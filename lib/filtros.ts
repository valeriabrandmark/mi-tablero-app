import type { Filtros } from "@/lib/types";

/**
 * Única definición de los filtros de Ventas Mayoristas: la usan el navegador
 * para armar la URL y la ruta de API para leerla.
 *
 * Que estén en un solo lugar no es cosmético: antes cada lado enumeraba los
 * filtros por su cuenta, y agregar uno nuevo en un lado y olvidarlo en el otro
 * hacía que el filtro se aplicara "a medias", sin ningún error visible.
 */
export const CLAVES_FILTRO = [
  "vendedor",
  "empresa",
  "mes",
  "provincia",
  "proveedor",
  "cliente",
  "sku",
  "comprobante",
] as const satisfies readonly (keyof Filtros)[];

/**
 * Red de seguridad: si se agrega un filtro a `Filtros` y no se lo suma a
 * `CLAVES_FILTRO`, esto rompe el build en vez de fallar silenciosamente en
 * runtime (que fue exactamente lo que pasó con cliente/sku/comprobante).
 */
type ClavesFaltantes = Exclude<keyof Filtros, (typeof CLAVES_FILTRO)[number]>;
const _todasLasClavesCubiertas: ClavesFaltantes extends never ? true : never = true;
void _todasLasClavesCubiertas;

export function aQueryString(f: Filtros): string {
  const sp = new URLSearchParams();
  for (const clave of CLAVES_FILTRO) {
    const valor = f[clave];
    if (valor) sp.set(clave, valor);
  }
  return sp.toString();
}

export function desdeSearchParams(sp: URLSearchParams): Filtros {
  const f: Filtros = {};
  for (const clave of CLAVES_FILTRO) {
    f[clave] = sp.get(clave) || undefined;
  }
  return f;
}
