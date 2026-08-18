/**
 * Reglas de negocio de la página "Ventas Mayoristas".
 * Viven en su propio módulo (sin importar `pg`) para poder usarlas también
 * desde componentes del browser.
 */

/** Filtro fijo de la página: no es un selector, es parte de su definición. */
export const CANAL_MAYORISTA = "Mayorista";

/**
 * Vendedores que entran en la página de Ventas Mayoristas.
 *
 * Es una lista BLANCA, igual que el filtro de página del tablero de Power BI
 * (`vendedor IN ('PABLO','RAMON','SILVIO')`). Así quedan afuera de una todos
 * los valores de `vendedor` que no son vendedores reales — AGENCIA, BTL,
 * TRADE, PROYECTOS ESPECIALES — y también los canales que no son fuerza de
 * venta mayorista: CASA CENTRAL, MELI, VENDEDOR WEB, IGNACIO, IVANA.
 *
 * Para sumar o sacar un vendedor alcanza con tocar esta lista: aplica a las
 * consultas y a los selectores, porque todas pasan por `whereBase()` en
 * lib/queries.ts.
 */
export const VENDEDORES_INCLUIDOS = ["PABLO", "RAMON", "SILVIO"];

/**
 * Mínimo de unidades para que un proveedor entre al ranking de margen.
 * Sin este corte aparecen márgenes de 100% falsos por falta de dato de costo
 * (por ejemplo "AGENCIA PROVEEDORES").
 */
export const MIN_UNIDADES_MARGEN = 20;

/**
 * Vendedores que tienen página de objetivos propia.
 *
 * Es una lista aparte de `VENDEDORES_INCLUIDOS` a propósito: RICARDO todavía no
 * tiene ninguna venta en `gold.fact_ventas`, así que no puede entrar a las
 * consultas de Ventas Mayoristas, pero sí necesita su tablero (con el objetivo
 * cargado y 0 de avance) para cuando empiece a facturar.
 *
 * El orden es el del tablero de Data Studio y define el orden del nav.
 */
export const VENDEDORES_OBJETIVOS = ["SILVIO", "RAMON", "PABLO", "RICARDO"] as const;

export type VendedorObjetivos = (typeof VENDEDORES_OBJETIVOS)[number];

/** `SILVIO` -> `silvio`, para la URL. */
export function slugVendedor(vendedor: string): string {
  return vendedor.toLowerCase();
}

/** `silvio` -> `SILVIO`, o null si no es un vendedor con página propia. */
export function vendedorDesdeSlug(slug: string): VendedorObjetivos | null {
  return VENDEDORES_OBJETIVOS.find((v) => slugVendedor(v) === slug.toLowerCase()) ?? null;
}

/**
 * El mes comercial no es el mes calendario: va del día 6 de un mes al día 5 del
 * siguiente. Verificado contra los cuatro meses que hay en `gold.fact_ventas`
 * (2026-05 arranca el 06/05 y termina el 05/06, y así).
 */
export const DIA_INICIO_MES_COMERCIAL = 6;

/**
 * Mes comercial vigente, en el mismo formato `YYYY-MM` que `fact_ventas`.
 *
 * La fecha se lee en hora argentina y no en la del servidor: en Vercel el
 * servidor corre en UTC, y sin esto, entre las 21 y las 24 de Argentina el
 * tablero adelantaría el día — que justo en el cambio de mes comercial daría
 * el mes equivocado.
 */
export function mesComercialActual(ahora: Date = new Date()): string {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(ahora);

  const valor = (tipo: Intl.DateTimeFormatPartTypes) =>
    Number(partes.find((p) => p.type === tipo)?.value ?? 0);

  const anio = valor("year");
  const mes = valor("month");
  const dia = valor("day");

  // Antes del 6 todavía estamos cerrando el mes comercial anterior.
  const desplazado = dia >= DIA_INICIO_MES_COMERCIAL ? mes : mes - 1;
  const anioFinal = desplazado === 0 ? anio - 1 : anio;
  const mesFinal = desplazado === 0 ? 12 : desplazado;

  return `${anioFinal}-${String(mesFinal).padStart(2, "0")}`;
}
