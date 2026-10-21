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
     ${COLUMNAS_MAESTRO}
     where trim(a.id) = any($1::text[])
        or nullif(trim(a."proveedorCodigo"), '') in (select codigo from prov)`,
    [skus],
  );

  return filas.map(aArticulo);
}

/**
 * Las columnas del maestro que necesita el cruce. Las dos consultas tienen que
 * traer exactamente lo mismo: lo único que cambia es por dónde se entra.
 */
const COLUMNAS_MAESTRO = `
     select trim(a.id)                                   as sku,
            coalesce(a.descripcion, '')                  as descripcion,
            nullif(trim(a."codigoCompra"), '')           as codigo_compra,
            nullif(trim(a."eanUnidad"), '')              as ean_unidad,
            nullif(trim(a."eanDisplay"), '')             as ean_display,
            nullif(trim(a."eanBulto"), '')               as ean_bulto,
            greatest(coalesce(a."unidadesPorBulto", 1), 1)   as u_bulto,
            greatest(coalesce(a."unidadesPorDisplay", 1), 1) as u_display,
            coalesce(a."ivaPorcentual", 21)              as iva
     from bronze.sigma_articulos a`;

function aArticulo(r: Record<string, unknown>): ArticuloMaestro {
  return {
    sku: String(r.sku),
    descripcion: String(r.descripcion),
    codigoCompra: (r.codigo_compra as string | null) ?? null,
    eanUnidad: (r.ean_unidad as string | null) ?? null,
    eanDisplay: (r.ean_display as string | null) ?? null,
    eanBulto: (r.ean_bulto as string | null) ?? null,
    unidadesPorBulto: Number(r.u_bulto ?? 1),
    unidadesPorDisplay: Number(r.u_display ?? 1),
    iva: Number(r.iva ?? 21),
  };
}

/**
 * TODOS LOS PROVEEDORES DEL MAESTRO, para poder cargar una factura de uno que
 * todavía no tiene OC en el tablero.
 *
 * El desplegable se armaba con las órdenes mandadas desde Compras, y eso dejaba
 * 12 proveedores sobre 46: una factura de un proveedor al que la OC se le pasó
 * por teléfono no se podía cargar. La OC sirve para CRUZAR, no para existir.
 *
 * Sale del maestro de artículos porque es donde el código de proveedor vive
 * --el mismo `proveedorCodigo` con el que se arma la OC-- y porque un proveedor
 * sin un solo artículo cargado no sirve para nada acá: no habría con qué
 * reconocer los renglones de su factura.
 */
export async function getProveedoresDeCompra(): Promise<
  { codigo: string; nombre: string }[]
> {
  return query<{ codigo: string; nombre: string }>(
    `select nullif(trim("proveedorCodigo"), '')            as codigo,
            max("proveedorNombre")                         as nombre
     from bronze.sigma_articulos
     where nullif(trim("proveedorCodigo"), '') is not null
       and nullif(trim("proveedorNombre"), '') is not null
     group by 1
     order by 2`,
  );
}

/**
 * El maestro de UN proveedor, por su código.
 *
 * Es la misma lista que `getMaestroParaFactura` arma a partir de los SKU de la
 * OC, pero entrando por el otro lado: sin OC no hay SKU de los que partir.
 */
export async function getMaestroDelProveedor(
  codigo: string,
): Promise<ArticuloMaestro[]> {
  const filas = await query<Record<string, unknown>>(
    `${COLUMNAS_MAESTRO}
     where nullif(trim(a."proveedorCodigo"), '') = $1`,
    [codigo],
  );
  return filas.map(aArticulo);
}
