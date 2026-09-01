import { query, queryOne } from "@/lib/db";
import { agregarFiltro } from "@/lib/filtros";
import {
  COBERTURA_OBJETIVO_DIAS,
  DEPOSITO_POR_DEFECTO,
  PLAZO_REPOSICION_DIAS,
  PROVEEDORES_NO_MERCADERIA,
  VENTANA_POR_DEFECTO,
  tramoCobertura,
} from "@/lib/stock";
import type {
  DashboardStock,
  FilaStock,
  FiltrosStock,
  KpisStock,
  ProveedorStock,
  TramoStock,
} from "@/lib/types";

/**
 * Consultas del tablero de Stock.
 *
 * Cruza CINCO fuentes, cada una con algo que las otras no tienen:
 *
 *   bronze.digip_stock         unidades en el depósito de Tucumán
 *   bronze.ml_stock_full       unidades en el depósito de Mercado Libre
 *   bronze.ml_publicaciones    el mapa inventory_id -> SKU, que ML no da hecho
 *   bronze.sigma_articulos     proveedor, marca y descripción
 *   bronze.costos_historicos   el costo con el que se valoriza
 *   gold.fact_ventas           el ritmo de venta, que es lo que vuelve
 *                              interpretable a todo lo anterior
 *   bronze.sigma_compras       cuándo se compró por última vez cada artículo
 *   bronze.ml_stock_antiguedad hace cuánto que la mercadería está en Full
 *
 * Es exactamente lo que la planilla de compras arma pegando exportaciones a
 * mano, con la diferencia de que acá está al día y las cuentas se definen una
 * sola vez. Ver lib/stock.ts para las tres cosas que se hacen distinto y por qué.
 */

/**
 * El SKU de una publicación vive dentro del array `attributes`, no en
 * `seller_custom_field` — que está vacío en casi todas. Mismo rodeo que en
 * queries-stock-full.ts, por el mismo motivo.
 */
const SKU_DE_PUBLICACION = `(select a->>'value_name'
     from jsonb_array_elements(p.attributes::jsonb) a
    where a->>'id' = 'SELLER_SKU'
    limit 1)`;

/**
 * El armado completo, listo para filtrar. Una sola definición porque la usan
 * los KPIs, los dos gráficos y la tabla: escrita cuatro veces, terminarían
 * midiendo cosas distintas sin que nada avise.
 *
 * $1 es la ventana en días del ritmo de venta y $3 el depósito que se mira.
 */
