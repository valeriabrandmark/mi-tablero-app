/**
 * Los descuentos DE COSTO de un artículo, en SQL, para que las pantallas que
 * los muestran usen LA MISMA cuenta.
 *
 * ---------------------------------------------------------------------------
 * SON DOS Y NO TRES, Y ESA ES LA PARTE QUE HAY QUE SABER
 *
 *   Oferta prov. %    lo que EL PROVEEDOR nos descontó a nosotros. Columna J
 *                     del Excel de costos.
 *   Oferta propia %   lo que ponemos NOSOTROS encima. Columna K del mismo Excel.
 *
 * Viven en `bronze.costos_historicos` por (sku, mes_comercial), no por línea de
 * venta, así que valen para cualquier canal: son del COSTO, no de la venta.
 *
 * EL TERCERO --"Dto. venta %", lo que se le descontó al cliente-- NO ESTÁ ACÁ
 * a propósito. Sale de `gold.fact_ventas.oferta_pct`, que lo llena modelo.py
 * con los campos de descuento de la factura de Sigma, y esos sólo existen en
 * Mayorista: de 20.578 líneas de Mercado Libre y 36 de Tienda Nube, CERO lo
 * tienen. Llevarlo a esas pantallas sería una columna de guiones, y una columna
 * siempre vacía enseña a no mirar las columnas.
 *
 * ---------------------------------------------------------------------------
 * POR QUÉ EL JOIN RENOMBRA LAS COLUMNAS
 *
 * `costos_historicos` tiene `sku` y `mes_comercial`, que son también columnas de
 * `gold.fact_ventas`. Varias consultas de Mercado Libre y Tienda Nube filtran
 * por esas columnas SIN calificar la tabla (`where sku = ...`), así que un join
 * a secas las volvería ambiguas y rompería la pantalla entera.
 *
 * Con el subselect que las renombra, `sku` a secas sigue resolviendo a
 * `fact_ventas` y no hay que tocar ni un `where`.
 */

/** El join, con las columnas renombradas para no chocar. `t` es la tabla de ventas. */
export function joinCostos(t: string): string {
  return `left join (
       select sku             as ch_sku,
              mes_comercial   as ch_mes,
              oferta_pct      as ch_oferta_prov,
              desc_propio_pct as ch_oferta_propia
       from bronze.costos_historicos
     ) ch on ch.ch_sku = ${t}.sku and ch.ch_mes = ${t}.mes_comercial`;
}

/**
 * Los dos descuentos AGRUPADOS, ponderados por unidades.
 *
 * Son por (sku, mes) y no por línea, así que se promedian ponderados por
 * cantidad igual que el precio. EL DIVISOR SÓLO CUENTA LAS LÍNEAS QUE
 * ENCONTRARON COSTO CARGADO: meter las otras como cero diría "sin oferta"
 * donde en realidad es "sin dato".
 */
export function descuentosAgrupados(t: string): string {
  return `(sum(ch.ch_oferta_prov * ${t}.cantidad)
             / nullif(sum(${t}.cantidad) filter (where ch.ch_oferta_prov is not null), 0)
            )::float8 as "ofertaProveedorPct",
            (sum(ch.ch_oferta_propia * ${t}.cantidad)
             / nullif(sum(${t}.cantidad) filter (where ch.ch_oferta_propia is not null), 0)
            )::float8 as "ofertaPropiaPct"`;
}

/**
 * Los dos descuentos DE UNA LÍNEA, sin agrupar. Sin promedio ponderado porque
 * no hay nada que promediar: es una venta sola.
 *
 * No pide la tabla de ventas --a diferencia de `descuentosAgrupados`-- porque
 * no la necesita: los dos valores salen enteros del join. Se le pasaba un
 * parámetro sin usar para que las dos se llamaran igual, y eso obliga a
 * inventar un argumento que no significa nada.
 */
export const DESCUENTOS_DE_LINEA = `ch.ch_oferta_prov::float8   as "ofertaProveedorPct",
            ch.ch_oferta_propia::float8 as "ofertaPropiaPct"`;
