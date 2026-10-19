/**
 * Reglas de "Stock Full · días sin venta" (Mercado Libre).
 *
 * ---------------------------------------------------------------------------
 * QUÉ MIDE, Y QUÉ NO
 *
 * Mide **días desde la última venta** de cada SKU que hoy tiene stock en el
 * depósito de Mercado Libre.
 *
 * NO mide "días continuos con stock sin vender", que es otra cosa y es la que
 * uno querría: un artículo que llegó ayer y no vendió no es lo mismo que uno
 * que está hace dos meses juntando polvo, aunque los dos digan "60 días sin
 * venta" si el SKU se vendió por última vez hace 60 días desde OTRA
 * publicación.
 *
 * Esa métrica necesita saber si había stock CADA DÍA, y hasta el 20/08/2026 esa
 * historia no existía: `bronze.ml_stock_full` se sobrescribía entera en cada
 * corrida. Desde esa fecha el orquestador guarda una foto diaria en
 * `bronze.ml_stock_full_historico`, así que la métrica buena se va a poder
 * calcular cuando haya semanas acumuladas. Mientras tanto, ésta.
 *
 * ---------------------------------------------------------------------------
 * DIFERENCIAS CON EL REPORTE DE DATA STUDIO, a propósito
 *
 * 1. NO hay tope de 60 días. El script de la planilla cruza contra una hoja que
 *    guarda los últimos 60 días de ventas, así que todo lo que no vendió en ese
 *    plazo queda marcado como `999` — y ahí se mezclan "hace 61 días" con
 *    "nunca vendió". Acá las ventas salen de `gold.fact_ventas`, que tiene la
 *    historia entera desde el 06/05, y "nunca vendió" es su propia categoría.
 *
 * 2. Es por SKU y no por publicación. 7.559 publicaciones comparten 3.830
 *    inventarios, así que a nivel publicación el mismo stock físico aparece
 *    repetido y los totales se inflan al sumarlos. Además la decisión se toma
 *    sobre el producto, no sobre el aviso.
 */

/**
 * A PARTIR DE CUANTOS DIAS EN FULL un artículo que nunca vendió deja de ser
 * "recién llegado" y pasa a ser plata parada.
 *
 * Sesenta porque es el plazo que usa el negocio para decidir un retiro, y
 * porque a los 120 Mercado Libre empieza a cobrar almacenamiento prolongado:
 * a los 60 todavía se llega a sacarlo antes de pagar.
 */
export const DIAS_PARA_PARADO = 60;

/** Los cortes del reporte de Data Studio, respetados tal cual. */
export const TRAMOS = [
  { clave: "0-5", label: "0 a 5 días", corto: "0-5", hasta: 5 },
  { clave: "6-10", label: "6 a 10 días", corto: "6-10", hasta: 10 },
  { clave: "11-15", label: "11 a 15 días", corto: "11-15", hasta: 15 },
  { clave: "16-20", label: "16 a 20 días", corto: "16-20", hasta: 20 },
  { clave: "21+", label: "21 días o más", corto: "21+", hasta: null },
  // LOS TRES "NUNCA VENDIO". Antes era uno solo, y mezclaba dos cosas que
  // piden decisiones opuestas: el que está hace cinco meses juntando polvo
  // --retiralo-- y el que llegó la semana pasada --esperá--. Ver `tramoDe`.
  //
  // `corto` es para el eje del gráfico, que con ocho barras no entra con el
  // nombre entero. El largo sigue siendo el que manda en la ayuda y en el
  // chip del filtro, donde sí hay lugar para decirlo completo.
  { clave: "nunca-parado", label: "Nunca vendió · parado", corto: "Nunca · parado", hasta: null },
  { clave: "nunca-nuevo", label: "Nunca vendió · recién llegado", corto: "Nunca · nuevo", hasta: null },
  { clave: "nunca-sindato", label: "Nunca vendió · sin fecha", corto: "Nunca · s/fecha", hasta: null },
] as const;

export type ClaveTramo = (typeof TRAMOS)[number]["clave"];

/**
 * En qué tramo cae un SKU.
 *
 * `dias` nulo es "nunca vendió desde que hay datos", y ESO SOLO NO ALCANZA
 * para decidir qué hacer con él: un artículo que llegó a Full la semana pasada
 * y uno que está hace cinco meses dicen los dos "nunca vendió", y uno hay que
 * retirarlo mientras que al otro hay que darle tiempo.
 *
 * Por eso entra `diasEnFull`: cuánto hace que el artículo ESTA en Full, que
 * sale de dos fuentes distintas (ver `queries-stock-full.ts`).
 *
 * Y por eso entra `entradaExacta`: de 10 artículos sabemos que están desde
 * antes de que empezáramos a guardar la foto diaria, pero no desde cuándo. Su
 * `diasEnFull` es un PISO, no una medición, así que no se los puede meter en
 * "parado" --sería afirmar algo que no medimos-- ni en "recién llegado", que
 * es justamente lo que no son. Van en su propio grupo, que es lo único
 * honesto que se puede hacer con ellos hasta que la historia los alcance.
 */
export function tramoDe(
  dias: number | null,
  diasEnFull: number | null = null,
  entradaExacta = false,
): ClaveTramo {
  if (dias != null) {
    if (dias <= 5) return "0-5";
    if (dias <= 10) return "6-10";
    if (dias <= 15) return "11-15";
    if (dias <= 20) return "16-20";
    return "21+";
  }
  if (diasEnFull == null || !entradaExacta) return "nunca-sindato";
  return diasEnFull >= DIAS_PARA_PARADO ? "nunca-parado" : "nunca-nuevo";
}

/**
 * Los días que abarca un tramo, inclusive en las dos puntas.
 *
 * SE DERIVA DE `TRAMOS` Y NO SE ESCRIBE, por el mismo motivo que `tramoDe` es
 * una sola función: con los cortes en dos lados, el día que se mueva uno el
 * gráfico y el filtro dejan de decir lo mismo, y una barra de "6 a 10 días"
 * pasaría a filtrar otra cosa que la que dibuja.
 *
 * Devuelve `null` para los tres "nunca vendió", que no son rangos de días sin
 * venta sino la ausencia de venta -- y por eso el filtro los trata aparte.
 */
export function esTramoNunca(clave: string): boolean {
  return clave.startsWith("nunca");
}

export function limitesDelTramo(
  clave: string,
): { desde: number; hasta: number | null } | null {
  if (esTramoNunca(clave)) return null;
  let desde = 0;
  for (const t of TRAMOS) {
    if (esTramoNunca(t.clave)) continue;
    if (t.clave === clave) return { desde, hasta: t.hasta };
    desde = (t.hasta ?? desde) + 1;
  }
  return null;
}

/**
 * A partir de cuántos días sin vender se considera plata parada.
 *
 * Sale de los cortes del reporte de Data Studio (+7, +15, +21, +30). El de 20
 * es el que usa el KPI principal porque es donde termina el último tramo
 * "normal": pasado eso, el artículo dejó de rotar.
 */
export const UMBRAL_PARADO = 20;

export const UMBRALES_TARJETAS = [7, 15, 21, 30] as const;
