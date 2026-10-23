import { query, queryOne } from "@/lib/db";
import { CANAL_MELI } from "@/lib/meli";
import { ULTIMO_COSTO_VIGENTE } from "@/lib/sql-costos";
import { POR_INVENTARIO_SKU } from "@/lib/sql-meli";
import { PROVEEDORES_NO_MERCADERIA } from "@/lib/stock";
import {
  COLUMNAS_EN_RIESGO,
  REGLA_DESCARTE,
  type ClaveRespuesta,
  type DashboardTareasMeli,
  type FilaDescarte,
  type UltimaRespuesta,
} from "@/lib/tareas-meli";

/**
 * Consultas de "Mis tareas" (Mercado Libre). Reglas y por qué, en
 * lib/tareas-meli.ts. Las fuentes:
 *
 *   bronze.ml_stock_antiguedad    días en Full por FIFO, la última foto
 *   bronze.ml_stock_full          unidades aptas hoy
 *   gold.fact_ventas              la última venta por Mercado Libre
 *   bronze.sigma_articulos        producto, proveedor y marca
 *   bronze.costos_historicos      el costo con el que se valoriza
 *   app.tareas_meli_respuestas    lo que ya se contestó
 */

const REGLA = "riesgo_descarte";

/** Tope de filas que bajan al navegador. Es una bandeja, no un reporte. */
const TOPE = 300;

const num = (v: unknown): number => Number(v ?? 0);

/**
 * Los SKU que hoy cumplen la regla, más caros primero.
 *
 * $1 los proveedores que no son mercadería, $2 el canal, $3 los días sin venta.
 *
 * LA ANTIGÜEDAD SE AGRUPA POR SKU porque se guarda por inventario, y hay SKU
 * que usan más de uno: lo mismo que hace la pantalla de Antigüedad.
 */
const ALERTAS = `
with ant as (
  select a.sku,
         sum(${COLUMNAS_EN_RIESGO.map((c) => `a.${c}`).join(" + ")}) as u_riesgo,
         bool_or(a.incompleto) as parcial,
         case when sum(a.unidades) > 0
              then sum(a.dias_promedio * a.unidades) / sum(a.unidades)
         end as dias
  from bronze.ml_stock_antiguedad a
  where a.fecha = (select max(fecha) from bronze.ml_stock_antiguedad)
    and a.sku is not null
  group by a.sku
),
por_inv as (
  ${POR_INVENTARIO_SKU}
),
full_ml as (
  select i.sku, sum(coalesce(f.available_quantity, 0)) as aptas
  from bronze.ml_stock_full f
  join por_inv i on i.inventory_id = f.inventory_id
  where i.sku is not null
  group by i.sku
),
ventas as (
  -- Sólo Mercado Libre: lo que está en Full se vende por ahí. Una venta
  -- mayorista del mismo SKU sale de Tucumán y no mueve esas unidades.
  select sku, max(fecha) as ultima_venta
  from gold.fact_ventas
  where canal = $2
  group by sku
),
costo as (
  ${ULTIMO_COSTO_VIGENTE}
)
select ant.sku,
       ar.descripcion                         as producto,
       ar."proveedorNombre"                   as proveedor,
       ar."attributes.marca"                  as marca,
       ant.u_riesgo,
       ant.u_riesgo * coalesce(c.costo_real, 0) as valor_riesgo,
       coalesce(f.aptas, 0)                   as u_full,
       ant.dias                               as dias_en_full,
       to_char(v.ultima_venta, 'YYYY-MM-DD')  as ultima_venta,
       (current_date - v.ultima_venta)::int   as dias_sin_venta,
       coalesce(ant.parcial, false)           as parcial
from ant
left join full_ml f on f.sku = ant.sku
left join ventas v on v.sku = ant.sku
left join costo c on c.sku = ant.sku
left join bronze.sigma_articulos ar on trim(ar.id) = ant.sku
where ant.u_riesgo > 0
  and (v.ultima_venta is null or v.ultima_venta <= current_date - $3::int)
  and coalesce(ar."proveedorNombre", '') <> all($1::text[])
order by valor_riesgo desc, ant.u_riesgo desc`;

const PARAMS_ALERTAS = () => [
  PROVEEDORES_NO_MERCADERIA,
  CANAL_MELI,
  REGLA_DESCARTE.diasSinVenta,
];

/** Fecha de la foto de antigüedad. En un try por si la tabla no existe todavía. */
async function getFoto(): Promise<string | null> {
  try {
    const fila = await queryOne<{ fecha: string | null }>(
      `select to_char(max(fecha), 'YYYY-MM-DD') as fecha from bronze.ml_stock_antiguedad`,
    );
    return fila?.fecha ?? null;
  } catch {
    return null;
  }
}

/**
 * La última respuesta de cada SKU, o `null` si la tabla no existe.
 *
 * Distinguir "no hay respuestas" de "no hay tabla" es lo que deja publicar la
 * pantalla antes de aplicar la migración sin que mienta: con la tabla ausente
 * las alertas se ven igual, y los botones avisan en vez de fallar callados.
 */
