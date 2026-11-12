/**
 * TABLERO DE MARCA (Agatina) — DATOS DE EJEMPLO.
 *
 * ESTO ES UN PROTOTIPO. Ningún número de este archivo sale de una base: están
 * escritos a mano para ver cómo se lee el tablero antes de montar las fuentes.
 * Lo que SÍ es real son las METAS y los PRESUPUESTOS, que salen del "Acuerdo de
 * rol — Agatina, jefa de marca" (26/10/2026):
 *
 *   Diaper Genie  presupuesto $2MM/mes (nov-dic)    venta objetivo $17MM/mes
 *   Hola Toys     presupuesto $2,5MM/mes (nov-dic)  venta objetivo $10MM/mes
 *   Unibrandco    a definir                          mantenimiento
 *   Tiendas nuevas que abren cuenta: 10 a 15 en noviembre
 *   Influencers 4/mes · pauta todos los días · 3 publicaciones/semana/marca
 *   Campaña de Navidad antes del 15/11 · revista antes del día 5
 *
 * Litter Genie NO está en el acuerdo de rol: se suma porque lo pidió Ana. Se
 * trata como Unibrandco (presupuesto y metas a definir) hasta que se decida.
 *
 * PARA PASARLO A DATOS REALES: cada bloque de acá corresponde a una fila de la
 * planilla mensual que carga Agatina (ver `INDICADORES`, columna `fuente`).
 * Reemplazar este archivo por una query que devuelva la misma forma.
 */

export type ClaveMarca = "diaper_genie" | "hola_toys" | "unibrandco" | "litter_genie";

export type Canal = "Meta Ads" | "Google Ads" | "Influencers" | "Contenido" | "Ferias";
export const CANALES: Canal[] = ["Meta Ads", "Google Ads", "Influencers", "Contenido", "Ferias"];

export type Marca = {
  clave: ClaveMarca;
  nombre: string;
  color: string;
  /** Marca propia (foco del semestre) o en mantenimiento. */
  foco: boolean;
  estado: string;
  /** null = "a definir" en el acuerdo de rol. */
  presupuestoMes: number | null;
  ventaObjetivoMes: number | null;
  /** Margen de referencia, para calcular si la inversión se paga sola. */
  margen: number | null;
  /** Venta del mes previo a que arranque el rol (línea de base). */
  ventaBase: number;

  // ---- Mes en curso (noviembre, al día de corte) ----
  gastoPorCanal: Record<Canal, number>;
  ventaTiendas: number;
  ventaMayorista: number;
  /** Venta diaria de las tiendas + mayorista, día 1 al día de corte. */
  ventaDiaria: number[];
  diasPautaActiva: number;
  publicacionesPorSemana: number[];

  // ---- Nivel 1 · Marca ----
  seguidores: number;
  seguidoresMesAnterior: number;
  alcance30d: number;
  interacciones30d: number;
  mensajes30d: number;
  /** Minutos promedio hasta la primera respuesta. */
  tiempoRespuestaMin: number;
  puntajeTienda: number;
  resenas: number;

  // ---- Nivel 2 · Demanda ----
  visitasTienda: number;
  traficoOrigen: { origen: string; visitas: number }[];
  clicsPauta: number;
  conversionesPauta: number;
  leadsMayoristas: number;

  // ---- Nivel 3 · Venta ----
  pedidosTienda: number;

  /** Ago → nov: inversión y venta, para ver la tendencia del retorno. */
  historia: { mes: string; inversion: number; venta: number }[];
};

const MESES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

/**
 * El día de corte es HOY en Argentina: con datos reales, el ritmo y la
 * proyección tienen que medirse contra el día del mes en que se mira.
 */
function corteDeHoy() {
  const ar = new Date(Date.now() - 3 * 3600_000);
  const anio = ar.getUTCFullYear();
  const mes = ar.getUTCMonth();
  const dia = ar.getUTCDate();
  const dd = String(dia).padStart(2, "0");
  const mm = String(mes + 1).padStart(2, "0");
  return {
    dia,
    diasMes: new Date(Date.UTC(anio, mes + 1, 0)).getUTCDate(),
    mes: `${MESES[mes]} ${anio}`,
    fecha: `${dd}/${mm}/${anio}`,
    mm,
  };
}

export const CORTE = corteDeHoy();

