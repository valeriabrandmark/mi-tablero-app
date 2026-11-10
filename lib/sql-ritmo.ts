/**
 * LA CUENTA DEL RITMO DE VENTA, una sola vez para Stock y Compras.
 *
 * Las dos pantallas muestran la cobertura del mismo artículo, y que una diga
 * 40 días y la otra 140 no es un matiz: es una de las dos mintiendo. Hasta el
 * 10/11/2026 cada una tenía su copia de la regla, y cuando Compras pasó a medir
 * sobre los días con stock, Stock se quedó con la vieja. Por eso ahora los
 * pedazos de SQL viven acá y las dos consultas los usan.
 *
 * ---------------------------------------------------------------------------
 * LAS DOS REGLAS (ver lib/compras-parametros.ts)
 *
 *   Sobre los días con stock (por defecto): cada depósito vende lo suyo en
 *   los días que tuvo stock, y los dos ritmos se suman.
 *
 *       ritmo = vendido Tucumán / días con stock Tucumán
 *             + vendido Full    / días con stock Full
 *
 *   con un piso de `dias_minimos_con_stock` y nunca más días que la regla de
 *   la ventana: así el ritmo nuevo nunca da menos que el de siempre.
 *   Los días salen de gold.dias_con_stock (tablero_quo, stock_diario.py).
 *
 *   Sobre la ventana: lo vendido dividido la ventana, recortada a la primera
 *   venta con un piso de `dias_minimos_de_ritmo`. Es la regla de siempre, y la
 *   que se usa para un artículo que todavía no tiene la cuenta de días.
 *
 * ---------------------------------------------------------------------------
 * CÓMO SE USA
 *
 * La consulta tiene que tener `$1` = la ventana en días y un CTE `ventas` con
 * `sku` y `primera_venta`. Después:
 *
 *   1. `ctesRitmo(...)` va en el `with`, antes del CTE que arma la base.
 *   2. `columnasRitmo(p)` va en el select de la base (necesita `v` = ventas).
 *   3. `joinsRitmo("s.sku")` va en los joins de la base.
 *   4. `expresionRitmo(p)` es el ritmo, en un nivel por encima de la base.
 *
 * Los números de `p` se interpolan: ya pasaron por `normalizarParametros`.
 */

import type { ParametrosCompras } from "@/lib/compras-parametros";

/**
 * QUÉ VENTA SALE DEL DEPÓSITO DE FULL, en SQL sobre gold.fact_ventas.
 *
 * Mercado Libre con logística `fulfillment`. Hasta septiembre de 2026 la venta
 * de Meli no traía logística (null) y desde octubre el 99 % es fulfillment, así
 * que un null cuenta como Full. Todo lo demás (mayorista, Tienda Nube, Meli
 * con otra logística) sale de Tucumán.
 *
 * LA MISMA REGLA vive en tablero_quo/stock_diario.py, que cuenta los días con
 * stock de cada depósito: si se cambia acá, se cambia allá.
 */
export const LOGISTICAS_NO_FULL = [
  "cross_docking",
  "self_service",
  "xd_drop_off",
  "drop_off",
  "custom",
  "not_specified",
] as const;

export const VENTA_DESDE_FULL = `(canal = 'Mercado Libre' and coalesce(logistica, 'fulfillment') not in (${LOGISTICAS_NO_FULL.map((l) => `'${l}'`).join(", ")}))`;

const n = (v: number) => String(Number(v));

/**
 * Los dos CTE del ritmo por depósito, con la coma final para ir en el medio
 * del `with`.
 *
 * `hayDiasConStock` dice si existe gold.dias_con_stock: sin la tabla se usa
 * una vacía y el ritmo cae a la regla de la ventana, en vez de tirar la
 * pantalla.
 */
