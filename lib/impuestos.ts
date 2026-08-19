/**
 * Los impuestos que se le descuentan a una venta minorista para pasar de
 * rentabilidad BRUTA a NETA.
 *
 * Viven acá y no en el módulo de un canal porque no son un hecho de Mercado
 * Libre ni de Tienda Nube: son alícuotas de la empresa, y las dos secciones
 * tienen que usar exactamente las mismas. Cuando estaban dentro de `lib/meli.ts`
 * no había forma de que Tienda Nube las usara sin importar el módulo del otro
 * canal, que es justo el enredo que hace que un día alguien las cambie en un
 * lado y no en el otro.
 *
 * No están en Supabase: son alícuotas, no un dato de la venta. Los valores
 * salen de despejar las columnas IIBB / Imp. Cheque / Imp. Municipal de la
 * pestaña "Alertas" de la planilla contra su propia venta s/IVA (5,00 %, 1,20 %
 * y 1,20 % en todas las filas de la muestra).
 *
 * LOS TRES SE CALCULAN SOBRE LA VENTA SIN IVA, que es como se liquidan. Eso es
 * independiente de sobre qué se mida el margen: los tableros minoristas
 * expresan el porcentaje sobre venta c/IVA, pero la base del impuesto no cambia
 * por eso.
 */
export const IMPUESTOS = {
  iibb: 0.05,
  cheque: 0.012,
  municipal: 0.012,
} as const;

/** 7,4 % — lo que se le come a cada venta antes de llegar a la rentabilidad neta. */
export const CARGA_IMPOSITIVA = IMPUESTOS.iibb + IMPUESTOS.cheque + IMPUESTOS.municipal;
