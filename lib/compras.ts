/**
 * Reglas del panel de Compras.
 *
 * ---------------------------------------------------------------------------
 * QUÉ ES ESTA PANTALLA Y QUÉ LA HACE DISTINTA DEL TABLERO DE STOCK
 *
 * El tablero de Stock contesta "cómo estamos". Éste arma UNA ORDEN DE COMPRA y
 * la deja lista para importar en la grilla de Sigma. Por eso acá el usuario
 * EDITA —cambia cantidades, elige bultos o unidades, corrige el descuento— y lo
 * que se lleva es un archivo, no una conclusión.
 *
 * LAS ÓRDENES SON POR PROVEEDOR, siempre. No es una preferencia de la pantalla:
 * es cómo funciona la compra. Por eso el archivo no se puede bajar hasta que
 * haya un proveedor elegido, y no hay forma de mezclar dos en el mismo archivo.
 */

import type { FilaCompra } from "@/lib/types";

/** Sobre cuántos meses se mide la rentabilidad de venta del artículo. */
export const MESES_RENTABILIDAD = 3;

/**
 * Las dos formas de comprar.
 *
 * `Bultos` y `Unidad` son los textos que espera la columna UNICOM de Sigma,
 * escritos tal cual. NO son etiquetas de pantalla: viajan al archivo. Si Sigma
 * cambia lo que acepta, se cambia acá y en ningún otro lado.
 */
export const UNIDADES_COMPRA = [
  { clave: "bulto", label: "Bultos", unicom: "Bultos" },
  { clave: "unidad", label: "Unidades", unicom: "Unidad" },
] as const;

export type ClaveUnidadCompra = (typeof UNIDADES_COMPRA)[number]["clave"];

/**
 * Con qué unidad arranca cada artículo.
 *
 * LA MAYORÍA SE COMPRA POR BULTO, pero hay excepciones, así que el default sale
 * del dato y no de una regla fija: un artículo cuyo bulto es de UNA unidad no
 * tiene bulto —comprarlo "por bulto" sería lo mismo y sólo confundiría—.
 * De los 8.237 del maestro, 3.061 están así.
 *
 * Es un DEFAULT, no una imposición: el que compra lo cambia fila por fila.
 */
export function unidadPorDefecto(unidadesPorBulto: number): ClaveUnidadCompra {
  return unidadesPorBulto > 1 ? "bulto" : "unidad";
}

/**
 * Cuánto pedir, en la unidad elegida.
 *
 * REDONDEA PARA ARRIBA, y es una decisión de negocio: no se puede pedir medio
 * bulto, y quedarse corto es peor que pasarse. Un sugerido de 13 unidades con
 * bultos de 6 pide 3 bultos (18), no 2 (12) — con 2 el artículo se quiebra
 * antes de la próxima compra, que es justo lo que la pantalla intenta evitar.
 */
export function cantidadSugerida(
  sugeridoUnidades: number,
  unidad: ClaveUnidadCompra,
  unidadesPorBulto: number,
): number {
  if (sugeridoUnidades <= 0) return 0;
  if (unidad === "unidad") return Math.ceil(sugeridoUnidades);
  const porBulto = unidadesPorBulto > 0 ? unidadesPorBulto : 1;
  return Math.ceil(sugeridoUnidades / porBulto);
}

/** Cuántas unidades físicas son, para valorizar y para comparar con el stock. */
export function aUnidades(
  cantidad: number,
  unidad: ClaveUnidadCompra,
  unidadesPorBulto: number,
): number {
  if (unidad === "unidad") return cantidad;
  return cantidad * (unidadesPorBulto > 0 ? unidadesPorBulto : 1);
}

/**
 * Un renglón de la orden, tal como lo dejó el que compra.
 *
 * Vive aparte de `FilaCompra` —que es lo que calculó el servidor— porque son
 * dos cosas distintas: una es lo que los datos dicen, la otra es lo que la
 * persona decidió. Mezclarlas haría imposible mostrar "pediste 3 y el sugerido
 * era 2".
 */
export type RenglonOrden = {
  unidad: ClaveUnidadCompra;
  cantidad: number;
  /** Descuento del proveedor, en PUNTOS (15 = 15 %), como lo espera FDESCU1. */
  descuento: number;
};

/**
 * El renglón con el que arranca cada artículo: el sugerido y el sell in del mes.
 *
 * EL DESCUENTO SALE DEL SELL IN DEL PROVEEDOR Y DE NINGÚN OTRO LADO. Sin sell in
 * cargado arranca en CERO, y la pantalla dice por qué. La tentación es usar el
 * `oferta_pct` de `costos_historicos`, que está a mano y casi siempre tiene un
 * número — pero ése es un sell in CALCULADO con nuestras compras para
 * trasladarlo a las ofertas del mes, no el que el proveedor tiene vigente.
 * Mandarlo en una orden sería pedirle al proveedor con un descuento inventado,
 * y el error viajaría en un archivo que alguien importa sin volver a mirarlo.
 */
