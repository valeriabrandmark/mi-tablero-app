/**
 * LA PLANILLA DE MARKETING (Google Sheets) → TABLERO.
 *
 * Un solo archivo para las cuatro marcas, reemplaza a las planillas sueltas
 * de cada una. Se llena a mano en Sheets y su Apps Script
 * (apps-script/planilla-marketing.gs) manda una FOTO entera al tablero:
 * /api/marketing/planilla la guarda en bronze.mkt_planilla y el Tablero de
 * Marca lee siempre la última.
 *
 * Sin `pg`: los tipos y las cuentas los usan la API (al recibir) y la pantalla.
 *
 * ---------------------------------------------------------------------------
 * QUÉ CUESTA UNA COLABORACIÓN
 *
 * No sólo se paga: a veces es canje, a veces las dos cosas, y siempre hay
 * envío. El costo total de una colaboración es
 *
 *   honorarios + IVA de honorarios
 *   + costo del canje   (suma de "Productos canje": lo que NOS cuesta, no el PVP)
 *   + costo de envío    (suma de "Envíos")
 *   + otros costos
 *
 * El valor del canje a PVP se guarda aparte: es lo que el influencer percibe,
 * sirve para negociar, pero no es plata que sale.
 * ---------------------------------------------------------------------------
 */

import type { ClaveMarca } from "@/lib/marketing-demo";

export const NOMBRE_A_MARCA: Record<string, ClaveMarca> = {
  "diaper genie": "diaper_genie",
  "hola toys": "hola_toys",
  unibrandco: "unibrandco",
  "litter genie": "litter_genie",
};

export function marcaDe(texto: unknown): ClaveMarca | null {
  if (typeof texto !== "string") return null;
  const t = texto.trim().toLowerCase();
  return NOMBRE_A_MARCA[t] ?? (Object.values(NOMBRE_A_MARCA).includes(t as ClaveMarca) ? (t as ClaveMarca) : null);
}

export type ColaboracionPlanilla = {
  id: string;
  marca: ClaveMarca;
  fecha: string | null;
  influencer: string;
  instagram: string | null;
  modalidad: string | null;
  formato: string | null;
  campana: string | null;
  honorarios: number;
  ivaHonorarios: number;
  costoCanje: number;
  valorCanjePvp: number;
  costoEnvio: number;
  otrosCostos: number;
  costoTotal: number;
  estado: string | null;
  estadoPago: string | null;
  publicacion: string | null;
  link: string | null;
  cupon: string | null;
  alcance: number | null;
  interacciones: number | null;
};

export type GastoPlanilla = {
  fecha: string | null;
  mes: string | null;
  marca: ClaveMarca;
  concepto: string;
  proveedor: string | null;
  total: number;
  estadoPago: string | null;
};

export type PresupuestoPlanilla = { mes: string; marca: ClaveMarca; monto: number };

export type EnvioPlanilla = {
  idColaboracion: string | null;
  fecha: string | null;
  marca: ClaveMarca | null;
  tipo: string | null;
  costo: number;
  estado: string | null;
};

export type Planilla = {
  recibidoEn: string;
  colaboraciones: ColaboracionPlanilla[];
  gastos: GastoPlanilla[];
  presupuesto: PresupuestoPlanilla[];
  envios: EnvioPlanilla[];
  influencers: number;
};

// ---------------------------------------------------------------------------
// Normalización de lo que manda el Apps Script
// ---------------------------------------------------------------------------

type Fila = Record<string, unknown>;

const ISO = /^\d{4}-\d{2}-\d{2}/;
const MES = /^\d{4}-\d{2}$/;

function txt(v: unknown, max = 300): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
}

