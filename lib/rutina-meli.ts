/**
 * La rutina del responsable de Mercado Libre: la planilla de papel, pasada a
 * "Mis tareas".
 *
 * ---------------------------------------------------------------------------
 * LA MISMA PLANILLA, CON LOS MISMOS TRES ESTADOS
 *
 * En papel cada casillero tenía un tilde (hecho), una raya (no correspondía)
 * o un punto (quedó pendiente). Acá es igual, con una diferencia que es la
 * razón de pasarla: el punto no se escribe. Un casillero de un día que ya
 * pasó y quedó vacío ES el pendiente, y eso es lo que deja medir cuánto de la
 * rutina se cumple sin depender de que alguien se acuerde de anotar lo que
 * no hizo.
 *
 * Las notas también son las del papel: "HOLA cuotas", "GOGZ 9020", "20/30".
 *
 * ---------------------------------------------------------------------------
 * QUÉ SE GUARDA
 *
 * Una fila por casillero marcado en `app.tareas_meli_rutina` (ver
 * migraciones/tareas_meli_rutina.sql). Los días no laborables van como una
 * tarea más, `FERIADO`, para que no cuenten como incumplidos.
 */

/**
 * Cuándo corresponde cada tarea.
 *
 *   diaria     de lunes a viernes. `veces` es cuántas por día: "Controlar
 *              dashboard" tenía tres casilleros por día en la planilla.
 *   mensual    un día fijo del mes. Si cae sábado o domingo, el viernes
 *              anterior: así siempre queda dentro del mes.
 *   evento     no tiene día: aparece cuando pasa algo. Se lista para que se
 *              vea que existe, pero no suma ni resta en el cumplimiento.
 */
export type Frecuencia =
  | { tipo: "diaria"; veces?: number }
  | { tipo: "mensual"; dia: number }
  | { tipo: "evento"; cuando: string };

export type TareaRutina = {
  clave: string;
  label: string;
  frecuencia: Frecuencia;
  /** Si sale de una alerta de la bandeja, cuál: el casillero muestra cuántas hay pendientes. */
  alerta?: "riesgo_descarte";
};

/**
 * Las tareas, en el orden de la planilla. La `clave` es lo que se guarda en
 * la base: el `label` se puede cambiar libremente, la clave no (los tildes
 * viejos quedarían huérfanos).
 *
 * TODAS ARRANCAN DIARIAS menos las dos que la planilla dice que no lo son.
 * Para cambiar la frecuencia de una, se cambia acá.
 */
export const TAREAS_RUTINA: TareaRutina[] = [
  { clave: "controlar_dashboard", label: "Controlar dashboard", frecuencia: { tipo: "diaria", veces: 3 } },
  { clave: "actualizar_margenes", label: "Actualizar márgenes", frecuencia: { tipo: "diaria" } },
  { clave: "facturar_ventas", label: "Facturar ventas", frecuencia: { tipo: "diaria" } },
  { clave: "actualizar_costos", label: "Actualización de costos", frecuencia: { tipo: "diaria" } },
  {
    clave: "estrategias_sic_tst",
    label: "Cambio estrategias SIC/TST",
    frecuencia: { tipo: "evento", cuando: "cuando hay un cambio de precios en la base general" },
  },
  { clave: "antiguedad_meli", label: "Actualizar antigüedad Meli", frecuencia: { tipo: "diaria" } },
  { clave: "metricas_stock_full", label: "Controlar métricas stock Full", frecuencia: { tipo: "diaria" } },
  { clave: "envio_meli", label: "Crear/cargar envío Meli", frecuencia: { tipo: "diaria" } },
  { clave: "etiquetado_envios", label: "Crear archivo etiquetado envíos", frecuencia: { tipo: "diaria" } },
  { clave: "ajustar_envio_satisfecho", label: "Ajustar envío Meli c/satisfecho", frecuencia: { tipo: "diaria" } },
  { clave: "diferencias_envios", label: "Diferencias en envíos entregados", frecuencia: { tipo: "diaria" } },
  { clave: "pausadas_stock_full", label: "Pausadas c/stock Full", frecuencia: { tipo: "diaria" } },
  { clave: "control_retiros", label: "Control de retiros", frecuencia: { tipo: "diaria" } },
  { clave: "promociones_automaticas", label: "Sacar promociones automáticas", frecuencia: { tipo: "diaria" } },
  { clave: "publicidad_ads", label: "Publicidad Ads", frecuencia: { tipo: "diaria" } },
  {
    clave: "evitar_descarte",
    label: "Para evitar descarte",
    frecuencia: { tipo: "diaria" },
    alerta: "riesgo_descarte",
  },
  { clave: "stock_antiguo", label: "Stock antiguo", frecuencia: { tipo: "mensual", dia: 28 } },
];

/**
 * Desde qué día se mide. Antes, un casillero vacío no es un pendiente: la
 * planilla no existía y lo que se hizo quedó en papel. Se puede completar
 * igual, pero lo que quede vacío no resta.
 */
export const INICIO_RUTINA = "2026-10-26";