/** Una serie diaria determinista alrededor de un promedio, con picos de campaña. */
function serie(promedio: number, picos: Record<number, number> = {}): number[] {
  const ruido = [0.92, 1.05, 0.88, 1.1, 0.97, 1.02, 0.85, 1.08, 0.95, 1.12, 0.99];
  return Array.from({ length: CORTE.dia }, (_, i) =>
    Math.round(promedio * ruido[i % ruido.length] * (picos[i + 1] ?? 1)),
  );
}

export const MARCAS: Marca[] = [
  {
    clave: "diaper_genie",
    nombre: "Diaper Genie",
    color: "#22d3ee",
    foco: true,
    estado: "Marca propia · foco del semestre",
    presupuestoMes: 2_000_000,
    ventaObjetivoMes: 17_000_000,
    margen: null,
    ventaBase: 10_500_000,
    gastoPorCanal: {
      "Meta Ads": 380_000,
      "Google Ads": 150_000,
      Influencers: 250_000,
      Contenido: 80_000,
      Ferias: 0,
    },
    ventaTiendas: 2_150_000,
    ventaMayorista: 2_870_000,
    // CyberMonday 2 a 4/11.
    ventaDiaria: serie(420_000, { 2: 1.6, 3: 1.45, 4: 1.3 }),
    diasPautaActiva: 11,
    publicacionesPorSemana: [3, 4],
    seguidores: 18_420,
    seguidoresMesAnterior: 17_950,
    alcance30d: 212_000,
    interacciones30d: 9_300,
    mensajes30d: 340,
    tiempoRespuestaMin: 95,
    puntajeTienda: 4.7,
    resenas: 128,
    visitasTienda: 9_800,
    traficoOrigen: [
      { origen: "Pago", visitas: 4_300 },
      { origen: "Redes", visitas: 2_600 },
      { origen: "Orgánico", visitas: 2_100 },
      { origen: "Directo", visitas: 800 },
    ],
    clicsPauta: 6_900,
    conversionesPauta: 74,
    leadsMayoristas: 6,
    pedidosTienda: 118,
    historia: [
      { mes: "Ago", inversion: 1_100_000, venta: 9_800_000 },
      { mes: "Sep", inversion: 1_200_000, venta: 10_200_000 },
      { mes: "Oct", inversion: 1_300_000, venta: 10_500_000 },
      { mes: "Nov*", inversion: 2_000_000, venta: 13_700_000 },
    ],
  },
  {
    clave: "hola_toys",
    nombre: "Hola Toys",
    color: "#f472b6",
    foco: true,
    estado: "Marca propia · foco del semestre",
    presupuestoMes: 2_500_000,
    ventaObjetivoMes: 10_000_000,
    margen: 0.286,
    ventaBase: 6_200_000,
    gastoPorCanal: {
      "Meta Ads": 420_000,
      "Google Ads": 110_000,
      Influencers: 400_000,
      Contenido: 120_000,
      Ferias: 0,
    },
    ventaTiendas: 1_980_000,
    ventaMayorista: 1_420_000,
    // CyberMonday + la publicación de influencer del 8/11.
    ventaDiaria: serie(270_000, { 2: 1.5, 3: 1.4, 8: 2.1, 9: 1.7 }),
    diasPautaActiva: 10,
    publicacionesPorSemana: [3, 2],
    seguidores: 25_300,
    seguidoresMesAnterior: 23_900,
    alcance30d: 340_000,
    interacciones30d: 16_800,
    mensajes30d: 510,
    tiempoRespuestaMin: 140,
    puntajeTienda: 4.6,
    resenas: 86,
    visitasTienda: 12_400,
    traficoOrigen: [
      { origen: "Pago", visitas: 4_900 },
      { origen: "Redes", visitas: 4_800 },
      { origen: "Orgánico", visitas: 1_900 },
      { origen: "Directo", visitas: 800 },
    ],
    clicsPauta: 8_200,
    conversionesPauta: 96,
    leadsMayoristas: 5,
    pedidosTienda: 141,
    historia: [
      { mes: "Ago", inversion: 900_000, venta: 5_600_000 },
      { mes: "Sep", inversion: 1_000_000, venta: 5_900_000 },
      { mes: "Oct", inversion: 1_100_000, venta: 6_200_000 },
      { mes: "Nov*", inversion: 2_500_000, venta: 9_300_000 },
    ],
  },
  {
    clave: "unibrandco",
    nombre: "Unibrandco",
    color: "#a78bfa",
    foco: false,
    estado: "Mantenimiento · presupuesto a definir",
    presupuestoMes: null,
    ventaObjetivoMes: null,
    margen: null,
    ventaBase: 4_100_000,
    gastoPorCanal: {
      "Meta Ads": 60_000,
      "Google Ads": 40_000,
      Influencers: 0,
      Contenido: 20_000,
      Ferias: 0,
    },
    ventaTiendas: 1_350_000,
    ventaMayorista: 0,
    ventaDiaria: serie(123_000, { 2: 1.4, 3: 1.3 }),
    diasPautaActiva: 7,
    publicacionesPorSemana: [2, 2],
    seguidores: 9_100,
    seguidoresMesAnterior: 9_050,
    alcance30d: 41_000,
    interacciones30d: 1_200,
    mensajes30d: 95,
    tiempoRespuestaMin: 180,
    puntajeTienda: 4.4,
    resenas: 212,
    visitasTienda: 5_600,
    traficoOrigen: [
      { origen: "Pago", visitas: 1_200 },
      { origen: "Redes", visitas: 600 },
      { origen: "Orgánico", visitas: 2_900 },
      { origen: "Directo", visitas: 900 },
    ],
    clicsPauta: 1_300,
    conversionesPauta: 18,
    leadsMayoristas: 0,
    pedidosTienda: 61,
    historia: [
      { mes: "Ago", inversion: 150_000, venta: 4_300_000 },
      { mes: "Sep", inversion: 150_000, venta: 4_000_000 },
      { mes: "Oct", inversion: 120_000, venta: 4_100_000 },
      { mes: "Nov*", inversion: 330_000, venta: 3_700_000 },
    ],
  },
  {
    clave: "litter_genie",
    nombre: "Litter Genie",
    color: "#22c55e",
    foco: false,
    estado: "Sin definir en el acuerdo de rol",
    presupuestoMes: null,
    ventaObjetivoMes: null,
    margen: null,
    ventaBase: 2_300_000,
    gastoPorCanal: {
      "Meta Ads": 80_000,
      "Google Ads": 30_000,
      Influencers: 0,
      Contenido: 25_000,
      Ferias: 0,
    },
    ventaTiendas: 610_000,
    ventaMayorista: 340_000,
    ventaDiaria: serie(86_000, { 2: 1.3 }),
    diasPautaActiva: 9,
    publicacionesPorSemana: [1, 2],
    seguidores: 4_250,
    seguidoresMesAnterior: 4_100,
    alcance30d: 38_000,
    interacciones30d: 1_650,
    mensajes30d: 60,
    tiempoRespuestaMin: 160,
    puntajeTienda: 4.8,
    resenas: 34,
    visitasTienda: 2_900,
    traficoOrigen: [
      { origen: "Pago", visitas: 1_100 },
      { origen: "Redes", visitas: 500 },
      { origen: "Orgánico", visitas: 1_000 },
      { origen: "Directo", visitas: 300 },
    ],
    clicsPauta: 1_500,
    conversionesPauta: 14,
    leadsMayoristas: 1,
    pedidosTienda: 29,
    historia: [
      { mes: "Ago", inversion: 100_000, venta: 2_100_000 },
      { mes: "Sep", inversion: 120_000, venta: 2_200_000 },
      { mes: "Oct", inversion: 110_000, venta: 2_300_000 },
      { mes: "Nov*", inversion: 370_000, venta: 2_600_000 },
    ],
  },
];