const BASE = `
with por_inv as (
  -- Un renglón por INVENTARIO y no por publicación: varias publicaciones
  -- comparten el mismo stock físico, y sumarlas lo contaría de más.
  select p.inventory_id, max(${SKU_DE_PUBLICACION}) as sku
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
  -- Agrupado por código: hay 24 códigos repetidos en el export de Digip, y sin
  -- esto el join los multiplicaría en todas las cuentas de plata.
  select trim(codigo) as sku, sum(coalesce("stock.disponible", 0)) as unidades
  from bronze.digip_stock
  group by 1
),
costo as (
  -- El costo del último mes que lo tenga cargado. Los artículos sin costo
  -- quedan en 0 a propósito: son testers y exhibidores, que no se compran.
  select distinct on (sku) sku, costo_real
  from bronze.costos_historicos
  where costo_real > 0
  order by sku, mes_comercial desc
),
compras as (
  -- La última compra de cada SKU. El detalle de renglones viaja como JSON
  -- dentro de la columna items, así que hay que abrirlo para saber qué se compró.
  --
  -- ES UN PISO Y NO LA VERDAD: dos de cada tres comprobantes llegan con
  -- items vacío, y no hay compras cargadas después del 11/06/2026. Un
  -- artículo comprado en agosto figura con la fecha vieja, o sin fecha. Se
  -- muestra igual porque saber que algo NO se compró en meses vale, pero la
  -- pantalla dice hasta dónde llegan los datos (ver getComprasHasta más abajo).
  select it->>'articuloId' as sku, max(c."fechaFactura") as ultima_compra
  from bronze.sigma_compras c
  cross join lateral jsonb_array_elements(c.items::jsonb) it
  where it->>'articuloId' is not null
  group by 1
),
antiguedad as (
  -- Hace cuanto que la mercaderia esta parada en Full, de la ultima foto que
  -- haya. La calcula ml_antiguedad.py en tablero_quo reconstruyendo el libro de
  -- movimientos del inventario: Mercado Libre no da el dato hecho.
  --
  -- SUMA POR SKU porque la foto es por INVENTARIO, y hay 5 SKU que usan mas de
  -- uno. Sin agrupar, el join los duplicaria en todas las cuentas de plata.
  --
  -- SOLO EXISTE PARA FULL. En Tucuman no hay historia de movimientos con la que
  -- reconstruir nada, asi que un SKU que solo esta alla queda en null -- que es
  -- "no se sabe" y no "es nuevo".
  select a.sku,
         sum(a.u_mas_120)                                          as u_mas_120,
         -- Promedio ponderado por unidad: un inventario de una unidad no puede
         -- mover el promedio igual que uno de mil.
         case when sum(a.unidades) > 0
              then sum(a.dias_promedio * a.unidades) / sum(a.unidades)
         end                                                       as dias
  from bronze.ml_stock_antiguedad a
  where a.fecha = (select max(fecha) from bronze.ml_stock_antiguedad)
    and a.sku is not null
  group by a.sku
),
ventas as (
  select sku,
         max(fecha)                                                  as ultima_venta,
         coalesce(sum(cantidad) filter (where fecha >= current_date - $1::int), 0) as uds,
         coalesce(sum(cantidad) filter (where fecha >= current_date - $1::int
                                          and canal = 'Mercado Libre'), 0) as uds_meli,
         coalesce(sum(cantidad) filter (where fecha >= current_date - $1::int
                                          and canal = 'Tienda Nube'), 0)   as uds_tn,
         coalesce(sum(cantidad) filter (where fecha >= current_date - $1::int
                                          and canal = 'Mayorista'), 0)     as uds_may
  from gold.fact_ventas
  group by sku
),
stock as (
  -- FULL OUTER: hay SKU que sólo están en Tucumán y SKU que sólo están en Full.
  -- Un inner join perdería justo los que están en un solo depósito, que son los
  -- que más interesa mirar.
  select coalesce(t.sku, f.sku)         as sku,
         coalesce(t.unidades, 0)        as tuc,
         coalesce(f.unidades, 0)        as full_ml,
         -- El total depende del depósito elegido, y de ahí cuelga TODO lo
         -- demás: la plata, la cobertura, el exceso y el sugerido. Mirar sólo
         -- Full y seguir valorizando los dos depósitos daría un número que no
         -- es de ninguno de los dos.
         case $3::text
           when 'tucuman' then coalesce(t.unidades, 0)
           when 'full'    then coalesce(f.unidades, 0)
           else coalesce(t.unidades, 0) + coalesce(f.unidades, 0)
         end                            as total
  from tuc t
  full outer join full_ml f on f.sku = t.sku
),
base as (
  select s.sku,
         a.descripcion                                  as producto,
         a."proveedorNombre"                            as proveedor,
         a."attributes.marca"                           as marca,
         s.tuc,
         s.full_ml,
         s.total,
         coalesce(c.costo_real, 0)                      as costo,
         s.total * coalesce(c.costo_real, 0)            as valor,
         coalesce(v.uds, 0)                             as uds,
         coalesce(v.uds_meli, 0)                        as uds_meli,
         coalesce(v.uds_tn, 0)                          as uds_tn,
         coalesce(v.uds_may, 0)                         as uds_may,
         v.ultima_venta,
         co.ultima_compra,
         ant.dias                                       as dias_en_full,
         coalesce(ant.u_mas_120, 0)                     as u_mas_120,
         coalesce(ant.u_mas_120, 0) * coalesce(c.costo_real, 0) as valor_mas_120,
         -- El ritmo es unidades por DÍA. La planilla lo guardaba mensual y lo
         -- llamaba "STOCK MAX", que es lo que hacía leer un ritmo como un tope.
         coalesce(v.uds, 0)::numeric / $1::int          as ritmo_diario,
         -- Sin ventas no hay cobertura: es null y no un número enorme. Son dos
         -- situaciones distintas y la planilla las mezclaba en un #DIV/0!.
         case when coalesce(v.uds, 0) = 0 then null
              else s.total / (coalesce(v.uds, 0)::numeric / $1::int)
         end                                            as cobertura
  from stock s
  left join bronze.sigma_articulos a on trim(a.id) = s.sku
  left join costo c on c.sku = s.sku
  left join ventas v on v.sku = s.sku
  left join compras co on co.sku = s.sku
  left join antiguedad ant on ant.sku = s.sku
  where s.total > 0
    and coalesce(a."proveedorNombre", '') <> all($2::text[])
),
-- El exceso y el sugerido salen del ritmo, así que van en su propio nivel para
-- no repetir la expresión entera en cada uno.
calculada as (
  select b.*,
         greatest(0, b.total - b.ritmo_diario * ${COBERTURA_OBJETIVO_DIAS})           as exceso_u,
         greatest(0, b.total - b.ritmo_diario * ${COBERTURA_OBJETIVO_DIAS}) * b.costo as exceso,
         -- Lo que falta para llegar al objetivo CONTANDO lo que se va a vender
         -- mientras la reposición viaja. Sin sumar el plazo, el pedido llega
         -- justo cuando el artículo ya se quebró.
         ceil(greatest(0, b.ritmo_diario * ${COBERTURA_OBJETIVO_DIAS + PLAZO_REPOSICION_DIAS} - b.total)) as sugerido
  from base b
)`;

