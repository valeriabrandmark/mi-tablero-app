/**
 * Reglas de "Elasticidad de precios" (Mercado Libre).
 *
 * ---------------------------------------------------------------------------
 * QUÉ MIDE
 *
 * El experimento reparte los artículos en tres grupos. Cada grupo pasa una
 * semana en cada banda de markup sobre el costo y después rota, así que en tres
 * semanas los tres grupos pasaron por las tres bandas. Es un cuadrado latino:
 * cada semana contiene a las tres bandas al mismo tiempo, y por eso el efecto
 * "esta semana se vendió más" —feriados, quincena, campañas de ML— no se puede
 * confundir con el efecto de la banda.
 *
 * ---------------------------------------------------------------------------
 * POR QUÉ ESTA PANTALLA NO MUESTRA UNIDADES
 *
 * Comparar unidades entre semanas no mide elasticidad: mide disponibilidad.
 *
 * Si un SKU quebró stock el martes de la semana de markup 25-35 %, esa semana
 * muestra menos unidades y la lectura ingenua es "con markup alto vende menos"
 * —cuando en realidad no vendió porque no estaba a la venta—. Con más de la
 * mitad del catálogo quebrado en cualquier momento dado, ese sesgo es más
 * grande que el efecto que se busca medir.
 *
 * Por eso todo acá se mide **por día realmente a la venta**, y el quiebre no es
 * un flag sino lo que descuenta el denominador. La historia de disponibilidad
 * la construye `ml_pulso.py` del repo del pipeline.
 *
 * ---------------------------------------------------------------------------
 * Y POR QUÉ LA RESPUESTA ES EL MARGEN Y NO LAS UNIDADES
 *
 * "Vender más" no es el objetivo: bajando el markup a cero se vende muchísimo y
 * no queda nada. El número que contesta la pregunta del negocio —cuánto marcar
 * sobre el costo— es el **margen por día a la venta**, que sube cuando el
 * markup sube y baja cuando el markup espanta compradores. Su máximo es el
 * punto de equilibrio que se está buscando.
 *
 * ---------------------------------------------------------------------------
 * PERO EL MÁXIMO SOLO NO ALCANZA: EL EMPATE SE DESEMPATA HACIA ARRIBA
 *
 * Entre dos bandas que dejan lo mismo por día conviene la de **markup más
 * alto**, porque vende menos unidades para ganar la misma plata. Dicho con el
 * ejemplo del negocio: vender 50 unidades marcando 10 % y vender 20 marcando
 * 30 % no son equivalentes aunque den el mismo total.
 *
 * Importa por dos motivos concretos:
 *
 *   1. El stock dura más. Quemar la mercadería a mitad de semana deja al
 *      artículo sin nada que vender hasta que se repone, y en Full reponer no
 *      es inmediato.
 *   2. Cada unidad movida cuesta trabajo —preparar, despachar, atender— que no
 *      depende de a cuánto se vendió.
 *
 * Por eso `mejorBanda` no devuelve el máximo pelado: entre las bandas que están
 * dentro de `EMPATE_TECNICO` de la mejor, devuelve la de markup más alto.
 */

/** Las tres bandas. Tienen que decir lo mismo que `BANDAS` en experimento.py. */
export const BANDAS = [
  { clave: "10-18", label: "10 a 18 %", min: 0.1, max: 0.18 },
  { clave: "18-25", label: "18 a 25 %", min: 0.18, max: 0.25 },
  { clave: "25-35", label: "25 a 35 %", min: 0.25, max: 0.35 },
] as const;

export type ClaveBanda = (typeof BANDAS)[number]["clave"];

export function labelBanda(clave: string): string {
  return BANDAS.find((b) => b.clave === clave)?.label ?? clave;
}

/**
 * Mínimo de horas a la venta para que una semana de un SKU se pueda leer.
 *
 * Un artículo que estuvo doce horas disponibles en toda la semana no aporta
 * nada: su tasa sale de dividir por un número chiquito y cualquier venta suelta
 * la manda a las nubes. Un día entero es el piso razonable.
 */
export const HORAS_MINIMAS = 24;

/**
 * Cuánto de la ventana puede haber quedado sin observar antes de descartarla.
 *
 * `horas_sin_dato` son las horas en que el pulso no corrió. Con el pipeline
 * sano son cero; si un cuarto de la semana no se miró, lo que sobra no alcanza
 * para decir a qué ritmo vendía.
 */
export const MAX_SIN_DATO = 0.25;

