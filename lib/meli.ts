/**
 * Reglas de negocio de "Venta minorista — Mercado Libre".
 *
 * Vive en su propio módulo (sin importar `pg`) para poder usarse también desde
 * componentes del browser.
 *
 * TODA la aritmética de acá está verificada contra la planilla "Unibrand -
 * Sistema Inteligencia Comercial" fila por fila; el tablero NO lee la planilla,
 * lee `gold.fact_ventas` (canal = 'Mercado Libre'), que es lo que pidió el
 * usuario. Lo que se copió es la fórmula, no el dato.
 *
 * ---------------------------------------------------------------------------
 * Cómo se guarda cada número en `gold.fact_ventas` (esto NO es obvio y es la
 * fuente de todos los errores posibles en esta página):
 *
 * | Columna          | Grano      | Total de la línea       |
 * |------------------|------------|-------------------------|
 * | `precio_unitario`| por unidad | `total_linea`           |
 * | `precio_neto`    | por unidad | `precio_neto * cantidad`|
 * | `costo_unitario` | por unidad | `costo_unitario * cant` |
 * | `comision`       | por unidad | `comision * cantidad`   |
 * | `envio`          | POR LÍNEA  | `envio`                 |
 *
 * Que `comision` sea por unidad y `envio` por línea se comprobó con datos:
 * el mismo SKU con cantidad 2, 3, 6 y 10 tiene SIEMPRE el mismo `comision`
 * (2.206,55 para AC01004), así que no puede ser un total de línea; y un envío
 * de cantidad 9 vale 41.801,65 = 9 x 4.644,63, o sea que ya viene multiplicado.
 *
 * OJO con `margen_total`: resta la comisión UNA sola vez, así que en las líneas
 * de más de una unidad se queda corto. Por eso esta página lo recalcula y no lo
 * usa. Sobre el total de Mercado Libre la diferencia es de varios millones.
 *
 * `costo_unitario` YA viene con el descuento del proveedor aplicado (se
 * verificó contra la columna "Costo real s/IVA" de la planilla: GL31013 con 25 %
 * de oferta da 1.223,40 en los dos lados). Por eso que `oferta_pct` esté vacío
 * en Mercado Libre no afecta al cálculo.
 * ---------------------------------------------------------------------------
 */

/** Filtro fijo de la sección: no es un selector, es parte de su definición. */
export const CANAL_MELI = "Mercado Libre";

/**
 * Impuestos que la planilla descuenta para pasar de rentabilidad BRUTA a NETA.
 * Los tres se calculan sobre la VENTA SIN IVA.
 *
 * No están en Supabase: son alícuotas, no un dato de la venta. Los valores
 * salen de despejar las columnas IIBB / Imp. Cheque / Imp. Municipal de la
 * pestaña "Alertas" contra su propia venta s/IVA (5,00 %, 1,20 % y 1,20 % en
 * todas las filas de la muestra).
 */
export const IMPUESTOS = {
  iibb: 0.05,
  cheque: 0.012,
  municipal: 0.012,
} as const;

/** 7,4 % — lo que se le come a cada venta antes de llegar a la rentabilidad neta. */
export const CARGA_IMPOSITIVA = IMPUESTOS.iibb + IMPUESTOS.cheque + IMPUESTOS.municipal;

/**
 * Bandas de alerta por margen NETO (rentabilidad neta / venta s/IVA).
 *
 * La única banda que se pudo leer entera de la planilla es "MUY BAJO": las 93
 * filas de la pestaña Alertas van de -7,4 % a 1,4 % de margen neto, así que el
 * corte está en 1,5 %. Las otras dos son un umbral nuestro para que la página
 * no sea binaria; se cambian acá y en ningún otro lado.
 */
export const UMBRAL_MUY_BAJO = 0.015;
export const UMBRAL_BAJO = 0.05;

export const NIVELES_ALERTA = ["muy-bajo", "bajo", "ok"] as const;
export type NivelAlerta = (typeof NIVELES_ALERTA)[number];

export const NOMBRE_ALERTA: Record<NivelAlerta, string> = {
  "muy-bajo": "Muy bajo",
  bajo: "Bajo",
  ok: "OK",
};

/** Clasifica una línea por su margen neto. `null` (sin venta) cae en "muy-bajo". */
export function nivelDeMargen(margenNeto: number | null): NivelAlerta {
  if (margenNeto == null || margenNeto < UMBRAL_MUY_BAJO) return "muy-bajo";
  if (margenNeto < UMBRAL_BAJO) return "bajo";
  return "ok";
}

/**
 * Acción sugerida, igual que la columna homónima de la planilla: el corte no es
 * el del nivel de alerta sino el cero — una venta con rentabilidad neta
 * negativa hay que corregirla, una apenas positiva se evalúa.
 */
export function accionSugerida(rentabilidadNeta: number, nivel: NivelAlerta): string {
  if (nivel === "ok") return "Sin acción";
  return rentabilidadNeta < 0 ? "Revisar precio urgente" : "Evaluar si conviene seguir";
}
