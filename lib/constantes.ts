/**
 * Reglas de negocio de la página "Ventas Mayoristas".
 * Viven en su propio módulo (sin importar `pg`) para poder usarlas también
 * desde componentes del browser.
 */

/** Filtro fijo de la página: no es un selector, es parte de su definición. */
export const CANAL_MAYORISTA = "Mayorista";

/**
 * TODO (decisión de negocio pendiente):
 * `vendedor` incluye valores que no son vendedores reales: AGENCIA, BTL,
 * PROYECTOS ESPECIALES y TRADE. Por ahora solo se excluye AGENCIA — falta
 * definir si los otros tres también quedan afuera del reporte comercial.
 * Cuando se decida, se agregan acá y aplica a las 6 consultas y a los
 * selectores, porque todas pasan por `whereBase()` en lib/queries.ts.
 */
export const VENDEDORES_EXCLUIDOS = ["AGENCIA"];

/** Candidatos a excluir, pendientes de confirmación con Ana. */
export const VENDEDORES_A_DEFINIR = ["BTL", "PROYECTOS ESPECIALES", "TRADE"];

/**
 * Mínimo de unidades para que un proveedor entre al ranking de margen.
 * Sin este corte aparecen márgenes de 100% falsos por falta de dato de costo
 * (por ejemplo "AGENCIA PROVEEDORES").
 */
export const MIN_UNIDADES_MARGEN = 20;
