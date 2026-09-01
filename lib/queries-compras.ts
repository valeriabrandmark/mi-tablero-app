import { query, queryOne } from "@/lib/db";
import { agregarFiltro } from "@/lib/filtros";
import { MESES_RENTABILIDAD } from "@/lib/compras";
import {
  COBERTURA_OBJETIVO_DIAS,
  PLAZO_REPOSICION_DIAS,
  PROVEEDORES_NO_MERCADERIA,
  VENTANA_POR_DEFECTO,
} from "@/lib/stock";
import type { DashboardCompras, FilaCompra, FiltrosCompras } from "@/lib/types";

/**
 * Consultas del panel de Compras.
 *
 * Las cuentas de stock son LAS MISMAS que las del tablero de Stock —ritmo,
 * cobertura, sugerido— y salen de las mismas constantes de lib/stock.ts. Lo que
 * agrega esta pantalla es lo que hace falta para ARMAR LA ORDEN y no sólo para
 * mirarla:
 *
 *   unidadesPorBulto            para poder pedir en bultos
 *   oferta_pct del mes          el descuento del proveedor, que va a FDESCU1
 *   rentabilidad de 3 meses     para saber si se vende bien o si se estaba
 *                               liquidando, que es una decisión distinta
 *
 * $1 ventana del ritmo · $2 proveedores que no son mercadería · $3 mes de oferta
 */