async function getUltimas(skus: string[]): Promise<Map<string, UltimaRespuesta> | null> {
  try {
    const filas = await query<Record<string, unknown>>(
      `select distinct on (clave)
              clave, respuesta, motivo, nota, usuario,
              to_char(creado_en at time zone 'America/Argentina/Buenos_Aires',
                      'YYYY-MM-DD"T"HH24:MI') as creado_en,
              to_char(vence_en at time zone 'America/Argentina/Buenos_Aires',
                      'YYYY-MM-DD') as vence_en,
              vence_en > now() as vigente
       from app.tareas_meli_respuestas
       where regla = $1 and clave = any($2::text[])
       order by clave, creado_en desc`,
      [REGLA, skus],
    );
    return new Map(
      filas.map((r) => [
        r.clave as string,
        {
          respuesta: r.respuesta as ClaveRespuesta,
          motivo: (r.motivo as string | null) ?? null,
          nota: (r.nota as string | null) ?? null,
          usuario: r.usuario as string,
          creadoEn: r.creado_en as string,
          venceEn: r.vence_en as string,
          vigente: r.vigente === true,
        },
      ]),
    );
  } catch {
    return null;
  }
}

async function getSemana(): Promise<DashboardTareasMeli["semana"]> {
  try {
    const filas = await query<{ respuesta: ClaveRespuesta; cantidad: string }>(
      `select respuesta, count(*) as cantidad
       from app.tareas_meli_respuestas
       where regla = $1 and creado_en >= now() - interval '7 days'
       group by respuesta`,
      [REGLA],
    );
    return filas.map((r) => ({ respuesta: r.respuesta, cantidad: num(r.cantidad) }));
  } catch {
    return [];
  }
}

export async function getDashboardTareasMeli(): Promise<DashboardTareasMeli> {
  const [crudas, foto, semana] = await Promise.all([
    query<Record<string, unknown>>(`${ALERTAS} limit ${TOPE}`, PARAMS_ALERTAS()),
    getFoto(),
    getSemana(),
  ]);

  const ultimas = await getUltimas(crudas.map((r) => r.sku as string));

  const filas: FilaDescarte[] = crudas.map((r) => ({
    sku: r.sku as string,
    producto: (r.producto as string | null) ?? null,
    proveedor: (r.proveedor as string | null) ?? null,
    marca: (r.marca as string | null) ?? null,
    uRiesgo: num(r.u_riesgo),
    valorRiesgo: num(r.valor_riesgo),
    uFull: num(r.u_full),
    diasEnFull: r.dias_en_full == null ? null : num(r.dias_en_full),
    ultimaVenta: (r.ultima_venta as string | null) ?? null,
    diasSinVenta: r.dias_sin_venta == null ? null : num(r.dias_sin_venta),
    parcial: r.parcial === true,
    ultima: ultimas?.get(r.sku as string) ?? null,
  }));

  return {
    regla: REGLA_DESCARTE,
    foto,
    filas,
    recortada: filas.length === TOPE,
    semana,
    respuestasDisponibles: ultimas != null,
  };
}

/**
 * Guarda una respuesta. El plazo se resuelve acá, en el servidor, con el de
 * la respuesta: no viaja desde el navegador.
 *
 * `datos` es la foto de la alerta al momento de contestar, y SE ARMA ACÁ con
 * la consulta de la regla, no con lo que mande la pantalla: si el navegador
 * pudiera mandarla, "decidí sobre 3 unidades" podría decir cualquier cosa.
 * Si el SKU ya no cumple la regla, no se guarda nada.
 */
export async function guardarRespuestaDescarte(r: {
  sku: string;
  respuesta: ClaveRespuesta;
  dias: number;
  motivo: string | null;
  nota: string | null;
  usuario: string;
}): Promise<"ok" | "ya-no-aplica"> {
  // La misma consulta de la bandeja, recortada al SKU y SIN el tope: el tope
  // es para no mandar miles de filas al navegador, no parte de la regla.
  const actual = await queryOne<Record<string, unknown>>(
    `select * from (${ALERTAS}) x where x.sku = $4`,
    [...PARAMS_ALERTAS(), r.sku],
  );
  if (!actual) return "ya-no-aplica";

  await query(
    `insert into app.tareas_meli_respuestas
         (regla, clave, respuesta, motivo, nota, datos, usuario, vence_en)
     values ($1, $2, $3, $4, $5, $6::jsonb, $7, now() + make_interval(days => $8::int))`,
    [
      REGLA,
      r.sku,
      r.respuesta,
      r.motivo,
      r.nota,
      JSON.stringify({
        ...REGLA_DESCARTE,
        u_riesgo: num(actual.u_riesgo),
        valor_riesgo: num(actual.valor_riesgo),
        u_full: num(actual.u_full),
        dias_sin_venta: actual.dias_sin_venta == null ? null : num(actual.dias_sin_venta),
      }),
      r.usuario,
      r.dias,
    ],
  );
  return "ok";
}
