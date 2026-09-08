import { query, queryOne } from "@/lib/db";
import { agregarFiltro } from "@/lib/filtros";
import { PROVEEDORES_NO_MERCADERIA } from "@/lib/stock";
import {
  DIAS_PARA_LLEGAR_A_FULL,
  UMBRAL_RECLAMO_UNIDADES,
} from "@/lib/trazabilidad-full";
import type {
  DashboardTrazabilidad,
  FilaTrazabilidad,
  FiltrosTrazabilidad,
  KpisTrazabilidad,
  PuntoTrazabilidad,
} from "@/lib/types";

/**
 * Consultas de la trazabilidad de Full. La cuenta y por qué es así están en
 * lib/trazabilidad-full.ts; acá está cómo se arma con lo que hay en la base.
 *
 * Cruza tres fuentes que llegan por caminos distintos:
 *
 *   bronze.ml_stock_full_historico  la foto diaria de lo que Mercado Libre dice
 *                                   que tiene. La guarda mercadolibre.py.
 *   bronze.digip_envios_full        lo que despachamos, por articulo. La guarda
 *                                   digip_envios_full.py, con unidadesSatisfecha.
 *   gold.fact_ventas                lo que se vendio por Mercado Libre.
 *
 * La foto es POR INVENTARIO y todo lo demas por SKU, asi que primero hay que
 * pasar de un mundo al otro. Varias publicaciones comparten inventario --por eso
 * se agrupa antes de sumar-- y el SKU vive adentro del array `attributes`, no en
 * `seller_custom_field`, que esta vacio en casi todas.
 */

const SKU_DE_PUBLICACION = `(select a->>'value_name'
     from jsonb_array_elements(p.attributes::jsonb) a
    where a->>'id' = 'SELLER_SKU'
    limit 1)`;

/**
 * $1 es la fecha desde la que se cuenta: la linea de base.
 *
 * El primer dia de la foto NO puede generar una sorpresa --no hay dia anterior
 * con que compararlo-- asi que el saldo arranca a contar al dia siguiente. Es
 * exactamente lo que quiere decir "tomar el stock de hoy y empezar a contar
 * desde manana".
 */
const BASE = `
with por_inv as (
  select p.inventory_id, max(${SKU_DE_PUBLICACION}) as sku
  from bronze.ml_publicaciones p
  where p."shipping.logistic_type" = 'fulfillment'
    and p.inventory_id is not null
  group by p.inventory_id
),
declarado as (
  select h.fecha, i.sku, sum(h.total) as total
  from bronze.ml_stock_full_historico h
  join por_inv i on i.inventory_id = h.inventory_id
  where i.sku is not null
  group by h.fecha, i.sku
),
movimiento as (
  select d.fecha, d.sku, d.total,
         lag(d.total) over (partition by d.sku order by d.fecha) as total_ayer
  from declarado d
),
ventas as (
  select sku, fecha, sum(cantidad) as u
  from gold.fact_ventas
  where canal = 'Mercado Libre'
  group by sku, fecha
),
envios as (
  -- Se agrupa por el DIA del despacho. La hora no sirve para nada acá: la foto
  -- de Mercado Libre es diaria, asi que el maximo detalle posible es el dia.
  select sku, left(fecha_estado, 10)::date as fecha, sum(unidades_satisfecha) as u
  from bronze.digip_envios_full
  where sku is not null and fecha_estado is not null
  group by sku, left(fecha_estado, 10)::date
),
dia as (
  select m.fecha,
         m.sku,
         m.total                                as declarado,
         coalesce(v.u, 0)                       as vendido,
         coalesce(e.u, 0)                       as enviado,
         (m.total - m.total_ayer) + coalesce(v.u, 0) as sorpresa
  from movimiento m
  left join ventas v on v.sku = m.sku and v.fecha = m.fecha
  left join envios e on e.sku = m.sku and e.fecha = m.fecha
  where m.total_ayer is not null
    and m.fecha > $1::date
),
calculada as (
  select d.sku,
         a.descripcion                          as producto,
         a."proveedorNombre"                    as proveedor,
         a."attributes.marca"                   as marca,
         coalesce(pg.grupo, 'QUO MKT')          as grupo,
         -- EL SALDO. La sorpresa sola no alcanza: una recepción entra como
         -- sorpresa positiva, así que un artículo que recibió 50 y perdió 3
         -- daría +47 y el faltante quedaría tapado. Restando lo enviado, lo
         -- que queda es lo que no explica ni la venta ni el envío.
         sum(d.sorpresa) - sum(d.enviado)       as neto,
         -- Lo despachado hace poco, que todavía puede estar viajando. Se
         -- muestra aparte para poder descontarlo antes de reclamar: sin esto
         -- 245 artículos parecerían faltantes cuando son 37.
         coalesce(sum(d.enviado) filter (
           where d.fecha > (select max(fecha) from dia) - ${DIAS_PARA_LLEGAR_A_FULL}
         ), 0)                                  as en_transito,
         sum(d.sorpresa) filter (where d.sorpresa < 0) as bruto_caidas,
         count(*) filter (where d.sorpresa < 0) as dias_con_caida,
         sum(d.enviado)                         as enviado,
         sum(d.vendido)                         as vendido,
         max(d.declarado) filter (where d.fecha = (select max(fecha) from dia)) as declarado_hoy,
         min(d.fecha) filter (where d.sorpresa < 0) as primera_caida,
         max(d.fecha) filter (where d.sorpresa < 0) as ultima_caida,
         coalesce(c.costo_real, 0)              as costo
  from dia d
  left join bronze.sigma_articulos a on trim(a.id) = d.sku
  left join bronze.proveedores_grupo pg on pg.proveedor = a."proveedorNombre"
  left join (
    select distinct on (sku) sku, costo_real
    from bronze.costos_historicos
    where costo_real > 0
    order by sku, mes_comercial desc
  ) c on c.sku = d.sku
  where coalesce(a."proveedorNombre", '') <> all($2::text[])
  group by d.sku, a.descripcion, a."proveedorNombre", a."attributes.marca",
           pg.grupo, c.costo_real
)`;

