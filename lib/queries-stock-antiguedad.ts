import { query, queryOne } from "@/lib/db";
import { agregarFiltro } from "@/lib/filtros";
import { PROVEEDORES_NO_MERCADERIA } from "@/lib/stock";
import {
  DIAS_POR_VENCER_ALERTA,
  TRAMOS_ANTIGUEDAD,
  VENTANA_VENTAS_DIAS,
} from "@/lib/stock-antiguedad";
import type {
  DashboardAntiguedad,
  FilaAntiguedad,
  FiltrosAntiguedad,
  KpisAntiguedad,
  TramoAntiguedad,
  TramoVencimiento,
} from "@/lib/types";

/**
 * Consultas de la pantalla de Antigüedad de stock.
 *
 * Ver lib/stock-antiguedad.ts para por qué cada depósito contesta una pregunta
 * distinta. Las fuentes:
 *
 *   bronze.ml_stock_antiguedad   días en Full, calculados por FIFO en tablero_quo
 *   bronze.ml_stock_full         unidades aptas y no aptas para vender
 *   bronze.ml_publicaciones      el mapa inventory_id -> SKU, que ML no da hecho
 *   bronze.digip_stock_detalle   el vencimiento, ubicación por ubicación
 *   bronze.sigma_articulos       proveedor, marca y descripción
 *   bronze.costos_historicos     el costo con el que se valoriza
 *   gold.fact_ventas             el ritmo, que es lo que dice si urge o no
 */

/** El SKU vive dentro de `attributes`. Mismo rodeo que en queries-stock.ts. */
const SKU_DE_PUBLICACION = `(select a->>'value_name'
     from jsonb_array_elements(p.attributes::jsonb) a
    where a->>'id' = 'SELLER_SKU'
    limit 1)`;

/**
 * Las unidades de Tucumán que cuentan.
 *
 * DOS EXCLUSIONES, Y LAS DOS CAMBIAN EL NÚMERO:
 *
 *   `ubicacionEstado = 'Activa'`  deja afuera SCRAP y la ubicación "eliminar"
 *                                 (6.332 unidades): están en el depósito pero
 *                                 ya se dieron de baja.
 *   `preparacionId is null`       deja afuera lo que ya está apartado para un
 *                                 pedido (143.318 unidades en DESPACHO). Esa
 *                                 mercadería tiene dueño; su vencimiento no es
 *                                 una decisión de compras.
 *
 * Con las dos, quedan 148.417 unidades — y la resta contra las 145.552 que
 * Digip declara disponibles da EXACTAMENTE las unidades vencidas. Digip las
 * saca del disponible sin decirlo en ningún lado; acá se ven.
 */
const LOTES = `
  select trim(d."articuloCodigo") as sku,
         coalesce(d.unidades, 0)::numeric as u,
         -- El texto se valida antes de convertirlo: hay 22 filas con años
         -- imposibles (una vence en 5026) y un cast directo las tomaría como
         -- buenas o rompería la consulta entera.
         case when d."fechaVencimiento" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
               and substring(d."fechaVencimiento", 1, 10)::date
                   between date '2000-01-01' and date '2100-01-01'
              then substring(d."fechaVencimiento", 1, 10)::date
         end as vto
  from bronze.digip_stock_detalle d
  where d."ubicacionEstado" = 'Activa'
    and d."preparacionId" is null`;

/**
 * El armado completo. Una sola definición para los KPIs, los dos gráficos y la
 * tabla, por lo mismo que en el tablero de Stock: escrita cuatro veces,
 * terminaría midiendo cosas distintas sin que nada avise.
 *
 * $1 son los proveedores que no son mercadería.
 */
