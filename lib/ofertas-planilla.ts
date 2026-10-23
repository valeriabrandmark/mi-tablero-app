import { leerNumero } from "@/lib/factura-cruce";

/**
 * La hoja del Consolidador de Ofertas, leída de `bronze.ofertas_crudo`.
 *
 * ---------------------------------------------------------------------------
 * POR QUE EL PARSER ESTA ACA Y NO EN EL APPS SCRIPT
 *
 * Porque tiene que haber UNO SOLO. El script manda los textos tal como se ven
 * --"7,69%", no 0.0769-- justamente para que la interpretación viva en un solo
 * lugar y con pruebas. Dos parsers en dos lenguajes se van separando sin que
 * nadie lo note, y eso ya costó 4.368 valores desalineados una vez.
 *
 * ---------------------------------------------------------------------------
 * LO QUE TRAE LA HOJA DE VERDAD, Y POR QUE IMPORTA
 *
 * Medido sobre la primera foto real (11.000 filas):
 *
 *   - Los encabezados vienen CON ESPACIOS AL FINAL: "PROVEEDOR ", "SKU ". Se
 *     comparan recortados o no coincide ninguno.
 *   - Sólo 8.293 filas tienen SKU. Las otras ~2.700 son filas de fórmula que
 *     dan "#N/A" con "0,00%" en los porcentajes: NO están vacías, así que el
 *     filtro del Apps Script no las saca. Se descartan acá, por SKU vacío.
 *   - Un SKU repetido no debería pasar, pero si pasa gana el último: es el que
 *     se ve más abajo en la planilla, que es donde alguien agrega una fila.
 */

/** Dónde está cada cosa. Se busca por nombre y no por posición. */
const COL_SKU = "SKU";
const COL_OFERTA = "DESCUENTO TOTAL PROVEEDOR";
const COL_DESC_PROPIO = "DESC PROPIO";

/** Cuántas filas se prueban como encabezado antes de darse por vencido. */
const FILAS_DE_PRUEBA = 5;

export type OfertaDeUnSku = {
  /** El descuento del proveedor, en puntos (18 = 18 %). */
  ofertaPct: number;
  /** Lo que resignamos nosotros, en puntos. No entra en el costo real. */
  descPropioPct: number;
};

export type OfertasDeLaPlanilla = {
  porSku: Map<string, OfertaDeUnSku>;
  /** Filas de datos que trajo la hoja, sin contar el encabezado. */
  filas: number;
  /** Descartadas por no tener SKU. Ver arriba: son las de fórmula. */
  sinSku: number;
  /** Cuántas tienen alguna oferta distinta de cero. */
  conOferta: number;
  /**
   * Lo que impide usar esta foto. Con un solo problema no se arma nada: una
   * hoja mal leída pondría en cero el descuento de todo el catálogo, y eso no
   * se ve como un error sino como un mes sin ofertas.
   */
  problemas: string[];
};

const limpio = (v: unknown) => String(v ?? "").trim();

/**
 * En qué fila está el encabezado, o -1.
 *
 * Se prueban las primeras filas en vez de asumir la cero, por lo mismo que lo
 * hace el lector del Excel: un export que agrega una fila de título arriba
 * desalinearía todo sin fallar.
 */
function filaDelEncabezado(filas: string[][]): number {
  for (let i = 0; i < Math.min(FILAS_DE_PRUEBA, filas.length); i++) {
    const celdas = (filas[i] ?? []).map((c) => limpio(c).toUpperCase());
    if (celdas.includes(COL_SKU) && celdas.includes(COL_OFERTA)) return i;
  }
  return -1;
}

export function leerOfertas(filas: unknown): OfertasDeLaPlanilla {
  const vacio = (problemas: string[]): OfertasDeLaPlanilla => ({
    porSku: new Map(),
    filas: 0,
    sinSku: 0,
    conOferta: 0,
    problemas,
  });

  if (!Array.isArray(filas) || filas.length < 2) {
    return vacio(["La foto de la planilla no tiene filas."]);
  }
  const tabla = filas.map((f) => (Array.isArray(f) ? f.map(limpio) : []));

  const enc = filaDelEncabezado(tabla);
  if (enc < 0) {
    return vacio([
      `No se encontraron las columnas "${COL_SKU}" y "${COL_OFERTA}" en la planilla.`,
    ]);
  }

  const titulos = (tabla[enc] ?? []).map((c) => c.toUpperCase());
  const iSku = titulos.indexOf(COL_SKU);
  const iOferta = titulos.indexOf(COL_OFERTA);
  // EL DESC PROPIO PUEDE NO ESTAR y no es motivo para no leer nada: no entra
  // en el costo real, así que su ausencia no cambia ningún número que importe.
  const iPropio = titulos.indexOf(COL_DESC_PROPIO);

  const porSku = new Map<string, OfertaDeUnSku>();
  let sinSku = 0;
  let conOferta = 0;

  for (let i = enc + 1; i < tabla.length; i++) {
    const fila = tabla[i] ?? [];
    const sku = limpio(fila[iSku]);
    if (!sku) {
      sinSku++;
      continue;
    }
    // `leerNumero` entiende "7,69%", "7.69", "7,69 %" y los negativos
    // contables. Es el mismo que lee los importes de una factura pegada, con
    // sus pruebas: acá no hace falta otro.
    const ofertaPct = leerNumero(fila[iOferta] ?? "") ?? 0;
    const descPropioPct = iPropio >= 0 ? (leerNumero(fila[iPropio] ?? "") ?? 0) : 0;

    if (ofertaPct) conOferta++;
    porSku.set(sku, { ofertaPct, descPropioPct });
  }

  const problemas: string[] = [];
  if (porSku.size === 0) {
    problemas.push("La planilla no trajo ningún artículo con SKU.");
  }

  return {
    porSku,
    filas: tabla.length - enc - 1,
    sinSku,
    conOferta,
    problemas,
  };
}
