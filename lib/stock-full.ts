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

/** Los cortes del reporte de Data Studio, respetados tal cual. */
export const TRAMOS = [
  { clave: "0-5", label: "0 a 5 días", hasta: 5 },
  { clave: "6-10", label: "6 a 10 días", hasta: 10 },
  { clave: "11-15", label: "11 a 15 días", hasta: 15 },
  { clave: "16-20", label: "16 a 20 días", hasta: 20 },
  { clave: "21+", label: "21 días o más", hasta: null },
  { clave: "nunca", label: "Nunca vendió", hasta: null },
] as const;

export type ClaveTramo = (typeof TRAMOS)[number]["clave"];

/**
 * En qué tramo cae un SKU. `null` en `dias` es "nunca vendió desde que hay
 * datos", que NO es lo mismo que "hace muchos días": puede ser un artículo
 * nuevo que todavía no tuvo su primera venta.
 */
export function tramoDe(dias: number | null): ClaveTramo {
  if (dias == null) return "nunca";
  if (dias <= 5) return "0-5";
  if (dias <= 10) return "6-10";
  if (dias <= 15) return "11-15";
  if (dias <= 20) return "16-20";
  return "21+";
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
