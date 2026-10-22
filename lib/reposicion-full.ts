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

export const NOMBRES_RECOMENDACION: Record<string, string> = {
  NO_REPLENISHMENT_BY_RESTRICTION: "No se puede enviar: restringido",
};

export const NOMBRES_PLAZO: Record<string, string> = {
  THIS_WEEK: "esta semana",
  NEXT_WEEK: "la semana que viene",
};
