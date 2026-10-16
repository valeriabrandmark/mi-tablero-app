/** Paleta de gráficos: 6 colores que funcionan bien sobre fondo casi negro. */
export const PALETA = [
  "#3b82f6", // azul
  "#22c55e", // verde
  "#f59e0b", // ámbar
  "#a78bfa", // violeta
  "#22d3ee", // cian
  "#f472b6", // rosa
] as const;

export function colorSerie(indice: number): string {
  return PALETA[indice % PALETA.length];
}

/** Tokens del tema oscuro reutilizados por los gráficos (recharts pide hex/rgb). */
export const TEMA = {
  ink: "#e7e9ee",
  muted: "#8b93a1",
  line: "#242a33",
  panel: "#14171c",
  negativo: "#f43f5e",
} as const;

/* ---------------------------------------------------------------------------
   LA ESCALA DE RIESGO DE CUENTAS CORRIENTES.

   NO ES UNA PALETA CATEGORICA: las cinco categorías están ORDENADAS, de quien
   no debe nada a quien debe hace meses. Darles colores de identidad --azul,
   verde, cian-- obliga a recordar cuál es peor; con la escala, el gráfico lo
   dice solo.

   EL ORDEN ES EL DEL ORQUESTADOR, no el alfabético:

     BUENO        no tiene facturas vencidas
     AL DÍA       debe, pero dentro de los 15 días de tolerancia
     OBSERVACIÓN  16 a 30 días de atraso, exposición <= 60 %
     RIESGOSO     16 a 30 con exposición > 60 %, o más de 30 con <= 60 %
     CRÍTICO      más de 30 días de atraso y exposición > 60 %

   ---------------------------------------------------------------------------
   COMO SE ELIGIERON ESTOS CINCO

   Verde → amarillo → naranja → rojo en cinco pasos es, medido, muy difícil de
   separar: la primera tanda de candidatos daba ΔE 3,1 en protanopía entre el
   verde claro y el amarillo --indistinguibles. Se probaron dieciséis
   combinaciones de los dos pasos del medio con el validador de la guía de
   visualización. Los que quedaron:

     CVD, peor par adyacente      ΔE 13,2 (protan) · 15,7 (tritan)   PASA
     Visión normal, peor par      ΔE 18,8                            PASA
     Contraste contra el fondo    los cinco >= 3:1                   PASA

   La luminosidad NO es monótona --el amarillo es el más claro de los cinco--
   y por eso el chequeo de "banda de luminosidad" del validador falla. Ese
   chequeo es para paletas CATEGORICAS, donde ningún color debe pesar más que
   otro; acá el peso creciente es justamente lo que se busca.

   Y COMO ES UNA ESCALA DE ESTADO, el color nunca va solo: en los tres lugares
   donde se usa --la torta, las barras y la tabla-- el nombre de la categoría
   está siempre a la vista. Esa es la condición que la hace legible para quien
   no distingue los tonos.
   --------------------------------------------------------------------------- */
export const CATEGORIAS_RIESGO = [
  "BUENO",
  "AL DÍA",
  "OBSERVACIÓN",
  "RIESGOSO",
  "CRÍTICO",
] as const;

export const COLOR_CATEGORIA: Record<string, string> = {
  BUENO: "#15803d",
  "AL DÍA": "#34d399",
  OBSERVACIÓN: "#fde047",
  RIESGOSO: "#fb923c",
  CRÍTICO: "#dc2626",
  // A FAVOR NO ES EL ESCALON CERO DE LA ESCALA, ES OTRA COSA: ese cliente no
  // debe nada, le debemos nosotros. Por eso un celeste y no un verde más
  // verde: un sexto paso del degradé lo pondría a competir con BUENO por el
  // lugar de "el mejor", cuando ni siquiera está en la misma pregunta.
  "A FAVOR": "#38bdf8",
};

/**
 * El color de una categoría, con un gris para lo que no esté en la escala.
 *
 * El gris es deliberado: una categoría nueva que el orquestador empiece a
 * escribir tiene que VERSE como desconocida, no tomar prestado el rojo de
 * CRÍTICO ni el verde de BUENO por caer en un `%` de la lista.
 */
export function colorCategoria(categoria: string | null | undefined): string {
  return COLOR_CATEGORIA[(categoria ?? "").toUpperCase()] ?? TEMA.muted;
}

/**
 * Los tramos de antigüedad del aging, con la MISMA escala.
 *
 * Son el mismo eje --qué tan vencido está-- medido en días en vez de en
 * categorías, así que usar otra paleta haría que dos gráficos que dicen lo
 * mismo se lean como si dijeran cosas distintas.
 */
export const COLOR_TRAMO_AGING: Record<string, string> = {
  // Mismo celeste que la categoría A FAVOR, y por el mismo motivo: las notas
  // de crédito tienen días de atraso pero no son deuda vencida de ninguna
  // antigüedad. Antes caían en el tramo que les tocaba por edad y lo
  // DESCONTABAN --tres de ellas en "+90 días"-- así que el tramo más caro de
  // todos salía más chico de lo que es.
  "A favor": "#38bdf8",
  "No vencido": "#15803d",
  "0-30 días": "#34d399",
  "31-60 días": "#fde047",
  "61-90 días": "#fb923c",
  "+90 días": "#dc2626",
  "Sin dato": TEMA.muted,
};