const BASE = `
with por_inv as (
  -- Un renglón por INVENTARIO y no por publicación: varias publicaciones
  -- comparten el mismo stock físico y sumarlas lo contaría de más.
  select p.inventory_id, max(${SKU_DE_PUBLICACION}) as sku
  from bronze.ml_publicaciones p
  where p."shipping.logistic_type" = 'fulfillment'
    and p.inventory_id is not null
  group by p.inventory_id
),
full_ml as (
  select i.sku,
         sum(coalesce(f.available_quantity, 0))     as aptas,
         sum(coalesce(f.not_available_quantity, 0)) as no_aptas
  from bronze.ml_stock_full f
  join por_inv i on i.inventory_id = f.inventory_id
  where i.sku is not null
  group by i.sku
),
ant as (
  -- La última foto que haya. Agrupada por SKU porque se guarda por INVENTARIO
  -- y hay SKU que usan más de uno.
  select a.sku,
         sum(a.unidades)   as u_medidas,
         sum(a.u_0_30)     as u_0_30,
         sum(a.u_31_60)    as u_31_60,
         sum(a.u_61_90)    as u_61_90,
         sum(a.u_91_120)   as u_91_120,
         sum(a.u_mas_120)  as u_mas_120,
         -- La marca "incompleto" señala los inventarios donde el libro de operaciones no
         -- explica todas las unidades: las que sobran entran como viejas, que
         -- es el lado conservador, pero el número es un piso y hay que decirlo.
         bool_or(a.incompleto) as parcial,
         case when sum(a.unidades) > 0
              then sum(a.dias_promedio * a.unidades) / sum(a.unidades)
         end as dias
  from bronze.ml_stock_antiguedad a
  where a.fecha = (select max(fecha) from bronze.ml_stock_antiguedad)
    and a.sku is not null
  group by a.sku
),
lotes as (${LOTES}
),
tuc as (
  select sku,
         sum(u)                                                        as tuc,
         sum(u) filter (where vto <  current_date)                     as u_vencido,
         sum(u) filter (where vto >= current_date
                          and vto <  current_date + 30)                as u_v30,
         sum(u) filter (where vto >= current_date + 30
                          and vto <  current_date + 90)                as u_v90,
         sum(u) filter (where vto >= current_date + 90
                          and vto <  current_date + 180)               as u_v180,
         sum(u) filter (where vto >= current_date + 180)               as u_vmas,
         sum(u) filter (where vto is null)                             as u_sin_vto,
         -- El vencimiento que importa es el PRÓXIMO que todavía no pasó: el
         -- mínimo a secas sería la fecha de algo que ya está vencido y taparía
         -- el lote que hay que mover esta semana.
         min(vto) filter (where vto >= current_date)                   as prox_vto
  from lotes
  group by sku
),
costo as (
  -- El costo del último mes que lo tenga cargado. Los artículos sin costo
  -- quedan en 0 a propósito: son testers y exhibidores, que no se compran.
  select distinct on (sku) sku, costo_real
  from bronze.costos_historicos
  where costo_real > 0
  order by sku, mes_comercial desc
),
ventas as (
  select sku,
         max(fecha) as ultima_venta,
         coalesce(sum(cantidad) filter (
           where fecha >= current_date - ${VENTANA_VENTAS_DIAS}), 0) as uds
  from gold.fact_ventas
  group by sku
),
stock as (
  -- FULL OUTER: hay SKU que sólo están en Full y SKU que sólo están en Tucumán.
  -- Un inner join perdería justo los que están en un solo depósito.
  select coalesce(f.sku, t.sku)          as sku,
         coalesce(f.aptas, 0)            as aptas,
         coalesce(f.no_aptas, 0)         as no_aptas,
         coalesce(t.tuc, 0)              as tuc,
         coalesce(t.u_vencido, 0)        as u_vencido,
         coalesce(t.u_v30, 0)            as u_v30,
         coalesce(t.u_v90, 0)            as u_v90,
         coalesce(t.u_v180, 0)           as u_v180,
         coalesce(t.u_vmas, 0)           as u_vmas,
         coalesce(t.u_sin_vto, 0)        as u_sin_vto,
         t.prox_vto
  from full_ml f
  full outer join tuc t on t.sku = f.sku
),
base as (
  select s.sku,
         ar.descripcion                        as producto,
         ar."proveedorNombre"                  as proveedor,
         ar."attributes.marca"                 as marca,
         s.aptas,
         s.no_aptas,
         s.tuc,
         s.aptas + s.tuc                       as total,
         coalesce(c.costo_real, 0)             as costo,
         (s.aptas + s.tuc) * coalesce(c.costo_real, 0) as valor,
         a.dias                                as dias_en_full,
         coalesce(a.u_medidas, 0)              as u_medidas,
         coalesce(a.u_0_30, 0)                 as u_0_30,
         coalesce(a.u_31_60, 0)                as u_31_60,
         coalesce(a.u_61_90, 0)                as u_61_90,
         coalesce(a.u_91_120, 0)               as u_91_120,
         coalesce(a.u_mas_120, 0)              as u_mas_120,
         coalesce(a.u_mas_120, 0) * coalesce(c.costo_real, 0) as valor_mas_120,
         coalesce(a.parcial, false)            as parcial,
         s.u_vencido,
         s.u_vencido * coalesce(c.costo_real, 0) as valor_vencido,
         s.u_v30, s.u_v90, s.u_v180, s.u_vmas, s.u_sin_vto,
         -- Lo que vence dentro del plazo de alarma, vencido aparte: son dos
         -- decisiones distintas (una es tirar, la otra es liquidar a tiempo).
         s.u_v30 + s.u_v90                     as u_por_vencer,
         (s.u_v30 + s.u_v90) * coalesce(c.costo_real, 0) as valor_por_vencer,
         to_char(s.prox_vto, 'YYYY-MM-DD')     as prox_vto,
         (s.prox_vto - current_date)           as dias_a_vencer,
         coalesce(v.uds, 0)                    as uds,
         to_char(v.ultima_venta, 'YYYY-MM-DD') as ultima_venta,
         -- Días hasta agotar: lo mismo que la cobertura del tablero de Stock,
         -- medido sobre ${VENTANA_VENTAS_DIAS} días. Sin ventas es null y no un
         -- número enorme: son dos situaciones distintas.
         case when coalesce(v.uds, 0) = 0 then null
              else (s.aptas + s.tuc) / (coalesce(v.uds, 0)::numeric / ${VENTANA_VENTAS_DIAS})
         end                                   as dias_agotar
  from stock s
  left join bronze.sigma_articulos ar on trim(ar.id) = s.sku
  left join costo c on c.sku = s.sku
  left join ventas v on v.sku = s.sku
  left join ant a on a.sku = s.sku
  where s.sku is not null
    and (s.aptas + s.tuc + s.no_aptas) > 0
    and coalesce(ar."proveedorNombre", '') <> all($1::text[])
)`;

