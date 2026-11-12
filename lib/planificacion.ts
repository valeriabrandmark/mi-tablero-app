/**
 * MARKETING → PLANIFICACIÓN: el modelo y las reglas.
 *
 * Sin `pg`: lo usan la pantalla y la API.
 *
 * ---------------------------------------------------------------------------
 * CÓMO PLANIFICAN LOS EQUIPOS DE MARKETING GRANDES, Y QUÉ SE TOMÓ DE ESO
 *
 * 1. CALENDARIO ANUAL DE MOMENTOS FUERTES (tentpoles). Las fechas que mueven
 *    la venta se fijan una vez al año y se revisan por trimestre. Acá:
 *    `EventoCalendario`, con cuántos días antes hay que empezar.
 *
 * 2. PRIMERO EL BRIEF, DESPUÉS EL CALENDARIO. Cada campaña nace de un brief:
 *    objetivo, KPI y meta, público, canales, presupuesto. Un cambio de
 *    público, mensaje o presupuesto vuelve a pasar por aprobación. Acá: los
 *    campos del brief en `Iniciativa`.
 *
 * 3. PLANIFICACIÓN HACIA ATRÁS DESDE EL LANZAMIENTO. Los hitos se calculan
 *    restando días a la fecha de salida: brief, concepto, producción,
 *    aprobación, configuración, lanzamiento y medición. Acá: las PLANTILLAS,
 *    que arman las subtareas con fechas relativas al lanzamiento.
 *
 * 4. UN RESPONSABLE POR TAREA y estado visible en semáforo (en fecha, en
 *    riesgo, atrasada). Acá: `riesgo()`.
 *
 * 5. MEDICIÓN DESPUÉS DEL LANZAMIENTO. Toda campaña cierra con su resultado
 *    contra el KPI: es lo que alimenta el plan del trimestre siguiente.
 * ---------------------------------------------------------------------------
 */

export type ClaveMarcaPlan = "diaper_genie" | "hola_toys" | "unibrandco" | "litter_genie" | "todas";

export const MARCAS_PLAN: { clave: ClaveMarcaPlan; nombre: string; color: string }[] = [
  { clave: "diaper_genie", nombre: "Diaper Genie", color: "#22d3ee" },
  { clave: "hola_toys", nombre: "Hola Toys", color: "#f472b6" },
  { clave: "unibrandco", nombre: "Unibrandco", color: "#a78bfa" },
  { clave: "litter_genie", nombre: "Litter Genie", color: "#22c55e" },
  { clave: "todas", nombre: "Todas", color: "#94a3b8" },
];

export const nombreMarca = (k: string) => MARCAS_PLAN.find((m) => m.clave === k)?.nombre ?? k;
export const colorMarca = (k: string) => MARCAS_PLAN.find((m) => m.clave === k)?.color ?? "#94a3b8";

export const TIPOS_EVENTO = {
  comercial: "Evento de venta",
  regalo: "Fecha de regalo",
  estacional: "Temporada",
  efemeride: "Efeméride (contenido)",
  feria: "Feria",
  interno: "Interno",
} as const;
export type TipoEvento = keyof typeof TIPOS_EVENTO;

export const TIPOS_INICIATIVA = {
  campana: "Campaña",
  contenido: "Contenido",
  influencer: "Influencer",
  revista: "Revista / catálogo",
  tienda: "Tienda oficial",
  mayorista: "Demanda mayorista",
  feria: "Feria / evento",
  interna: "Interna",
} as const;
export type TipoIniciativa = keyof typeof TIPOS_INICIATIVA;

export const ESTADOS = {
  idea: "Idea",
  planificada: "Planificada",
  en_curso: "En curso",
  en_revision: "En revisión",
  entregada: "Entregada",
  cancelada: "Cancelada",
} as const;
export type Estado = keyof typeof ESTADOS;

export const FASES = {
  brief: "Brief",
  produccion: "Producción",
  aprobacion: "Aprobación",
  lanzamiento: "Lanzamiento",
  medicion: "Medición",
} as const;
export type Fase = keyof typeof FASES;

