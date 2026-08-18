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
