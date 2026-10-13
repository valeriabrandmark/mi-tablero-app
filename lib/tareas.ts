/**
 * El organizador de tareas (/tareas): tipos, validación, resumen y sugerencias.
 *
 * Este archivo no toca la base ni el navegador, así que lo usan las dos
 * puntas --la ruta de API para validar, la pantalla para resumir-- y se prueba
 * sin nada levantado (pruebas/tareas.mts).
 *
 * La base está en migraciones/tareas.sql. Ahí vive lo que tiene que pasar
 * aunque nadie tenga el tablero abierto: generar las ocurrencias de las reglas
 * que se repiten y ejecutar las tareas automáticas.
 */

export const ESTADOS = ["pendiente", "en_curso", "hecha", "cancelada"] as const;
export type Estado = (typeof ESTADOS)[number];

export const PRIORIDADES = ["alta", "media", "baja"] as const;
export type Prioridad = (typeof PRIORIDADES)[number];

export const FRECUENCIAS = ["diaria", "semanal", "mensual"] as const;
export type Frecuencia = (typeof FRECUENCIAS)[number];

/**
 * Las categorías que ofrece el formulario. Son una sugerencia, no una lista
 * cerrada: la base guarda texto libre, y lo que no esté acá se agrupa igual en
 * el resumen por su nombre.
 */
export const CATEGORIAS = [
  "Mayoristas",
  "Mercado Libre",
  "Tienda Nube",
  "Stock y compras",
  "Cobranzas",
  "Administración",
  "Reuniones",
  "Personal",
];

/**
 * Lo que una tarea puede EJECUTAR sola a su hora. La lista tiene que coincidir
 * con el `case` de `app.ejecutar_accion` en migraciones/tareas.sql: una clave
 * que esté acá y no allá termina en "acción desconocida" en la propia tarea.
 */
export const ACCIONES = [
  {
    clave: "actualizar_tablero",
    nombre: "Actualizar los datos del tablero",
    detalle:
      "Pide una corrida del orquestador, como el botón \"Actualizar ahora\". Si los datos tienen menos de 15 minutos, no hace nada.",
  },
] as const;
export type ClaveAccion = (typeof ACCIONES)[number]["clave"];

export function nombreAccion(clave: string | null): string | null {
  if (!clave) return null;
  return ACCIONES.find((a) => a.clave === clave)?.nombre ?? clave;
}

export type Tarea = {
  id: string;
  titulo: string;
  nota: string | null;
  categoria: string | null;
  prioridad: Prioridad;
  /** ISO. */
  inicio: string;
  duracionMin: number;
  recordarMinAntes: number;
  estado: Estado;
  iniciadaEn: string | null;
  hechaEn: string | null;
  vecesPostergada: number;
  accion: string | null;
  resultadoAccion: string | null;
  recurrenciaId: string | null;
};

export type Recurrencia = {
  id: string;
  titulo: string;
  nota: string | null;
  categoria: string | null;
  prioridad: Prioridad;
  duracionMin: number;
  recordarMinAntes: number;
  accion: string | null;
  frecuencia: Frecuencia;
  cada: number;
  /** ISO: 1 = lunes … 7 = domingo. */
  diasSemana: number[] | null;
  diaMes: number | null;
  /** "HH:MM", hora de Argentina. */
  hora: string;
  /** "YYYY-MM-DD". */
  desde: string;
  hasta: string | null;
  activa: boolean;
};

// ============================================================================
//  VALIDACIÓN
// ============================================================================

/** Los campos que se pueden escribir de una tarea suelta. */
export type DatosTarea = {
  titulo: string;
  nota: string | null;
  categoria: string | null;
  prioridad: Prioridad;
  inicio: string;
  duracionMin: number;
  recordarMinAntes: number;
  accion: string | null;
};

export type DatosRecurrencia = Omit<DatosTarea, "inicio"> & {
  frecuencia: Frecuencia;
  cada: number;
  diasSemana: number[] | null;
  diaMes: number | null;
  hora: string;
  desde: string;
  hasta: string | null;
};

type Resultado<T> = { ok: true; valor: T } | { ok: false; error: string };

function textoOpcional(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t.slice(0, max);
}

function entero(v: unknown, def: number, min: number, max: number): number | null {
  if (v === undefined || v === null || v === "") return def;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) return null;
  return n;
}

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const RE_HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

function esAccionValida(v: string | null): boolean {
  return v === null || ACCIONES.some((a) => a.clave === v);
}

