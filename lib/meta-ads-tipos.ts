import type { ClaveMarca } from "@/lib/marketing-demo";

/**
 * Tipos y cuentas de Meta Ads que usa la PANTALLA. Van aparte de
 * `lib/meta-ads.ts` porque aquel lee el token y llama a la API: este archivo
 * lo importa el componente del navegador, y no tiene que arrastrar nada de eso.
 */

export type DiaMeta = {
  /** dd/mm */
  fecha: string;
  gasto: number;
  impresiones: number;
  clics: number;
  compras: number;
  valorCompras: number;
};

export type TotalesMeta = {
  gasto: number;
  impresiones: number;
  alcance: number;
  frecuencia: number;
  clics: number;
  compras: number;
  valorCompras: number;
  /** Conversaciones iniciadas por mensaje (anuncios a Instagram Direct / WhatsApp). */
  conversaciones: number;
};

export type CampanaMeta = {
  nombre: string;
  /** Objetivo de la campaña según Meta (OUTCOME_SALES, OUTCOME_AWARENESS...). */
  objetivo?: string | null;
  gasto: number;
  impresiones: number;
  clics: number;
  compras: number;
  valorCompras: number;
};

export type MetaAdsMarca = {
  fuente: "meta" | "demo";
  /** Por qué esta marca no muestra datos reales, si no los muestra. */
  motivo?: string;
  diario: DiaMeta[];
  totales: TotalesMeta;
  campanas: CampanaMeta[];
  /** Los anuncios (creatividades) con más inversión del mes. */
  anuncios: CampanaMeta[];
  /** Apertura por plataforma: Instagram, Facebook, Messenger, Audience Network. */
  plataformas: CampanaMeta[];
  /** Apertura por rango de edad. */
  edades: CampanaMeta[];
};

export type MetaAds = Record<ClaveMarca, MetaAdsMarca>;

// ---------------------------------------------------------------------------
// Cálculos que usa la pantalla
// ---------------------------------------------------------------------------

export const ctr = (t: { clics: number; impresiones: number }) =>
  t.impresiones ? t.clics / t.impresiones : NaN;
export const cpc = (t: { gasto: number; clics: number }) => (t.clics ? t.gasto / t.clics : NaN);
export const cpm = (t: { gasto: number; impresiones: number }) =>
  t.impresiones ? (t.gasto / t.impresiones) * 1000 : NaN;
export const roas = (t: { gasto: number; valorCompras: number }) =>
  t.gasto ? t.valorCompras / t.gasto : NaN;
export const costoPorCompra = (t: { gasto: number; compras: number }) =>
  t.compras ? t.gasto / t.compras : NaN;
export const diasConPauta = (d: DiaMeta[]) => d.filter((x) => x.gasto > 0).length;

