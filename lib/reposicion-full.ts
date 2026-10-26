/**
 * Tipos y nombres de la reposición de Full, sin base de datos: los importan
 * componentes que corren en el navegador. La consulta está en
 * lib/queries-reposicion-full.ts.
 */

export type ReposicionFull = {
  /** null = ML no contestó por este producto: no se sabe. */
  restringido: boolean | null;
  /** Tipo de recomendación de ML, ej. NO_REPLENISHMENT_BY_RESTRICTION. */
  recomendacion: string | null;
  cantidadSugerida: number | null;
  /** Urgencia de envío que informa ML, ej. URGENT. */
  urgencia: string | null;
  /** Plazo para mandar, ej. THIS_WEEK. */
  plazo: string | null;
  /**
   * DESTACADO POR MERCADO LIBRE (`star_product`).
   *
   * Lo pone ML, no nosotros, y son pocos: 18 de 4.037 el 26/10/2026. De esos,
   * 17 vendieron el ultimo mes y SIETE estaban sin stock en Full. Ahi esta el
   * valor de mostrarlo: un destacado vacio no es un articulo parado mas, es el
   * que ML mismo iba a empujar y no tiene que vender.
   */
  destacado: boolean;
};

/**
 * Lo que contesta la API de reposicion de Full, en castellano.
 *
 * Son los tres que manda hoy, contados sobre la cuenta el 26/10/2026:
 * NO_REPLENISHMENT 2.292, REPLENISH 1.192 y NO_REPLENISHMENT_BY_RESTRICTION
 * 551. Los dos primeros se veian con el nombre crudo en ingles porque solo
 * estaba traducido el tercero.
 *
 * LO QUE NO ESTE ACA SIGUE SALIENDO CON SU NOMBRE CRUDO, a proposito: un
 * codigo nuevo tiene que verse para poder nombrarlo. Asi aparecio este.
 */
/**
 * Un producto que Mercado Libre marca como destacado, con lo que hace falta
 * para decidir si hay que mandarle stock. La consulta esta en
 * lib/queries-reposicion-full.ts; el tipo vive aca por lo mismo que
 * `ReposicionFull`: lo importa un componente que corre en el navegador.
 */
export type DestacadoFull = {
  sku: string | null;
  producto: string | null;
  enFull: number;
  unidades30d: number | null;
  facturacion30d: number | null;
  reposicion: ReposicionFull;
};

/**
 * Un producto que ENTRO o SALIO de restriccion en Full.
 *
 * El tipo vive aca --y no en el archivo de consultas-- por lo mismo que
 * `ReposicionFull`: lo importa un componente que corre en el navegador.
 */
export type CambioDeRestriccion = {
  sku: string | null;
  producto: string | null;
  /** `true` = entró en restricción. `false` = salió. */
  restringido: boolean;
  fecha: string;
  hace: number;
};

export const NOMBRES_RECOMENDACION: Record<string, string> = {
  NO_REPLENISHMENT: "No hace falta reponer",
  // SIN CANTIDAD: es lo que se muestra cuando ML recomienda reponer pero no
  // dice cuanto. Hasta el 26/10/2026 era el caso de TODOS, porque el
  // orquestador leia `suggested_quantity` como si fuera un numero y en
  // realidad es un objeto -- {"type": "exact", "value": 140}-- asi que se
  // guardaba vacio (ver el PR 130 de tablero_quo). Arreglado eso, estos pasan
  // a mostrar "Mandar N" y este texto queda para los que igual no traigan
  // cantidad.
  REPLENISH: "Conviene reponer",
  NO_REPLENISHMENT_BY_RESTRICTION: "No se puede enviar: restringido",
};

/**
 * El nombre en castellano de lo que contesta ML, incluso cuando son VARIOS.
 *
 * UN SKU PUEDE TENER MAS DE UN PRODUCTO EN FULL y cada uno su recomendación.
 * La consulta los junta con `string_agg(distinct …, ' / ')`, así que llega
 * "NO_REPLENISHMENT / REPLENISH" -- una clave que no está en la tabla y que
 * por eso salía cruda en pantalla. Son 6 SKU el 26/10/2026: pocos, pero
 * justo los que más desconcierta ver en inglés, porque aparecen mezclados
 * entre filas que sí están traducidas.
 *
 * Se traduce parte por parte y se vuelve a unir. Lo que no esté sigue saliendo
 * con su nombre crudo, que es la red de siempre.
 */
export function nombreDeRecomendacion(recomendacion: string): string {
  return recomendacion
    .split(" / ")
    .map((r) => NOMBRES_RECOMENDACION[r.trim()] ?? r.trim())
    .join(" / ");
}

export const NOMBRES_PLAZO: Record<string, string> = {
  THIS_WEEK: "esta semana",
  NEXT_WEEK: "la semana que viene",
  IN_TWO_WEEKS: "en dos semanas",
  NOT_REPLENISHMENT_NEEDED: "no hace falta",
};

/**
 * Las opciones del filtro "Envío a Full", en el orden en que se muestran.
 *
 * SON LO QUE DICE LA COLUMNA, no los códigos de la API. Quien filtra acaba de
 * leer "Restringido" en una fila y quiere ver todas las que dicen eso; pedirle
 * que traduzca a NO_REPLENISHMENT_BY_RESTRICTION sería hacerle aprender un
 * vocabulario que la pantalla justamente le esconde.
 *
 * "Conviene reponer" junta los dos textos que puede mostrar ese caso: hoy dice
 * eso, y cuando lleguen las cantidades --ver el PR 130 de tablero_quo-- dirá
 * "Mandar N". Es el mismo estado.
 */
export const OPCIONES_ENVIO_FULL = [
  { clave: "restringido", etiqueta: "Restringido" },
  { clave: "reponer", etiqueta: "Conviene reponer" },
  { clave: "no-hace-falta", etiqueta: "No hace falta reponer" },
  { clave: "sin-dato", etiqueta: "Sin dato de ML" },
] as const;

export type ClaveEnvioFull = (typeof OPCIONES_ENVIO_FULL)[number]["clave"];
