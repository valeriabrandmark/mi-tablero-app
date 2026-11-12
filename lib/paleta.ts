/**
 * Paleta de gráficos: 6 colores.
 *
 * ---------------------------------------------------------------------------
 * SON VARIABLES DE CSS Y NO HEX, DESDE QUE EXISTE EL MODO CLARO
 *
 * Los seis colores de siempre están pensados para brillar sobre casi negro y
 * sobre el fondo crema del modo claro quedan lavados --el verde da 1,9:1, por
 * debajo del 3:1 que necesita un elemento gráfico para verse--. En claro hay
 * que usar los tonos 600/700: mismo color conceptual, otra tinta.
 *
 * Apuntando a la variable, el cambio lo hace el CSS y ningún gráfico se entera.
 * La alternativa era que cada componente supiera en qué tema está, y son
 * TREINTA Y TRES archivos: alcanzaba con que uno se olvidara para dejar una
 * línea invisible sobre el crema, y nadie lo iba a ver hasta abrir ese panel.
 *
 * FUNCIONA EN SVG. Recharts pone estos valores en atributos de presentación
 * (`stroke`, `fill`, `stop-color`), que resuelven `var()` como cualquier
 * propiedad CSS. Lo que NO se puede es hacerles cuentas --aclarar, mezclar--:
 * si algún día hace falta eso, se hace con `color-mix()` en el CSS, no acá.
 */
export const PALETA = [
  "var(--color-c1)", // azul
  "var(--color-c2)", // verde
  "var(--color-c3)", // ámbar
  "var(--color-c4)", // violeta
  "var(--color-c5)", // cian
  "var(--color-c6)", // rosa
] as const;

export function colorSerie(indice: number): string {
  return PALETA[indice % PALETA.length];
}

/** Tokens del tema oscuro reutilizados por los gráficos (recharts pide hex/rgb). */
export const TEMA = {
  ink: "var(--color-ink)",
  muted: "var(--color-muted)",
  line: "var(--color-line)",
  panel: "var(--color-panel)",
  negativo: "var(--color-negativo)",
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
  BUENO: "var(--color-r-bueno)",
  "AL DÍA": "var(--color-r-aldia)",
  OBSERVACIÓN: "var(--color-r-observacion)",
  RIESGOSO: "var(--color-r-riesgoso)",
  CRÍTICO: "var(--color-r-critico)",
  // A FAVOR NO ES EL ESCALON CERO DE LA ESCALA, ES OTRA COSA: ese cliente no
  // debe nada, le debemos nosotros. Por eso un celeste y no un verde más
  // verde: un sexto paso del degradé lo pondría a competir con BUENO por el
  // lugar de "el mejor", cuando ni siquiera está en la misma pregunta.
  "A FAVOR": "var(--color-r-afavor)",
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
  "A favor": "var(--color-r-afavor)",
  "No vencido": "var(--color-r-bueno)",
  "0-30 días": "var(--color-r-aldia)",
  "31-60 días": "var(--color-r-observacion)",
  "61-90 días": "var(--color-r-riesgoso)",
  "+90 días": "var(--color-r-critico)",
  "Sin dato": TEMA.muted,
};
