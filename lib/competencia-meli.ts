/**
 * Reglas de "Mercado Libre — Competencia".
 *
 * ---------------------------------------------------------------------------
 * DE DÓNDE SALE CADA NÚMERO
 *
 *   Precio para ganar   Mercado Libre, `/items/{id}/price_to_win`. Es el mismo
 *                       dato que usa Foxie para repreciar: su API no lo expone,
 *                       así que se pide directo (tablero_quo/ml_competencia.py).
 *   Comisión            Mercado Libre, `listing_prices`, al precio actual y al
 *                       precio para ganar. Se guarda con IVA y acá se le saca,
 *                       igual que hace modelo.py con `sale_fee` de la venta.
 *   Costo y ofertas     `bronze.costos_historicos`, el último tramo vigente: el
 *                       mismo costo que el resto del tablero.
 *   Envío               lo que pagamos por unidad en las ventas de los últimos
 *                       60 días del SKU. Si no vendió, el que calcula Foxie.
 *   Impuestos           IIBB + cheque + municipal (lib/impuestos.ts).
 *
 * La rentabilidad se calcula como en el resto de Mercado Libre:
 *
 *   venta s/IVA − costo − comisión − envío − impuestos
 *
 * y el margen sobre el precio CON IVA, que es el denominador de la sección.
 * ---------------------------------------------------------------------------
 */

import { CARGA_IMPOSITIVA } from "@/lib/impuestos";

/** El IVA con el que ML nos factura la comisión. */
const IVA_COMISION = 1.21;

/** Días de ventas con los que se promedia el envío por unidad. */
export const DIAS_ENVIO = 60;

/**
 * Diferencia a partir de la cual el costo de Foxie se marca como distinto del
 * nuestro. Menos que esto es redondeo o un tramo que cambió hace horas.
 */
export const TOLERANCIA_COSTO_FOXIE = 0.05;

/** Lo que llega de la base, una fila por publicación de catálogo nuestra. */
export type FilaCompetenciaBase = {
  itemId: string;
  sku: string | null;
  producto: string | null;
  marca: string | null;
  proveedor: string | null;
  catalogProductId: string | null;
  logistica: string | null;
  estado: string | null;
  precioActual: number | null;
  precioParaGanar: number | null;
  visibilidad: string | null;
  compartenPrimerLugar: number | null;
  ganadorItemId: string | null;
  ganadorPrecio: number | null;
  ganadorApodo: string | null;
  boosts: Boost[];
  ganadorBoosts: Boost[];
  motivos: string[];
  error: string | null;
  comisionActual: number | null;
  comisionGanar: number | null;
  comisionPct: number | null;
  comisionFija: number | null;
  ivaPct: number;
  costo: number | null;
  costoTeorico: number | null;
  ofertaProvPct: number | null;
  ofertaPropiaPct: number | null;
  envioUnidad: number | null;
  envioFuente: "ventas" | "foxie" | null;
  costoFoxie: number | null;
  rivales: number;
};

export type Boost = { id: string; status: string };

/** Cómo queda una venta a un precio dado. Todo por unidad. */
export type Desglose = {
  precio: number;
  iva: number;
  ventaSiva: number;
  comision: number;
  /** true cuando la comisión se estimó con el % y el fijo, no la dio ML. */
  comisionEstimada: boolean;
  costo: number;
  envio: number;
  impuestos: number;
  neta: number;
  /** Sobre el precio con IVA. */
  margenPct: number;
};

export type FilaCompetencia = FilaCompetenciaBase & {
  grupo: ClaveGrupo;
  /** Cuánto hay que bajar para ganar, en pesos y en % del precio actual. */
  bajar: number | null;
  bajarPct: number | null;
  actual: Desglose | null;
  ganar: Desglose | null;
  /** El precio más bajo que no pierde plata (aproximado). */
  equilibrio: number | null;
  /** Costo de Foxie contra el nuestro: (foxie − nuestro) / nuestro. */
  difCostoFoxie: number | null;
};

export const GRUPOS = [
  {
    clave: "no_competible",
    titulo: "No se puede competir sin perder",
    detalle:
      "Al precio que gana la caja, la venta no cubre costo, comisión, envío e impuestos. " +
      "Bajar es vender a pérdida. Acá la diferencia no está en el precio: hay que mirar " +
      "costo, oferta del proveedor o si conviene estar en esta publicación.",
    tono: "critico",
  },
  {
    clave: "puede_ganar",
    titulo: "Se puede ganar bajando",
    detalle:
      "Hay que bajar para ganar la caja, y a ese precio todavía queda ganancia. Es lo " +
      "que Foxie debería estar haciendo solo: si sigue acá, revisar su piso.",
    tono: "aviso",
  },
  {
    clave: "comparte",
    titulo: "Compartiendo el primer lugar",
    detalle:
      "Mismo precio que otro vendedor: ML reparte las visitas. Un peso menos alcanza " +
      "para quedarse con la caja entera.",
    tono: "aviso",
  },
  {
    clave: "ganando",
    titulo: "Ganando la caja",
    detalle: "Somos la opción que ve el comprador. El margen de abajo es lo que queda hoy.",
    tono: "ok",
  },
  {
    clave: "sin_costo",
    titulo: "Sin costo cargado",
    detalle:
      "Se sabe el precio para ganar pero no se puede decir si conviene: el SKU no " +
      "tiene costo en la lista de costos, o la publicación no tiene SKU.",
    tono: "neutro",
  },
  {
    clave: "sin_dato",
    titulo: "Sin dato de Mercado Libre",
    detalle:
      "ML no informó precio para ganar: publicación sin competencia, recién creada, " +
      "o la consulta falló en la última corrida.",
    tono: "neutro",
  },
] as const;

