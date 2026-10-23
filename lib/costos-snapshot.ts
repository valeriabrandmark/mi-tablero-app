import type { OfertasDeLaPlanilla } from "@/lib/ofertas-planilla";

/**
 * La foto de costos que se va a aplicar: qué queda, qué cambia y qué no cierra.
 *
 * ---------------------------------------------------------------------------
 * DE DONDE SALE CADA NUMERO
 *
 *   costo_teorico   del maestro de Sigma, que el orquestador ya sincroniza por
 *                   API. Se verificó contra el Excel: 8.184 de 8.299 idénticos,
 *                   y los 13 distintos eran artículos que Sigma modificó
 *                   DESPUES del export. O sea que el maestro es el más fresco.
 *   oferta_pct      de la hoja del Consolidador (ver lib/ofertas-planilla).
 *   costo_real      teórico x (1 - oferta/100).
 *
 * EL DESCUENTO PROPIO NO ENTRA EN EL COSTO REAL, igual que en costos.py: es lo
 * que resignamos nosotros, no lo que nos cuesta. Se guarda aparte.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ESTO ESTA SEPARADO DE LA CONSULTA
 *
 * Porque es la cuenta que decide el margen de todo el tablero y tiene que
 * poder probarse sin base. El 07/09/2026 entró un archivo con la coma decimal
 * borrada en el 63 % de los artículos y el margen del día dio -$42.421
 * millones; nadie lo vio en la carga, se vio en una pantalla.
 */

/** Cuántas veces tiene que saltar un costo para ser sospechoso. */
export const SALTO_SOSPECHOSO = 50;

/** Qué proporción de los artículos tiene que saltar para abortar. */
export const PROPORCION_PARA_ABORTAR = 0.2;

/** Un artículo del maestro, con lo que hace falta para costearlo. */
export type ArticuloParaCostear = {
  sku: string;
  proveedor: string | null;
  descripcion: string | null;
  costoTeorico: number | null;
};

export type FilaDeCosto = {
  sku: string;
  costoTeorico: number;
  ofertaPct: number;
  descPropioPct: number;
  costoReal: number;
};

export type SaltoSospechoso = {
  sku: string;
  descripcion: string | null;
  antes: number;
  despues: number;
  veces: number;
};

/** Tenía costo guardado y el maestro no le da teórico: se quedaría en cero. */
export type SeQuedaSinCosto = {
  sku: string;
  proveedor: string | null;
  descripcion: string | null;
  antes: number;
};

export type FaltanteEnLaPlanilla = {
  sku: string;
  proveedor: string | null;
  descripcion: string | null;
};

export type Snapshot = {
  filas: FilaDeCosto[];
  /** Artículos del maestro que la planilla no tiene. Quedan en 0 % de oferta. */
  faltantes: FaltanteEnLaPlanilla[];
  /** Cuántos quedan con una oferta distinta de cero. */
  conOferta: number;
  /** Cuántos cambian de costo real contra lo que hay hoy. */
  cambian: number;
  /**
   * LOS QUE TENIAN COSTO Y EL MAESTRO NO LES DA TEORICO. Quedan en cero.
   *
   * No entran en `cambian` y no son un problema que frene: las consultas que
   * leen costos saltean los ceros (`where costo_real > 0`) y se quedan con el
   * último tramo que SI tenga uno, así que escribir un cero no borra nada --
   * el costo viejo sigue rigiendo. Pero contarlos como cambios haría leer
   * "cambian 16" cuando de verdad cambian 13, y por eso van aparte.
   *
   * Hoy son tres: CI123 (consumo interno), PU02004 y PU03095. Son los que
   * están en el Excel viejo y Sigma ya no cotiza.
   */
  sinCostoTeorico: SeQuedaSinCosto[];
  /** Los que saltaron `SALTO_SOSPECHOSO` veces o más. */
  saltos: SaltoSospechoso[];
  /** La proporción de comparables que saltó. */
  proporcionDeSaltos: number;
  /**
   * `true` si hay que frenar. Ver el 07/09: una coma decimal borrada no se ve
   * como un error en la carga, se ve como un margen imposible dos pantallas
   * más allá.
   */
  abortar: boolean;
  /** Lo que impide aplicar. Con uno solo no se escribe nada. */
  problemas: string[];
};

