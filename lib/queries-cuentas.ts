import { query, queryOne } from "@/lib/db";
import type {
  DashboardCuentas,
  FilaCliente,
  FiltrosCuentas,
  OpcionesCuentas,
  PuntoEtiqueta,
} from "@/lib/types";

/**
 * Página "Cuentas Corrientes" — equivalente de la página homónima de Power BI.
 *
 * Tablas: `bronze.cuentas_corrientes_scoring` (una fila por cliente, es la
 * tabla madre), `_aging` (una fila por comprobante impago), `_historial_scoring`
 * (foto mensual) y `_cancelaciones` (clientes que salieron de mora).
 * Las tres últimas cruzan con scoring por `cuit`, cobertura 100%.
 *
 * ⚠️ Diferencia con el modelo de Power BI: allá la relación con las ventas es
 * `fact_ventas[comprobante] -> aging[comprobante]`, que con los datos reales NO
 * matchea ni una fila, porque `fact_ventas` guarda el comprobante con un
 * prefijo de tipo ('F-B93-00001281' contra 'B93-00001281'). Acá se usan las dos
 * formas corregidas:
 *   - por comprobante, sacando el prefijo  -> 209 de 252 (83%)
 *   - por nombre de cliente normalizado    -> 118 de 129 clientes, 96% de la deuda
 * El cruce por nombre es el que tiene mejor cobertura, así que es el que se usa
 * para las métricas que mezclan ventas con deuda.
 */

type Where = { sql: string; params: unknown[] };

/**
 * Filtros sobre cualquier tabla que tenga `vendedor` y `empresa` propios.
 * `omitir` desactiva uno para una consulta puntual: los gráficos que desglosan
 * por categoría (o por vendedor) siguen mostrando el panorama completo aunque
 * haya uno seleccionado, si no quedan con una sola barra.
 */
function whereCuentas(
  f: FiltrosCuentas,
  alias: string,
  conCategoria = true,
  omitir: (keyof FiltrosCuentas)[] = [],
): Where {
  const params: unknown[] = [];
  const clauses: string[] = ["true"];

  if (f.vendedor && !omitir.includes("vendedor")) {
    params.push(f.vendedor);
    clauses.push(`${alias}.vendedor = $${params.length}`);
  }
  if (f.empresa && !omitir.includes("empresa")) {
    params.push(f.empresa);
    clauses.push(`${alias}.empresa = $${params.length}`);
  }
  if (f.categoria && !omitir.includes("categoria")) {
    params.push(f.categoria);
    clauses.push(
      conCategoria
        ? `${alias}.categoria = $${params.length}`
        : // aging y cancelaciones no tienen categoría: se resuelve por cuit.
          `${alias}.cuit in (select s.cuit from bronze.cuentas_corrientes_scoring s
                             where s.categoria = $${params.length})`,
    );
  }

  return { sql: clauses.join(" and "), params };
}

/** Normalización usada para cruzar `fact_ventas.cliente` con `scoring.razon_social`. */
const CLIENTE_NORMALIZADO = "upper(btrim(fv.cliente))";

// --- KPIs --------------------------------------------------------------------

type FilaSaldos = {
  deudaTotal: number;
  deudaVencida: number;
  clientesEnRiesgo: string;
  clientesTotales: string;
};

async function getSaldos(f: FiltrosCuentas) {
  const w = whereCuentas(f, "s");
  const fila = await queryOne<FilaSaldos>(
    `select coalesce(sum(s.saldo_total), 0)::float8 as "deudaTotal",
            coalesce(sum(s.saldo_vencido), 0)::float8 as "deudaVencida",
            count(distinct s.razon_social) filter (
              where s.categoria in ('CRÍTICO', 'RIESGOSO')
            ) as "clientesEnRiesgo",
            count(distinct s.razon_social) as "clientesTotales"
     from bronze.cuentas_corrientes_scoring s
     where ${w.sql}`,
    w.params,
  );
  return {
    deudaTotal: fila?.deudaTotal ?? 0,
    deudaVencida: fila?.deudaVencida ?? 0,
    clientesEnRiesgo: Number(fila?.clientesEnRiesgo ?? 0),
    clientesTotales: Number(fila?.clientesTotales ?? 0),
  };
}

