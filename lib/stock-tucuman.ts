import { buscadorDeArticulo } from "@/lib/sql-codigos";
import { CANAL_MAYORISTA, VENDEDORES_INCLUIDOS } from "@/lib/constantes";
import type { Filtros, PuntoStockTucuman } from "@/lib/types";

/**
 * Las cláusulas que recortan el STOCK, y los parámetros que necesitan.
 *
 * ---------------------------------------------------------------------------
 * ESTA AFUERA DE LA CONSULTA PARA PODER PROBARLO
 *
 * La primera versión se olvidó del buscador de texto: el panel mostraba las
 * 131.294 unidades del depósito entero mientras el resto de la pantalla
 * hablaba de un solo artículo. No falló nada --un número creíble y
 * equivocado-- y lo encontró ANA mirando el gráfico, que es el peor lugar
 * donde encontrarlo.
 *
 * El error de fondo no fue la cláusula que faltaba, sino que la decisión "este
 * filtro recorta el stock, este no" vivía adentro de una consulta y no se
 * podía revisar. Acá afuera se prueba, y la prueba dice, para cada filtro,
 * cuál de las dos cosas se decidió.
 *
 * Empuja los parámetros a `params` --por eso no es del todo pura-- y devuelve
 * las cláusulas ya numeradas contra ese arreglo.
 */
export function clausulasDeStockTucuman(f: Filtros, params: unknown[]): string[] {
  const delArticulo: string[] = [];

  if (f.sku?.length) {
    params.push(f.sku);
    delArticulo.push(`h.sku = any($${params.length}::text[])`);
  }
  if (f.proveedor?.length) {
    params.push(f.proveedor);
    delArticulo.push(`a."proveedorNombre" = any($${params.length}::text[])`);
  }
  if (f.marca?.length) {
    params.push(f.marca);
    delArticulo.push(
      `upper(trim(coalesce(a."attributes.marca", ''))) = any(
         select upper(trim(x)) from unnest($${params.length}::text[]) x)`,
    );
  }

  // EL BUSCADOR DE TEXTO TAMBIEN RECORTA EL STOCK.
  //
  // El término se resuelve a SKUs CONTRA LAS VENTAS, con el mismo
  // `buscadorDeArticulo` que usa el resto de la pantalla, para que pegar un EAN
  // encuentre lo mismo acá que en la tabla de artículos. El `h.sku ilike` suelto
  // es para que escribir un CODIGO funcione aunque ese artículo nunca haya
  // vendido por el canal: tiene stock igual.
  //
  // Se limita al canal y a los vendedores incluidos y nada más: si se aplicara
  // el filtro entero, buscar un cliente dejaría el stock recortado a lo que ese
  // cliente compra, y el stock del depósito no es de nadie en particular.
  if (f.buscar && f.buscar.trim() !== "") {
    const termino = f.buscar.trim();
    params.push(`%${termino}%`);
    const iLike = params.length;
    params.push(CANAL_MAYORISTA);
    const canal = params.length;
    params.push(VENDEDORES_INCLUIDOS);
    const vendedores = params.length;

    delArticulo.push(
      `(h.sku ilike $${iLike}
        or trim(h.sku) in (
             select distinct trim(b.sku)
               from gold.fact_ventas b
              where b.canal = $${canal}
                and b.vendedor = any($${vendedores}::text[])
                and b.sku is not null
                and (b.cliente ilike $${iLike}
                     or ${buscadorDeArticulo(termino, iLike, "b.sku", "b.producto")})))`,
    );
  }

  // CLIENTE, VENDEDOR, EMPRESA, PROVINCIA, COMPROBANTE Y MES NO ESTAN, y no es
  // un olvido: el stock de un depósito no es de nadie en particular. Filtrar
  // "lo que le vendimos a este cliente" no tiene un stock asociado, y aplicarlo
  // dejaría la serie en cero haciendo creer que no hay mercadería. Esos filtros
  // siguen recortando el RANGO de fechas --que sale de las ventas-- pero no las
  // unidades.
  return delArticulo;
}

/** Si hace falta joinear el maestro: de ahí salen el proveedor y la marca. */
export function stockTucumanNecesitaMaestro(f: Filtros): boolean {
  return !!(f.proveedor?.length || f.marca?.length);
}

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