const BASE = `
with por_inv as (
  select p.inventory_id,
         max((select a->>'value_name'
                from jsonb_array_elements(p.attributes::jsonb) a
               where a->>'id' = 'SELLER_SKU'
               limit 1)) as sku
  from bronze.ml_publicaciones p
  where p."shipping.logistic_type" = 'fulfillment'
    and p.inventory_id is not null
  group by p.inventory_id
),
full_ml as (
  select i.sku, sum(coalesce(f.available_quantity, 0)) as unidades
  from bronze.ml_stock_full f
  join por_inv i on i.inventory_id = f.inventory_id
  where i.sku is not null
  group by i.sku
),
tuc as (
  -- Agrupado por código: hay 24 códigos repetidos en el export de Digip.
  select trim(codigo) as sku, sum(coalesce("stock.disponible", 0)) as unidades
  from bronze.digip_stock
  group by 1
),
-- El costo con el que se valoriza: el del último mes que lo tenga cargado.
costo as (
  select distinct on (sku) sku, costo_real, costo_teorico
  from bronze.costos_historicos
  where costo_real > 0
  order by sku, mes_comercial desc
),
-- El sell in VIGENTE DEL PROVEEDOR en el mes elegido: el descuento con el que
-- se le pide, y el único que puede ir a FDESCU1.
--
-- SALE DE bronze.sell_in Y NO DE costos_historicos, y la diferencia no es un
-- detalle: el oferta_pct de costos_historicos es un sell in CALCULADO a partir de
-- nuestras compras, que se usa para trasladarlo a las ofertas del mes. Sirve
-- para valorizar lo que ya compramos; NO es lo que el proveedor tiene vigente.
-- Mandarlo en una orden de compra sería pedir con un descuento inventado.
--
-- Hoy la tabla está vacía —la planilla de Google todavía no se carga sola— y
-- por eso el descuento arranca en cero y la pantalla lo dice.
sell_in as (
  -- SOLO LA OFERTA DEL MES, que es lo que va a FDESCU1.
  --
  -- En la planilla, al lado de la columna del mes hay columnas de eventos
  -- ("HOT SALE") y de cortes especificos ("1/7/2026 (Glade)"). Son ofertas de
  -- verdad y se guardan, pero NO son el descuento con el que se arma la orden
  -- del mes: una promo de tres dias aplicada a la compra de un mes entero es
  -- un pedido mal hecho. El evento vacio es la oferta del mes.
  select sku, descuento_pct
  from bronze.sell_in
  where mes_comercial = $3::text
    and evento = ''
),
-- El costo de lista y el sell in calculado del mes elegido. El calculado se
-- MUESTRA como referencia —es con lo que venimos costeando— pero no viaja al
-- archivo.
oferta as (
  select sku, oferta_pct, costo_teorico
  from bronze.costos_historicos
  where mes_comercial = $3::text
),
compras as (
  select it->>'articuloId' as sku,
         max(c."fechaFactura") as ultima_compra,
         -- Si ese SKU aparece en algún comprobante del mes pasado. Ojo con el
         -- que da false: ver proveedores_mes_pasado aca abajo.
         bool_or(c."fechaFactura" >= to_char(date_trunc('month', current_date)
                                             - interval '1 month', 'YYYY-MM-DD')
             and c."fechaFactura" <  to_char(date_trunc('month', current_date),
                                             'YYYY-MM-DD')) as comprado_mes_pasado
  from bronze.sigma_compras c
  cross join lateral jsonb_array_elements(c.items::jsonb) it
  where it->>'articuloId' is not null
  group by 1
),
-- SI LE COMPRAMOS AL PROVEEDOR EL MES PASADO, mirando la CABECERA y no los
-- renglones. Existe porque el detalle casi no viene: de los 173 comprobantes de
-- agosto, 14 traen items. Sin esto, un artículo sin renglón se mostraría como
-- "no se compró" cuando la verdad es que no sabemos.
--
-- Con las dos cosas juntas se pueden separar tres situaciones distintas:
--   el SKU aparece en un renglón            -> sí, seguro
--   no aparece pero el proveedor sí compró  -> no consta (falta el detalle)
--   el proveedor no compró nada             -> no, y eso sí es seguro
proveedores_mes_pasado as (
  select distinct "proveedorNombre" as proveedor
  from bronze.sigma_compras
  where "fechaFactura" >= to_char(date_trunc('month', current_date)
                                  - interval '1 month', 'YYYY-MM-DD')
    and "fechaFactura" <  to_char(date_trunc('month', current_date), 'YYYY-MM-DD')
    and "proveedorNombre" is not null
),
-- LOS ÚLTIMOS SEIS MESES DE DESCUENTO, para poder decir si la oferta de este mes
-- es buena o si es la de siempre. Van los dos: el sell in del proveedor —cuando
-- esté cargado— y el calculado con nuestras compras, que es el que hay hoy. La
-- pantalla muestra uno solo y el título dice cuál.
hist_sell_in as (
  select sku, jsonb_agg(jsonb_build_object('mes', mes, 'pct', pct) order by mes desc) as historia
  from (
    select sku, mes_comercial as mes, descuento_pct as pct,
           row_number() over (partition by sku order by mes_comercial desc) as n
    from bronze.sell_in
    where mes_comercial <= $3::text
  ) x
  where n <= 6
  group by sku
),
hist_calculado as (
  select sku, jsonb_agg(jsonb_build_object('mes', mes, 'pct', pct) order by mes desc) as historia
  from (
    select sku, mes_comercial as mes, oferta_pct as pct,
           row_number() over (partition by sku order by mes_comercial desc) as n
    from bronze.costos_historicos
    where mes_comercial <= $3::text
      and oferta_pct is not null
  ) x
  where n <= 6
  group by sku
),
ventas as (
  select sku,
         max(fecha) as ultima_venta,
         coalesce(sum(cantidad) filter (where fecha >= current_date - $1::int), 0) as uds,
         -- La rentabilidad de los ÚLTIMOS 3 MESES va con su propia ventana y no
         -- con la del ritmo: son dos preguntas distintas. El ritmo dice cuánto
         -- se vende hoy; la rentabilidad, si lo que se vendió dejaba plata.
         coalesce(sum(cantidad) filter (
           where fecha >= current_date - ${MESES_RENTABILIDAD * 30}), 0) as uds_rent,
         coalesce(sum(margen_total) filter (
           where fecha >= current_date - ${MESES_RENTABILIDAD * 30}), 0) as margen_rent,
         coalesce(sum(precio_neto * cantidad) filter (
           where fecha >= current_date - ${MESES_RENTABILIDAD * 30}), 0) as facturado_rent,
         -- El MES CALENDARIO pasado, aparte de la ventana movil de 3 meses: una
         -- cosa es como viene rindiendo el articulo y otra a cuanto se vendio el
         -- mes que acaba de cerrar, que es contra lo que se compara la oferta
         -- que el proveedor ofrece ahora.
         coalesce(sum(cantidad) filter (
           where fecha >= date_trunc('month', current_date) - interval '1 month'
             and fecha <  date_trunc('month', current_date)), 0) as uds_mes_pasado,
         coalesce(sum(margen_total) filter (
           where fecha >= date_trunc('month', current_date) - interval '1 month'
             and fecha <  date_trunc('month', current_date)), 0) as margen_mes_pasado,
         coalesce(sum(precio_neto * cantidad) filter (
           where fecha >= date_trunc('month', current_date) - interval '1 month'
             and fecha <  date_trunc('month', current_date)), 0) as facturado_mes_pasado
  from gold.fact_ventas
  group by sku
),
stock as (
  -- Los DOS depósitos siempre: se compra para la empresa, no para un depósito.
  select coalesce(t.sku, f.sku)                          as sku,
         coalesce(t.unidades, 0)                         as tuc,
         coalesce(f.unidades, 0)                         as full_ml,
         coalesce(t.unidades, 0) + coalesce(f.unidades, 0) as total
  from tuc t
  full outer join full_ml f on f.sku = t.sku
),
base as (
  select s.sku,
         a.descripcion                                  as producto,
         a."proveedorNombre"                            as proveedor,
         a."attributes.marca"                           as marca,
         -- Sin dato se toma 1: un bulto de una unidad es lo mismo que la
         -- unidad, así que en el peor caso el artículo se pide de a uno. Poner
         -- 0 haría una división por cero; inventar 6 haría pedir de más.
         greatest(coalesce(a."unidadesPorBulto", 1), 1)  as u_bulto,
         s.tuc,
         s.full_ml,
         s.total,
         coalesce(c.costo_real, 0)                      as costo,
         s.total * coalesce(c.costo_real, 0)            as valor,
         -- El costo de lista del mes elegido, que es sobre el que se aplica el
         -- descuento. Si ese mes no está cargado, cae al último costo conocido.
         coalesce(o.costo_teorico, c.costo_teorico, c.costo_real, 0) as costo_lista,
         o.oferta_pct                                   as oferta_calculada_pct,
         si.descuento_pct                               as sell_in_pct,
         coalesce(v.uds, 0)                             as uds,
         v.ultima_venta,
         co.ultima_compra,
         coalesce(v.uds_rent, 0)                        as uds_rent,
         case when coalesce(v.facturado_rent, 0) = 0 then null
              else v.margen_rent / v.facturado_rent
         end                                            as rentabilidad,
         coalesce(v.uds_mes_pasado, 0)                  as uds_mes_pasado,
         case when coalesce(v.facturado_mes_pasado, 0) = 0 then null
              else v.margen_mes_pasado / v.facturado_mes_pasado
         end                                            as rent_mes_pasado,
         coalesce(co.comprado_mes_pasado, false)        as comprado_mes_pasado,
         (pmp.proveedor is not null)                    as proveedor_compro,
         hs.historia                                    as hist_sell_in,
         hc.historia                                    as hist_calculado,
         coalesce(v.uds, 0)::numeric / $1::int          as ritmo_diario,
         case when coalesce(v.uds, 0) = 0 then null
              else s.total / (coalesce(v.uds, 0)::numeric / $1::int)
         end                                            as cobertura
  from stock s
  left join bronze.sigma_articulos a on trim(a.id) = s.sku
  left join costo c on c.sku = s.sku
  left join oferta o on o.sku = s.sku
  left join sell_in si on si.sku = s.sku
  left join ventas v on v.sku = s.sku
  left join compras co on co.sku = s.sku
  left join proveedores_mes_pasado pmp on pmp.proveedor = a."proveedorNombre"
  left join hist_sell_in hs on hs.sku = s.sku
  left join hist_calculado hc on hc.sku = s.sku
  where coalesce(a."proveedorNombre", '') <> all($2::text[])
),
calculada as (
  select b.*,
         -- Lo mismo que en el tablero de Stock, con las mismas constantes:
         -- lo que falta para cubrir el objetivo contando lo que se vende
         -- mientras la reposición viaja.
         ceil(greatest(0, b.ritmo_diario * ${COBERTURA_OBJETIVO_DIAS + PLAZO_REPOSICION_DIAS} - b.total)) as sugerido
  from base b
)`;