/**
 * Actividad de compra: espeja [Clientes Activos (60d)] / [Clientes Inactivos (60d)].
 *
 * ⚠️ Diferencia deliberada con Power BI: allá la medida es
 * `DISTINCTCOUNT(fact_ventas[cliente])` sobre TODA la tabla de ventas, que
 * incluye los compradores minoristas de Mercado Libre y Tienda Nube — da más
 * de 30.000 clientes y en esta página no significa nada. Acá se cuenta solo
 * sobre el universo de cuentas corrientes (los clientes de `scoring`), que es
 * lo que la página está mirando. Los que nunca compraron cuentan como inactivos.
 */
async function getActividad(f: FiltrosCuentas) {
  const w = whereCuentas(f, "s");
  const fila = await queryOne<{ activos: string; total: string }>(
    `with clientes as (
       select upper(btrim(s.razon_social)) as clave
       from bronze.cuentas_corrientes_scoring s
       where ${w.sql}
     ),
     ultima as (
       select ${CLIENTE_NORMALIZADO} as clave, max(fv.fecha) as ultima_compra
       from gold.fact_ventas fv
       where fv.cliente is not null
       group by 1
     )
     select count(*) filter (
              where u.ultima_compra is not null and current_date - u.ultima_compra <= 60
            ) as activos,
            count(*) as total
     from clientes c
     left join ultima u on u.clave = c.clave`,
    w.params,
  );

  const activos = Number(fila?.activos ?? 0);
  const total = Number(fila?.total ?? 0);
  return { clientesActivos60d: activos, clientesInactivos60d: total - activos };
}

/**
 * [Clientes Vencidos Que Siguen Comprando]: clientes con saldo vencido cuya
 * última compra es posterior al vencimiento impago más viejo.
 * `aging.vencimiento` es texto en formato DD/MM/YYYY.
 */
async function getVencidosQueCompran(f: FiltrosCuentas) {
  const w = whereCuentas(f, "s");
  const fila = await queryOne<{ n: string }>(
    `with venc as (
       select a.cuit, min(to_date(a.vencimiento, 'DD/MM/YYYY')) as venc_mas_viejo
       from bronze.cuentas_corrientes_aging a
       where a.atraso > 0 and coalesce(a.vencimiento, '') <> ''
       group by a.cuit
     ),
     compras as (
       select ${CLIENTE_NORMALIZADO} as cliente, max(fv.fecha) as ultima_compra
       from gold.fact_ventas fv
       where fv.cliente is not null
       group by 1
     )
     select count(*) as n
     from bronze.cuentas_corrientes_scoring s
     join venc v on v.cuit = s.cuit
     join compras c on c.cliente = upper(btrim(s.razon_social))
     where ${w.sql} and s.saldo_vencido > 0 and c.ultima_compra > v.venc_mas_viejo`,
    w.params,
  );
  return Number(fila?.n ?? 0);
}

// --- Tabla y gráficos --------------------------------------------------------

async function getClientes(f: FiltrosCuentas): Promise<FilaCliente[]> {
  const w = whereCuentas(f, "s");
  return query<FilaCliente>(
    `select s.razon_social as "razonSocial",
            s.categoria,
            s.vendedor,
            coalesce(s.saldo_total, 0)::float8 as "saldoTotal",
            coalesce(s.saldo_vencido, 0)::float8 as "saldoVencido",
            s.atraso_max::float8 as "atrasoMax"
     from bronze.cuentas_corrientes_scoring s
     where ${w.sql}
     order by s.saldo_vencido desc nulls last, s.saldo_total desc nulls last
     limit 100`,
    w.params,
  );
}

