/**
 * Reglas de "Mis tareas", la bandeja del responsable de Mercado Libre.
 *
 * ---------------------------------------------------------------------------
 * LA ALERTA SE CALCULA, LA RESPUESTA SE GUARDA
 *
 * Cada alerta es una consulta en vivo sobre lo que ya carga el pipeline. Lo
 * único que se escribe es lo que la persona decidió, en
 * `app.tareas_meli_respuestas` (ver migraciones/tareas_meli.sql). Una alerta
 * está PENDIENTE cuando la condición se cumple hoy y no tiene una respuesta
 * vigente.
 *
 * Y se cierra sola cuando la condición deja de cumplirse: si el stock viejo
 * salió de Full, la fila desaparece aunque nadie la haya contestado. Eso
 * también se mide, porque "se resolvió sin que nadie la mirara" y "se
 * descartó igual" son las dos cosas que esta bandeja viene a evitar.
 */

import { TRAMOS_ANTIGUEDAD } from "@/lib/stock-antiguedad";

// ---------------------------------------------------------------------------
// RIESGO DE DESCARTE
// ---------------------------------------------------------------------------

/**
 * Lo configurable de la regla. Cambiar un número acá cambia la alerta en la
 * pantalla, en la API y en lo que se guarda con cada respuesta.
 *
 * `diasEnFull`: a partir de cuántos días una unidad está en riesgo. Mercado
 * Libre no informa ni la antigüedad ni el riesgo de descarte (sondeado contra
 * la cuenta real el 23/10/2026, probar_descarte_ml.py en tablero_quo), así que
 * sale de la antigüedad que calcula ml_antiguedad.py. Arranca en 120 porque es
 * donde empieza el cargo por almacenamiento prolongado.
 *
 * SÓLO PUEDE SER 30, 60, 90 o 120: son los cortes con los que ml_antiguedad.py
 * guarda las unidades (ver TRAMOS_ANTIGUEDAD). Un número intermedio no se
 * puede medir con esa tabla, y más de 120 pide primero estirar la historia que
 * ese script le pide a Mercado Libre (hoy 120 días: todo lo más viejo cae en el
 * mismo tramo). Si se pone otro número, el tablero no arranca en vez de
 * mostrar una alerta calculada con otro corte.
 *
 * `diasSinVenta`: desde cuántos días sin vender por Mercado Libre el artículo
 * cuenta como "no se vende". Sesenta es el mismo plazo que usa Stock Full para
 * decidir un retiro (DIAS_PARA_PARADO). Un artículo que nunca vendió entra
 * siempre: con unidades de 120 días, no es un recién llegado.
 */
export const REGLA_DESCARTE = {
  diasEnFull: 120,
  diasSinVenta: 60,
} as const;

/**
 * Las columnas de `bronze.ml_stock_antiguedad` que suman "unidades de más de
 * `diasEnFull` días", sacadas de los mismos tramos que la pantalla de
 * Antigüedad para que no puedan quedar desfasadas.
 */
export const COLUMNAS_EN_RIESGO: readonly string[] = (() => {
  const cortes: Record<number, number> = { 30: 1, 60: 2, 90: 3, 120: 4 };
  const desde = cortes[REGLA_DESCARTE.diasEnFull];
  if (desde == null) {
    throw new Error(
      `REGLA_DESCARTE.diasEnFull = ${REGLA_DESCARTE.diasEnFull}: tiene que ser 30, 60, 90 o 120 ` +
        "(los cortes de bronze.ml_stock_antiguedad). Ver lib/tareas-meli.ts.",
    );
  }
  return TRAMOS_ANTIGUEDAD.slice(desde).map((t) => t.columna);
})();

// ---------------------------------------------------------------------------
// RESPUESTAS
// ---------------------------------------------------------------------------

/**
 * Las respuestas posibles, y por cuántos días cada una saca la alerta de la
 * bandeja. Pasado ese plazo, si la condición sigue, la alerta vuelve.
 *
 *   retiro        "Armé el retiro". 15 días es lo que tarda en salir; si a
 *                 los 15 el stock sigue en Full, el retiro no salió.
 *   se_deja       "Lo dejo, va a vender". Es una apuesta y se revisa al mes.
 *   desestimada   "No corresponde". Pide motivo, y también vuelve al mes: una
 *                 alerta descartada para siempre es una que nadie va a ver el
 *                 día que sí corresponda.
 */
export const RESPUESTAS = [
  { clave: "retiro", label: "Retiro armado", dias: 15, pideMotivo: false },
  { clave: "se_deja", label: "Se deja, va a vender", dias: 30, pideMotivo: false },
  { clave: "desestimada", label: "Desestimar", dias: 30, pideMotivo: true },
] as const;

export type ClaveRespuesta = (typeof RESPUESTAS)[number]["clave"];

/**
 * Motivos para desestimar. Una lista y no texto libre porque es lo que se va a
 * contar: "desestimadas por X" sólo se puede sumar si X se escribe siempre
 * igual. El detalle va en la nota.
 */
export const MOTIVOS_DESESTIMAR = [
  "Ya tiene un retiro en curso",
  "Hay una promoción o campaña que lo va a mover",
  "Es de temporada",
  "El dato de antigüedad está mal",
  "Otro (lo explico en la nota)",
] as const;

export function respuestaDe(clave: string) {
  return RESPUESTAS.find((r) => r.clave === clave) ?? null;
}

// ---------------------------------------------------------------------------
// TIPOS
// ---------------------------------------------------------------------------

/** La última respuesta que tuvo una alerta, vigente o no. */
export type UltimaRespuesta = {
  respuesta: ClaveRespuesta;
  motivo: string | null;
  nota: string | null;
  usuario: string;
  creadoEn: string;
  venceEn: string;
  vigente: boolean;
};

export type FilaDescarte = {
  sku: string;
  producto: string | null;
  proveedor: string | null;
  marca: string | null;
  /** Unidades en Full con más de `diasEnFull` días. */
  uRiesgo: number;
  valorRiesgo: number;
  /** Todo lo que hay en Full del SKU, aptas. */
  uFull: number;
  /** Antigüedad promedio en Full, ponderada por unidad. */
  diasEnFull: number | null;
  ultimaVenta: string | null;
  /** null = nunca vendió por Mercado Libre desde que hay datos. */
  diasSinVenta: number | null;
  /** La historia no alcanzó para fechar todas las unidades: el número es un piso. */
  parcial: boolean;
  ultima: UltimaRespuesta | null;
};

export type DashboardTareasMeli = {
  regla: typeof REGLA_DESCARTE;
  /** Fecha de la foto de antigüedad sobre la que se calculó. */
  foto: string | null;
  filas: FilaDescarte[];
  /** `true` si se llegó al tope de filas: hay más alertas que las que se ven. */
  recortada: boolean;
  /** Respuestas de los últimos 7 días, por tipo. La medición de la semana. */
  semana: { respuesta: ClaveRespuesta; cantidad: number }[];
  /**
   * `false` si la tabla de respuestas todavía no existe en la base (no se
   * aplicó la migración). La pantalla muestra las alertas igual y avisa.
   */
  respuestasDisponibles: boolean;
};
