import { query, queryOne } from "@/lib/db";
import { agregarFiltro } from "@/lib/filtros";
import { CANAL_MELI } from "@/lib/meli";
import { UMBRAL_PARADO, UMBRALES_TARJETAS, tramoDe } from "@/lib/stock-full";
import type {
  DashboardStockFull,
  FiltrosStockFull,
  FilaStockFull,
  KpisStockFull,
  TramoStockFull,
} from "@/lib/types";

/**
 * Consultas de "Stock Full · días sin venta".
 *
 * Cruza TRES fuentes, y cada una aporta algo que las otras no tienen:
 *
 *   bronze.ml_publicaciones  el mapa inventory_id -> SKU, y el precio de lista
 *   bronze.ml_stock_full     cuántas unidades hay hoy en el depósito de ML
 *   gold.fact_ventas         cuándo fue la última venta de ese SKU
 *
 * EL SKU NO ESTÁ DONDE UNO ESPERA. `seller_custom_field` está vacío en 7.459 de
 * 7.559 publicaciones; el SKU real vive dentro del array `attributes`, en el
 * atributo `SELLER_SKU`. Ahí está en las 7.559. El Apps Script de la planilla
 * hace exactamente el mismo rodeo, por lo mismo.
 */

/** El SKU de una publicación, sacado del array de atributos. */
const SKU_DE_PUBLICACION = `(select a->>'value_name'
     from jsonb_array_elements(p.attributes::jsonb) a
    where a->>'id' = 'SELLER_SKU'
    limit 1)`;

/**
 * Un renglón por inventario, no por publicación.
 *
 * Varias publicaciones comparten el mismo `inventory_id` —el mismo stock físico
 * publicado en varios avisos—, así que sin este paso el stock se contaría una
 * vez por aviso. Con 7.559 publicaciones sobre 3.830 inventarios, eso sería el
 * doble.
 */
const POR_INVENTARIO = `
  select p.inventory_id,
         max(${SKU_DE_PUBLICACION}) as sku,
         max(p.title)               as titulo,
         max(p.price)               as precio_publicado
  from bronze.ml_publicaciones p
  where p."shipping.logistic_type" = 'fulfillment'
    and p.inventory_id is not null
  group by p.inventory_id`;

/**
 * El armado completo, listo para filtrar. Se define una sola vez porque lo usan
 * la tabla, los KPIs y los tramos, y si cada uno lo escribiera por su lado
 * terminarían midiendo cosas distintas.
 *
 * `disponible` es lo que Mercado Libre puede vender. `no_disponible` son
 * unidades que están físicamente en el depósito pero ML no puede vender
 * —dañadas, en revisión, reservadas—: son plata parada de la peor clase, porque
 * ni siquiera está a la venta.
 */
const BASE = `
with por_inv as (${POR_INVENTARIO}),
stock as (
  select i.sku,
         max(i.titulo)                              as producto,
         max(i.precio_publicado)                    as precio_publicado,
         sum(coalesce(f.available_quantity, 0))     as disponible,
         sum(coalesce(f.not_available_quantity, 0)) as no_disponible
  from bronze.ml_stock_full f
  join por_inv i on i.inventory_id = f.inventory_id
  where i.sku is not null
  group by i.sku
),
ventas as (
  select sku,
         max(fecha)                                              as ultima_venta,
         coalesce(sum(cantidad) filter (where fecha >= current_date - 30), 0) as uds30,
         avg(precio_unitario)                                    as precio_vendido
  from gold.fact_ventas
  where canal = $1
  group by sku
),
base as (
  select s.sku,
         s.producto,
         a."proveedorNombre"                        as proveedor,
         a."attributes.marca"                       as marca,
         s.disponible,
         s.no_disponible,
         v.ultima_venta,
         case when v.ultima_venta is null then null
              else (current_date - v.ultima_venta)::int end      as dias_sin_venta,
         coalesce(v.uds30, 0)                                    as uds30,
         -- Se valoriza al precio al que se VENDIÓ, y si nunca se vendió, al
         -- precio publicado. Sin ese respaldo los artículos que nunca rotaron
         -- valdrían cero, que es justo lo contrario de lo que son: los que más
         -- preocupan.
         s.disponible * coalesce(v.precio_vendido, s.precio_publicado, 0) as valorizacion
  from stock s
  left join ventas v on v.sku = s.sku
  left join bronze.sigma_articulos a on trim(a.id::text) = trim(s.sku)
  where s.disponible > 0
)`;