/** Lo común a una tarea y a una regla. */
function validarBase(
  b: Record<string, unknown>,
): Resultado<Omit<DatosTarea, "inicio">> {
  const titulo = textoOpcional(b.titulo, 200);
  if (!titulo) return { ok: false, error: "Falta el título." };

  const prioridad = b.prioridad ?? "media";
  if (!PRIORIDADES.some((p) => p === prioridad)) {
    return { ok: false, error: "Prioridad inválida." };
  }
  const duracionMin = entero(b.duracionMin, 30, 1, 24 * 60);
  if (duracionMin === null) {
    return { ok: false, error: "La duración tiene que ser de 1 minuto a 24 horas." };
  }
  const recordarMinAntes = entero(b.recordarMinAntes, 0, 0, 7 * 24 * 60);
  if (recordarMinAntes === null) {
    return { ok: false, error: "El aviso previo no es válido." };
  }
  const accion = textoOpcional(b.accion, 60);
  if (!esAccionValida(accion)) return { ok: false, error: "Acción desconocida." };

  return {
    ok: true,
    valor: {
      titulo,
      nota: textoOpcional(b.nota, 2000),
      categoria: textoOpcional(b.categoria, 60),
      prioridad: prioridad as Prioridad,
      duracionMin,
      recordarMinAntes,
      accion,
    },
  };
}

export function validarTarea(body: unknown): Resultado<DatosTarea> {
  if (!body || typeof body !== "object") return { ok: false, error: "Cuerpo vacío." };
  const b = body as Record<string, unknown>;
  const base = validarBase(b);
  if (!base.ok) return base;

  const inicio = typeof b.inicio === "string" ? new Date(b.inicio) : null;
  if (!inicio || Number.isNaN(inicio.getTime())) {
    return { ok: false, error: "Falta la fecha y hora." };
  }
  return { ok: true, valor: { ...base.valor, inicio: inicio.toISOString() } };
}

export function validarRecurrencia(body: unknown): Resultado<DatosRecurrencia> {
  if (!body || typeof body !== "object") return { ok: false, error: "Cuerpo vacío." };
  const b = body as Record<string, unknown>;
  const base = validarBase(b);
  if (!base.ok) return base;

  const frecuencia = b.frecuencia;
  if (!FRECUENCIAS.some((f) => f === frecuencia)) {
    return { ok: false, error: "Frecuencia inválida." };
  }
  const cada = entero(b.cada, 1, 1, 52);
  if (cada === null) return { ok: false, error: "\"Cada\" tiene que ser de 1 a 52." };

  const hora = typeof b.hora === "string" ? b.hora.slice(0, 5) : "";
  if (!RE_HORA.test(hora)) return { ok: false, error: "Hora inválida." };

  const desde = typeof b.desde === "string" ? b.desde : "";
  if (!RE_FECHA.test(desde)) return { ok: false, error: "Fecha de inicio inválida." };

  const hasta = textoOpcional(b.hasta, 10);
  if (hasta !== null && (!RE_FECHA.test(hasta) || hasta < desde)) {
    return { ok: false, error: "La fecha de fin tiene que ser posterior al inicio." };
  }

  let diasSemana: number[] | null = null;
  let diaMes: number | null = null;
  if (frecuencia === "semanal") {
    const dias = Array.isArray(b.diasSemana) ? b.diasSemana.map(Number) : [];
    diasSemana = [...new Set(dias)].filter((d) => Number.isInteger(d) && d >= 1 && d <= 7).sort();
    if (diasSemana.length === 0) {
      return { ok: false, error: "Elegí al menos un día de la semana." };
    }
  }
  if (frecuencia === "mensual") {
    diaMes = entero(b.diaMes, Number(desde.slice(8, 10)), 1, 31);
    if (diaMes === null) return { ok: false, error: "Día del mes inválido." };
  }

  return {
    ok: true,
    valor: {
      ...base.valor,
      frecuencia: frecuencia as Frecuencia,
      cada,
      diasSemana,
      diaMes,
      hora,
      desde,
      hasta,
    },
  };
}

// ============================================================================
//  TEXTOS
// ============================================================================

export const NOMBRE_DIA = ["", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];
export const DIA_CORTO = ["", "Lu", "Ma", "Mi", "Ju", "Vi", "Sá", "Do"];

