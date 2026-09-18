import { cacheado } from "@/lib/cache";
import { query, queryOne } from "@/lib/db";
import type {
  ComprobanteVencido,
  DashboardCuentas,
  FilaCliente,
  FiltrosCuentas,
  OpcionesCuentas,
  PuntoEtiqueta,
  PuntoHistorial,
} from "@/lib/types";
import { agregarFiltro, vacio } from "@/lib/filtros";

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

  if (!omitir.includes("vendedor")) agregarFiltro(clauses, params, `${alias}.vendedor`, f.vendedor);
  if (!omitir.includes("empresa")) agregarFiltro(clauses, params, `${alias}.empresa`, f.empresa);

  if (!vacio(f.categoria) && !omitir.includes("categoria")) {
    params.push(f.categoria);
    clauses.push(
      conCategoria
        ? `${alias}.categoria = any($${params.length}::text[])`
        : // aging y cancelaciones no tienen categoría: se resuelve por cuit.
          `${alias}.cuit in (select s.cuit from bronze.cuentas_corrientes_scoring s
                             where s.categoria = any($${params.length}::text[]))`,
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

/**
 * La evolución del saldo vencido, un punto por mes.
 *
 * DE DÓNDE SALE. `_historial_scoring` es una FOTO: una fila por cliente y por
 * mes, con el día en que se sacó. La saca `foto_cuentas.py` desde
 * `_scoring` —que dice cómo está cada cliente hoy y se pisa entera en cada
 * carga— así que lo que no se fotografió antes de que la pisaran no existe.
 *
 * Por eso viaja `fecha`: la barra del mes en curso es la foto de un día suelto,
 * no el cierre del mes, y la pantalla lo dice para que una barra más baja no se
 * lea como "bajó la mora" cuando es "todavía no terminó el mes".
 *
 * `fecha` es texto DD/MM/YYYY, así que el máximo se toma sobre la fecha de
 * verdad: en texto, 09/09 sería mayor que 16/09.
 */
/**
 * Los comprobantes vencidos, UNO POR UNO.
 *
 * POR QUE EXISTE, que es la parte importante.
 *
 * La tabla "Clientes y Saldos" muestra una fila por cliente: la SUMA de lo
 * vencido y, al lado, el atraso del comprobante MAS VIEJO. Leídas juntas, esas
 * dos celdas dicen algo que no es cierto.
 *
 * El caso real, al 18/09/2026: JESUS GUILLERMO TORRES debe $ 751.451 repartidos
 * en CUATRO comprobantes, con atrasos de 14, y hasta 246 días. La fila del
 * cliente dice "$ 751.451 · 246 días", como si todo estuviera vencido hace ocho
 * meses. Para decidir a quién llamar primero, eso es una lectura falsa.
 *
 * Acá cada comprobante trae SU plata y SUS días, sin sumar nada. La fila del
 * cliente sigue estando --sirve para ver el total de la cuenta-- pero el
 * detalle para ir a cobrar sale de esta tabla.
 *
 * SALE DE `aging` Y NO DE `scoring`, y por eso los dos totales pueden no dar
 * igual: `scoring` guarda un saldo por CLIENTE ya consolidado y `aging` una
 * fila por COMPROBANTE. Un pago a cuenta que todavía no se imputó baja el
 * primero y no baja ninguna fila del segundo.
 */
async function getComprobantesVencidos(
  f: FiltrosCuentas,
): Promise<ComprobanteVencido[]> {
  // `false`: aging no tiene columna categoría, se resuelve por cuit.
  const w = whereCuentas(f, "a", false);
  return query<ComprobanteVencido>(
    `select a.comprobante,
            -- Las fechas vienen como texto dd/mm/yyyy: se dan vuelta acá para
            -- que la pantalla reciba el mismo formato que el resto del tablero
            -- y para que ordenen por fecha y no alfabéticamente.
            to_char(to_date(a.fecha, 'DD/MM/YYYY'), 'YYYY-MM-DD')       as fecha,
            to_char(to_date(a.vencimiento, 'DD/MM/YYYY'), 'YYYY-MM-DD') as vencimiento,
            a.razon_social                    as cliente,
            a.empresa,
            a.vendedor,
            coalesce(a.total, 0)::float8      as total,
            coalesce(a.pendiente, 0)::float8  as adeuda,
            coalesce(a.atraso, 0)::float8     as "diasVencido"
     from bronze.cuentas_corrientes_aging a
     where ${w.sql}
       and coalesce(a.atraso, 0) > 0
       -- Un comprobante saldado no es una deuda vencida aunque su fecha haya
       -- pasado. Sin esto la tabla listaría todo el histórico cobrado.
       and coalesce(a.pendiente, 0) > 0
       -- Sólo la última foto: la tabla guarda una por carga y sin esto cada
       -- comprobante saldría repetido una vez por día cargado.
       and a.fecha_carga = (select max(fecha_carga) from bronze.cuentas_corrientes_aging)
     order by a.atraso desc nulls last, a.pendiente desc
     limit 500`,
    w.params,
  );
}

async function getHistorial(f: FiltrosCuentas): Promise<PuntoHistorial[]> {
  const w = whereCuentas(f, "h");
  return query<PuntoHistorial>(
    `select h.periodo as label,
            coalesce(sum(h.saldo_vencido), 0)::float8 as valor,
            to_char(max(to_date(h.fecha, 'DD/MM/YYYY')), 'DD/MM/YYYY') as fecha
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

async function getOpcionesCuentasDirecto(): Promise<OpcionesCuentas> {
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

async function getDashboardCuentasDirecto(f: FiltrosCuentas): Promise<DashboardCuentas> {
  const [
    saldos,
    actividad,
    vencidosQueCompran,
    clientes,
    categorias,
    aging,
    comprobantesVencidos,
    historial,
    cancelaciones,
  ] = await Promise.all([
    getSaldos(f),
    getActividad(f),
    getVencidosQueCompran(f),
    getClientes(f),
    getPorCategoria(f),
    getAging(f),
    getComprobantesVencidos(f),
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
    comprobantesVencidos,
    historial,
    cancelacionesPorVendedor: cancelaciones,
    generadoEn: new Date().toISOString(),
  };
}


/* ---------------------------------------------------------------------------
   LAS ENTRADAS QUE CONSUME LA RUTA, CACHEADAS.

   Se envuelven acá al final y no en la ruta para que cualquier consumidor
   futuro herede el caché sin acordarse de pedirlo. La version sin cachear
   queda como `...Directo` por si alguna vez hace falta saltearlo.

   Ver lib/cache.ts para por que esto es seguro (y cuando dejaria de serlo).
   --------------------------------------------------------------------------- */
export const getOpcionesCuentas = cacheado(
  "cuentas:opciones",
  getOpcionesCuentasDirecto,
);
export const getDashboardCuentas = cacheado(
  "cuentas:dashboard",
  getDashboardCuentasDirecto,
);