type Where = { sql: string; params: unknown[] };

/** Los filtros de la pantalla, sobre el CTE `base`. */
function where(f: FiltrosStockFull): Where {
  const params: unknown[] = [CANAL_MELI];
  const clauses: string[] = [];

  agregarFiltro(clauses, params, "proveedor", f.proveedor);
  agregarFiltro(clauses, params, "marca", f.marca);
  agregarFiltro(clauses, params, "sku", f.sku);

  // "Sin vender hace más de N días" trata al que nunca vendió como el peor
  // caso, que es lo correcto: si tiene stock y jamás rotó, es exactamente lo
  // que este tablero busca.
  if (f.minDias != null) {
    params.push(f.minDias);
    clauses.push(`(dias_sin_venta is null or dias_sin_venta >= $${params.length})`);
  }

  return { sql: clauses.length ? `where ${clauses.join(" and ")}` : "", params };
}

const num = (v: unknown): number => Number(v ?? 0);

async function getKpis(f: FiltrosStockFull): Promise<KpisStockFull> {
  const w = where(f);
  const fila = await queryOne<Record<string, string>>(
    `${BASE}
     select count(*)                                            as skus,
            coalesce(sum(disponible), 0)                        as disponible,
            coalesce(sum(no_disponible), 0)                     as no_disponible,
            coalesce(sum(valorizacion), 0)                      as valorizacion,
            count(*) filter (where dias_sin_venta is null
                                or dias_sin_venta > ${UMBRAL_PARADO})  as skus_parados,
            coalesce(sum(valorizacion) filter (where dias_sin_venta is null
                                or dias_sin_venta > ${UMBRAL_PARADO}), 0) as valorizacion_parada,
            coalesce(sum(uds30), 0)                             as uds30
     from base ${w.sql}`,
    w.params,
  );

  return {
    skus: num(fila?.skus),
    disponible: num(fila?.disponible),
    noDisponible: num(fila?.no_disponible),
    valorizacion: num(fila?.valorizacion),
    skusParados: num(fila?.skus_parados),
    valorizacionParada: num(fila?.valorizacion_parada),
    uds30: num(fila?.uds30),
  };
}

/**
 * Cuántos SKU caen en cada umbral (+7, +15, +21, +30 días sin vender).
 *
 * Son ACUMULATIVOS y no excluyentes: un SKU con 35 días cuenta en los cuatro.
 * Es lo que hacen las tarjetas del reporte de Data Studio, y es lo que se
 * quiere — la pregunta es "cuánto llevo parado hace más de X", no "cuánto cae
 * justo en esta franja".
 */
async function getUmbrales(f: FiltrosStockFull): Promise<Record<number, number>> {
  const w = where(f);
  const columnas = UMBRALES_TARJETAS.map(
    (d) => `count(*) filter (where dias_sin_venta is null or dias_sin_venta >= ${d}) as d${d}`,
  ).join(",\n            ");

  const fila = await queryOne<Record<string, string>>(
    `${BASE} select ${columnas} from base ${w.sql}`,
    w.params,
  );

  return Object.fromEntries(UMBRALES_TARJETAS.map((d) => [d, num(fila?.[`d${d}`])]));
}