function enumerar(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} y ${items[items.length - 1]}`;
}

/** "Todos los lunes y jueves a las 09:00", "Cada 2 meses, el día 6 a las 10:00". */
export function describirRecurrencia(
  r: Pick<Recurrencia, "frecuencia" | "cada" | "diasSemana" | "diaMes" | "hora">,
): string {
  const hora = `a las ${r.hora.slice(0, 5)}`;
  if (r.frecuencia === "diaria") {
    return r.cada === 1 ? `Todos los días ${hora}` : `Cada ${r.cada} días ${hora}`;
  }
  if (r.frecuencia === "semanal") {
    const dias = (r.diasSemana ?? []).map((d) => NOMBRE_DIA[d]);
    const lista = dias.length === 5 && !(r.diasSemana ?? []).some((d) => d > 5)
      ? "de lunes a viernes"
      : enumerar(dias);
    if (r.cada === 1) {
      return lista === "de lunes a viernes"
        ? `De lunes a viernes ${hora}`
        : `Todos los ${lista} ${hora}`;
    }
    return `Cada ${r.cada} semanas, ${lista} ${hora}`;
  }
  const dia = `el día ${r.diaMes ?? 1}`;
  return r.cada === 1
    ? `Todos los meses, ${dia} ${hora}`
    : `Cada ${r.cada} meses, ${dia} ${hora}`;
}

export function fmtDuracion(min: number): string {
  if (min < 60) return `${Math.round(min)} min`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/**
 * El día de Argentina ("YYYY-MM-DD") de un instante. Argentina está fija en
 * UTC-3, sin horario de verano, así que alcanza con correr tres horas: el
 * `slice(0, 10)` directo de un ISO da el día UTC, y una tarea de las 22 h
 * caería al día siguiente.
 */
export function diaAR(iso: string | number | Date): string {
  const ms = new Date(iso).getTime() - 3 * 3_600_000;
  return new Date(ms).toISOString().slice(0, 10);
}

// ============================================================================
//  ESTADO EN EL TIEMPO
// ============================================================================

/**
 * Una tarea que ya tendría que haber terminado y sigue abierta.
 *
 * Las automáticas nunca están "atrasadas": no son trabajo de nadie. Si una
 * quedó pendiente es que el cron no la corrió, y eso se ve en su resultado.
 */
export function estaAtrasada(t: Tarea, ahora: Date): boolean {
  if (t.accion) return false;
  if (t.estado !== "pendiente" && t.estado !== "en_curso") return false;
  const fin = new Date(t.inicio).getTime() + t.duracionMin * 60_000;
  return fin < ahora.getTime();
}

/** Cuándo hay que avisar: la hora de inicio menos el aviso previo. */
export function momentoAviso(t: Tarea): number {
  return new Date(t.inicio).getTime() - t.recordarMinAntes * 60_000;
}

/**
 * Las tareas que hay que avisar AHORA: su momento de aviso cayó entre la última
 * revisión y este instante. La ventana es lo que impide avisar dos veces la
 * misma tarea, y además se recuerdan los ids ya avisados (la pantalla los
 * guarda) por si dos revisiones se pisan.
 *
 * Las automáticas no se avisan: no hay nada que arrancar, las hace la base.
 */
export function tareasParaAvisar(
  tareas: Tarea[],
  desde: number,
  hasta: number,
  yaAvisadas: ReadonlySet<string>,
): Tarea[] {
  return tareas.filter((t) => {
    if (t.estado !== "pendiente" || t.accion) return false;
    if (yaAvisadas.has(`${t.id}@${t.inicio}`)) return false;
    const m = momentoAviso(t);
    return m > desde && m <= hasta;
  });
}

// ============================================================================
//  RESUMEN
// ============================================================================

export type FilaCategoria = {
  categoria: string;
  total: number;
  hechas: number;
  /** Minutos de lo hecho: los reales si se midieron, si no los estimados. */
  minutos: number;
};

export type Resumen = {
  total: number;
  hechas: number;
  pendientes: number;
  atrasadas: number;
  canceladas: number;
  automaticas: number;
  /** % de lo que vencía en el período y se terminó. `null` si no vencía nada. */
  cumplimiento: number | null;
  minutosHechos: number;
  porCategoria: FilaCategoria[];
  hechasLista: Tarea[];
  atrasadasLista: Tarea[];
};

const SIN_CATEGORIA = "Sin categoría";

/** Minutos que llevó de verdad, si se midió (arrancar → terminar). */
export function minutosReales(t: Tarea): number | null {
  if (!t.iniciadaEn || !t.hechaEn || t.accion) return null;
  const m = (new Date(t.hechaEn).getTime() - new Date(t.iniciadaEn).getTime()) / 60_000;
  // Menos de un minuto es haber tocado los dos botones seguidos, y más de 12
  // horas es haberse olvidado de terminarla: ninguno de los dos es una medida.
  return m >= 1 && m <= 12 * 60 ? m : null;
}

/**
 * El resumen de un período. Habla del trabajo DE LA PERSONA: las automáticas
 * se cuentan aparte (`automaticas`) y no entran en los totales, el
 * cumplimiento ni las categorías. Si entraran, una acción diaria inflaría
 * "hechas" con treinta tareas al mes que nadie hizo.
 */
export function resumir(todas: Tarea[], ahora: Date): Resumen {
  const tareas = todas.filter((t) => !t.accion);
  const hechas = tareas.filter((t) => t.estado === "hecha");
  const atrasadas = tareas.filter((t) => estaAtrasada(t, ahora));
  const vencidas = tareas.filter(
    (t) => t.estado !== "cancelada" && new Date(t.inicio).getTime() <= ahora.getTime(),
  );
  const vencidasHechas = vencidas.filter((t) => t.estado === "hecha").length;

  const cats = new Map<string, FilaCategoria>();
  let minutosHechos = 0;
  for (const t of tareas) {
    if (t.estado === "cancelada") continue;
    const clave = t.categoria ?? SIN_CATEGORIA;
    const fila = cats.get(clave) ?? { categoria: clave, total: 0, hechas: 0, minutos: 0 };
    fila.total += 1;
    if (t.estado === "hecha") {
      fila.hechas += 1;
      const m = minutosReales(t) ?? t.duracionMin;
      fila.minutos += m;
      minutosHechos += m;
    }
    cats.set(clave, fila);
  }

  const porFecha = (a: Tarea, b: Tarea) => a.inicio.localeCompare(b.inicio);
  return {
    total: tareas.filter((t) => t.estado !== "cancelada").length,
    hechas: hechas.length,
    pendientes: tareas.filter((t) => t.estado === "pendiente" || t.estado === "en_curso").length,
    atrasadas: atrasadas.length,
    canceladas: tareas.filter((t) => t.estado === "cancelada").length,
    automaticas: todas.filter((t) => t.accion && t.estado === "hecha").length,
    cumplimiento: vencidas.length === 0 ? null : (vencidasHechas / vencidas.length) * 100,
    minutosHechos,
    porCategoria: [...cats.values()].sort((a, b) => b.minutos - a.minutos || b.total - a.total),
    hechasLista: [...hechas].sort(porFecha),
    atrasadasLista: [...atrasadas].sort(porFecha),
  };
}

// ============================================================================
//  SUGERENCIAS
// ============================================================================
//
// Reglas simples sobre el propio historial. No reemplazan mirar el trabajo con
// calma --para eso está pedirle a Claude que analice las tareas-- pero señalan
// los patrones que se repiten sin que haya que buscarlos.

export type Sugerencia = {
  clave: string;
  titulo: string;
  detalle: string;
};

/** "Revisar  Stock!" y "revisar stock" son la misma tarea. */
export function normalizarTitulo(t: string): string {
  return t
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const PALABRAS_AUTOMATIZABLES = ["actualizar", "actualiza", "refrescar", "correr orquestador"];

export function sugerir(tareas: Tarea[], recurrencias: Recurrencia[], ahora: Date): Sugerencia[] {
  const out: Sugerencia[] = [];

  // 1. Se patea una y otra vez.
  for (const t of tareas) {
    if (t.vecesPostergada >= 3 && t.estado !== "hecha" && t.estado !== "cancelada") {
      out.push({
        clave: `postergada-${t.id}`,
        titulo: `"${t.titulo}" ya se postergó ${t.vecesPostergada} veces`,
        detalle:
          "Cuando una tarea se patea tanto suele ser porque es muy grande o no está claro el primer paso. Partila en una tarea de 15–30 min con un primer paso concreto, delegala, o decidí si de verdad hace falta.",
      });
    }
  }

  // 2. Se carga a mano lo mismo una y otra vez.
  const sueltas = new Map<string, Tarea[]>();
  for (const t of tareas) {
    if (t.recurrenciaId || t.estado === "cancelada") continue;
    const k = normalizarTitulo(t.titulo);
    if (!k) continue;
    sueltas.set(k, [...(sueltas.get(k) ?? []), t]);
  }
  const titulosRecurrentes = new Set(recurrencias.filter((r) => r.activa).map((r) => normalizarTitulo(r.titulo)));
  for (const [k, lista] of sueltas) {
    if (lista.length >= 3 && !titulosRecurrentes.has(k)) {
      out.push({
        clave: `repetida-${k}`,
        titulo: `"${lista[0].titulo}" la cargaste ${lista.length} veces a mano`,
        detalle:
          "Convertila en una tarea que se repite: se crea sola en el calendario y te avisa a la hora que elijas.",
      });
    }
  }

  // 3. Algo que el tablero puede hacer solo.
  for (const t of tareas) {
    if (t.accion || t.estado === "cancelada") continue;
    const k = normalizarTitulo(t.titulo);
    if (PALABRAS_AUTOMATIZABLES.some((p) => k.includes(p)) && /(tablero|datos|orquestador|ventas)/.test(k)) {
      out.push({
        clave: `automatizable-${k}`,
        titulo: `"${t.titulo}" la puede hacer el tablero solo`,
        detalle:
          "Elegí la acción \"Actualizar los datos del tablero\" al crearla y se ejecuta sola a la hora programada, sin que tengas que estar.",
      });
      break;
    }
  }

  // 4. Tareas cortas de la misma categoría desparramadas en la semana. Sólo
  // las sueltas: una que se repite todos los días ya ES un bloque fijo.
  const cortas = new Map<string, Set<string>>();
  for (const t of tareas) {
    if (!t.categoria || t.accion || t.recurrenciaId || t.duracionMin > 20 || t.estado === "cancelada") continue;
    const dia = diaAR(t.inicio);
    cortas.set(t.categoria, (cortas.get(t.categoria) ?? new Set()).add(dia));
  }
  for (const [cat, dias] of cortas) {
    if (dias.size >= 4) {
      out.push({
        clave: `agrupar-${cat}`,
        titulo: `Tareas cortas de ${cat} en ${dias.size} días distintos`,
        detalle:
          "Agruparlas en uno o dos bloques fijos por semana ahorra el costo de cambiar de tema cada vez. Probá con una tarea repetida \"Bloque " +
          cat +
          "\" y anotá adentro lo que hay que hacer.",
      });
    }
  }

  // 5. Se estima de menos.
  const medidas = new Map<string, { est: number; real: number; n: number }>();
  for (const t of tareas) {
    const real = minutosReales(t);
    if (real === null) continue;
    const k = t.categoria ?? SIN_CATEGORIA;
    const m = medidas.get(k) ?? { est: 0, real: 0, n: 0 };
    m.est += t.duracionMin;
    m.real += real;
    m.n += 1;
    medidas.set(k, m);
  }
  for (const [cat, m] of medidas) {
    if (m.n >= 3 && m.real > m.est * 1.5) {
      out.push({
        clave: `estimacion-${cat}`,
        titulo: `En ${cat} las tareas llevan ${Math.round((m.real / m.est) * 10) / 10}× lo estimado`,
        detalle: `Medidas ${m.n} tareas: estimaste ${fmtDuracion(m.est)} y llevaron ${fmtDuracion(m.real)}. Agendalas con más margen para que el resto del día no se corra.`,
      });
    }
  }

  // 6. Atrasadas acumuladas.
  const atrasadas = tareas.filter((t) => estaAtrasada(t, ahora));
  if (atrasadas.length >= 5) {
    out.push({
      clave: "limpieza",
      titulo: `Tenés ${atrasadas.length} tareas atrasadas`,
      detalle:
        "Hacé una limpieza de 10 minutos: lo que ya no importa, cancelalo; lo que sí, reprogramalo a un día concreto. Una lista que siempre tiene atrasadas deja de servir de guía.",
    });
  }

  // 7. Un día cargado de más en lo que viene.
  const carga = new Map<string, number>();
  const hoy = ahora.getTime();
  for (const t of tareas) {
    if (t.accion || t.estado !== "pendiente") continue;
    const ms = new Date(t.inicio).getTime();
    if (ms < hoy || ms > hoy + 7 * 86_400_000) continue;
    const dia = diaAR(t.inicio);
    carga.set(dia, (carga.get(dia) ?? 0) + t.duracionMin);
  }
  for (const [dia, min] of carga) {
    if (min > 7 * 60) {
      out.push({
        clave: `cargado-${dia}`,
        titulo: `El ${dia.slice(8, 10)}/${dia.slice(5, 7)} tiene ${fmtDuracion(min)} de tareas`,
        detalle:
          "Es más de lo que entra en un día con reuniones e imprevistos. Pasá lo de prioridad baja a otro día antes de que llegue.",
      });
    }
  }

  return out;
}