export const CANALES_PLAN = [
  "Instagram",
  "Facebook",
  "TikTok",
  "Meta Ads",
  "Google Ads",
  "Tienda Nube",
  "Mercado Libre",
  "Influencers",
  "Mailing",
  "WhatsApp",
  "Puntos de venta",
  "Revista",
] as const;

export type EventoCalendario = {
  id: number;
  nombre: string;
  desde: string;
  hasta: string;
  tipo: TipoEvento;
  importancia: 1 | 2 | 3;
  anticipacionDias: number;
  lanzamientoDias: number;
  marcas: string[] | null;
  estimada: boolean;
  nota: string | null;
};

export type Subtarea = {
  id?: number;
  titulo: string;
  fase: Fase;
  responsable: string | null;
  vence: string | null;
  hecha: boolean;
  hechaEn?: string | null;
  orden?: number;
};

export type Iniciativa = {
  id?: number;
  titulo: string;
  marca: ClaveMarcaPlan;
  tipo: TipoIniciativa;
  eventoId: number | null;
  objetivo: string | null;
  kpi: string | null;
  meta: number | null;
  publico: string | null;
  canales: string[];
  presupuesto: number | null;
  gasto: number | null;
  cupon: string | null;
  responsable: string | null;
  inicio: string | null;
  vence: string;
  estado: Estado;
  prioridad: 1 | 2 | 3;
  entregadoEn: string | null;
  resultado: string | null;
  subtareas: Subtarea[];
};

// ---------------------------------------------------------------------------
// Fechas
// ---------------------------------------------------------------------------