type Where = { sql: string; params: unknown[] };

function where(f: FiltrosStock): Where {
  const params: unknown[] = [
    f.ventana ?? VENTANA_POR_DEFECTO,
    PROVEEDORES_NO_MERCADERIA,
    f.deposito ?? DEPOSITO_POR_DEFECTO,
  ];
  const clauses: string[] = [];

  agregarFiltro(clauses, params, "proveedor", f.proveedor);
  agregarFiltro(clauses, params, "marca", f.marca);
  agregarFiltro(clauses, params, "sku", f.sku);

  if (f.buscar) {
    params.push(`%${f.buscar}%`);
    clauses.push(`(sku ilike $${params.length} or producto ilike $${params.length})`);
  }

  // El tramo se filtra con los mismos bordes que usa `tramoCobertura`, escritos
  // acá una vez. No se puede llamar a la función de TypeScript desde SQL, así
  // que lo que se cuida es que los números salgan de las mismas constantes.
  if (f.tramo) {
    const rango: Record<string, string> = {
      quiebre: `cobertura is not null and cobertura < ${PLAZO_REPOSICION_DIAS}`,
      ajustado: `cobertura >= ${PLAZO_REPOSICION_DIAS} and cobertura < ${COBERTURA_OBJETIVO_DIAS}`,
      objetivo: `cobertura >= ${COBERTURA_OBJETIVO_DIAS} and cobertura < 60`,
      sobra: `cobertura >= 60 and cobertura <= 120`,
      excedido: `cobertura > 120`,
      sin_venta: `cobertura is null`,
    };
    if (rango[f.tramo]) clauses.push(rango[f.tramo]);
  }

  return { sql: clauses.length ? `where ${clauses.join(" and ")}` : "", params };
}

const num = (v: unknown): number => Number(v ?? 0);

async function getKpis(f: FiltrosStock): Promise<KpisStock> {
  const w = where(f);
  const fila = await queryOne<Record<string, string>>(
    `${BASE}
     select count(*)                                                as skus,
            coalesce(sum(total), 0)                                 as unidades,
            coalesce(sum(valor), 0)                                 as valor,
            count(*) filter (where cobertura is null)               as skus_sin_venta,
            coalesce(sum(valor) filter (where cobertura is null), 0) as valor_sin_venta,
            count(*) filter (where cobertura is not null
                               and cobertura < ${PLAZO_REPOSICION_DIAS}) as skus_quiebre,
            coalesce(sum(exceso), 0)                                as exceso,
            count(*) filter (where costo = 0)                       as skus_sin_costo,
            coalesce(sum(u_mas_120), 0)                             as u_mas_120,
            coalesce(sum(valor_mas_120), 0)                         as valor_mas_120
     from calculada ${w.sql}`,
    w.params,
  );

  return {
    skus: num(fila?.skus),
    unidades: num(fila?.unidades),
    valor: num(fila?.valor),
    skusSinVenta: num(fila?.skus_sin_venta),
    valorSinVenta: num(fila?.valor_sin_venta),
    skusQuiebre: num(fila?.skus_quiebre),
    exceso: num(fila?.exceso),
    skusSinCosto: num(fila?.skus_sin_costo),
    uMas120: num(fila?.u_mas_120),
    valorMas120: num(fila?.valor_mas_120),
  };
}

/**
 * Cuánto stock hay en cada tramo de cobertura.
 *
 * El tramo se resuelve en TypeScript con `tramoCobertura` y no en SQL: con los
 * cortes escritos en los dos lados, el día que se muevan van a quedar
 * distintos en cada uno y nadie lo va a notar hasta que los números no cierren.
 */
async function getTramos(f: FiltrosStock): Promise<TramoStock[]> {
  const w = where(f);
  const filas = await query<Record<string, string | null>>(
    `${BASE}
     select cobertura, total, valor
     from calculada ${w.sql}`,
    w.params,
  );

  const mapa = new Map<string, TramoStock>();
  for (const r of filas) {
    const clave = tramoCobertura(r.cobertura == null ? null : num(r.cobertura));
    const actual = mapa.get(clave) ?? { tramo: clave, skus: 0, unidades: 0, valor: 0 };
    actual.skus += 1;
    actual.unidades += num(r.total);
    actual.valor += num(r.valor);
    mapa.set(clave, actual);
  }
  return [...mapa.values()];
}

