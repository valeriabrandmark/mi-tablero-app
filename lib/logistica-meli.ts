/**
 * CÓMO SE DESPACHÓ CADA VENTA DE MERCADO LIBRE.
 *
 * ---------------------------------------------------------------------------
 * POR QUÉ LA TRADUCCIÓN VIVE ACÁ Y NO EN EL ORQUESTADOR
 *
 * `gold.fact_ventas.logistica` guarda el valor CRUDO de la API de ML
 * —`fulfillment`, `self_service`, `cross_docking`…—, a propósito. Si el
 * orquestador guardara "Full" y "Flex" ya traducidos, el día que ML renombre un
 * modo o agregue uno nuevo habría que decidir en el momento de GUARDAR qué
 * hacer con algo que no conocemos, y lo que se guarda no se puede revisar.
 *
 * Guardando el crudo, el dato queda tal como vino y la decisión de cómo
 * mostrarlo se toma acá, donde se puede cambiar sin volver a bajar nada.
 *
 * ---------------------------------------------------------------------------
 * UN MODO QUE NO CONOCEMOS SE VE, NO SE ESCONDE
 *
 * `etiquetaLogistica` NO tiene un "Otros" que se coma lo que no está en la
 * lista: un valor desconocido se muestra tal cual vino de ML, y
 * `colorLogistica` le da un color llamativo. Es deliberado. Un "Otros" gris es
 * cómodo y miente: si ML empieza a mandar un modo nuevo y se lleva el 20 % de
 * las ventas, con un "Otros" nadie se entera nunca; con el nombre crudo en
 * pantalla, la primera persona que mire el gráfico pregunta qué es eso.
 *
 * ---------------------------------------------------------------------------
 * "SIN DATO" Y "SIN ESPECIFICAR" NO SON LO MISMO
 *
 * `not_specified` es un valor REAL de Mercado Libre: la orden no va por Mercado
 * Envíos y el envío se arregla por fuera. "Sin dato" es un agujero NUESTRO: el
 * envío todavía no se bajó —o la orden no tiene envío, como un retiro en
 * persona—. Mezclarlos taparía justo lo que hay que mirar cuando el gráfico se
 * ve raro: si la franja gris crece, no es que cambió la operación, es que el
 * pipeline se está quedando atrás.
 */
export const LOGISTICA_ML: Record<string, string> = {
  fulfillment: "Full",
  self_service: "Flex",
  cross_docking: "Colecta",
  drop_off: "Punto de despacho",
  // Colecta y punto de despacho a la vez: ML lo retira de un punto, no del
  // depósito. Va separado de `drop_off` porque es otra operación, aunque de
  // lejos se parezcan.
  xd_drop_off: "Punto de despacho (XD)",
  // El envío no va por Mercado Envíos: lo maneja el vendedor.
  default: "Logística propia",
  not_specified: "Sin especificar",
};

/** Lo que se muestra cuando la venta no tiene el dato bajado. */
export const SIN_DATO = "Sin dato";

export const COLOR_LOGISTICA: Record<string, string> = {
  Full: "#3b82f6",
  Flex: "#22c55e",
  Colecta: "#f59e0b",
  "Punto de despacho": "#a78bfa",
  "Punto de despacho (XD)": "#22d3ee",
  "Logística propia": "#f472b6",
  // Un gris CLARO: es un valor real de ML, no un hueco.
  "Sin especificar": "#94a3b8",
  // Y uno OSCURO para el hueco nuestro, que tiene que leerse como apagado y no
  // como una categoría más.
  [SIN_DATO]: "#4b5563",
};

/**
 * El modo de envío como se muestra, a partir del crudo que guarda el modelo.
 *
 * Un valor que no está en el mapa se devuelve TAL CUAL: ver el comentario de
 * arriba sobre por qué no hay un "Otros".
 */
export function etiquetaLogistica(crudo: string | null | undefined): string {
  if (crudo == null) return SIN_DATO;
  const limpio = crudo.trim();
  if (!limpio) return SIN_DATO;
  return LOGISTICA_ML[limpio.toLowerCase()] ?? limpio;
}

/**
 * El color de cada etiqueta en el gráfico.
 *
 * El fucsia NO es un descuido: es el color de lo que no conocemos. Si ML manda
 * un modo nuevo, la porción aparece en un color que no pertenece a la paleta
 * del tablero y se nota.
 */
export function colorLogistica(etiqueta: string): string {
  return COLOR_LOGISTICA[etiqueta] ?? "#e879f9";
}

/**
 * El orden en que se muestran: los modos conocidos primero, en el orden de
 * arriba, y lo desconocido al final.
 *
 * NO se ordena por tamaño. Full se lleva casi todo, así que ordenar por tamaño
 * no cambia nada hoy —y el día que cambie, la leyenda se reordenaría sola y dos
 * fotos del mismo gráfico dejarían de ser comparables de un pantallazo.
 * "Sin dato" va último siempre: es el hueco, no una categoría.
 */
const ORDEN = [...Object.values(LOGISTICA_ML), SIN_DATO];

export function ordenLogistica(etiqueta: string): number {
  const i = ORDEN.indexOf(etiqueta);
  // Lo desconocido va entre los conocidos y "Sin dato": importa que se vea,
  // pero el hueco se lee mejor al final de todo.
  return i === -1 ? ORDEN.length - 1.5 : i;
}

/**
 * Las cuentas crudas de la base, listas para el gráfico.
 *
 * JUNTA LOS CRUDOS QUE COMPARTEN ETIQUETA. Hoy el mapa es uno a uno, pero el
 * día que dos valores de ML se muestren igual, la base seguiría devolviendo dos
 * filas y la torta dibujaría dos porciones del mismo color con el mismo nombre.
 *
 * DESCARTA LOS CEROS. Una etiqueta en cero no es una porción: sólo ensucia la
 * leyenda con modos que no se usaron en el recorte.
 *
 * Vive acá y no en `queries-meli.ts` porque no toca la base: así se puede
 * probar sin levantar una conexión.
 */
export function armarPorLogistica(
  filas: { logistica: string | null; ordenes: string | number | null }[],
): { label: string; total: number }[] {
  const porEtiqueta = new Map<string, number>();
  for (const fila of filas) {
    const etiqueta = etiquetaLogistica(fila.logistica);
    const n = Number(fila.ordenes);
    porEtiqueta.set(
      etiqueta,
      (porEtiqueta.get(etiqueta) ?? 0) + (Number.isFinite(n) ? n : 0),
    );
  }
  return Array.from(porEtiqueta, ([label, total]) => ({ label, total }))
    .filter((p) => p.total > 0)
    .sort((a, b) => ordenLogistica(a.label) - ordenLogistica(b.label));
}