export function renglonInicial(f: FilaCompra): RenglonOrden {
  const unidad = unidadPorDefecto(f.unidadesPorBulto);
  return {
    unidad,
    cantidad: cantidadSugerida(f.sugerido, unidad, f.unidadesPorBulto),
    descuento: f.sellInPct ?? 0,
  };
}

/* -------------------------------------------------------------------------
   EL ARCHIVO PARA SIGMA
   ------------------------------------------------------------------------- */

/**
 * Las cuatro columnas de la grilla de compra de Sigma, en su orden y con sus
 * nombres exactos. El orden importa: la grilla las lee por posición.
 */
export const COLUMNAS_SIGMA = ["FCODREF", "UNICOM", "CANTIDAD", "FDESCU1"] as const;

/**
 * El descuento como lo escribe Sigma: dos decimales y coma.
 *
 * COMA Y NO PUNTO porque así está en la grilla ("15,00", "0,00"). Es también el
 * motivo por el que el CSV va con punto y coma: con coma decimal Y coma
 * separadora, Excel parte el número al medio y el archivo entra corrido.
 */
export function fmtDescuento(pct: number): string {
  return (Number.isFinite(pct) ? pct : 0).toFixed(2).replace(".", ",");
}

/**
 * Descuentos imposibles, recortados antes de que salgan por la puerta.
 *
 * `bronze.costos_historicos` tiene hoy un SKU con oferta de 973,08 % —el
 * GL04016, que por eso figura con costo NEGATIVO de -18.900—. Un dato así en la
 * orden de compra no es un número raro en una pantalla: es un pedido mal hecho.
 * Se recorta a 100 y la pantalla avisa cuáles tocó.
 */
export const DESCUENTO_MAXIMO = 100;

export function descuentoValido(pct: number | null | undefined): number {
  if (pct == null || !Number.isFinite(pct) || pct < 0) return 0;
  return Math.min(pct, DESCUENTO_MAXIMO);
}

export type LineaExportada = {
  sku: string;
  unicom: string;
  cantidad: number;
  descuento: number;
};

/**
 * Los renglones que van al archivo: los que tienen cantidad.
 *
 * Un renglón en cero NO es una compra de cero, es un artículo que el que compra
 * decidió no pedir. Mandarlo igual dejaría a Sigma con líneas vacías que
 * después hay que borrar a mano.
 */
export function lineasParaExportar(
  filas: FilaCompra[],
  orden: Map<string, RenglonOrden>,
): LineaExportada[] {
  const lineas: LineaExportada[] = [];
  for (const f of filas) {
    const r = orden.get(f.sku);
    if (!r || !(r.cantidad > 0)) continue;
    lineas.push({
      sku: f.sku,
      unicom: UNIDADES_COMPRA.find((u) => u.clave === r.unidad)!.unicom,
      cantidad: Math.round(r.cantidad),
      descuento: descuentoValido(r.descuento),
    });
  }
  return lineas;
}

/**
 * El archivo de texto: columnas separadas por TABULACIÓN.
 *
 * Tabulación y no coma ni punto y coma porque el descuento lleva coma decimal y
 * los códigos no tienen tabs adentro: es el único separador que no puede
 * chocar con el contenido.
 */
export function aTxt(lineas: LineaExportada[]): string {
  const filas = [COLUMNAS_SIGMA.join("\t")];
  for (const l of lineas) {
    filas.push([l.sku, l.unicom, String(l.cantidad), fmtDescuento(l.descuento)].join("\t"));
  }
  // Termina en salto de línea: hay importadores que se comen el último renglón
  // si el archivo no cierra con uno.
  return filas.join("\r\n") + "\r\n";
}

/**
 * El mismo contenido para abrir en Excel.
 *
 * PUNTO Y COMA como separador, por lo dicho arriba: el descuento va con coma
 * decimal. Y va con BOM porque si no, Excel abre el archivo como ASCII y
 * cualquier acento aparece roto.
 */
export function aCsv(lineas: LineaExportada[]): string {
  const filas = [COLUMNAS_SIGMA.join(";")];
  for (const l of lineas) {
    filas.push([l.sku, l.unicom, String(l.cantidad), fmtDescuento(l.descuento)].join(";"));
  }
  return "\ufeff" + filas.join("\r\n") + "\r\n";
}

/**
 * Cómo se llama el archivo.
 *
 * Lleva el proveedor y la fecha porque termina en la carpeta de Descargas al
 * lado de otros diez: "compra.txt" no se puede distinguir de nada.
 */
export function nombreArchivo(proveedor: string, extension: string): string {
  const limpio = proveedor
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toUpperCase()
    .slice(0, 40);
  const hoy = new Date().toISOString().slice(0, 10);
  return `OC-${limpio || "PROVEEDOR"}-${hoy}.${extension}`;
}
