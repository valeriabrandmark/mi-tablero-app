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

export const NOMBRES_PLAZO: Record<string, string> = {
  THIS_WEEK: "esta semana",
  NEXT_WEEK: "la semana que viene",
  IN_TWO_WEEKS: "en dos semanas",
  NOT_REPLENISHMENT_NEEDED: "no hace falta",
};