/** El costo que se paga de verdad: el de lista con la oferta aplicada. */
export function costoRealDe(costoTeorico: number, ofertaPct: number): number {
  return costoTeorico * (1 - ofertaPct / 100);
}

/**
 * Arma la foto y la compara contra lo que hay.
 *
 * @param articulos  el maestro de Sigma, ya filtrado a los que se costean.
 * @param ofertas    lo que leyó la planilla.
 * @param costoActual costo real vigente hoy por SKU, para medir el salto.
 */
export function armarSnapshot(
  articulos: ArticuloParaCostear[],
  ofertas: OfertasDeLaPlanilla,
  costoActual: Map<string, number>,
): Snapshot {
  const problemas = [...ofertas.problemas];

  const filas: FilaDeCosto[] = [];
  const faltantes: FaltanteEnLaPlanilla[] = [];
  let conOferta = 0;
  let cambian = 0;
  const sinCostoTeorico: SeQuedaSinCosto[] = [];
  const saltos: SaltoSospechoso[] = [];
  let comparables = 0;

  for (const a of articulos) {
    const costoTeorico = a.costoTeorico ?? 0;
    const de = ofertas.porSku.get(a.sku);

    // NO ESTAR EN LA PLANILLA ES QUEDAR EN CERO, no quedar afuera. Es lo que
    // hacía el Excel --los traía a todos con 0,00 %-- y es lo prudente: sin
    // oferta se paga la lista, así que el costo no queda subestimado.
    if (!de) {
      faltantes.push({
        sku: a.sku,
        proveedor: a.proveedor,
        descripcion: a.descripcion,
      });
    }

    const ofertaPct = de?.ofertaPct ?? 0;
    const descPropioPct = de?.descPropioPct ?? 0;
    const costoReal = costoRealDe(costoTeorico, ofertaPct);
    if (ofertaPct) conOferta++;

    filas.push({ sku: a.sku, costoTeorico, ofertaPct, descPropioPct, costoReal });

    // SIN COSTO TEORICO NO HAY CAMBIO, hay ausencia. Ver `sinCostoTeorico`.
    const antes = costoActual.get(a.sku);
    if (costoTeorico <= 0) {
      if (antes != null && antes > 0) {
        sinCostoTeorico.push({
          sku: a.sku,
          proveedor: a.proveedor,
          descripcion: a.descripcion,
          antes,
        });
      }
    } else if (antes != null && Math.abs(antes - costoReal) > 0.01) {
      cambian++;
    }

    // EL SALTO SE MIDE SOBRE LOS QUE TENIAN COSTO Y LO SIGUEN TENIENDO. Un
    // artículo que arranca de cero no "saltó cien veces": no tenía con qué
    // comparar, y contarlo inflaría la proporción hasta abortar cargas sanas.
    if (antes != null && antes > 0 && costoReal > 0) {
      comparables++;
      if (costoReal >= antes * SALTO_SOSPECHOSO) {
        saltos.push({
          sku: a.sku,
          descripcion: a.descripcion,
          antes,
          despues: costoReal,
          veces: costoReal / antes,
        });
      }
    }
  }

  if (filas.length === 0) {
    problemas.push("No hay ningún artículo para costear.");
  }

  const proporcionDeSaltos = comparables > 0 ? saltos.length / comparables : 0;
  const abortar = comparables > 0 && proporcionDeSaltos >= PROPORCION_PARA_ABORTAR;

  if (abortar) {
    problemas.push(
      `${saltos.length} de ${comparables} artículos (${Math.round(proporcionDeSaltos * 100)} %) ` +
        `saltaron ${SALTO_SOSPECHOSO} veces o más. Eso no es un aumento: es un archivo mal leído, ` +
        "como el del 07/09 que vino con la coma decimal borrada.",
    );
  }

  // Los más grandes primero: es lo que se mira para decidir.
  saltos.sort((a, b) => b.veces - a.veces);
  sinCostoTeorico.sort((a, b) => b.antes - a.antes);

  return {
    filas,
    faltantes,
    conOferta,
    cambian,
    sinCostoTeorico,
    saltos,
    proporcionDeSaltos,
    abortar,
    problemas,
  };
}