export type Colaboracion = {
  marca: ClaveMarca;
  influencer: string;
  fecha: string;
  cupon: string;
  costo: number;
  canjes: number;
  ventaAtribuida: number;
};

/**
 * Colaboraciones del mes. Los nombres son genéricos a propósito: es un
 * prototipo. La primera tarea del acuerdo de rol es medir lo que costó la
 * colaboración que generó $5MM en dos días para Hola Toys, porque fija el
 * costo de adquisición de referencia.
 */
export const COLABORACIONES: Colaboracion[] = [
  { marca: "hola_toys", influencer: "Influencer A", fecha: "08/11", cupon: "HOLA-A10", costo: 250_000, canjes: 41, ventaAtribuida: 1_640_000 },
  { marca: "hola_toys", influencer: "Influencer B", fecha: "04/11", cupon: "HOLA-B10", costo: 150_000, canjes: 9, ventaAtribuida: 310_000 },
  { marca: "diaper_genie", influencer: "Influencer C", fecha: "06/11", cupon: "DG-C10", costo: 250_000, canjes: 22, ventaAtribuida: 980_000 },
];

export const META_INFLUENCERS_MES = 4;
export const META_PUBLICACIONES_SEMANA = 3;
export const META_TIENDAS_NUEVAS = { min: 10, max: 15 };
export const TIENDAS_NUEVAS_MES = 4;

