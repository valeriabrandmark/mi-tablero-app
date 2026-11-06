import { limitesMesComercial } from "@/lib/constantes";

/**
 * A DÓNDE VA EL TRAMO: mes comercial y desde cuándo rige.
 *
 * ---------------------------------------------------------------------------
 * SON DOS DATOS Y NO UNO
 *
 * Es tentador deducir el mes de la fecha —`mesComercialActual` ya lo hace— y
 * pedir sólo la fecha. Pero los dos casos reales piden cosas distintas:
 *
 *   LA LISTA DEL MES NUEVO. Llega el 6 o el 7, y rige desde el PRIMER día del
 *   mes comercial, para que los días que ya pasaron se recalculen con ella. La
 *   fecha en que se carga no tiene nada que ver con la fecha en que rige.
 *
 *   UN CAMBIO A MITAD DE MES. Un proveedor aumenta el 16; rige desde el 16 y
 *   el resto del mes queda como estaba.
 *
 * Es la misma convención que ya usan los Excel de `costos_mensuales`:
 * `2026-11.xlsx` es la lista del mes y `2026-11-16.xlsx` un tramo del medio.
 * Deduciendo el mes de la fecha, cargar la lista de noviembre con vigencia
 * 05/11 la escribiría en el mes comercial OCTUBRE —el 5 todavía es octubre— y
 * noviembre seguiría sin lista.
 *
 * ---------------------------------------------------------------------------
 * POR OMISIÓN NO CAMBIA NADA
 *
 * Sin `Destino`, el mes es el vigente y la fecha es hoy: exactamente lo que
 * hacía antes de que se pudiera elegir. Apretar el botón sin tocar nada sigue
 * creando el tramo de hoy.
 */
export type Destino = { mes: string; vigenteDesde: string };

const FORMATO_MES = /^\d{4}-\d{2}$/;
const FORMATO_FECHA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Qué está mal con el destino elegido, o null si está bien.
 *
 * LA FECHA TIENE QUE CAER DENTRO DEL MES COMERCIAL, y el motivo es que los dos
 * errores posibles son silenciosos:
 *
 *   UNA FECHA POSTERIOR AL CIERRE no rige nunca. `costo_vigente` busca el
 *   último tramo que ya había arrancado, y un tramo que arranca después de que
 *   el mes terminó no arranca para ninguna venta de ese mes. El tramo queda
 *   escrito, la pantalla dice "listo" y los costos no cambian.
 *
 *   UNA FECHA ANTERIOR AL ARRANQUE rige para el mes entero, que es casi
 *   siempre lo que se quiso —cargar la lista del mes— pero escrito de una
 *   forma que no se entiende después. Para eso está el primer día del mes, que
 *   dice lo mismo sin ambigüedad.
 *
 * Las dos se rechazan con el rango a la vista, así que el mensaje alcanza para
 * arreglarlo sin ir a buscar cuándo cierra el mes.
 */
export function problemaDelDestino(destino: Destino): string | null {
  if (!FORMATO_MES.test(destino.mes)) {
    return `El mes comercial se escribe AAAA-MM (por ejemplo 2026-11), y llegó "${destino.mes}".`;
  }
  const m = Number(destino.mes.slice(5));
  if (m < 1 || m > 12) {
    return `No existe el mes ${destino.mes}.`;
  }
  if (!FORMATO_FECHA.test(destino.vigenteDesde)) {
    return `La fecha de vigencia se escribe AAAA-MM-DD, y llegó "${destino.vigenteDesde}".`;
  }

  const { desde, hasta } = limitesMesComercial(destino.mes);
  if (destino.vigenteDesde < desde || destino.vigenteDesde > hasta) {
    return (
      `El mes comercial ${destino.mes} va del ${aTextoCorto(desde)} al ` +
      `${aTextoCorto(hasta)}, así que un tramo con vigencia ` +
      `${aTextoCorto(destino.vigenteDesde)} no le aplica a ninguna venta de ` +
      `ese mes. Si querés la lista del mes entero, poné el ${aTextoCorto(desde)}.`
    );
  }
  return null;
}

/** `2026-11-06` -> `06/11/2026`, para los mensajes. */
function aTextoCorto(iso: string): string {
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a}`;
}

/** Hoy, en hora argentina y no en la del servidor (Vercel corre en UTC). */
export function hoyEnArgentina(ahora: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(ahora);
}

