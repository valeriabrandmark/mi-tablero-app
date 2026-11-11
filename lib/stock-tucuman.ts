import type { PuntoStockTucuman } from "@/lib/types";

/**
 * EL RESUMEN DE LA SERIE DE STOCK DE TUCUMÁN, para la bajada del panel.
 *
 * ---------------------------------------------------------------------------
 * POR QUÉ LA BAJADA NO ES DECORACIÓN ACÁ
 *
 * La serie arranca el 10/11/2026 —antes de eso no hay foto de Tucumán— y el
 * gráfico abarca TODO el rango filtrado, que puede ser de mayo. O sea que lo
 * normal, durante meses, va a ser un gráfico casi vacío con una línea corta a
 * la derecha.
 *
 * Sin una bajada que lo diga, eso se lee como "el depósito estuvo en cero
 * medio año y se llenó ayer", que es exactamente lo contrario de lo que pasó.
 * Por eso dice cuántos días del rango tienen foto: deja claro que el hueco es
 * falta de registro y no falta de mercadería.
 *
 * ---------------------------------------------------------------------------
 * LOS NULOS NO SON CEROS Y NO SE PROMEDIAN
 *
 * Un día sin foto llega como `null`. Todo lo de acá los saltea en vez de
 * tratarlos como cero: la última medición es la última con foto —no el último
 * día del rango— y la variación compara las dos últimas FOTOS, que pueden no
 * ser días consecutivos.
 */
export type ResumenStockTucuman = {
  /** Días del rango que tienen foto. */
  conFoto: number;
  /** Días del rango, con foto o sin ella. */
  dias: number;
  /** La última foto del rango, o null si no hay ninguna. */
  ultima: PuntoStockTucuman | null;
  /**
   * Unidades de la última foto menos las de la anterior, o null si no hay dos.
   *
   * Son las dos últimas FOTOS, no los dos últimos días: con una foto el lunes
   * y otra el jueves, la variación es entre esas dos y el panel lo dice con
   * las fechas, para que nadie la lea como "lo que se movió ayer".
   */
  variacion: number | null;
};

export function resumenStockTucuman(
  datos: PuntoStockTucuman[],
): ResumenStockTucuman {
  const conFoto = datos.filter((p) => p.unidades != null);
  const ultima = conFoto.length ? conFoto[conFoto.length - 1]! : null;
  const anteultima = conFoto.length > 1 ? conFoto[conFoto.length - 2]! : null;

  return {
    conFoto: conFoto.length,
    dias: datos.length,
    ultima,
    variacion:
      ultima?.unidades != null && anteultima?.unidades != null
        ? ultima.unidades - anteultima.unidades
        : null,
  };
}