/** El desglose por tramo y proveedor, como la tabla del reporte. */
async function getTramos(f: FiltrosStockFull): Promise<TramoStockFull[]> {
  const w = where(f);
  const filas = await query<Record<string, string | null>>(
    `${BASE}
     select coalesce(proveedor, 'Sin dato') as proveedor,
            dias_sin_venta,
            count(*)                        as skus,
            coalesce(sum(disponible), 0)    as disponible,
            coalesce(sum(valorizacion), 0)  as valorizacion
     from base ${w.sql}
     group by 1, 2`,
    w.params,
  );

  // El tramo se resuelve en TypeScript y no en SQL para que use la misma
  // función que la tabla (`tramoDe`). Con los cortes escritos dos veces, el día
  // que se muevan van a quedar distintos en cada lado.
  const mapa = new Map<string, TramoStockFull>();
  for (const r of filas) {
    const dias = r.dias_sin_venta == null ? null : num(r.dias_sin_venta);
    const clave = `${r.proveedor}|${tramoDe(dias)}`;
    const actual = mapa.get(clave) ?? {
      proveedor: r.proveedor as string,
      tramo: tramoDe(dias),
      skus: 0,
      disponible: 0,
      valorizacion: 0,
    };
    actual.skus += num(r.skus);
    actual.disponible += num(r.disponible);
    actual.valorizacion += num(r.valorizacion);
    mapa.set(clave, actual);
  }
  return [...mapa.values()];
}

/** Tope de filas que bajan al navegador. Son ~1.700 SKU, así que no se toca. */
const TOPE = 500;

async function getFilas(f: FiltrosStockFull): Promise<FilaStockFull[]> {
  const w = where(f);
  const filas = await query<Record<string, string | null>>(
    `${BASE}
     select sku, producto, proveedor, marca,
            disponible, no_disponible,
            to_char(ultima_venta, 'YYYY-MM-DD') as ultima_venta,
            dias_sin_venta, uds30, valorizacion
     from base ${w.sql}
     -- Los que nunca vendieron van primero: son el caso más grave y con un
     -- orden numérico quedarían al final, donde nadie los mira.
     order by (dias_sin_venta is null) desc, dias_sin_venta desc nulls first,
              valorizacion desc
     limit ${TOPE}`,
    w.params,
  );

  return filas.map((r) => ({
    sku: r.sku,
    producto: r.producto,
    proveedor: r.proveedor,
    marca: r.marca,
    disponible: num(r.disponible),
    noDisponible: num(r.no_disponible),
    ultimaVenta: r.ultima_venta,
    diasSinVenta: r.dias_sin_venta == null ? null : num(r.dias_sin_venta),
    uds30: num(r.uds30),
    valorizacion: num(r.valorizacion),
  }));
}

/** Desde cuándo hay foto diaria del stock, para poder decirlo en pantalla. */
async function getDesdeCuandoHayHistoria(): Promise<string | null> {
  try {
    const fila = await queryOne<{ v: string | null }>(
      `select to_char(min(fecha), 'YYYY-MM-DD') as v
       from bronze.ml_stock_full_historico`,
    );
    return fila?.v ?? null;
  } catch {
    // La tabla todavía no existe: el orquestador no corrió con el cambio.
    return null;
  }
}

export async function getOpcionesStockFull() {
  const [proveedores, marcas] = await Promise.all([
    query<{ v: string }>(
      `${BASE} select distinct proveedor as v from base
       where proveedor is not null order by 1`,
      [CANAL_MELI],
    ),
    query<{ v: string }>(
      `${BASE} select distinct marca as v from base
       where marca is not null order by 1`,
      [CANAL_MELI],
    ),
  ]);
  return { proveedores: proveedores.map((r) => r.v), marcas: marcas.map((r) => r.v) };
}

export async function getDashboardStockFull(
  f: FiltrosStockFull,
): Promise<DashboardStockFull> {
  const [kpis, umbrales, tramos, filas, historiaDesde] = await Promise.all([
    getKpis(f),
    getUmbrales(f),
    getTramos(f),
    getFilas(f),
    getDesdeCuandoHayHistoria(),
  ]);

  return {
    kpis,
    umbrales,
    tramos,
    filas,
    recortada: filas.length === TOPE,
    historiaDesde,
    generadoEn: new Date().toISOString(),
  };
}