/** Números como los escribe una planilla argentina: 1.234,5 · $ 1.234 · 1234.5 */
export function num(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v !== "string") return 0;
  let s = v.replace(/[^\d,.-]/g, "");
  if (!s) return 0;
  const coma = s.lastIndexOf(",");
  const punto = s.lastIndexOf(".");
  if (coma > punto) s = s.replace(/\./g, "").replace(",", ".");
  else if (coma >= 0 && punto > coma) s = s.replace(/,/g, "");
  else if (coma < 0 && /^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function numONull(v: unknown): number | null {
  return v === null || v === undefined || v === "" ? null : num(v);
}

function fecha(v: unknown): string | null {
  const s = txt(v, 40);
  if (!s) return null;
  if (ISO.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m) return `${m[3].length === 2 ? `20${m[3]}` : m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return null;
}

function mesDe(v: unknown): string | null {
  const s = txt(v, 20);
  if (!s) return null;
  if (MES.test(s)) return s;
  const f = fecha(s);
  return f ? f.slice(0, 7) : null;
}

const lista = (v: unknown): Fila[] => (Array.isArray(v) ? v.filter((x) => x && typeof x === "object") : []) as Fila[];

/**
 * Convierte la foto cruda (lo que manda el script, con los encabezados de la
 * planilla como claves) en el modelo. Una fila sin marca válida o sin lo
 * mínimo se descarta: mejor una fila menos que un costo cargado a la marca
 * equivocada.
 */
export function normalizarPlanilla(crudo: unknown, recibidoEn: string): Planilla {
  const h = (crudo && typeof crudo === "object" ? (crudo as { hojas?: Record<string, unknown> }).hojas : null) ?? {};

  const colaboraciones: ColaboracionPlanilla[] = [];
  for (const f of lista(h.colaboraciones)) {
    const marca = marcaDe(f["Marca"]);
    const id = txt(f["ID"], 40);
    const influencer = txt(f["Influencer"], 120);
    if (!marca || !id || !influencer) continue;
    const honorarios = num(f["Honorarios ($)"]);
    const iva = num(f["IVA honorarios ($)"]);
    const canje = num(f["Costo canje ($)"]);
    const envio = num(f["Costo envío ($)"]);
    const otros = num(f["Otros costos ($)"]);
    const total = num(f["Costo total ($)"]) || honorarios + iva + canje + envio + otros;
    colaboraciones.push({
      id,
      marca,
      fecha: fecha(f["Fecha"]),
      influencer,
      instagram: txt(f["Instagram"], 80),
      modalidad: txt(f["Modalidad"], 40),
      formato: txt(f["Formato"], 60),
      campana: txt(f["Campaña / fecha comercial"], 120),
      honorarios,
      ivaHonorarios: iva,
      costoCanje: canje,
      valorCanjePvp: num(f["Valor canje PVP ($)"]),
      costoEnvio: envio,
      otrosCostos: otros,
      costoTotal: total,
      estado: txt(f["Estado"], 40),
      estadoPago: txt(f["Estado de pago"], 40),
      publicacion: fecha(f["Publicación real"]) ?? fecha(f["Publicación prevista"]),
      link: txt(f["Link"], 300),
      cupon: txt(f["Cupón"], 60)?.toUpperCase() ?? null,
      alcance: numONull(f["Alcance"]),
      interacciones: numONull(f["Interacciones"]),
    });
  }

  const gastos: GastoPlanilla[] = [];
  for (const f of lista(h.gastos)) {
    const marca = marcaDe(f["Marca"]);
    const concepto = txt(f["Concepto"], 80);
    const total = num(f["Total ($)"]) || num(f["Monto ($)"]) + num(f["IVA ($)"]);
    if (!marca || !concepto || !total) continue;
    const fe = fecha(f["Fecha"]);
    gastos.push({
      fecha: fe,
      mes: mesDe(f["Mes"]) ?? fe?.slice(0, 7) ?? null,
      marca,
      concepto,
      proveedor: txt(f["Proveedor"], 120),
      total,
      estadoPago: txt(f["Estado de pago"], 40),
    });
  }

  const presupuesto: PresupuestoPlanilla[] = [];
  for (const f of lista(h.presupuesto)) {
    const marca = marcaDe(f["Marca"]);
    const mes = mesDe(f["Mes"]);
    const monto = num(f["Presupuesto ($)"]);
    if (marca && mes && monto) presupuesto.push({ mes, marca, monto });
  }

  const envios: EnvioPlanilla[] = lista(h.envios)
    .map((f) => ({
      idColaboracion: txt(f["ID colaboración"], 40),
      fecha: fecha(f["Fecha"]),
      marca: marcaDe(f["Marca"]),
      tipo: txt(f["Tipo"], 40),
      costo: num(f["Costo envío ($)"]),
      estado: txt(f["Estado"], 40),
    }))
    .filter((e) => e.fecha || e.costo);

  return {
    recibidoEn,
    colaboraciones,
    gastos,
    presupuesto,
    envios,
    influencers: lista(h.influencers).filter((f) => txt(f["Nombre"])).length,
  };
}

// ---------------------------------------------------------------------------
// Cuentas para el tablero
// ---------------------------------------------------------------------------

/**
 * A qué canal del tablero va cada concepto de "Otros gastos". La pauta de
 * Meta se marca aparte porque ya viene de la API: sumarla también desde la
 * planilla la contaría dos veces.
 */
export function canalDeConcepto(concepto: string): "Meta Ads" | "Google Ads" | "Influencers" | "Contenido" | "Ferias" {
  const c = concepto.toLowerCase();
  if (/meta|facebook|instagram ads/.test(c) && /pauta/.test(c)) return "Meta Ads";
  if (/google/.test(c)) return "Google Ads";
  if (/feria|stand|evento/.test(c)) return "Ferias";
  if (/influencer|canje/.test(c)) return "Influencers";
  return "Contenido";
}

function diasDelMes(mes: string): number {
  const [a, m] = mes.split("-").map(Number);
  return new Date(Date.UTC(a, m, 0)).getUTCDate();
}

/**
 * Presupuesto de una marca para un período: cada mes cargado aporta la parte
 * de sus días que cae en el período. Un mes calendario entero es su monto;
 * un mes comercial (6 al 5) toma 25 días de uno y 5 del siguiente.
 * `null` si la planilla no tiene presupuesto para ningún mes del período.
 */
export function presupuestoDelPeriodo(
  filas: PresupuestoPlanilla[],
  marca: ClaveMarca,
  desde: string,
  hasta: string,
): number | null {
  let total = 0;
  let hay = false;
  for (const f of filas) {
    if (f.marca !== marca) continue;
    const ini = `${f.mes}-01`;
    const fin = `${f.mes}-${String(diasDelMes(f.mes)).padStart(2, "0")}`;
    const a = ini > desde ? ini : desde;
    const b = fin < hasta ? fin : hasta;
    if (a > b) continue;
    const dias = Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000) + 1;
    total += (f.monto * dias) / diasDelMes(f.mes);
    hay = true;
  }
  return hay ? total : null;
}

export const enPeriodo = (f: string | null, desde: string, hasta: string) => !!f && f >= desde && f <= hasta;