type Where = { sql: string; params: unknown[] };

function where(f: FiltrosAntiguedad): Where {
  const params: unknown[] = [PROVEEDORES_NO_MERCADERIA];
  const clauses: string[] = [];

  agregarFiltro(clauses, params, "proveedor", f.proveedor);
  agregarFiltro(clauses, params, "marca", f.marca);
  agregarFiltro(clauses, params, "sku", f.sku);

  if (f.buscar) {
    params.push(`%${f.buscar}%`);
    clauses.push(`(sku ilike $${params.length} or producto ilike $${params.length})`);
  }

  // Los dos tramos filtran por "tiene alguna unidad ahí" y no por el promedio
  // del artículo: un SKU con 100 unidades nuevas y 5 de más de 120 días TIENE
  // un problema de 5 unidades, y por el promedio no aparecería nunca.
  const columna = TRAMOS_ANTIGUEDAD.find((t) => t.clave === f.tramo)?.columna;
  if (columna) clauses.push(`${columna} > 0`);

  const vencimiento: Record<string, string> = {
    vencido: "u_vencido > 0",
    "30": "u_v30 > 0",
    "90": "u_v90 > 0",
    "180": "u_v180 > 0",
    mas_180: "u_vmas > 0",
    sin_dato: "u_sin_vto > 0",
  };
  if (f.vencimiento && vencimiento[f.vencimiento]) clauses.push(vencimiento[f.vencimiento]);

  return { sql: clauses.length ? `where ${clauses.join(" and ")}` : "", params };
}

const num = (v: unknown): number => Number(v ?? 0);

async function getKpis(f: FiltrosAntiguedad): Promise<KpisAntiguedad> {
  const w = where(f);
  const fila = await queryOne<Record<string, string | null>>(
    `${BASE}
     select count(*)                                        as skus,
            coalesce(sum(aptas), 0)                         as u_full,
            coalesce(sum(tuc), 0)                           as u_tuc,
            coalesce(sum(valor), 0)                         as valor,
            coalesce(sum(no_aptas), 0)                      as no_aptas,
            coalesce(sum(u_mas_120), 0)                     as u_mas_120,
            coalesce(sum(valor_mas_120), 0)                 as valor_mas_120,
            coalesce(sum(u_vencido), 0)                     as u_vencido,
            coalesce(sum(valor_vencido), 0)                 as valor_vencido,
            coalesce(sum(u_por_vencer), 0)                  as u_por_vencer,
            coalesce(sum(valor_por_vencer), 0)              as valor_por_vencer,
            -- Promedio ponderado por unidad, no por SKU: un artículo con una
            -- unidad no puede mover el promedio igual que uno con mil.
            case when coalesce(sum(u_medidas), 0) > 0
                 then sum(dias_en_full * u_medidas) / sum(u_medidas)
            end                                             as dias_promedio,
            count(*) filter (where parcial)                 as skus_parciales
     from base ${w.sql}`,
    w.params,
  );

  return {
    skus: num(fila?.skus),
    uFull: num(fila?.u_full),
    uTucuman: num(fila?.u_tuc),
    valor: num(fila?.valor),
    noAptas: num(fila?.no_aptas),
    uMas120: num(fila?.u_mas_120),
    valorMas120: num(fila?.valor_mas_120),
    uVencido: num(fila?.u_vencido),
    valorVencido: num(fila?.valor_vencido),
    uPorVencer: num(fila?.u_por_vencer),
    valorPorVencer: num(fila?.valor_por_vencer),
    diasPromedio: fila?.dias_promedio == null ? null : num(fila.dias_promedio),
    skusParciales: num(fila?.skus_parciales),
  };
}

