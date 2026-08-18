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

/**
 * Cada valor va como un parámetro repetido (`?sku=A&sku=B`) y no separado por
 * comas: los nombres de cliente y los productos traen comas adentro, así que
 * cualquier separador terminaría partiendo un valor al medio.
 */
export function aQueryString(f: Filtros): string {
  const sp = new URLSearchParams();
  for (const clave of CLAVES_FILTRO) {
    for (const valor of f[clave] ?? []) {
      if (valor) sp.append(clave, valor);
    }
  }
  return sp.toString();
}

export function desdeSearchParams(sp: URLSearchParams): Filtros {
  const f: Filtros = {};
  for (const clave of CLAVES_FILTRO) {
    const valores = sp.getAll(clave).filter(Boolean);
    if (valores.length > 0) f[clave] = valores;
  }
  return f;
}

// --- Ayudantes compartidos ---------------------------------------------------

/** `true` si el filtro no tiene ningún valor elegido. */
export function vacio(valores?: string[]): boolean {
  return !valores || valores.length === 0;
}

/**
 * Agrega o saca un valor de un filtro múltiple. Es lo que hace el click en un
 * gráfico: sumar esa categoría a la selección, o quitarla si ya estaba.
 */
export function alternar(valores: string[] | undefined, valor: string): string[] | undefined {
  const actuales = valores ?? [];
  const nuevos = actuales.includes(valor)
    ? actuales.filter((v) => v !== valor)
    : [...actuales, valor];
  // `undefined` en vez de lista vacía: así el filtro desaparece de la URL.
  return nuevos.length > 0 ? nuevos : undefined;
}

/**
 * Agrega `columna = any($n)` al where, si el filtro tiene algo elegido.
 *
 * Se usa `= any($n)` y no `in (...)`: con `any` el valor viaja como UN
 * parámetro (un array de Postgres), así que la consulta preparada es siempre la
 * misma sin importar cuántos valores se elijan, y no hay forma de armar la
 * lista concatenando texto.
 *
 * El `::text[]` es explícito a propósito: sin él, Postgres tiene que inferir el
 * tipo del array y en algunos contextos (subconsultas, joins) no lo logra.
 */
export function agregarFiltro(
  clauses: string[],
  params: unknown[],
  columna: string,
  valores?: string[],
): void {
  if (vacio(valores)) return;
  params.push(valores);
  clauses.push(`${columna} = any($${params.length}::text[])`);
}

/**
 * Lee un filtro múltiple de la query string de una ruta de API.
 * Devuelve `undefined` en vez de lista vacía para que "sin filtrar" sea un
 * solo caso y no dos.
 */
export function lista(sp: URLSearchParams, clave: string): string[] | undefined {
  const valores = sp.getAll(clave).filter(Boolean);
  return valores.length > 0 ? valores : undefined;
}
