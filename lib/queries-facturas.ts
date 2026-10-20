import { query } from "@/lib/db";
import type { ArticuloMaestro } from "@/lib/factura-cruce";

/**
 * El maestro de Sigma que hace falta para reconocer los renglones de una
 * factura de compra.
 *
 * SE TRAE EL PROVEEDOR ENTERO, no sólo los SKU de la OC. Una factura trae a
 * veces artículos que no estaban pedidos --un reemplazo, un bonificado, un
 * error del proveedor-- y para poder decir "esto no estaba en la OC" primero
 * hay que saber QUÉ es. Con sólo los de la OC, esos renglones quedarían como
 * "sin identificar", que es otra cosa.
 *
 * El proveedor sale de los mismos SKU: así sirve igual para una OC armada en
 * el tablero que para una pegada desde Sigma, sin que nadie tenga que elegirlo.
 * Si los SKU son de dos proveedores, vienen los dos.
 */
export async function getMaestroParaFactura(
  skus: string[],
): Promise<ArticuloMaestro[]> {
  if (skus.length === 0) return [];
  const filas = await query<Record<string, unknown>>(
    `with prov as (
       select distinct nullif(trim("proveedorCodigo"), '') as codigo
       from bronze.sigma_articulos
       where trim(id) = any($1::text[])
     )
     select trim(a.id)                                   as sku,
            coalesce(a.descripcion, '')                  as descripcion,
            nullif(trim(a."codigoCompra"), '')           as codigo_compra,
            nullif(trim(a."eanUnidad"), '')              as ean_unidad,
            nullif(trim(a."eanDisplay"), '')             as ean_display,
            nullif(trim(a."eanBulto"), '')               as ean_bulto,
            greatest(coalesce(a."unidadesPorBulto", 1), 1)   as u_bulto,
            greatest(coalesce(a."unidadesPorDisplay", 1), 1) as u_display,
            coalesce(a."ivaPorcentual", 21)              as iva
     from bronze.sigma_articulos a
     where trim(a.id) = any($1::text[])
        or nullif(trim(a."proveedorCodigo"), '') in (select codigo from prov)`,
    [skus],
  );

  return filas.map((r) => ({
    sku: String(r.sku),
    descripcion: String(r.descripcion),
    codigoCompra: (r.codigo_compra as string | null) ?? null,
    eanUnidad: (r.ean_unidad as string | null) ?? null,
    eanDisplay: (r.ean_display as string | null) ?? null,
    eanBulto: (r.ean_bulto as string | null) ?? null,
    unidadesPorBulto: Number(r.u_bulto ?? 1),
    unidadesPorDisplay: Number(r.u_display ?? 1),
    iva: Number(r.iva ?? 21),
  }));
}
