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
 * IIBB Y MUNICIPAL SE LIQUIDAN SOBRE LA VENTA SIN IVA. El CHEQUE NO.
 *
 * El impuesto al cheque grava la plata que entra y sale de la cuenta, o sea el
 * total COBRADO, con el IVA adentro. Cobrarlo sobre la venta neta lo subestima
 * en un 21 %: 1,2 % del neto son 1,452 % del neto una vez que se lo cobra
 * donde se paga.
 *
 * Esto estuvo mal en los dos lados y se corrigió primero en el motor de
 * precios. La planilla "Alertas" —de donde salieron estos valores— lo ponía
 * sobre venta s/IVA; la hoja MARKUP, que es la que se mantiene y con la que se
 * fijan los precios, lo pone sobre lo cobrado. Manda MARKUP: es la que se
 * revisó contra las liquidaciones.
 *
 * Que la base cambie NO cambia sobre qué se mide el margen. Son dos preguntas
 * distintas y el denominador del porcentaje sigue siendo decisión de cada
 * canal (ver `DENOMINADOR`).
 */
export const IMPUESTOS = {
  /** Sobre la venta SIN IVA. */
  iibb: 0.05,
  /** Sobre la venta SIN IVA. */
  municipal: 0.012,
  /** Sobre el total COBRADO, con IVA adentro. */
  cheque: 0.012,
} as const;

/** 6,2 % sobre la venta s/IVA: IIBB + municipal. */
export const IMPUESTOS_SOBRE_NETA = IMPUESTOS.iibb + IMPUESTOS.municipal;

/** 1,2 % sobre lo cobrado. */
export const IMPUESTOS_SOBRE_COBRADO = IMPUESTOS.cheque;

/**
 * 7,4 % sobre venta s/IVA — LA CUENTA VIEJA, que todavía usa Mercado Libre.
 *
 * NO LA USES EN CÓDIGO NUEVO. Mete el cheque sobre la base equivocada y por
 * eso da 7,4 % en vez de 6,2 % + 1,2 % sobre lo cobrado.
 *
 * Sigue acá porque Tienda Nube se corrigió y Mercado Libre no: sus umbrales de
 * alerta (`UMBRAL_MUY_BAJO`, `UMBRAL_BAJO`) están calibrados contra esta
 * cuenta, así que cambiarla movería la clasificación de miles de líneas sin
 * que nadie lo haya pedido. Es una deuda conocida, no un descuido: cuando se
 * alinee Mercado Libre, esta constante se borra.
 */
export const CARGA_IMPOSITIVA = IMPUESTOS.iibb + IMPUESTOS.cheque + IMPUESTOS.municipal;
