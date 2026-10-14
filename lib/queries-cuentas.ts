import { cacheado } from "@/lib/cache";
import { query, queryOne } from "@/lib/db";
import type {
  ComprobanteCliente,
  ComprobanteVencido,
  DashboardCuentas,
  FilaCliente,
  FiltrosCuentas,
  OpcionesCuentas,
  PuntoEtiqueta,
  PuntoHistorial,
  PuntoRecupero,
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
  // Las tres tablas --scoring, aging e historial-- tienen `razon_social` y
  // `cuit`, así que el buscador de abajo sirve con cualquiera de los alias.
  const params: unknown[] = [];
  const clauses: string[] = ["true"];

  if (!omitir.includes("vendedor")) agregarFiltro(clauses, params, `${alias}.vendedor`, f.vendedor);
  if (!omitir.includes("empresa")) agregarFiltro(clauses, params, `${alias}.empresa`, f.empresa);

  // EL BUSCADOR PEGA CONTRA EL NOMBRE Y CONTRA EL CUIT. El CUIT entra sin
  // guiones de los dos lados: en la base está "20-11111111-1" y nadie lo
  // escribe así cuando lo está buscando.
  if (f.buscar && f.buscar.trim() && !omitir.includes("buscar")) {
    params.push(`%${f.buscar.trim().toUpperCase()}%`);
    const i = params.length;
    params.push(`%${f.buscar.replace(/[^0-9A-Za-z]/g, "")}%`);
    const j = params.length;
    clauses.push(
      `(upper(${alias}.razon_social) like $${i} or ` +
        `regexp_replace(${alias}.cuit, '[^0-9A-Za-z]', '', 'g') like $${j})`,
    );
  }

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

/**
 * La tabla de clientes, DESDE LA FOTO MENSUAL y no desde `scoring`.
 *
 * POR QUE EL HISTORIAL. `scoring` se pisa entera en cada carga: es cómo está
 * cada cliente hoy y nada más. `historial_scoring` guarda una fila por cliente
 * y por mes, así que la misma tabla puede contestar "cómo está hoy" y "cómo
 * estaba en agosto" sin cambiar de fuente.
 *
 * Y tiene MÁS CLIENTES: 211 CUIT contra los 111 de `scoring`, porque ahí sólo
 * quedan los que hoy deben algo. Un cliente que canceló el mes pasado
 * desaparece de `scoring` y sigue en el historial.
 *
 * SE TOMA EL PERIODO MAS NUEVO. Es una FOTO, no el estado en vivo: la del mes
 * en curso se sacó el día que corrió la planilla. La pantalla lo dice, porque
 * una deuda de hace seis días leída como "ahora" hace llamar a quien ya pagó.
 */
async function getClientes(f: FiltrosCuentas): Promise<FilaCliente[]> {
  const w = whereCuentas(f, "h");
  return query<FilaCliente>(
    `select h.razon_social as "razonSocial",
            h.categoria,
            h.vendedor,
            h.cuit,
            h.periodo,
            coalesce(h.saldo_total, 0)::float8 as "saldoTotal",
            coalesce(h.saldo_vencido, 0)::float8 as "saldoVencido",
            h.atraso_max::float8 as "atrasoMax"
     from bronze.cuentas_corrientes_historial_scoring h
     where ${w.sql}
       and h.periodo = (select max(periodo) from bronze.cuentas_corrientes_historial_scoring)
     order by h.saldo_vencido desc nulls last, h.saldo_total desc nulls last
     limit 300`,
    w.params,
  );
}

/** De qué foto sale la tabla de clientes, para que la pantalla lo diga. */
async function getPeriodoClientes(): Promise<string> {
  const fila = await queryOne<{ v: string | null; f: string | null }>(
    `select max(periodo) as v,
            to_char(max(to_date(fecha, 'DD/MM/YYYY')), 'DD/MM/YYYY') as f
       from bronze.cuentas_corrientes_historial_scoring`,
  );
  return fila?.f ? `${fila.v} · foto del ${fila.f}` : (fila?.v ?? "");
}

/**
 * Los comprobantes de cada cliente, agrupados por CUIT.
 *
 * VAN TODOS DE UNA con el resto del tablero. `aging` tiene 208 filas en total,
 * así que mandarlas enteras cuesta menos que el primer pedido extra al abrir
 * una fila --y evita el parpadeo de abrir y esperar. El día que sean miles
 * habrá que darlo vuelta y pedirlas por cliente.
 *
 * NO SE FILTRA POR `atraso > 0`: ver la nota del tipo. El desglose tiene que
 * cerrar contra el saldo total de la fila, y ahí entran los que aún no vencen.
 */
async function getComprobantesPorCuit(
  f: FiltrosCuentas,
): Promise<Record<string, ComprobanteCliente[]>> {
  // `false`: aging no tiene columna categoría, se resuelve por cuit.
  const w = whereCuentas(f, "a", false);
  const filas = await query<ComprobanteCliente & { cuit: string }>(
    `select a.cuit,
            a.comprobante,
            to_char(to_date(a.fecha, 'DD/MM/YYYY'), 'YYYY-MM-DD')       as fecha,
            to_char(to_date(a.vencimiento, 'DD/MM/YYYY'), 'YYYY-MM-DD') as vencimiento,
            coalesce(a.total, 0)::float8     as total,
            coalesce(a.pendiente, 0)::float8 as pendiente,
            coalesce(a.atraso, 0)::float8    as atraso
     from bronze.cuentas_corrientes_aging a
     where ${w.sql}
       and coalesce(a.pendiente, 0) > 0
       -- Sólo la última foto, igual que la tabla de comprobantes vencidos: la
       -- tabla guarda una por carga y sin esto cada comprobante saldría
       -- repetido una vez por día cargado.
       and a.fecha_carga = (select max(fecha_carga) from bronze.cuentas_corrientes_aging)
     order by a.atraso desc nulls last, a.pendiente desc`,
    w.params,
  );

  const porCuit: Record<string, ComprobanteCliente[]> = {};
  for (const { cuit, ...resto } of filas) {
    (porCuit[cuit] ??= []).push(resto);
  }
  return porCuit;
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

/* ---------------------------------------------------------------------------
   LAS CANCELACIONES, UNA POR CLIENTE Y POR MES.

   Esta sub-consulta la comparten los dos gráficos de cancelaciones, y existe
   por dos razones que no son de gusto.

   1. EL PERÍODO VIENE EN DOS FORMAS. La planilla escribía `Historial_Cancelaciones`
      leyendo la celda de fecha con `String(...)`, así que en la tabla conviven

          2026-07                                            (la forma correcta)
          Wed Jul 01 2026 00:00:00 GMT-0300 (...)             (la vieja)

      y la vieja encima en dos variantes, porque ese texto incluye EL NOMBRE DE
      LA ZONA HORARIA y cambia con el idioma del servidor que corrió el trigger.
      Agrupar por la columna cruda daría dos o tres barras para un mismo mes.

   2. LA CLAVE PRIMARIA ES (cuit, periodo_con_mora), así que esas variantes NO
      se pisaron entre sí al subir: los mismos 76 clientes entraron dos veces.
      Al 13/10/2026 la tabla tiene 152 filas para 76 cancelaciones, y el
      gráfico por vendedor venía mostrando $ 127 M donde la plata real es
      $ 63,8 M.

   El arreglo de la planilla está en `apps_script/cancelaciones_periodo.gs` del
   orquestador, pero NO alcanza con arreglar el origen: las filas viejas se
   quedan como están hasta que alguien las borre. Mientras existan, el
   `distinct on` es lo que hace que la pantalla diga la verdad.

   Y no es un parche: "un cliente canceló su mora del mes X" es UN hecho, así
   que una fila por (cuit, mes) es la forma correcta de contarlo incluso con la
   tabla limpia. Gana la detección MÁS VIEJA, que es la fecha en que el cliente
   realmente se puso al día.
   --------------------------------------------------------------------------- */
const PERIODO_CANCELACION = `
  case
    -- La forma correcta, que es la que escribe la planilla arreglada.
    when c.periodo_con_mora ~ '^\\d{4}-\\d{2}' then left(c.periodo_con_mora, 7)
    -- La vieja: "Wed Jul 01 2026 ...". Se le sacan los 11 caracteres del medio
    -- ("Jul 01 2026") y se parsean. 'Mon' en to_date es siempre inglés --no
    -- depende de lc_time-- así que esto no se rompe según el locale del server.
    when c.periodo_con_mora ~ '^\\w{3} \\w{3} \\d{2} \\d{4}'
      then to_char(to_date(substring(c.periodo_con_mora from 5 for 11), 'Mon DD YYYY'), 'YYYY-MM')
    else c.periodo_con_mora
  end`;

function cancelacionesUnicas(where: string) {
  return `
    normalizadas as (
      select c.*, ${PERIODO_CANCELACION} as periodo
      from bronze.cuentas_corrientes_cancelaciones c
      where ${where}
    ),
    unicas as (
      select distinct on (periodo, cuit) *
      from normalizadas
      order by periodo, cuit, to_date(fecha_deteccion, 'DD/MM/YYYY') asc
    )`;
}

/**
 * Cuánta mora se recuperó, mes a mes.
 *
 * QUÉ ES EL MES DEL EJE, porque acá se puede leer mal. Es el `periodo_con_mora`:
 * el mes en que el cliente ADEUDABA, no el mes en que pagó. La detección es
 * siempre posterior --la planilla compara la última foto contra el estado de
 * hoy-- y `fecha_deteccion` la guarda aparte.
 *
 * Se eligió ese mes a propósito, para que este gráfico se lea JUNTO al de
 * "Evolución del saldo vencido", que también va por período: en el mes X había
 * tanto vencido, y de eso se terminó recuperando tanto. Con la fecha de
 * detección en el eje los dos gráficos no se podrían comparar barra a barra.
 *
 * VIAJA LA CANTIDAD DE CLIENTES además del monto. $ 5 M recuperados de doce
 * clientes y $ 5 M de uno solo son la misma barra y dos situaciones distintas,
 * así que el número va en el tooltip. NO va como segunda serie ni como segundo
 * eje: son unidades distintas y apilarlas daría una altura que no significa
 * nada.
 */
async function getCancelacionesPorMes(f: FiltrosCuentas): Promise<PuntoRecupero[]> {
  const w = whereCuentas(f, "c", false);
  return query<PuntoRecupero>(
    `with ${cancelacionesUnicas(w.sql)}
     select periodo as label,
            coalesce(sum(saldo_vencido_cancelado), 0)::float8 as valor,
            count(*)::int as clientes
     from unicas
     group by periodo
     order by periodo`,
    w.params,
  );
}

async function getCancelaciones(f: FiltrosCuentas): Promise<PuntoEtiqueta[]> {
  const w = whereCuentas(f, "c", false, ["vendedor"]);
  return query<PuntoEtiqueta>(
    `with ${cancelacionesUnicas(w.sql)}
     select coalesce(vendedor, '—') as label,
            coalesce(sum(saldo_vencido_cancelado), 0)::float8 as valor
     from unicas
     group by vendedor order by valor desc nulls last`,
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
    comprobantesPorCuit,
    periodoClientes,
    historial,
    cancelaciones,
    cancelacionesMes,
  ] = await Promise.all([
    getSaldos(f),
    getActividad(f),
    getVencidosQueCompran(f),
    getClientes(f),
    getPorCategoria(f),
    getAging(f),
    getComprobantesVencidos(f),
    getComprobantesPorCuit(f),
    getPeriodoClientes(),
    getHistorial(f),
    getCancelaciones(f),
    getCancelacionesPorMes(f),
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
    comprobantesPorCuit,
    periodoClientes,
    historial,
    cancelacionesPorVendedor: cancelaciones,
    cancelacionesPorMes: cancelacionesMes,
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