export function sumarDiasIso(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

export function diasHasta(desde: string, hasta: string): number {
  return Math.round((Date.parse(`${hasta}T12:00:00Z`) - Date.parse(`${desde}T12:00:00Z`)) / 86_400_000);
}

export function fechaCorta(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
}

/** Cuándo hay que salir al aire para un evento. */
export function lanzamientoDe(e: EventoCalendario): string {
  return sumarDiasIso(e.desde, -e.lanzamientoDias);
}

/** Desde cuándo hay que estar planificando un evento. */
export function inicioPlanificacion(e: EventoCalendario): string {
  return sumarDiasIso(e.desde, -e.anticipacionDias);
}

// ---------------------------------------------------------------------------
// Avance y riesgo
// ---------------------------------------------------------------------------

/** Subtareas hechas / total. Sin subtareas, una iniciativa entregada es 100 % y el resto 0 %. */
export function avance(i: Iniciativa): number {
  if (i.estado === "entregada") return 1;
  if (!i.subtareas.length) return 0;
  return i.subtareas.filter((s) => s.hecha).length / i.subtareas.length;
}

export type Riesgo = "entregada" | "cancelada" | "atrasada" | "en_riesgo" | "en_fecha";

export const RIESGOS: Record<Riesgo, { label: string; color: string }> = {
  entregada: { label: "Entregada", color: "#22c55e" },
  cancelada: { label: "Cancelada", color: "#8b93a1" },
  atrasada: { label: "Atrasada", color: "#f43f5e" },
  en_riesgo: { label: "En riesgo", color: "#f59e0b" },
  en_fecha: { label: "En fecha", color: "#3b82f6" },
};

/**
 * El semáforo. ATRASADA: pasó la fecha y no se entregó, o tiene subtareas
 * vencidas sin hacer. EN RIESGO: el avance va más de 25 puntos por debajo del
 * tiempo consumido (si ya pasó el 60 % del plazo y va por el 30 %, no llega).
 */
export function riesgo(i: Iniciativa, hoy: string): Riesgo {
  if (i.estado === "entregada") return "entregada";
  if (i.estado === "cancelada") return "cancelada";
  if (i.vence < hoy) return "atrasada";
  if (i.subtareas.some((s) => !s.hecha && s.vence && s.vence < hoy)) return "atrasada";
  const inicio = i.inicio ?? i.subtareas.map((s) => s.vence).filter(Boolean).sort()[0] ?? null;
  if (inicio && inicio < hoy) {
    const total = Math.max(1, diasHasta(inicio, i.vence));
    const consumido = Math.min(1, diasHasta(inicio, hoy) / total);
    if (consumido - avance(i) > 0.25) return "en_riesgo";
  }
  return "en_fecha";
}

/** ¿Se entregó a tiempo? null si todavía no se entregó. */
export function aTiempo(i: Iniciativa): boolean | null {
  if (i.estado !== "entregada") return null;
  return !i.entregadoEn || i.entregadoEn <= i.vence;
}

// ---------------------------------------------------------------------------
// Plantillas: planificación hacia atrás desde el lanzamiento
// ---------------------------------------------------------------------------

/** `dias` es relativo a la fecha de lanzamiento (negativo = antes). */
type PasoPlantilla = { titulo: string; fase: Fase; dias: number };

export type Plantilla = {
  clave: string;
  nombre: string;
  tipo: TipoIniciativa;
  descripcion: string;
  kpi?: string;
  canales?: string[];
  pasos: PasoPlantilla[];
};

export const PLANTILLAS: Plantilla[] = [
  {
    clave: "estacional",
    nombre: "Campaña estacional",
    tipo: "campana",
    descripcion: "Para una fecha del calendario (Día del Niño, Navidad, Hot Sale...).",
    kpi: "Venta de la marca en la fecha",
    canales: ["Instagram", "Meta Ads", "Tienda Nube", "Influencers"],
    pasos: [
      { titulo: "Brief aprobado: objetivo, KPI y meta, público, presupuesto", fase: "brief", dias: -45 },
      { titulo: "Promociones y stock acordados con Ana y Alejandro", fase: "brief", dias: -40 },
      { titulo: "Concepto creativo y grilla de piezas", fase: "produccion", dias: -35 },
      { titulo: "Brief al diseñador externo", fase: "produccion", dias: -30 },
      { titulo: "Influencers elegidos y cupones creados", fase: "produccion", dias: -25 },
      { titulo: "Piezas listas: redes, tienda, banners, mailing", fase: "produccion", dias: -15 },
      { titulo: "Aprobación de piezas", fase: "aprobacion", dias: -12 },
      { titulo: "Fichas y banners cargados en las tiendas (Lucila)", fase: "lanzamiento", dias: -5 },
      { titulo: "Pauta configurada en Meta / Google", fase: "lanzamiento", dias: -3 },
      { titulo: "Lanzamiento y publicación", fase: "lanzamiento", dias: 0 },
      { titulo: "Medición: resultado contra el KPI y aprendizajes", fase: "medicion", dias: 14 },
    ],
  },
  {
    clave: "influencer",
    nombre: "Colaboración con influencer",
    tipo: "influencer",
    descripcion: "Con cupón único para medir la venta que genera.",
    kpi: "Venta con el cupón",
    canales: ["Instagram", "Influencers"],
    pasos: [
      { titulo: "Elegir influencer y acordar costo o canje", fase: "brief", dias: -14 },
      { titulo: "Brief para el influencer (mensaje, fechas, do's & don'ts)", fase: "brief", dias: -10 },
      { titulo: "Crear cupón único en Tienda Nube", fase: "produccion", dias: -7 },
      { titulo: "Envío del producto", fase: "produccion", dias: -6 },
      { titulo: "Aprobar el contenido antes de publicar", fase: "aprobacion", dias: -2 },
      { titulo: "Publicación", fase: "lanzamiento", dias: 0 },
      { titulo: "Medir canjes y venta del cupón; costo por venta", fase: "medicion", dias: 7 },
    ],
  },
  {
    clave: "revista",
    nombre: "Revista Brandmark",
    tipo: "revista",
    descripcion: "Entrega antes del día 5. Las ofertas las decide Ana o el papá de Alejandro.",
    kpi: "Entregada a tiempo",
    canales: ["Revista"],
    pasos: [
      { titulo: "Recibir las ofertas decididas", fase: "brief", dias: -10 },
      { titulo: "Armado con la plantilla", fase: "produccion", dias: -7 },
      { titulo: "Revisión de precios y textos", fase: "aprobacion", dias: -3 },
      { titulo: "Entrega", fase: "lanzamiento", dias: 0 },
    ],
  },
  {
    clave: "contenido",
    nombre: "Contenido del mes",
    tipo: "contenido",
    descripcion: "Grilla de 3 publicaciones por semana por marca.",
    kpi: "Publicaciones por semana",
    canales: ["Instagram", "TikTok"],
    pasos: [
      { titulo: "Grilla de contenido del mes", fase: "brief", dias: -10 },
      { titulo: "Producción de fotos y videos", fase: "produccion", dias: -7 },
      { titulo: "Copys y aprobación", fase: "aprobacion", dias: -3 },
      { titulo: "Programación de publicaciones", fase: "lanzamiento", dias: 0 },
      { titulo: "Revisión de alcance e interacción", fase: "medicion", dias: 30 },
    ],
  },
  {
    clave: "feria",
    nombre: "Feria o evento",
    tipo: "feria",
    descripcion: "Presencia de marca y demanda mayorista.",
    kpi: "Leads mayoristas",
    canales: ["Puntos de venta"],
    pasos: [
      { titulo: "Confirmar participación y presupuesto (consultar a Alejandro)", fase: "brief", dias: -45 },
      { titulo: "Diseño del stand y material de venta", fase: "produccion", dias: -25 },
      { titulo: "Producto y logística", fase: "produccion", dias: -10 },
      { titulo: "Evento", fase: "lanzamiento", dias: 0 },
      { titulo: "Seguimiento de leads con los comisionistas", fase: "medicion", dias: 7 },
    ],
  },
  {
    clave: "blanco",
    nombre: "En blanco",
    tipo: "interna",
    descripcion: "Sin subtareas: se cargan a mano.",
    pasos: [],
  },
];

/**
 * Arma una iniciativa con las subtareas fechadas hacia atrás desde el
 * lanzamiento.
 *
 * SI SE PLANIFICA TARDE (pasado `hoy` ya no alcanza el plazo de la
 * plantilla), los pasos previos se COMPRIMEN entre hoy y el lanzamiento en vez
 * de quedar con fechas pasadas: una iniciativa recién creada no puede nacer
 * atrasada. El orden y las proporciones entre pasos se mantienen.
 */
export function desdePlantilla(
  p: Plantilla,
  lanzamiento: string,
  extra: Partial<Iniciativa> = {},
  hoy?: string,
): Iniciativa {
  const necesarios = Math.max(0, ...p.pasos.map((s) => -s.dias));
  const disponibles = hoy ? Math.max(0, diasHasta(hoy, lanzamiento)) : necesarios;
  const escala = necesarios > disponibles ? disponibles / necesarios : 1;
  const subtareas = p.pasos.map((s, orden) => ({
    titulo: s.titulo,
    fase: s.fase,
    responsable: extra.responsable ?? "Agatina",
    vence: sumarDiasIso(lanzamiento, s.dias < 0 ? Math.round(s.dias * escala) : s.dias),
    hecha: false,
    orden,
  }));
  const fechas = subtareas.map((s) => s.vence).sort();
  return {
    titulo: p.nombre,
    marca: "todas",
    tipo: p.tipo,
    eventoId: null,
    objetivo: null,
    kpi: p.kpi ?? null,
    meta: null,
    publico: null,
    canales: p.canales ?? [],
    presupuesto: null,
    gasto: null,
    cupon: null,
    responsable: "Agatina",
    inicio: fechas[0] ?? lanzamiento,
    // La iniciativa "vence" en el lanzamiento: la medición posterior queda
    // como subtarea, pero la entrega es salir a tiempo.
    vence: lanzamiento,
    estado: "planificada",
    prioridad: 2,
    entregadoEn: null,
    resultado: null,
    subtareas,
    ...extra,
  };
}

export function iniciativaVacia(hoy: string): Iniciativa {
  return desdePlantilla(
    PLANTILLAS.find((p) => p.clave === "blanco")!,
    sumarDiasIso(hoy, 14),
    { titulo: "", inicio: hoy },
    hoy,
  );
}