async function getProveedores(f: FiltrosStock): Promise<ProveedorStock[]> {
  const w = where(f);
  const filas = await query<Record<string, string | null>>(
    `${BASE}
     select coalesce(proveedor, 'Sin dato') as proveedor,
            count(*)                        as skus,
            coalesce(sum(valor), 0)         as valor,
            coalesce(sum(exceso), 0)        as exceso
     from calculada ${w.sql}
     group by 1
     order by 3 desc`,
    w.params,
  );
  return filas.map((r) => ({
    proveedor: r.proveedor as string,
    skus: num(r.skus),
    valor: num(r.valor),
    exceso: num(r.exceso),
  }));
}

/** Tope de filas que bajan al navegador. Son ~3.300 SKU con stock. */
const TOPE = 500;

async function getFilas(f: FiltrosStock): Promise<FilaStock[]> {
  const w = where(f);
  const filas = await query<Record<string, string | null>>(
    `${BASE}
     select sku, producto, proveedor, marca,
            tuc, full_ml, total, costo, valor,
            uds, uds_meli, uds_tn, uds_may,
            ritmo_diario, cobertura, exceso_u, exceso, sugerido,
            to_char(ultima_venta, 'YYYY-MM-DD') as ultima_venta,
            ultima_compra,
            dias_en_full, u_mas_120, valor_mas_120
     from calculada ${w.sql}
     -- Por plata, no por unidades: el orden tiene que empujar arriba lo que más
     -- pesa en el bolsillo, que es lo que se decide primero.
     order by valor desc
     limit ${TOPE}`,
    w.params,
  );

  return filas.map((r) => ({
    sku: r.sku as string,
    producto: r.producto,
    proveedor: r.proveedor,
    marca: r.marca,
    tuc: num(r.tuc),
    full: num(r.full_ml),
    total: num(r.total),
    costo: num(r.costo),
    valor: num(r.valor),
    uds: num(r.uds),
    udsMeli: num(r.uds_meli),
    udsTn: num(r.uds_tn),
    udsMayorista: num(r.uds_may),
    ritmoDiario: num(r.ritmo_diario),
    cobertura: r.cobertura == null ? null : num(r.cobertura),
    excesoU: num(r.exceso_u),
    exceso: num(r.exceso),
    sugerido: num(r.sugerido),
    ultimaVenta: r.ultima_venta,
    ultimaCompra: r.ultima_compra,
    diasEnFull: r.dias_en_full == null ? null : num(r.dias_en_full),
    uMas120: num(r.u_mas_120),
    valorMas120: num(r.valor_mas_120),
  }));
}

export async function getOpcionesStock() {
  const params = [VENTANA_POR_DEFECTO, PROVEEDORES_NO_MERCADERIA, DEPOSITO_POR_DEFECTO];
  const [proveedores, marcas] = await Promise.all([
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
  ]);
  return { proveedores: proveedores.map((r) => r.v), marcas: marcas.map((r) => r.v) };
}

/**
 * Hasta qué fecha hay compras cargadas.
 *
 * Se consulta en vez de escribirse a mano porque el día que el orquestador
 * empiece a traer las que faltan, la pantalla tiene que dejar de disculparse
 * sola. Una constante quedaría mintiendo justo cuando el problema se arregló.
 */
async function getComprasHasta(): Promise<string | null> {
  const fila = await queryOne<{ v: string | null }>(
    `select max("fechaFactura") as v from bronze.sigma_compras`,
  );
  return fila?.v ?? null;
}

/**
 * De cuándo es la foto de antigüedad.
 *
 * `null` mientras el paso del orquestador no haya corrido, y la pantalla lo
 * dice. Sin eso, una columna vacía se leería como "no hay mercadería vieja",
 * que es la lectura opuesta a la verdadera.
 *
 * En un `try` porque la tabla puede no existir todavía en una base donde el
 * paso nunca corrió: eso no tiene que tumbar el tablero entero.
 */
async function getAntiguedadAl(): Promise<string | null> {
  try {
    const fila = await queryOne<{ v: string | null }>(
      `select to_char(max(fecha), 'YYYY-MM-DD') as v
       from bronze.ml_stock_antiguedad`,
    );
    return fila?.v ?? null;
  } catch {
    return null;
  }
}

export async function getDashboardStock(f: FiltrosStock): Promise<DashboardStock> {
  const [kpis, tramos, proveedores, filas, comprasHasta, antiguedadAl] =
    await Promise.all([
      getKpis(f),
      getTramos(f),
      getProveedores(f),
      getFilas(f),
      getComprasHasta(),
      getAntiguedadAl(),
    ]);

  return {
    kpis,
    tramos,
    proveedores,
    filas,
    recortada: filas.length === TOPE,
    ventana: f.ventana ?? VENTANA_POR_DEFECTO,
    deposito: f.deposito ?? DEPOSITO_POR_DEFECTO,
    comprasHasta,
    antiguedadAl,
    generadoEn: new Date().toISOString(),
  };
}