/** La "tarea" que marca un día entero como no laborable. */
export const FERIADO = "feriado";

export const ESTADOS_RUTINA = ["hecho", "no_correspondia"] as const;
export type EstadoRutina = (typeof ESTADOS_RUTINA)[number];

export function tareaRutina(clave: string): TareaRutina | null {
  return TAREAS_RUTINA.find((t) => t.clave === clave) ?? null;
}

/** Cuántos casilleros tiene la tarea en un día (0 si ese día no corresponde). */
export function vecesEnDia(t: TareaRutina, fecha: string): number {
  const f = t.frecuencia;
  if (!esDiaHabil(fecha)) return 0;
  if (f.tipo === "diaria") return f.veces ?? 1;
  if (f.tipo === "mensual") return fecha === diaMensual(fecha, f.dia) ? 1 : 0;
  return 0;
}

// ---------------------------------------------------------------------------
// FECHAS. Siempre como 'YYYY-MM-DD' y en hora argentina: en Vercel el servidor
// corre en UTC, y entre las 21 y las 24 marcaría el día siguiente.
// ---------------------------------------------------------------------------

export function hoyAR(ahora: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(ahora);
}

/** Para hacer cuentas con fechas sin que se meta ningún huso horario. */
function aUTC(fecha: string): Date {
  return new Date(`${fecha}T00:00:00Z`);
}

function aTexto(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function sumarDias(fecha: string, dias: number): string {
  const d = aUTC(fecha);
  d.setUTCDate(d.getUTCDate() + dias);
  return aTexto(d);
}

/** 1 = lunes … 7 = domingo. */
function diaSemana(fecha: string): number {
  return aUTC(fecha).getUTCDay() || 7;
}

function esDiaHabil(fecha: string): boolean {
  return diaSemana(fecha) <= 5;
}

/** El lunes de la semana de `fecha`. */
export function lunesDe(fecha: string): string {
  return sumarDias(fecha, 1 - diaSemana(fecha));
}

/** Los cinco días hábiles de la semana que arranca en `lunes`. */
export function diasDeSemana(lunes: string): string[] {
  return [0, 1, 2, 3, 4].map((i) => sumarDias(lunes, i));
}

/** El día `dia` del mes de `fecha`, corrido al viernes anterior si cae en fin de semana. */
function diaMensual(fecha: string, dia: number): string {
  let d = `${fecha.slice(0, 8)}${String(dia).padStart(2, "0")}`;
  while (!esDiaHabil(d)) d = sumarDias(d, -1);
  return d;
}

export function esFecha(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(aUTC(v).getTime());
}

// ---------------------------------------------------------------------------
// TIPOS Y CUMPLIMIENTO
// ---------------------------------------------------------------------------

export type MarcaRutina = {
  fecha: string;
  tarea: string;
  vez: number;
  estado: EstadoRutina;
  nota: string | null;
  usuario: string;
  actualizadoEn: string;
};

export type DashboardRutinaMeli = {
  lunes: string;
  hoy: string;
  marcas: MarcaRutina[];
  /** `false` si la tabla todavía no existe en la base (falta la migración). */
  disponible: boolean;
};

export type Cumplimiento = {
  /** Casilleros que correspondían, de días ya empezados y no feriados. */
  esperados: number;
  hechos: number;
  noCorrespondia: number;
  /**
   * Lo que quedó vacío en un día que ya pasó. Hoy no cuenta: el día no
   * terminó. Antes de INICIO_RUTINA tampoco.
   */
  pendientes: number;
};

/**
 * El cumplimiento de un conjunto de días. "No correspondía" cuenta como
 * cumplido: es una respuesta, y la planilla la usaba así (la raya era "lo
 * miré y no había nada que hacer").
 */
export function cumplimiento(
  dias: string[],
  hoy: string,
  marcas: MarcaRutina[],
  tareas: TareaRutina[] = TAREAS_RUTINA,
): Cumplimiento {
  const c: Cumplimiento = { esperados: 0, hechos: 0, noCorrespondia: 0, pendientes: 0 };
  const clave = (m: { fecha: string; tarea: string; vez: number }) => `${m.fecha}|${m.tarea}|${m.vez}`;
  const porClave = new Map(marcas.map((m) => [clave(m), m]));
  const feriados = new Set(marcas.filter((m) => m.tarea === FERIADO).map((m) => m.fecha));

  for (const fecha of dias) {
    if (fecha > hoy || feriados.has(fecha)) continue;
    for (const t of tareas) {
      for (let vez = 1; vez <= vecesEnDia(t, fecha); vez++) {
        const m = porClave.get(clave({ fecha, tarea: t.clave, vez }));
        if (m?.estado === "hecho") c.hechos++;
        else if (m?.estado === "no_correspondia") c.noCorrespondia++;
        else if (fecha < hoy && fecha >= INICIO_RUTINA) c.pendientes++;
        else continue; // hoy y todavía vacío: ni cumplido ni incumplido
        c.esperados++;
      }
    }
  }
  return c;
}