export type ClaveGrupo = (typeof GRUPOS)[number]["clave"];

/** Los nombres de los boosts que usa Mercado Libre en price_to_win. */
export const NOMBRES_BOOST: Record<string, string> = {
  fulfillment: "Full",
  free_shipping: "Envío gratis",
  same_day_shipping: "Envío en el día",
  shipping_collect: "Colecta",
  free_installments: "Cuotas sin interés",
  installments: "Cuotas",
  official_store: "Tienda oficial",
  reputation: "Reputación",
  price: "Precio",
};

export const NOMBRES_MOTIVO: Record<string, string> = {
  non_trusted_seller: "Reputación insuficiente",
  manufacturing_time: "Tiene demora de despacho",
  temporarily_winning_manufacturing_time: "Gana temporalmente con demora de despacho",
  temporarily_competing_manufacturing_time: "Compite temporalmente con demora de despacho",
  winner_has_better_reputation: "El ganador tiene mejor reputación",
  item_paused: "Publicación pausada",
  item_not_active: "Publicación inactiva",
  shipping_not_free: "Sin envío gratis",
};

/**
 * La comisión a un precio: la que dio ML si está, si no estimada con el % y
 * el cargo fijo que ML informó para el precio actual.
 */
function comisionA(
  f: FilaCompetenciaBase,
  precio: number,
  informada: number | null,
): { valor: number; estimada: boolean } | null {
  if (informada != null) return { valor: informada / IVA_COMISION, estimada: false };
  if (f.comisionPct == null) return null;
  const conIva = (precio * f.comisionPct) / 100 + (f.comisionFija ?? 0);
  return { valor: conIva / IVA_COMISION, estimada: true };
}

export function desglosar(
  f: FilaCompetenciaBase,
  precio: number | null,
  comisionInformada: number | null,
): Desglose | null {
  if (precio == null || precio <= 0 || f.costo == null) return null;
  const com = comisionA(f, precio, comisionInformada);
  if (!com) return null;
  const ventaSiva = precio / (1 + f.ivaPct / 100);
  const envio = f.envioUnidad ?? 0;
  const impuestos = ventaSiva * CARGA_IMPOSITIVA;
  const neta = ventaSiva - f.costo - com.valor - envio - impuestos;
  return {
    precio,
    iva: precio - ventaSiva,
    ventaSiva,
    comision: com.valor,
    comisionEstimada: com.estimada,
    costo: f.costo,
    envio,
    impuestos,
    neta,
    margenPct: neta / precio,
  };
}

/**
 * El precio con IVA en el que la rentabilidad neta da cero.
 *
 * Es APROXIMADO: supone el mismo % de comisión y el mismo cargo fijo que al
 * precio actual, y el mismo envío. ML cambia el cargo fijo y el envío gratis
 * por tramos de precio, así que cerca de un corte puede errar unos pesos.
 */
export function precioEquilibrio(f: FilaCompetenciaBase): number | null {
  if (f.costo == null || f.comisionPct == null) return null;
  const porPeso =
    (1 - CARGA_IMPOSITIVA) / (1 + f.ivaPct / 100) - f.comisionPct / 100 / IVA_COMISION;
  if (porPeso <= 0) return null;
  const fijo = f.costo + (f.envioUnidad ?? 0) + (f.comisionFija ?? 0) / IVA_COMISION;
  return fijo / porPeso;
}

export function clasificar(f: FilaCompetenciaBase): FilaCompetencia {
  const actual = desglosar(f, f.precioActual, f.comisionActual);
  const ganando = f.estado === "winning";
  // Ganando, el precio para ganar ES el actual (ML a veces lo informa igual).
  const precioGanar = ganando ? f.precioActual : f.precioParaGanar;
  const ganar = ganando ? actual : desglosar(f, precioGanar, f.comisionGanar);

  const bajar =
    f.precioActual != null && precioGanar != null && !ganando
      ? f.precioActual - precioGanar
      : null;

  let grupo: ClaveGrupo;
  if (ganando) grupo = "ganando";
  else if (f.estado === "sharing_first_place") grupo = "comparte";
  else if (f.error || precioGanar == null) grupo = "sin_dato";
  else if (!ganar) grupo = "sin_costo";
  else grupo = ganar.neta < 0 ? "no_competible" : "puede_ganar";

  return {
    ...f,
    grupo,
    bajar,
    bajarPct: bajar != null && f.precioActual ? bajar / f.precioActual : null,
    actual,
    ganar,
    equilibrio: precioEquilibrio(f),
    difCostoFoxie:
      f.costoFoxie != null && f.costo ? (f.costoFoxie - f.costo) / f.costo : null,
  };
}

/** Un competidor en el producto de catálogo. */
export type Rival = {
  itemId: string;
  sellerId: string | null;
  apodo: string | null;
  reputacion: string | null;
  medalla: string | null;
  ventasTotales: number | null;
  propia: boolean;
  precio: number | null;
  precioOriginal: number | null;
  tipoPublicacion: string | null;
  logistica: string | null;
  envioGratis: boolean | null;
  tiendaOficial: boolean;
};

export const NOMBRES_LOGISTICA: Record<string, string> = {
  fulfillment: "Full",
  cross_docking: "Colecta",
  xd_drop_off: "Places",
  drop_off: "Correo",
  self_service: "Flex",
  default: "Propio",
};