type Where = { sql: string; params: unknown[] };

function where(f: FiltrosCompras, mes: string): Where {
  const params: unknown[] = [
    f.ventana ?? VENTANA_POR_DEFECTO,
    PROVEEDORES_NO_MERCADERIA,
    mes,
  ];
  const clauses: string[] = [];

  agregarFiltro(clauses, params, "proveedor", f.proveedor);
  agregarFiltro(clauses, params, "marca", f.marca);

  if (f.buscar) {
    params.push(`%${f.buscar}%`);
    clauses.push(`(sku ilike $${params.length} or producto ilike $${params.length})`);
  }

  // POR DEFECTO SÓLO LO QUE HAY QUE COMPRAR. Son ~3.300 SKU con stock y la
  // orden típica tiene decenas: arrancar con todo obligaría a buscar los que
  // importan entre los que no. El switch de "ver todos" está en la pantalla
  // para cuando se quiere agregar algo que el cálculo no pidió.
  if (!f.todos) clauses.push("sugerido > 0");

  return { sql: clauses.length ? `where ${clauses.join(" and ")}` : "", params };
}

const num = (v: unknown): number => Number(v ?? 0);

/** El historial de descuentos que devuelve Postgres, ya tipado. */
function historia(v: unknown): { mes: string; pct: number }[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x) => x && typeof x === "object")
    .map((x) => ({
      mes: String((x as { mes: unknown }).mes ?? ""),
      pct: num((x as { pct: unknown }).pct),
    }));
}