export type EstadoHito = "hecho" | "en_curso" | "pendiente" | "atrasado";

export type Hito = {
  que: string;
  marca: ClaveMarca | "todas";
  /** Fecha comprometida, dd/mm. */
  vence: string;
  /** Fecha real de entrega, si ya se entregó. */
  entregado?: string;
  estado: EstadoHito;
  responsable: string;
  presupuesto?: number;
  /** Entregada en fecha. En el ejemplo, toda entrega es a tiempo. */
  aTiempo?: boolean;
  /** Avance por subtareas (0 a 1), cuando viene de Planificación. */
  avance?: number;
};

/** Deadlines del período: campañas, revista y el plan de los primeros 60 días. */
export const HITOS: Hito[] = [
  { que: "Revista Brandmark — edición noviembre", marca: "todas", vence: "05/11", entregado: "04/11", estado: "hecho", responsable: "Agatina" },
  { que: "CyberMonday — piezas y pauta", marca: "todas", vence: "02/11", entregado: "01/11", estado: "hecho", responsable: "Agatina", presupuesto: 600_000 },
  { que: "Campaña de Navidad planificada y publicada", marca: "todas", vence: "15/11", estado: "en_curso", responsable: "Agatina", presupuesto: 1_400_000 },
  { que: "Cupón único por influencer en Tienda Nube", marca: "todas", vence: "25/11", estado: "en_curso", responsable: "Agatina" },
  { que: "Verificar Google Analytics en las 3 tiendas", marca: "todas", vence: "25/11", estado: "pendiente", responsable: "Agatina" },
  { que: "Acceso directo a Meta Ads y Google Ads", marca: "todas", vence: "25/11", entregado: "05/11", estado: "hecho", responsable: "Agatina" },
  { que: "Planilla de leads mayoristas", marca: "todas", vence: "25/11", estado: "en_curso", responsable: "Agatina" },
  { que: "Medir costo de la colaboración de $5MM (CAC de referencia)", marca: "hola_toys", vence: "08/11", estado: "atrasado", responsable: "Agatina" },
  { que: "Línea de base de indicadores nivel 1 y 3", marca: "todas", vence: "25/11", estado: "en_curso", responsable: "Agatina" },
  { que: "Revista Brandmark — edición diciembre", marca: "todas", vence: "05/12", estado: "pendiente", responsable: "Agatina" },
  { que: "Kit de venta mayorista Diaper Genie", marca: "diaper_genie", vence: "25/12", estado: "pendiente", responsable: "Agatina" },
  { que: "Kit de venta mayorista Hola Toys", marca: "hola_toys", vence: "25/12", estado: "pendiente", responsable: "Agatina" },
  { que: "Metas numéricas por indicador sobre la línea de base", marca: "todas", vence: "25/12", estado: "pendiente", responsable: "Agatina + Ana" },
];

export type EstadoFuente = "listo" | "verificar" | "montar";

export type Indicador = {
  nivel: 1 | 2 | 3;
  nombre: string;
  formula: string;
  fuente: string;
  estado: EstadoFuente;
};

/**
 * Los KPIs del acuerdo de rol, más los que se sumaron para medirla (marcados
 * con "+" en la fórmula). El nivel 3 es el que importa; los otros dos explican
 * por qué sube o baja.
 */
