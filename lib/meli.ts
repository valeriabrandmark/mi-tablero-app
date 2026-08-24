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
 * IIBB + Imp. Cheque + Imp. Municipal.
 *
 * Se definen en `lib/impuestos.ts` y se re-exportan acá: no son un hecho de
 * Mercado Libre sino alícuotas de la empresa, y Tienda Nube tiene que usar
 * exactamente las mismas. Se siguen importando desde este módulo para no
 * reescribir las pantallas que ya las usaban.
 */
export { CARGA_IMPOSITIVA, IMPUESTOS } from "@/lib/impuestos";

/**
 * Sobre qué se mide el margen en Mercado Libre: la venta CON IVA.
 *
 * No es lo mismo que en Ventas Mayoristas, que lo mide sobre la venta SIN IVA,
 * y la diferencia no es chica: la misma venta da 7,5 % c/IVA y 9,1 % s/IVA.
 *
 * Que cada canal use el suyo es una decisión del negocio, no un descuido: en
 * Mercado Libre se razona sobre el precio de publicación, que es el que ve el
 * comprador y lleva el IVA adentro. Lo que NO puede pasar es que dos pantallas
 * del mismo canal usen denominadores distintos — que es exactamente el bug que
 * tenía esta sección, con el Tablero midiendo c/IVA y las Alertas s/IVA.
 *
 * OJO: esto es SOLO el denominador del porcentaje. La base de los impuestos
 * sigue siendo la venta s/IVA, porque así se liquidan; eso no se toca.
 */
export const DENOMINADOR = "venta c/IVA";

/**
 * Bandas de alerta por margen NETO.
 *
 * OJO CON EL DENOMINADOR: el margen de esta sección se mide sobre la venta
 * CON IVA (ver `DENOMINADOR` más abajo), así que estos umbrales también están
 * expresados sobre venta c/IVA.
 *
 * La única banda que se pudo leer entera de la planilla es "MUY BAJO": sus 93
 * filas van de -7,4 % a 1,4 % de margen neto sobre venta s/IVA, o sea que el
 * corte de la planilla está en 1,5 % s/IVA. Pasado a c/IVA (dividir por 1,21)
 * da 1,24 %, y se redondeó a 1,25 %. Se verificó contra los datos: de 37.698
 * líneas, solo 2 cambian de banda respecto de la regla original — o sea que es
 * la misma clasificación, dicha en la otra unidad.
 *
 * El corte de "BAJO" es nuestro, no de la planilla: 5 % s/IVA -> 4,15 % c/IVA.
 * Se cambian acá y en ningún otro lado.
 */
export const UMBRAL_MUY_BAJO = 0.0125;
export const UMBRAL_BAJO = 0.0415;

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

// --- Fechas y presets del filtro ---------------------------------------------
//
// Viven en `lib/rangos.ts` y se re-exportan acá. "Hoy en Argentina" y "el mes
// comercial" tampoco son un hecho de este canal: los usa igual Tienda Nube.

export {
  hoyArgentina,
  mesComercialComoRango,
  PRESETS,
  sumarDias,
  type Rango,
} from "@/lib/rangos";

/**
 * Tope de filas de la tabla de artículos.
 *
 * Subió de 300 a 600 cuando la tabla pasó a mostrar una fila por ORDEN y SKU en
 * vez de una por SKU: el mismo recorte de días ocupa unas dos veces más filas
 * (medido: 468 SKUs son 868 líneas en dos días), así que con 300 se recortaba
 * mucho antes que antes.
 *
 * Vive acá y no en queries-meli.ts porque la pantalla lo necesita para saber si
 * la tabla quedó recortada, y ese módulo importa `pg`: no puede llegar al
 * browser.
 */
export const TOPE_ARTICULOS = 600;