export function ctesRitmo(hayDiasConStock: boolean): string {
  return `
-- LO VENDIDO DE CADA DEPOSITO, para medir el ritmo sobre los días que cada
-- uno tuvo stock. Ver lib/sql-ritmo.ts.
ventas_deposito as (
  select sku,
         coalesce(sum(cantidad) filter (where ${VENTA_DESDE_FULL}), 0)       as uds_full,
         coalesce(sum(cantidad) filter (where not (${VENTA_DESDE_FULL})), 0) as uds_tuc
  from gold.fact_ventas
  where fecha >= current_date - $1::int
  group by sku
),
-- Cuántos días de la ventana tuvo stock cada depósito. Lo calcula tablero_quo
-- (stock_diario.py) con las fotos diarias y, donde no hay foto, reconstruyendo
-- el stock con compras, ventas y envíos a Full.
dias_stock as (
  ${
    hayDiasConStock
      ? `select sku,
         max(dias_con_stock) filter (where deposito = 'tuc')  as dias_tuc,
         max(dias_con_stock) filter (where deposito = 'full') as dias_full
  from gold.dias_con_stock
  where ventana = $1::int
  group by sku`
      : `select null::text as sku, null::int as dias_tuc, null::int as dias_full
  where false`
  }
),`;
}

/** Las columnas del ritmo en el select de la base. Necesita `v` = ventas. */
export function columnasRitmo(p: ParametrosCompras): string {
  const ritmoSobreStock = p.ritmo_sobre_dias_con_stock >= 1;
  return `
         -- SOBRE CUANTOS DIAS SE MIDE EL RITMO CON LA REGLA DE LA VENTANA: la
         -- ventana entera, salvo que el artículo haya empezado a venderse
         -- adentro de ella. Uno dado de alta hace 30 días que vendió 20
         -- unidades no vende 20/120 = 0,17 por día, vende 0,67. El piso de
         -- ${n(p.dias_minimos_de_ritmo)} días evita el otro extremo: sin él,
         -- tres unidades vendidas ayer darían un ritmo de 3 por día.
         case when v.primera_venta is null then $1::int
              else least($1::int,
                         greatest(${n(p.dias_minimos_de_ritmo)},
                                  current_date - v.primera_venta::date))
         end                                            as dias_ritmo,
         coalesce(vd.uds_tuc, 0)                        as uds_tuc,
         coalesce(vd.uds_full, 0)                       as uds_full,
         ds.dias_tuc                                    as dias_stock_tuc,
         ds.dias_full                                   as dias_stock_full,
         -- EL RITMO SE MIDE SOBRE LOS DIAS CON STOCK sólo si está prendida la
         -- regla Y el artículo tiene la cuenta hecha. Sin fila en
         -- gold.dias_con_stock se usa la regla de la ventana de siempre.
         (${ritmoSobreStock ? "true" : "false"} and ds.sku is not null) as ritmo_sobre_stock`;
}

/** Los joins de la base. `sku` es la columna con la que se cruza. */
export function joinsRitmo(sku: string): string {
  return `
  left join ventas_deposito vd on vd.sku = ${sku}
  left join dias_stock ds on ds.sku = ${sku}`;
}

/**
 * El ritmo diario, sobre las columnas de `columnasRitmo` (alias `b`) y `b.uds`
 * (lo vendido en la ventana, todos los canales).
 */
export function expresionRitmo(p: ParametrosCompras): string {
  const piso = n(p.dias_minimos_con_stock);
  // NUNCA MÁS DÍAS QUE LA REGLA DE LA VENTANA (`dias_ritmo`). Sacar los días
  // sin stock sólo puede ACHICAR el divisor, así que con este tope el ritmo
  // nuevo nunca da menos que el de antes, aunque la cuenta de días se pase.
  //
  // Y se pasa: la reconstrucción del stock de Tucumán es un techo, porque el
  // 84 % de las facturas de compra llega sin detalle de artículos (al
  // 10/11/2026). Sin este tope, el pañal AL01081 --primera venta el 22/10--
  // figuraba con 101 días con stock y sugería 3 en vez de 13.
  return `case when b.ritmo_sobre_stock then
                b.uds_tuc::numeric / least(b.dias_ritmo, greatest(${piso}, coalesce(b.dias_stock_tuc, 0)))
              + b.uds_full::numeric / least(b.dias_ritmo, greatest(${piso}, coalesce(b.dias_stock_full, 0)))
              else b.uds::numeric / b.dias_ritmo
         end`;
}
