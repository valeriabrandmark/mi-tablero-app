/**
 * Reglas de negocio de "Venta minorista — Tienda Nube".
 *
 * Vive en su propio módulo (sin importar `pg`) para poder usarse también desde
 * componentes del browser.
 *
 * Fuente: `gold.fact_ventas` filtrada por `canal = 'Tienda Nube'`, que arma
 * `modelo.py` en el orquestador.
 *
 * ---------------------------------------------------------------------------
 * EN QUÉ SE PARECE Y EN QUÉ NO A MERCADO LIBRE
 *
 * Se parece en el grano de las columnas, que es lo que importa para no sumar
 * mal (ver la tabla en lib/meli.ts): `precio_neto` y `costo_unitario` van POR
 * UNIDAD, `envio` va POR LÍNEA, `total_linea` es el total c/IVA de la línea.
 *
 * Se diferencia en tres cosas, y las tres se ven en pantalla:
 *
 * 1. NO HAY COMISIÓN. Lo que cobra la pasarela de pago (Pago Nube, Mercado
 *    Pago) por procesar el cobro no viene en ningún campo de la API de Tienda
 *    Nube, así que `comision` queda en 0. NO se inventa un porcentaje: el
 *    margen de este canal está por eso algo sobreestimado, y el tablero lo dice
 *    en vez de dar un número lindo y falso.
 *
 * 2. EL ENVÍO ES EL QUE PAGA LA TIENDA. Tienda Nube informa dos costos de envío
 *    distintos: `shipping_cost_customer` (lo que paga el comprador, que es
 *    ingreso) y `shipping_cost_owner` (lo que paga la tienda, que es costo).
 *    `modelo.py` resta el segundo. Suelen coincidir, pero no cuando hay envío
 *    gratis o bonificado — que es justo cuando el margen se cae.
 *
 * 3. EL VOLUMEN ES OTRO. Mercado Libre son 38.000 líneas; Tienda Nube, unos
 *    ocho pedidos por mes. Eso cambia el diseño del tablero, no solo su
 *    contenido: acá se pueden mostrar los pedidos UNO POR UNO, y los clientes
 *    son personas con nombre que se repiten, no 33.000 apodos irrepetibles.
 * ---------------------------------------------------------------------------
 */

/** Filtro fijo de la sección: no es un selector, es parte de su definición. */
export const CANAL_TIENDA_NUBE = "Tienda Nube";

export { CARGA_IMPOSITIVA, IMPUESTOS } from "@/lib/impuestos";

export {
  hoyArgentina,
  mesComercialComoRango,
  PRESETS_POCO_VOLUMEN as PRESETS,
  sumarDias,
  type Rango,
} from "@/lib/rangos";

/**
 * Sobre qué se mide el margen: la venta CON IVA, igual que Mercado Libre.
 *
 * Las dos son venta minorista y se razona sobre el precio que ve el comprador,
 * que lleva el IVA adentro. Que los dos tableros de la sección usen el mismo
 * denominador no es un detalle: son pantallas hermanas y sus porcentajes se
 * miran uno al lado del otro.
 *
 * Ventas Mayoristas mide s/IVA y ahí la diferencia no es chica —la misma venta
 * da 7,5 % c/IVA y 9,1 % s/IVA—, así que las pantallas lo dicen explícitamente.
 */
export const DENOMINADOR = "venta c/IVA";

/**
 * Qué cuenta como venta, para poder explicarlo en pantalla.
 *
 * El corte lo hace `modelo.py` (`estado_pago = 'paid' AND estado <> 'cancelled'`)
 * y a `gold.fact_ventas` ya llega filtrado; este texto está para que quien mire
 * el tablero sepa qué está viendo sin tener que abrir el código del orquestador.
 *
 * El criterio es el PAGO y no el estado del pedido porque en Tienda Nube las
 * ventas no pasan solas a "cerrada": hay que cerrarlas a mano y nadie lo hace,
 * así que en toda la historia de la tienda no hay ni un pedido cerrado.
 */
export const CRITERIO_VENTA =
  "Cuenta como venta el pedido pagado y no cancelado. No se usa el estado del " +
  "pedido porque en Tienda Nube las ventas no pasan solas a cerrada.";