/** Tope de filas. Una orden de compra de más de 500 renglones no existe. */
const TOPE = 500;

async function getFilas(f: FiltrosCompras, mes: string): Promise<FilaCompra[]> {
  const w = where(f, mes);
  const filas = await query<Record<string, unknown>>(
    `${BASE}
     select sku, producto, proveedor, marca, u_bulto,
            tuc, full_ml, total, costo, valor, costo_lista,
            oferta_calculada_pct, sell_in_pct,
            uds, ritmo_diario, cobertura, sugerido,
            uds_rent, rentabilidad,
            uds_mes_pasado, rent_mes_pasado,
            comprado_mes_pasado, proveedor_compro,
            hist_sell_in, hist_calculado,
            to_char(ultima_venta, 'YYYY-MM-DD') as ultima_venta,
            ultima_compra
     from calculada ${w.sql}
     -- Por lo que hay que comprar, no por lo que hay: arriba lo más urgente.
     order by sugerido * costo desc, sugerido desc
     limit ${TOPE}`,
    w.params,
  );

  return filas.map((r) => ({
    sku: r.sku as string,
    producto: (r.producto as string | null) ?? null,
    proveedor: (r.proveedor as string | null) ?? null,
    marca: (r.marca as string | null) ?? null,
    unidadesPorBulto: num(r.u_bulto),
    tuc: num(r.tuc),
    full: num(r.full_ml),
    total: num(r.total),
    costo: num(r.costo),
    valor: num(r.valor),
    costoLista: num(r.costo_lista),
    ofertaCalculadaPct:
      r.oferta_calculada_pct == null ? null : num(r.oferta_calculada_pct),
    sellInPct: r.sell_in_pct == null ? null : num(r.sell_in_pct),
    uds: num(r.uds),
    ritmoDiario: num(r.ritmo_diario),
    cobertura: r.cobertura == null ? null : num(r.cobertura),
    sugerido: num(r.sugerido),
    udsRentabilidad: num(r.uds_rent),
    rentabilidad: r.rentabilidad == null ? null : num(r.rentabilidad),
    udsMesPasado: num(r.uds_mes_pasado),
    rentMesPasado: r.rent_mes_pasado == null ? null : num(r.rent_mes_pasado),
    compradoMesPasado: r.comprado_mes_pasado === true,
    proveedorComproMesPasado: r.proveedor_compro === true,
    histSellIn: historia(r.hist_sell_in),
    histCalculado: historia(r.hist_calculado),
    ultimaVenta: (r.ultima_venta as string | null) ?? null,
    ultimaCompra: (r.ultima_compra as string | null) ?? null,
  }));
}

