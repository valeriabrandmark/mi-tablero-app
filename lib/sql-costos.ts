/**
 * De qué costo hablamos cuando hay más de uno en el mismo mes.
 *
 * ---------------------------------------------------------------------------
 * QUÉ CAMBIÓ
 *
 * Hasta el 11/09/2026 `bronze.costos_historicos` tenía exactamente UNA fila por
 * (sku, mes_comercial): el costo valía el mes comercial entero. Eso obligaba a
 * elegir entre dos cosas malas cuando un proveedor mandaba lista nueva a mitad
 * de mes: dejar el costo viejo hasta el 5, o pisarlo y recostear hacia atrás
 * ventas que se hicieron con el precio anterior.
 *
 * Ahora cada fila tiene `vigente_desde`, y conviven varios tramos del mismo
 * mes. El costo de una venta es el del tramo que regía ESE DÍA.
 *
 * ---------------------------------------------------------------------------
 * POR QUÉ ESTÁ TODO ACÁ Y NO COPIADO EN CADA PANTALLA
 *
 * Son nueve consultas las que leen esa tabla. Las que joinean por
 * (sku, mes_comercial) —Artículos, los descuentos de Meli y Tienda Nube,
 * Compras— MULTIPLICAN FILAS apenas un mes tiene dos tramos: cada línea de
 * venta se encuentra con dos costos y todos los totales de esa pantalla se
 * duplican. No es un número que quede feo, es un número que queda mal.
 *
 * Por eso el criterio de "cuál de los tramos" vive en un solo lugar.
 *
 * ---------------------------------------------------------------------------
 * OJO CON LOS BACKTICKS
 *
 * Nada de backticks adentro de estos SQL: viven en template literals y uno solo
 * parte la cadena.
 *
 * ---------------------------------------------------------------------------
 * EL EMPATE ENTRE EL BOTON Y EL EXCEL
 *
 * `bronze.costos_historicos` la escriben DOS caminos, y cada uno borra sólo lo
 * suyo: `costos.py` desde los Excel del orquestador (`origen = 'excel'`) y el
 * botón de actualizar costos del tablero (`origen = 'tablero'`). Conviven a
 * propósito.
 *
 * La regla es la vigencia: manda el tramo que arrancó más cerca de hoy, venga
 * de donde venga. Una lista nueva en Excel con fecha posterior entra sola, que
 * es lo que se espera de una lista nueva.
 *
 * Pero las dos pueden caer EL MISMO DIA --el botón escribe con la fecha de hoy
 * y un archivo `2026-10-29.xlsx` también-- y ahí la vigencia no desempata. Sin
 * criterio, `distinct on` se queda con la fila que Postgres devuelva primero:
 * el costo del tablero depende del plan de ejecución. Ya hay un caso en la
 * base (2026-10 / 21-10, el SKU C03041 con los dos orígenes); no se notó
 * porque los dos valores coinciden.
 *
 * Desempata el botón. Es el único de los dos que alguien aprieta mirando la
 * pantalla, con la foto delante y dejando su nombre en el tramo: si se tomó el
 * trabajo de revisarla, su número vale más que el del archivo.
 */

/** Lo escrito desde el tablero gana el empate. Ver arriba. */
const DESEMPATE = `(origen = 'tablero') desc`;

/**
 * El último costo conocido de cada SKU, uno por SKU.
 *
 * Es el que usan las pantallas que VALORIZAN STOCK (Stock, Antigüedad, Stock
 * Full, Trazabilidad): ahí no hay fecha de venta contra la cual preguntar, la
 * pregunta es "cuánto vale lo que tengo hoy en el depósito".
 *
 * Los artículos sin costo cargado quedan afuera a propósito —son testers y
 * exhibidores, que no se compran— y las pantallas los muestran en 0.
 *
 * `vigente_desde <= current_date` es lo que impide que una lista cargada con
 * fecha futura (el aumento que entra el lunes) valorice el stock de hoy.
 */
const ULTIMO_TRAMO = `
  from bronze.costos_historicos
  where costo_real > 0 and vigente_desde <= current_date
  order by sku, mes_comercial desc, vigente_desde desc, ${DESEMPATE}`;

export const ULTIMO_COSTO_VIGENTE = `
  select distinct on (sku) sku, costo_real, costo_teorico${ULTIMO_TRAMO}`;

/**
 * El mismo tramo que `ULTIMO_COSTO_VIGENTE`, con las dos ofertas de costo.
 *
 * Va aparte y no como columnas de más en el de arriba porque `oferta_pct`
 * también es una columna de `gold.fact_ventas` (con otro significado: el
 * descuento de la factura), y varias consultas que usan el de arriba la
 * nombran sin calificar. Sumarla ahí las volvería ambiguas.
 */
export const ULTIMO_COSTO_CON_OFERTAS = `
  select distinct on (sku) sku, costo_real, costo_teorico,
         oferta_pct as oferta_prov_pct, desc_propio_pct as oferta_propia_pct${ULTIMO_TRAMO}`;

/**
 * Una fila por (sku, mes_comercial): el tramo que rige HOY dentro de cada mes.
 *
 * Para todo lo que pregunta "el costo/la oferta DEL MES" sin tener una fecha
 * de venta a mano: el selector de mes de Compras, la historia de ofertas, el
 * precio que viaja a la orden de compra.
 *
 * EL ORDEN DE DESEMPATE, que es la parte que importa:
 *
 *   1) primero los tramos que ya empezaron (`vigente_desde <= current_date`),
 *   2) y entre ésos, el más cercano a hoy: el último que arrancó.
 *
 * Con un mes ya cerrado las dos reglas dan lo mismo —todos sus tramos
 * empezaron— y sale el último, que es el costo con el que terminó el mes. Con
 * el mes en curso sale el que está corriendo, no el que entra la semana que
 * viene. Y si el mes todavía no empezó (alguien cargó octubre en septiembre),
 * ningún tramo empezó y sale el primero, que es el que va a regir.
 */
export const COSTOS_VIGENTES_POR_MES = `
  select distinct on (sku, mes_comercial)
         sku, mes_comercial, vigente_desde,
         costo_teorico, costo_real, oferta_pct, desc_propio_pct
  from bronze.costos_historicos
  order by sku, mes_comercial,
           (vigente_desde <= current_date) desc,
           abs(vigente_desde - current_date),
           ${DESEMPATE}`;

/**
 * El tramo vigente EL DÍA DE LA VENTA, para colgar de una tabla de ventas.
 *
 * Es un LATERAL y no un join común porque la condición mira una columna de la
 * fila de ventas (`fecha`), y porque así devuelve UNA fila o ninguna: es la
 * forma de que el join no multiplique.
 *
 * Se queda dentro del mismo mes comercial a propósito. Un SKU que salió del
 * catálogo no hereda el costo de hace tres meses: sigue sin costo, como antes,
 * y la pantalla muestra un guión en vez de un número inventado.
 *
 * `t` es la tabla de ventas. `cols` son las columnas que se quieren de
 * `costos_historicos`, que adentro del lateral se llama `c`; el resultado
 * queda colgado como `ch`.
 */
export function joinCostoDelDia(t: string, cols: string): string {
  return `left join lateral (
       select ${cols}
       from bronze.costos_historicos c
       where c.sku = ${t}.sku
         and c.mes_comercial = ${t}.mes_comercial
         and c.vigente_desde <= ${t}.fecha
       order by c.vigente_desde desc, (c.origen = 'tablero') desc
       limit 1
     ) ch on true`;
}
