/**
 * Rangos de fecha de los tableros minoristas.
 *
 * Vive en su propio módulo (sin importar `pg`) porque lo necesitan los dos
 * lados: el navegador para armar los botones del filtro, y el servidor para
 * resolver con qué día abre la página. Si cada lado calculara "hoy" por su
 * cuenta, en la franja de las 21 a las 24 no coincidirían.
 *
 * Y vive afuera del módulo de un canal porque "hoy en Argentina" y "el mes
 * comercial" no son un hecho de Mercado Libre: los usan igual Tienda Nube y
 * cualquier sección que venga después.
 */

import { limitesMesComercial, mesComercialActual } from "@/lib/constantes";

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

/**
 * El mes comercial vigente como rango de fechas.
 *
 * Los bordes los calcula `limitesMesComercial`, que es donde viven los cierres
 * movidos. Repetir acá la cuenta del 6 al 5 haría que un mes con excepción
 * mostrara un día de más o de menos que lo que los datos tienen etiquetado.
 */
export function mesComercialComoRango(hoy: string = hoyArgentina()): Rango {
  return limitesMesComercial(mesComercialActual(new Date(`${hoy}T12:00:00Z`)));
}

export type Preset = { label: string; rango: (hoy: string) => Rango };

/**
 * Los atajos del filtro de fechas de Mercado Libre. El orden es el de uso real:
 * casi siempre se mira hoy, y de vez en cuando se abre la ventana.
 *
 * Tienda Nube usa otros (ver `PRESETS_POCO_VOLUMEN`): con ocho pedidos por mes,
 * "Hoy" y "Ayer" dan vacío casi siempre y no sirven de atajo.
 */
export const PRESETS: Preset[] = [
  { label: "Hoy", rango: (hoy) => ({ desde: hoy, hasta: hoy }) },
  {
    label: "Ayer",
    rango: (hoy) => ({ desde: sumarDias(hoy, -1), hasta: sumarDias(hoy, -1) }),
  },
  { label: "7 días", rango: (hoy) => ({ desde: sumarDias(hoy, -6), hasta: hoy }) },
  { label: "30 días", rango: (hoy) => ({ desde: sumarDias(hoy, -29), hasta: hoy }) },
  { label: "Mes comercial", rango: (hoy) => mesComercialComoRango(hoy) },
];

/**
 * Atajos para un canal de poco volumen.
 *
 * No es una preferencia estética: en Tienda Nube entran unos ocho pedidos por
 * mes, así que un botón "Hoy" devolvería vacío tres de cada cuatro días y se
 * leería como que el tablero está roto. Los cortes útiles ahí son más largos, y
 * "Todo" tiene sentido porque la historia entera son treinta pedidos —algo que
 * en Mercado Libre, con 38.000 líneas, no se podría ni dibujar.
 */
export const PRESETS_POCO_VOLUMEN: Preset[] = [
  { label: "7 días", rango: (hoy) => ({ desde: sumarDias(hoy, -6), hasta: hoy }) },
  { label: "30 días", rango: (hoy) => ({ desde: sumarDias(hoy, -29), hasta: hoy }) },
  { label: "Mes comercial", rango: (hoy) => mesComercialComoRango(hoy) },
  { label: "90 días", rango: (hoy) => ({ desde: sumarDias(hoy, -89), hasta: hoy }) },
];
