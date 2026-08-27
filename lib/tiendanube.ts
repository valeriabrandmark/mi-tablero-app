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
 * 1. LA COMISIÓN SE CALCULA, NO VIENE. Tienda Nube no informa en el pedido lo
 *    que cobra la pasarela: no hay campo con el monto ni con el neto
 *    liquidado. Pero sí manda QUÉ pasarela y con QUÉ medio se pagó, y con eso
 *    `modelo.py` la resuelve contra `bronze.comisiones_pasarela`, que tiene los
 *    aranceles reales del panel de la tienda. No es un porcentaje inventado.
 *
 *    Se cobra sobre lo que el cliente pagó de verdad (`total`), no sobre el
 *    valor de la mercadería: a la pasarela le da igual si esa plata era
 *    producto o flete.
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

/**
 * Nombre legible de la pasarela y del medio de pago.
 *
 * Los dos valores se guardan CRUDOS, tal como los manda la API, y se traducen
 * acá y no en el orquestador: así un medio nuevo entra a la base sin migración
 * y, mientras nadie lo agregue a esta tabla, se muestra tal cual en vez de
 * desaparecer. Por eso el fallback devuelve el valor crudo y no un "otro".
 *
 * `free` es la pasarela de los pedidos que no pasaron por ninguna —el sorteo
 * con cupón del 100 %, una transferencia acordada aparte—: no cobra nada, y la
 * comisión en $ 0 de esa fila es correcta, no un dato que falta.
 */
const PASARELAS: Record<string, string> = {
  "pago-nube": "Pago Nube",
  nave: "Nave",
  free: "Sin pasarela",
};

const MEDIOS: Record<string, string> = {
  credit_card: "tarjeta",
  debit_card: "débito",
  wallet: "billetera",
  wire_transfer: "transferencia",
  ticket: "efectivo",
  redirect: "MODO",
};

/**
 * `"Pago Nube · tarjeta"`, o `null` si no hay con qué armarlo — los pedidos
 * viejos, cargados antes de que se guardara el medio de pago.
 */
export function medioDePago(
  pasarela: string | null,
  medio: string | null,
): string | null {
  const p = pasarela ? (PASARELAS[pasarela] ?? pasarela) : null;
  const m = medio ? (MEDIOS[medio] ?? medio) : null;
  if (p && m) return `${p} · ${m}`;
  return p ?? m;
}