type Where = { sql: string; params: unknown[] };

function where(f: FiltrosTrazabilidad, desde: string): Where {
  const params: unknown[] = [desde, PROVEEDORES_NO_MERCADERIA];
  const clauses: string[] = [];

  agregarFiltro(clauses, params, "proveedor", f.proveedor);
  agregarFiltro(clauses, params, "grupo", f.grupo);
  agregarFiltro(clauses, params, "sku", f.sku);

  // Por defecto se muestran SOLO los que no cierran. Los que netean cero son el
  // 71 % y no hay nada que hacer con ellos: verlos todos convertiria la tabla en
  // un listado del catalogo.
  if (!f.todos) clauses.push("neto <> 0");
  if (f.soloReclamables) clauses.push(`neto + en_transito <= -${UMBRAL_RECLAMO_UNIDADES}`);

  if (f.buscar) {
    params.push(`%${f.buscar}%`);
    clauses.push(`(sku ilike $${params.length} or producto ilike $${params.length})`);
  }

  return { sql: clauses.length ? `where ${clauses.join(" and ")}` : "", params };
}

const num = (v: unknown): number => Number(v ?? 0);

/**
 * Desde cuando hay foto diaria. Es el piso de todo: sin dos dias seguidos no
 * hay movimiento que mirar.
 */
async function getRango(): Promise<{ desde: string | null; hasta: string | null; dias: number }> {
  const fila = await queryOne<{ desde: string | null; hasta: string | null; dias: string }>(
    `select min(fecha)::text as desde, max(fecha)::text as hasta,
            count(distinct fecha) as dias
       from bronze.ml_stock_full_historico`,
  );
  return { desde: fila?.desde ?? null, hasta: fila?.hasta ?? null, dias: num(fila?.dias) };
}

async function getKpis(f: FiltrosTrazabilidad, desde: string): Promise<KpisTrazabilidad> {
  const w = where({ ...f, todos: true, soloReclamables: false }, desde);
  const fila = await queryOne<Record<string, string>>(
    `${BASE}
     select count(*)                                                as skus,
            count(*) filter (where neto = 0)                        as skus_en_orden,
            count(*) filter (where neto + en_transito <= -${UMBRAL_RECLAMO_UNIDADES}) as skus_reclamables,
            coalesce(sum(neto), 0)                                  as neto,
            coalesce(-sum(neto + en_transito) filter (where neto + en_transito <= -${UMBRAL_RECLAMO_UNIDADES}), 0) as u_reclamables,
            coalesce(-sum((neto + en_transito) * costo) filter (where neto + en_transito <= -${UMBRAL_RECLAMO_UNIDADES}), 0) as plata_reclamable,
            coalesce(sum(bruto_caidas), 0)                          as bruto_caidas,
            coalesce(sum(enviado), 0)                               as enviado,
            coalesce(sum(vendido), 0)                               as vendido
     from calculada ${w.sql}`,
    w.params,
  );
  return {
    skus: num(fila?.skus),
    skusEnOrden: num(fila?.skus_en_orden),
    skusReclamables: num(fila?.skus_reclamables),
    neto: num(fila?.neto),
    unidadesReclamables: num(fila?.u_reclamables),
    plataReclamable: num(fila?.plata_reclamable),
    brutoCaidas: num(fila?.bruto_caidas),
    enviado: num(fila?.enviado),
    vendido: num(fila?.vendido),
  };
}

/**
 * La serie diaria del conjunto. Muestra de un vistazo por que la alerta no
 * puede ser diaria: las barras suben y bajan todos los dias, y el acumulado
 * --la linea-- es el que se queda quieto.
 */