export const INDICADORES: Indicador[] = [
  { nivel: 1, nombre: "Seguidores por cuenta", formula: "Captura mensual, mismo día", fuente: "Instagram Insights", estado: "listo" },
  { nivel: 1, nombre: "Alcance y visualizaciones", formula: "Vista de 30 días", fuente: "Instagram Insights", estado: "listo" },
  { nivel: 1, nombre: "Tasa de interacción +", formula: "Interacciones ÷ alcance", fuente: "Instagram Insights", estado: "listo" },
  { nivel: 1, nombre: "Mensajes recibidos y tiempo de respuesta", formula: "Conteo semanal · minutos a 1ª respuesta", fuente: "Bandeja Instagram / Tienda Nube", estado: "listo" },
  { nivel: 1, nombre: "Puntaje y reseñas de tiendas", formula: "Lectura mensual", fuente: "Panel Tienda Nube", estado: "listo" },
  { nivel: 2, nombre: "Visitas por tienda", formula: "Sesiones del mes", fuente: "Google Analytics", estado: "verificar" },
  { nivel: 2, nombre: "Origen del tráfico", formula: "Informe de adquisición", fuente: "Google Analytics", estado: "verificar" },
  { nivel: 2, nombre: "Inversión, clics y CPC de pauta (Meta)", formula: "Inversión ÷ clics, día por día", fuente: "API de Meta Ads (automático)", estado: "listo" },
  { nivel: 2, nombre: "Inversión, clics y CPC de pauta (Google)", formula: "Inversión ÷ clics", fuente: "Google Ads", estado: "listo" },
  { nivel: 2, nombre: "Días con pauta activa +", formula: "Días con gasto > 0 en Meta", fuente: "API de Meta Ads (automático)", estado: "listo" },
  { nivel: 2, nombre: "Alcance, frecuencia, CTR y CPM de pauta +", formula: "Insights por campaña", fuente: "API de Meta Ads (automático)", estado: "listo" },
  { nivel: 3, nombre: "Compras y ROAS atribuidos a Meta +", formula: "Valor de compras del píxel ÷ inversión", fuente: "API de Meta Ads (requiere píxel en las tiendas)", estado: "verificar" },
  { nivel: 2, nombre: "Ventas por influencer", formula: "Canjes del cupón único", fuente: "Cupones Tienda Nube", estado: "montar" },
  { nivel: 2, nombre: "Leads mayoristas nuevos", formula: "Consultas registradas: origen, fecha, estado", fuente: "Planilla de leads", estado: "montar" },
  { nivel: 3, nombre: "Venta de tiendas oficiales por marca", formula: "Informe de ventas filtrado", fuente: "Panel Tienda Nube", estado: "listo" },
  { nivel: 3, nombre: "Conversión de cada tienda", formula: "Pedidos ÷ visitas", fuente: "Tienda Nube + Analytics", estado: "verificar" },
  { nivel: 3, nombre: "Ticket promedio", formula: "Venta ÷ pedidos", fuente: "Panel Tienda Nube", estado: "listo" },
  { nivel: 3, nombre: "Venta mayorista de marcas propias", formula: "DG y Hola Toys a tiendas", fuente: "SIGMA", estado: "listo" },
  { nivel: 3, nombre: "Costo de adquisición (CAC)", formula: "(Pauta + influencers) ÷ pedidos atribuidos", fuente: "Cálculo mensual", estado: "montar" },
  { nivel: 3, nombre: "Retorno de la inversión (ROAS / MER) +", formula: "Venta ÷ inversión de marketing", fuente: "Cálculo mensual", estado: "listo" },
  { nivel: 3, nombre: "Ejecución de presupuesto +", formula: "Gastado ÷ asignado vs. % del mes", fuente: "Planilla de gastos", estado: "listo" },
  { nivel: 3, nombre: "Entregas a tiempo (revista y campañas)", formula: "Entregadas en fecha ÷ comprometidas", fuente: "Checklist de entregas", estado: "listo" },
];

// ---------------------------------------------------------------------------
// Cálculos
// ---------------------------------------------------------------------------

export function gastoTotal(m: Marca): number {
  return CANALES.reduce((s, c) => s + m.gastoPorCanal[c], 0);
}

export function ventaTotal(m: Marca): number {
  return m.ventaTiendas + m.ventaMayorista;
}

/** Proyección lineal al cierre de mes según el ritmo de lo que va. */
export function proyectar(valorAlCorte: number): number {
  return (valorAlCorte / CORTE.dia) * CORTE.diasMes;
}

/**
 * Venta acumulada día a día. La serie diaria da la FORMA (picos de campaña) y
 * se escala para que el acumulado cierre exactamente con la venta del mes.
 */
export function ventaAcumulada(m: Marca): number[] {
  const bruto = m.ventaDiaria.reduce((s, v) => s + v, 0);
  const factor = bruto > 0 ? ventaTotal(m) / bruto : 0;
  let acc = 0;
  return m.ventaDiaria.map((v) => (acc += v * factor));
}

/** Fracción del mes transcurrida: el ritmo "esperado" de gasto y venta. */
export const AVANCE_MES = CORTE.dia / CORTE.diasMes;
