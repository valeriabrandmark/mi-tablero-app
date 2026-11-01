/**
 * El mapa `inventory_id` -> SKU de Mercado Libre, en SQL.
 *
 * ---------------------------------------------------------------------------
 * POR QUÉ EXISTE ESTE ARCHIVO
 *
 * Cuatro pantallas necesitan el mismo mapa —Stock, Stock Full, Antigüedad y
 * Trazabilidad—, y hasta ahora cada una lo armaba por su cuenta parseando el
 * JSON de `ml_publicaciones.attributes`. Eso tenía dos problemas.
 *
 * EL PRIMERO ES QUE ERA CARO. `attributes` es TEXTO: 6.646 caracteres de
 * promedio, 14 MB en total. Sacar de ahí un solo campo obliga a convertir todo
 * el texto a jsonb, y medido daba 896 ms. El tablero de Stock hace SIETE
 * consultas por pantalla y cada una lo repetía, así que eran ~6 segundos de
 * puro parseo en cada click de un filtro. Se notaba: la pantalla quedaba
 * sombreada un rato largo antes de contestar.
 *
 * EL SEGUNDO es que el mismo rodeo escrito en cuatro archivos son cuatro
 * lugares donde puede quedar distinto sin que nadie se entere.
 *
 * ---------------------------------------------------------------------------
 * CÓMO SE RESUELVE
 *
 * `bronze.ml_inventario_sku` tiene el mapa ya calculado. Lo rehace
 * `mercadolibre.py --catalogo` después de traer las publicaciones, que es el
 * único momento en el que puede cambiar. Leerlo tarda 0,9 ms contra los 896 de
 * antes.
 *
 * POR QUÉ IGUAL SE PARSEA UN POCO. La segunda mitad del `union` toma las
 * publicaciones que TODAVÍA NO ESTÁN en el mapa. Normalmente son cero, y el
 * `not exists` hace que Postgres ni mire su JSON. Pero el día que el catálogo
 * traiga un artículo nuevo y el mapa todavía no se haya rehecho, ese artículo
 * aparece igual en vez de desaparecer del stock hasta la próxima corrida.
 *
 * Es lo que hace que esto sea una optimización y no una fuente nueva de datos
 * faltantes: si el mapa está al día, vuela; si está viejo, sigue estando bien;
 * y si estuviera vacío, se comporta exactamente como el código anterior.
 */
export const POR_INVENTARIO_SKU = `
  select m.inventory_id, m.sku
  from bronze.ml_inventario_sku m
  union all
  select p.inventory_id,
         max((select a->>'value_name'
                from jsonb_array_elements(p.attributes::jsonb) a
               where a->>'id' = 'SELLER_SKU'
               limit 1))
  from bronze.ml_publicaciones p
  where p."shipping.logistic_type" = 'fulfillment'
    and p.inventory_id is not null
    and not exists (
      select 1 from bronze.ml_inventario_sku m2
      where m2.inventory_id = p.inventory_id
    )
  group by p.inventory_id`;

/**
 * Stock de Full por SKU: lo APTO PARA VENDER y lo PENDIENTE DE INGRESO.
 *
 * Necesita un CTE `por_inv` (ver POR_INVENTARIO_SKU) antes. Lo usan Stock y
 * Compras, que tienen que contar lo mismo.
 *
 * PENDIENTE DE INGRESO ("en camino"): lo que ya salió de Tucumán --Digip ya no
 * lo cuenta-- pero Mercado Libre todavía no recibió, así que
 * /inventories/{id}/stock/fulfillment tampoco. Sin esto, cada envío a Full en
 * tránsito desaparecía del stock y el sugerido pedía de más.
 *
 * No hay campo directo en la API: sale de restar dos que sí hay.
 *   ml_reposicion_full.stock_total  (replenishment, stock.total_stock)
 *       = en Full + pendiente de ingreso
 *   ml_stock_full.total             (/stock/fulfillment)
 *       = en Full (aptas + no aptas)
 * Validado contra el reporte "Stock general Full" del 01/11/2026: coincide
 * exacto con "Pendientes de ingreso" en 523 de 561 productos (el resto es
 * corrimiento horario entre la corrida y el reporte). greatest(.., 0) porque
 * las dos fotos no son del mismo segundo.
 */
export const FULL_POR_SKU = `
  select i.sku,
         sum(coalesce(f.available_quantity, 0)) as unidades,
         sum(greatest(coalesce(r.stock_total, 0) - coalesce(f.total, 0), 0)) as en_camino
  from bronze.ml_stock_full f
  join por_inv i on i.inventory_id = f.inventory_id
  left join bronze.ml_reposicion_full r on r.inventory_id = f.inventory_id
  where i.sku is not null
  group by i.sku`;