async function getSerie(
  f: FiltrosTrazabilidad,
  desde: string,
): Promise<PuntoTrazabilidad[]> {
  // Los filtros se aplican sobre `dia` y no sobre `calculada`: la serie es por
  // fecha, no por artículo. Se repiten las mismas columnas para que el gráfico
  // muestre exactamente el mismo conjunto que la tabla de abajo -- si no, al
  // filtrar un proveedor el gráfico seguiría contando a todos y las dos cosas
  // dirían números distintos sin avisar.
  const params: unknown[] = [desde, PROVEEDORES_NO_MERCADERIA];
  const clauses: string[] = [`coalesce(a."proveedorNombre", '') <> all($2::text[])`];

  agregarFiltro(clauses, params, `a."proveedorNombre"`, f.proveedor);
  agregarFiltro(clauses, params, `coalesce(pg.grupo, 'QUO MKT')`, f.grupo);
  agregarFiltro(clauses, params, "d.sku", f.sku);

  const filas = await query<Record<string, string>>(
    `${BASE},
     por_dia as (
       select d.fecha,
              sum(d.sorpresa) as sorpresa,
              sum(d.enviado)  as enviado,
              sum(d.vendido)  as vendido
       from dia d
       left join bronze.sigma_articulos a on trim(a.id) = d.sku
       left join bronze.proveedores_grupo pg on pg.proveedor = a."proveedorNombre"
       where ${clauses.join(" and ")}
       group by d.fecha
     )
     select fecha::text as fecha, sorpresa, enviado, vendido,
            -- El saldo corrido, con la MISMA cuenta que la tabla: la sorpresa
            -- menos lo enviado. Es la cuenta corriente, y su forma es lo que
            -- contesta la pregunta: si baja sostenido, hay algo que reclamar.
            sum(sorpresa - enviado) over (order by fecha) as acumulado
     from por_dia order by fecha`,
    params,
  );
  return filas.map((r) => ({
    fecha: String(r.fecha),
    sorpresa: num(r.sorpresa),
    enviado: num(r.enviado),
    vendido: num(r.vendido),
    acumulado: num(r.acumulado),
  }));
}

/** Tope de filas. Una revision de mas de 300 articulos no la hace nadie. */
const TOPE = 300;

async function getFilas(f: FiltrosTrazabilidad, desde: string): Promise<FilaTrazabilidad[]> {
  const w = where(f, desde);
  const filas = await query<Record<string, unknown>>(
    `${BASE}
     select sku, producto, proveedor, marca, grupo,
            neto, en_transito, bruto_caidas, dias_con_caida, enviado, vendido, declarado_hoy,
            primera_caida::text as primera_caida,
            ultima_caida::text  as ultima_caida,
            costo, (-(neto + en_transito) * costo) as plata
     from calculada ${w.sql}
     -- Lo mas negativo primero: es el orden en el que se revisa.
     order by (neto + en_transito) asc, costo desc
     limit ${TOPE}`,
    w.params,
  );
  return filas.map((r) => ({
    sku: r.sku as string,
    producto: (r.producto as string | null) ?? null,
    proveedor: (r.proveedor as string | null) ?? null,
    marca: (r.marca as string | null) ?? null,
    grupo: (r.grupo as string | null) ?? null,
    neto: num(r.neto),
    enTransito: num(r.en_transito),
    brutoCaidas: num(r.bruto_caidas),
    diasConCaida: num(r.dias_con_caida),
    enviado: num(r.enviado),
    vendido: num(r.vendido),
    declaradoHoy: num(r.declarado_hoy),
    primeraCaida: (r.primera_caida as string | null) ?? null,
    ultimaCaida: (r.ultima_caida as string | null) ?? null,
    costo: num(r.costo),
    plata: num(r.plata),
  }));
}

export async function getOpcionesTrazabilidad(desde: string) {
  const params = [desde, PROVEEDORES_NO_MERCADERIA];
  const [proveedores, grupos] = await Promise.all([
    query<{ v: string }>(
      `${BASE} select distinct proveedor as v from calculada
       where proveedor is not null order by 1`,
      params,
    ),
    query<{ v: string }>(
      `${BASE} select distinct grupo as v from calculada
       where grupo is not null order by 1`,
      params,
    ),
  ]);
  return { proveedores: proveedores.map((r) => r.v), grupos: grupos.map((r) => r.v) };
}

export async function getDashboardTrazabilidad(
  f: FiltrosTrazabilidad,
): Promise<DashboardTrazabilidad> {
  const rango = await getRango();

  // Sin dos dias de foto no hay ni un movimiento que mirar. Se devuelve vacio
  // con el rango, y la pantalla explica que falta -- en vez de mostrar ceros
  // que se leerian como "todo en orden".
  if (!rango.desde || rango.dias < 2) {
    return {
      kpis: {
        skus: 0, skusEnOrden: 0, skusReclamables: 0, neto: 0,
        unidadesReclamables: 0, plataReclamable: 0, brutoCaidas: 0,
        enviado: 0, vendido: 0,
      },
      serie: [], filas: [], recortada: false,
      desde: rango.desde, hasta: rango.hasta, diasDeFoto: rango.dias,
    };
  }

  const desde = f.desde && f.desde > rango.desde ? f.desde : rango.desde;

  const [kpis, serie, filas] = await Promise.all([
    getKpis(f, desde),
    getSerie(f, desde),
    getFilas(f, desde),
  ]);

  return {
    kpis, serie, filas,
    recortada: filas.length >= TOPE,
    desde, hasta: rango.hasta, diasDeFoto: rango.dias,
  };
}