/**
 * Cuántas unidades y cuánta plata hay en cada tramo de antigüedad de Full.
 *
 * Los tramos salen de `TRAMOS_ANTIGUEDAD` y no de una lista escrita acá: el
 * nombre de cada columna está definido una sola vez, así que no puede quedar
 * una etiqueta sobre las unidades de otro tramo.
 */
async function getTramosAntiguedad(f: FiltrosAntiguedad): Promise<TramoAntiguedad[]> {
  const w = where(f);
  const columnas = TRAMOS_ANTIGUEDAD.map(
    (t) => `coalesce(sum(${t.columna}), 0) as ${t.columna},
            coalesce(sum(${t.columna} * costo), 0) as v_${t.columna}`,
  ).join(",\n            ");

  const fila = await queryOne<Record<string, string>>(
    `${BASE} select ${columnas} from base ${w.sql}`,
    w.params,
  );

  return TRAMOS_ANTIGUEDAD.map((t) => ({
    tramo: t.clave,
    unidades: num(fila?.[t.columna]),
    valor: num(fila?.[`v_${t.columna}`]),
  }));
}

/** Lo mismo para los vencimientos de Tucumán. */
async function getTramosVencimiento(f: FiltrosAntiguedad): Promise<TramoVencimiento[]> {
  const w = where(f);
  const fila = await queryOne<Record<string, string>>(
    `${BASE}
     select coalesce(sum(u_vencido), 0)          as vencido,
            coalesce(sum(u_vencido * costo), 0)  as v_vencido,
            coalesce(sum(u_v30), 0)              as u30,
            coalesce(sum(u_v30 * costo), 0)      as v30,
            coalesce(sum(u_v90), 0)              as u90,
            coalesce(sum(u_v90 * costo), 0)      as v90,
            coalesce(sum(u_v180), 0)             as u180,
            coalesce(sum(u_v180 * costo), 0)     as v180,
            coalesce(sum(u_vmas), 0)             as umas,
            coalesce(sum(u_vmas * costo), 0)     as vmas,
            coalesce(sum(u_sin_vto), 0)          as usin,
            coalesce(sum(u_sin_vto * costo), 0)  as vsin
     from base ${w.sql}`,
    w.params,
  );

  const par = (u: string, v: string) => ({ unidades: num(fila?.[u]), valor: num(fila?.[v]) });
  return [
    { tramo: "vencido", ...par("vencido", "v_vencido") },
    { tramo: "30", ...par("u30", "v30") },
    { tramo: "90", ...par("u90", "v90") },
    { tramo: "180", ...par("u180", "v180") },
    { tramo: "mas_180", ...par("umas", "vmas") },
    { tramo: "sin_dato", ...par("usin", "vsin") },
  ];
}

/** Tope de filas que bajan al navegador. */
const TOPE = 500;

async function getFilas(f: FiltrosAntiguedad): Promise<FilaAntiguedad[]> {
  const w = where(f);
  // `parcial` es booleano y el resto texto, así que la fila es de `unknown`:
  // tipar todo como string obligaría a comparar `"true"` con un boolean real.
  const filas = await query<Record<string, unknown>>(
    `${BASE}
     select sku, producto, proveedor, marca,
            aptas, no_aptas, tuc, total, costo, valor,
            dias_en_full, u_medidas, u_mas_120, valor_mas_120, parcial,
            u_vencido, valor_vencido, u_por_vencer, valor_por_vencer,
            prox_vto, dias_a_vencer, uds, ultima_venta, dias_agotar
     from base ${w.sql}
     -- Primero lo que está mal y cuesta plata: vencido, después por vencer,
     -- después viejo en Full. El orden ES la lista de tareas del día.
     order by valor_vencido desc, valor_por_vencer desc, valor_mas_120 desc, valor desc
     limit ${TOPE}`,
    w.params,
  );

  return filas.map((r) => ({
    sku: r.sku as string,
    producto: (r.producto as string | null) ?? null,
    proveedor: (r.proveedor as string | null) ?? null,
    marca: (r.marca as string | null) ?? null,
    aptas: num(r.aptas),
    noAptas: num(r.no_aptas),
    tuc: num(r.tuc),
    total: num(r.total),
    costo: num(r.costo),
    valor: num(r.valor),
    diasEnFull: r.dias_en_full == null ? null : num(r.dias_en_full),
    uMedidas: num(r.u_medidas),
    uMas120: num(r.u_mas_120),
    valorMas120: num(r.valor_mas_120),
    parcial: r.parcial === true,
    uVencido: num(r.u_vencido),
    valorVencido: num(r.valor_vencido),
    uPorVencer: num(r.u_por_vencer),
    valorPorVencer: num(r.valor_por_vencer),
    proxVto: (r.prox_vto as string | null) ?? null,
    diasAVencer: r.dias_a_vencer == null ? null : num(r.dias_a_vencer),
    uds: num(r.uds),
    ultimaVenta: (r.ultima_venta as string | null) ?? null,
    diasAgotar: r.dias_agotar == null ? null : num(r.dias_agotar),
  }));
}

