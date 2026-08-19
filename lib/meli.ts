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
// Viven acá y no en las consultas porque los necesitan los dos lados: el
// navegador para armar los botones, y el servidor para resolver con qué día
// abre la página. Si cada lado calculara "hoy" por su cuenta, en la franja de
// las 21 a las 24 no coincidirían.

import { DIA_INICIO_MES_COMERCIAL, mesComercialActual } from "@/lib/constantes";

/**
 * Hoy en Argentina, `YYYY-MM-DD`.
 *
 * El `timeZone` no es un detalle: Vercel corre en UTC, así que entre las 21 y
 * las 24 de acá un `new Date()` pelado ya está en el día siguiente — y el
 * tablero abriría vacío justo en la franja de más venta.
 */
export function hoyArgentina(ahora: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(ahora);
}

/** Corre una fecha `YYYY-MM-DD` N días (negativo va para atrás). */
export function sumarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

export type Rango = { desde: string; hasta: string };

/** El mes comercial vigente (del 6 al 5) como rango de fechas. */
export function mesComercialComoRango(hoy: string = hoyArgentina()): Rango {
  const mes = mesComercialActual(new Date(`${hoy}T12:00:00Z`));
  const [anio, m] = mes.split("-").map(Number);
  const dd = String(DIA_INICIO_MES_COMERCIAL).padStart(2, "0");
  const finAnio = m === 12 ? anio + 1 : anio;
  const finMes = m === 12 ? 1 : m + 1;
  const hastaMes = `${finAnio}-${String(finMes).padStart(2, "0")}`;
  return {
    desde: `${mes}-${dd}`,
    hasta: sumarDias(`${hastaMes}-${dd}`, -1),
  };
}

/**
 * Los atajos del filtro de fechas. El orden es el de uso real: casi siempre se
 * mira hoy, y de vez en cuando se abre la ventana.
 */
export const PRESETS: { label: string; rango: (hoy: string) => Rango }[] = [
  { label: "Hoy", rango: (hoy) => ({ desde: hoy, hasta: hoy }) },
  {
    label: "Ayer",
    rango: (hoy) => ({ desde: sumarDias(hoy, -1), hasta: sumarDias(hoy, -1) }),
  },
  { label: "7 días", rango: (hoy) => ({ desde: sumarDias(hoy, -6), hasta: hoy }) },
  { label: "30 días", rango: (hoy) => ({ desde: sumarDias(hoy, -29), hasta: hoy }) },
  { label: "Mes comercial", rango: (hoy) => mesComercialComoRango(hoy) },
];
