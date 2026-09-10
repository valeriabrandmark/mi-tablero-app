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
