import type { FilaComprobanteEnvio, FilaEnvio } from "@/lib/types";

/**
 * Las cuentas de la tabla de envíos que no son de la base.
 *
 * ---------------------------------------------------------------------------
 * EL FLETE SE PAGA POR ENVIO Y SE COBRA POR COMPROBANTE
 *
 * Esa es toda la razón por la que este archivo existe. El transportista factura
 * una preparación; adentro pueden viajar seis comprobantes de cuatro empresas
 * distintas, y lo que cada uno "se llevó" de ese flete es un reparto.
 *
 * El reparto cierra: la suma de lo prorrateado a los renglones de un envío da
 * exactamente lo que facturó el transportista (medido sobre los 453 envíos con
 * flete real, ninguno se aparta más de nueve centavos). Por eso los
 * porcentajes de acá suman 100 y se pueden mostrar sin aclaraciones.
 */

/**
 * QUE PARTE DEL FLETE DEL ENVIO SE LLEVO ESTE COMPROBANTE, de 0 a 1.
 *
 * `null` cuando no se puede responder, y son dos casos distintos que dan la
 * misma respuesta honesta:
 *
 *   - el envío no tiene flete (todavía no se cargó, o dio cero): no hay nada
 *     que repartir, así que "0 %" sería tan falso como "100 %";
 *   - el flete del envío es negativo. No debería pasar, pero una nota de
 *     crédito del transportista lo haría, y un porcentaje sobre un
 *     denominador negativo sale al revés -- el que más pagó aparecería con el
 *     número más chico.
 *
 * Un comprobante en CERO sí devuelve 0: es una respuesta de verdad --no se
 * llevó nada-- y pasa seguido, porque una nota de crédito viaja en el envío
 * sin que le toque flete.
 */
export function repartoDelFlete(
  flete: number,
  fleteDelEnvio: number,
): number | null {
  if (!Number.isFinite(flete) || !Number.isFinite(fleteDelEnvio)) return null;
  if (fleteDelEnvio <= 0) return null;
  return flete / fleteDelEnvio;
}

/**
 * De dónde sale el flete, contado en renglones.
 *
 * SON TRES Y NO DOS, y es lo mismo que pasaba por comprobante: el flete se
 * resuelve por preparación, y un envío puede tener parte de sus renglones con
 * la factura del transportista cargada y parte sin ella. Decir "real" o
 * "estimado" a secas en ese caso sería mentir en la mitad del importe.
 *
 * `peso` ordena de menos a más confiable: arriba queda lo que falta cargar,
 * que es lo accionable.
 */
export type Origen = {
  clave: "real" | "mixto" | "estimado";
  texto: string;
  peso: number;
};

export function origenDelFlete(fila: {
  lineasReales: string | number;
  lineasTotales: string | number;
}): Origen {
  // Vienen como texto: pg devuelve los `count(*)` (int8) como string.
  const reales = Number(fila.lineasReales) || 0;
  const total = Number(fila.lineasTotales) || 0;
  if (total === 0 || reales === 0)
    return { clave: "estimado", texto: "Estimado 5%", peso: 0 };
  if (reales >= total) return { clave: "real", texto: "Real", peso: 2 };
  return { clave: "mixto", texto: `Mixto ${reales}/${total}`, peso: 1 };
}

/**
 * Cómo se nombra a las empresas que facturaron en un envío.
 *
 * UN ENVIO PUEDE LLEVAR VARIAS, y ése es el motivo por el que la tabla vieja no
 * servía: una preparación con facturas de Quo y de Noa se veía como dos fletes
 * sin relación. Con una sola se la nombra; con varias se dice cuántas, porque
 * cuatro razones sociales no entran en una celda y el detalle ya las lista.
 */
export function resumenEmpresas(empresas: string[] | null | undefined): string {
  const limpias = (empresas ?? []).filter((e) => e && e.trim() !== "");
  if (limpias.length === 0) return "—";
  if (limpias.length === 1) return limpias[0]!;
  return `${limpias.length} empresas`;
}

/**
 * El destino en una línea: "SAN MIGUEL DE TUCUMAN, TUCUMAN".
 *
 * Sin repetir cuando la localidad es la provincia --pasa con CAPITAL FEDERAL--
 * y sin la coma suelta cuando falta una de las dos.
 */
export function destino(fila: {
  localidad: string | null;
  provincia: string | null;
}): string {
  const l = fila.localidad?.trim() ?? "";
  const p = fila.provincia?.trim() ?? "";
  if (l === "" && p === "") return "—";
  if (l === "" || p === "") return l || p;
  if (l.toUpperCase() === p.toUpperCase()) return p;
  return `${l}, ${p}`;
}

/** Los comprobantes de un envío, con su parte del flete ya calculada. */
export function repartoDelEnvio(
  envio: FilaEnvio,
): (FilaComprobanteEnvio & { reparto: number | null })[] {
  return (envio.comprobantes ?? []).map((c) => ({
    ...c,
    reparto: repartoDelFlete(c.flete, envio.flete),
  }));
}