export async function getOpcionesAntiguedad() {
  const params = [PROVEEDORES_NO_MERCADERIA];
  const [proveedores, marcas] = await Promise.all([
    query<{ v: string }>(
      `${BASE} select distinct proveedor as v from base where proveedor is not null order by 1`,
      params,
    ),
    query<{ v: string }>(
      `${BASE} select distinct marca as v from base where marca is not null order by 1`,
      params,
    ),
  ]);
  return { proveedores: proveedores.map((r) => r.v), marcas: marcas.map((r) => r.v) };
}

/**
 * De cuándo es la foto de antigüedad de Full, y cuántos SKU trae.
 *
 * SON DOS PREGUNTAS Y NO UNA. La foto puede existir y aun así no servir para
 * esta pantalla: el paso de tablero_quo calcula por INVENTARIO de Mercado Libre
 * —que no es nuestro código de artículo— y recién en un segundo momento lo
 * enlaza con el SKU. Con la fecha sola, una foto sin enlazar se vería como
 * ceros, que se leen como "no hay mercadería vieja": la lectura opuesta a la
 * verdadera. Con las dos, la pantalla puede decir cuál de los dos falta.
 *
 * En un `try` porque la tabla puede no existir todavía en una base donde el
 * paso nunca corrió, y eso no tiene que tumbar la pantalla entera.
 */
async function getFotoAntiguedad(): Promise<{
  fecha: string | null;
  skus: number;
  skusFull: number;
}> {
  // Cuántos SKU TENDRÍA que cubrir la foto. Va sin los filtros de pantalla a
  // propósito: es una medida de la foto, no del recorte que se está mirando.
  const enFull = await queryOne<{ v: string }>(
    `with por_inv as (
       select p.inventory_id, max(${SKU_DE_PUBLICACION}) as sku
       from bronze.ml_publicaciones p
       where p."shipping.logistic_type" = 'fulfillment'
         and p.inventory_id is not null
       group by p.inventory_id
     )
     select count(distinct i.sku) as v
     from bronze.ml_stock_full f
     join por_inv i on i.inventory_id = f.inventory_id
     where i.sku is not null and coalesce(f.available_quantity, 0) > 0`,
  );

  try {
    const fila = await queryOne<{ fecha: string | null; skus: string }>(
      `select to_char(max(fecha), 'YYYY-MM-DD')                          as fecha,
              count(distinct sku) filter (
                where fecha = (select max(fecha) from bronze.ml_stock_antiguedad)
              )                                                          as skus
       from bronze.ml_stock_antiguedad`,
    );
    return {
      fecha: fila?.fecha ?? null,
      skus: num(fila?.skus),
      skusFull: num(enFull?.v),
    };
  } catch {
    return { fecha: null, skus: 0, skusFull: num(enFull?.v) };
  }
}

export async function getDashboardAntiguedad(
  f: FiltrosAntiguedad,
): Promise<DashboardAntiguedad> {
  const [kpis, antiguedad, vencimiento, filas, foto] = await Promise.all([
    getKpis(f),
    getTramosAntiguedad(f),
    getTramosVencimiento(f),
    getFilas(f),
    getFotoAntiguedad(),
  ]);

  return {
    kpis,
    antiguedad,
    vencimiento,
    filas,
    recortada: filas.length === TOPE,
    ventanaVentas: VENTANA_VENTAS_DIAS,
    diasPorVencer: DIAS_POR_VENCER_ALERTA,
    antiguedadAl: foto.fecha,
    antiguedadSkus: foto.skus,
    antiguedadSkusFull: foto.skusFull,
    generadoEn: new Date().toISOString(),
  };
}