/**
 * Los meses que tienen ofertas cargadas, del más nuevo al más viejo.
 *
 * La pantalla arranca en el más nuevo y NO en el mes calendario: el 1° de cada
 * mes los costos del mes nuevo todavía no están cargados, y ofrecer un mes
 * vacío mostraría todos los descuentos en cero como si el proveedor no diera
 * ninguno.
 */
async function getMeses(): Promise<string[]> {
  // La unión de los dos: los meses que tienen sell in cargado y los que tienen
  // costos. Mientras `bronze.sell_in` esté vacía el selector sigue teniendo los
  // meses de siempre —si no, quedaría sin ninguna opción— y el día que se carguen
  // los del sell in aparecen solos.
  const filas = await query<{ v: string }>(
    `select v from (
       -- Sin los eventos sin fecha, que se guardan con el mes vacio: en un
       -- selector de meses, una opcion en blanco no se puede elegir ni entender.
       select distinct mes_comercial as v from bronze.sell_in where mes_comercial <> ''
       union
       select distinct mes_comercial from bronze.costos_historicos
     ) m
     order by v desc
     limit 24`,
  );
  return filas.map((r) => r.v);
}

/** Cuántos artículos tiene el sell in del mes elegido. `0` = todavía no se cargó. */
async function getSellInCargado(mes: string): Promise<number> {
  const fila = await queryOne<{ v: string }>(
    `select count(*) as v from bronze.sell_in
     where mes_comercial = $1::text and evento = ''`,
    [mes],
  );
  return Number(fila?.v ?? 0);
}

export async function getOpcionesCompras() {
  const params = [VENTANA_POR_DEFECTO, PROVEEDORES_NO_MERCADERIA, ""];
  const [proveedores, marcas, meses] = await Promise.all([
    query<{ v: string }>(
      `${BASE} select distinct proveedor as v from calculada
       where proveedor is not null order by 1`,
      params,
    ),
    query<{ v: string }>(
      `${BASE} select distinct marca as v from calculada
       where marca is not null order by 1`,
      params,
    ),
    getMeses(),
  ]);
  return {
    proveedores: proveedores.map((r) => r.v),
    marcas: marcas.map((r) => r.v),
    meses,
  };
}

/** Hasta qué fecha hay compras cargadas. Ver la nota en queries-stock.ts. */
async function getComprasHasta(): Promise<string | null> {
  const fila = await queryOne<{ v: string | null }>(
    `select max("fechaFactura") as v from bronze.sigma_compras`,
  );
  return fila?.v ?? null;
}

export async function getDashboardCompras(
  f: FiltrosCompras,
): Promise<DashboardCompras> {
  const meses = await getMeses();
  // El mes pedido sólo vale si existe: uno inventado dejaría todos los
  // descuentos en cero sin decir por qué.
  const mes = (f.mes && meses.includes(f.mes) ? f.mes : meses[0]) ?? "";

  const [filas, comprasHasta, sellInCargado] = await Promise.all([
    getFilas(f, mes),
    getComprasHasta(),
    getSellInCargado(mes),
  ]);

  // El mes pasado, calculado igual que en el SQL, para que la pantalla lo
  // nombre sin volver a deducirlo —y sin la chance de que los dos no coincidan
  // el día 1 de un mes.
  const hoy = new Date();
  const mesPasado = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() - 1, 1))
    .toISOString()
    .slice(0, 7);

  return {
    filas,
    recortada: filas.length === TOPE,
    mesPasado,
    ventana: f.ventana ?? VENTANA_POR_DEFECTO,
    mes,
    meses,
    sellInCargado,
    comprasHasta,
    generadoEn: new Date().toISOString(),
  };
}
