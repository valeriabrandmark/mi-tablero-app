/**
 * Trazabilidad del stock en Full: qué mandamos, qué se vendió y qué declara
 * Mercado Libre.
 *
 * ---------------------------------------------------------------------------
 * LA CUENTA
 *
 * Todos los días, para cada artículo:
 *
 *     sorpresa = [declarado(hoy) − declarado(ayer)] + vendido(hoy)
 *
 *   sorpresa > 0   entró mercadería: llegó un envío, o una devolución
 *   sorpresa < 0   stock que desapareció sin que nadie lo vendiera
 *
 * No hace falta estimar cuándo llega un envío. Un envío en tránsito
 * simplemente todavía no aparece, y el día que aparece se ve como una
 * sorpresa positiva. Eso evita el problema de fondo: el tránsito no tiene
 * un plazo fijo —se midió entre 3 y 5 días, y variable— así que cualquier
 * número que eligiéramos se equivocaría en las dos direcciones.
 *
 * ---------------------------------------------------------------------------
 * POR QUÉ LA ALERTA VA POR NETO ACUMULADO Y NO POR CAÍDA DEL DÍA
 *
 * Ésta es la decisión que hace que la pantalla sirva, y está medida.
 *
 * Sobre 64.898 días-artículo del período 22/08–07/09:
 *
 *   89,2 %  no tienen ninguna sorpresa
 *   3.066   días tienen una caída, que suman 5.873 unidades
 *   pero    5.620 de esas 5.873 VUELVEN al día siguiente
 *   neto    −253 unidades, repartidas en 144 artículos
 *
 * O sea que una alerta por caída diaria dispararía 3.066 veces y se
 * equivocaría el 96 % de las veces. Nadie la miraría después de la primera
 * semana, y el día que hubiera un faltante de verdad estaría apagada.
 *
 * La causa del ida y vuelta es el borde del día: la foto de Mercado Libre se
 * toma a una hora fija y las ventas se cuentan por fecha calendario, así que
 * una venta del límite cae de un lado y su descuento de stock del otro. Se
 * corrige sola al día siguiente.
 *
 * Lo que NO se corrige solo es una unidad que Mercado Libre sacó. Por eso se
 * mira el acumulado.
 */

/**
 * Desde cuántas unidades netas perdidas vale la pena mirar un artículo.
 *
 * Con 1 o 2 todavía manda el ruido del borde del día. Con 3, en los 17 días
 * medidos no queda ningún artículo con pérdida limpia —lo cual es la
 * respuesta correcta: en ese período no hubo nada que reclamar—.
 */
export const UMBRAL_RECLAMO_UNIDADES = 3;

/**
 * Cuántos días se le dan a un envío para aparecer en la foto de Mercado Libre.
 *
 * NO es el plazo de entrega: es cuánto se espera antes de tratar una unidad
 * como perdida. Se midió entre 3 y 5 días, y variable, así que acá va el borde
 * de arriba -- equivocarse para el lado paciente cuesta un reclamo demorado;
 * para el otro lado cuesta reclamar mercadería que está en el camión.
 *
 * Es la calibración que hace que la pantalla sirva. Sobre el período medido:
 * sin descontar el tránsito, 245 artículos parecerían reclamables; con el
 * descuento quedan 37. Los otros 208 eran envíos viajando.
 */
export const DIAS_PARA_LLEGAR_A_FULL = 5;

/** Los dos despachos que van al depósito de Mercado Libre. */
export const DESPACHOS_A_FULL = ["ETIQUETADO MELI QUO", "ANDREANI BRANDMARK"];

/**
 * Cómo se lee el saldo de un artículo.
 *
 * `en_orden` incluye a los que netean positivo: que Mercado Libre declare de
 * más no es un problema a gestionar, y separarlos en su propio estado llenaría
 * la pantalla de un caso que a nadie le importa.
 */
export type EstadoTrazabilidad = "reclamable" | "a_mirar" | "en_orden";

export function estadoDelSaldo(neto: number): EstadoTrazabilidad {
  if (neto <= -UMBRAL_RECLAMO_UNIDADES) return "reclamable";
  if (neto < 0) return "a_mirar";
  return "en_orden";
}

export const ETIQUETA_ESTADO: Record<EstadoTrazabilidad, string> = {
  reclamable: "Para reclamar",
  a_mirar: "Diferencia chica",
  en_orden: "En orden",
};