/**
 * Unidades mínimas —sumando las tres semanas— para leer a UN artículo solo.
 *
 * DE DÓNDE SALE, PORQUE ES EL LÍMITE MÁS IMPORTANTE DE TODA LA PANTALLA:
 * la mediana de los 2.282 SKU del experimento es 0,58 unidades por semana, y
 * 1.316 de ellos (58 %) venden menos de una. Con esos números, la diferencia
 * entre markup 10 % y 35 % en un artículo es indistinguible del ruido: entre
 * vender 0 y vender 1 no hay señal, hay azar.
 *
 * 15 unidades en tres semanas son 5 por semana, que es donde arrancan los ~93
 * SKU con volumen propio. Debajo de eso el artículo cuenta para el agregado
 * —que sí tiene miles de unidades— pero no se lee solo.
 */
export const UDS_MINIMAS_SKU = 15;

/** Si una fila SKU-semana se puede leer, y por qué no si no. */
export function motivoDescartado(fila: {
  horasVendible: number;
  horasSinDato: number;
  horasVentana: number;
}): string | null {
  if (fila.horasVendible < HORAS_MINIMAS) return "Menos de un día a la venta";
  if (fila.horasVentana > 0 && fila.horasSinDato / fila.horasVentana > MAX_SIN_DATO) {
    return "El pulso no corrió buena parte de la semana";
  }
  return null;
}

/**
 * Cuánto puede estar por debajo del mejor margen por día una banda para que se
 * la siga considerando empatada.
 *
 * NO ES UN NÚMERO ESTADÍSTICO, es una preferencia del negocio, y por eso está
 * acá arriba y no escondido en una fórmula. Dice: "una banda que deja hasta un
 * 10 % menos por día, pero con markup más alto, me conviene igual" — porque lo
 * que se ahorra en stock quemado y en trabajo por unidad compensa esa
 * diferencia. Subirlo empuja a marcar más caro; bajarlo, a vender más barato.
 *
 * Con 0 el criterio vuelve a ser el máximo pelado.
 */
export const EMPATE_TECNICO = 0.1;

/**
 * La banda recomendada, o `null` si no hay al menos dos bandas medidas.
 *
 * Con una sola banda medida no hay comparación posible: el "mejor" sería el
 * único, que no dice nada. Devolver null y que la pantalla muestre "—" es
 * preferible a un ganador que se eligió a sí mismo.
 *
 * Entre las que quedan dentro de `EMPATE_TECNICO` del mejor margen por día,
 * gana la de **markup más alto** (ver el encabezado del archivo). `BANDAS` está
 * ordenada de menor a mayor markup, así que "la última que empata" es esa.
 *
 * Ojo con el signo: si el mejor margen por día es NEGATIVO —el artículo pierde
 * plata en las tres bandas—, un umbral multiplicativo se daría vuelta y
 * elegiría la PEOR. Por eso el piso se calcula sobre el valor absoluto.
 */
export function mejorBanda(
  porBanda: Partial<Record<string, number | null>>,
): ClaveBanda | null {
  const medidas = BANDAS.filter((b) => porBanda[b.clave] != null);
  if (medidas.length < 2) return null;

  const tope = Math.max(...medidas.map((b) => porBanda[b.clave]!));
  const piso = tope - Math.abs(tope) * EMPATE_TECNICO;

  // `filter` conserva el orden de BANDAS (markup creciente), así que la última
  // que pasa el piso es la de markup más alto entre las empatadas.
  const empatadas = medidas.filter((b) => porBanda[b.clave]! >= piso);
  return empatadas[empatadas.length - 1].clave;
}

/**
 * Qué le falta al experimento para poder leerse. Lo usa la pantalla cuando
 * todavía no hay nada: sin esto, una pantalla vacía se lee como "no vendimos
 * nada" en vez de "esto todavía no arrancó".
 */
export const PASOS_PREVIOS = [
  {
    clave: "pulso",
    titulo: "El pulso tiene que estar corriendo",
    detalle:
      "`ml_pulso.py` mira el estado de cada publicación en cada corrida del " +
      "orquestador y guarda desde cuándo está quebrada. Es lo único que no se " +
      "puede reconstruir hacia atrás: las horas que no se miraron se pierden.",
  },
  {
    clave: "asignacion",
    titulo: "Hay que asignar las bandas",
    detalle:
      "`experimento.py --asignar --desde AAAA-MM-DD` reparte los SKU en tres " +
      "grupos y arma el cuadrado latino de tres semanas.",
  },
  {
    clave: "semanas",
    titulo: "Y esperar a que pasen las semanas",
    detalle:
      "Cada grupo necesita haber pasado por al menos dos bandas para que haya " +
      "algo que comparar. Antes de eso los números existen pero no se pueden leer.",
  },
] as const;