async function getPorCategoria(f: FiltrosCuentas) {
  const w = whereCuentas(f, "s", true, ["categoria"]);
  const [deuda, clientes] = await Promise.all([
    query<PuntoEtiqueta>(
      `select coalesce(s.categoria, '—') as label,
              coalesce(sum(s.saldo_total), 0)::float8 as valor
       from bronze.cuentas_corrientes_scoring s
       where ${w.sql} group by s.categoria order by valor desc nulls last`,
      w.params,
    ),
    query<PuntoEtiqueta>(
      `select coalesce(s.categoria, '—') as label,
              count(distinct s.razon_social)::float8 as valor
       from bronze.cuentas_corrientes_scoring s
       where ${w.sql} group by s.categoria order by valor desc nulls last`,
      w.params,
    ),
  ]);
  return { deuda, clientes };
}

/** Buckets de antigüedad: traducción del SWITCH de la columna calculada. */
async function getAging(f: FiltrosCuentas): Promise<PuntoEtiqueta[]> {
  const w = whereCuentas(f, "a", false);
  return query<PuntoEtiqueta>(
    `select case when a.atraso is null then 'Sin dato'
                 when a.atraso < 0 then 'No vencido'
                 when a.atraso <= 30 then '0-30 días'
                 when a.atraso <= 60 then '31-60 días'
                 when a.atraso <= 90 then '61-90 días'
                 else '+90 días' end as label,
            coalesce(sum(a.pendiente), 0)::float8 as valor
     from bronze.cuentas_corrientes_aging a
     where ${w.sql}
     group by 1
     order by min(case when a.atraso is null then 5
                       when a.atraso < 0 then 0
                       when a.atraso <= 30 then 1
                       when a.atraso <= 60 then 2
                       when a.atraso <= 90 then 3
                       else 4 end)`,
    w.params,
  );
}

async function getHistorial(f: FiltrosCuentas): Promise<PuntoEtiqueta[]> {
  const w = whereCuentas(f, "h");
  return query<PuntoEtiqueta>(
    `select h.periodo as label, coalesce(sum(h.saldo_vencido), 0)::float8 as valor
     from bronze.cuentas_corrientes_historial_scoring h
     where ${w.sql}
     group by h.periodo order by h.periodo`,
    w.params,
  );
}

async function getCancelaciones(f: FiltrosCuentas): Promise<PuntoEtiqueta[]> {
  const w = whereCuentas(f, "c", false, ["vendedor"]);
  return query<PuntoEtiqueta>(
    `select coalesce(c.vendedor, '—') as label,
            coalesce(sum(c.saldo_vencido_cancelado), 0)::float8 as valor
     from bronze.cuentas_corrientes_cancelaciones c
     where ${w.sql}
     group by c.vendedor order by valor desc nulls last`,
    w.params,
  );
}

// --- Opciones ----------------------------------------------------------------

export async function getOpcionesCuentas(): Promise<OpcionesCuentas> {
  const columna = (col: string) =>
    query<{ valor: string }>(
      `select distinct s.${col} as valor from bronze.cuentas_corrientes_scoring s
       where s.${col} is not null and s.${col} <> '' order by valor`,
    );

  const [vendedores, empresas, categorias] = await Promise.all([
    columna("vendedor"),
    columna("empresa"),
    columna("categoria"),
  ]);

  return {
    vendedores: vendedores.map((r) => r.valor),
    empresas: empresas.map((r) => r.valor),
    categorias: categorias.map((r) => r.valor),
  };
}

// --- Dashboard completo ------------------------------------------------------

export async function getDashboardCuentas(f: FiltrosCuentas): Promise<DashboardCuentas> {
  const [saldos, actividad, vencidosQueCompran, clientes, categorias, aging, historial, cancelaciones] =
    await Promise.all([
      getSaldos(f),
      getActividad(f),
      getVencidosQueCompran(f),
      getClientes(f),
      getPorCategoria(f),
      getAging(f),
      getHistorial(f),
      getCancelaciones(f),
    ]);

  return {
    kpis: {
      ...saldos,
      ...actividad,
      clientesVencidosQueCompran: vencidosQueCompran,
      pctCarteraVencida: saldos.deudaTotal > 0 ? saldos.deudaVencida / saldos.deudaTotal : null,
    },
    clientes,
    deudaPorCategoria: categorias.deuda,
    clientesPorCategoria: categorias.clientes,
    aging,
    historial,
    cancelacionesPorVendedor: cancelaciones,
    generadoEn: new Date().toISOString(),
  };
}
