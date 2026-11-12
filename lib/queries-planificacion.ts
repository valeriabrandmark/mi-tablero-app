import { enTransaccion, query } from "@/lib/db";
import {
  ESTADOS,
  FASES,
  MARCAS_PLAN,
  TIPOS_EVENTO,
  TIPOS_INICIATIVA,
  type EventoCalendario,
  type Iniciativa,
  type Subtarea,
} from "@/lib/planificacion";

/**
 * Lectura y escritura de Marketing → Planificación (tablas en
 * migraciones/marketing_planificacion.sql).
 *
 * Toda la validación vive acá y no en la ruta: la ruta sólo decide quién
 * puede, y estas funciones deciden qué es un dato válido. Un campo que no
 * cumple se descarta o se corta, nunca se guarda tal cual vino.
 */

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const fecha = (v: unknown) => (typeof v === "string" && ISO.test(v) ? v : null);
const texto = (v: unknown, max = 500) =>
  typeof v === "string" && v.trim() !== "" ? v.trim().slice(0, max) : null;
const numero = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null;
const de = <T extends string | number>(v: unknown, opciones: readonly T[], defecto: T): T =>
  opciones.includes(v as T) ? (v as T) : defecto;

const CLAVES_MARCA = MARCAS_PLAN.map((m) => m.clave);

export class ErrorDeDatos extends Error {}

// ---------------------------------------------------------------------------
// Lectura
// ---------------------------------------------------------------------------

type FilaIniciativa = {
  id: string;
  titulo: string;
  marca: string;
  tipo: string;
  evento_id: string | null;
  objetivo: string | null;
  kpi: string | null;
  meta: string | null;
  publico: string | null;
  canales: string[] | null;
  presupuesto: string | null;
  gasto: string | null;
  cupon: string | null;
  responsable: string | null;
  inicio: string | null;
  vence: string;
  estado: string;
  prioridad: number;
  entregado_en: string | null;
  resultado: string | null;
};

type FilaSubtarea = {
  id: string;
  iniciativa_id: string;
  titulo: string;
  fase: string;
  responsable: string | null;
  vence: string | null;
  hecha: boolean;
  hecha_en: string | null;
  orden: number;
};

type FilaEvento = {
  id: string;
  nombre: string;
  desde: string;
  hasta: string;
  tipo: string;
  importancia: number;
  anticipacion_dias: number;
  lanzamiento_dias: number;
  marcas: string[] | null;
  estimada: boolean;
  nota: string | null;
};

const n = (v: string | null) => (v === null ? null : Number(v));

function aEvento(f: FilaEvento): EventoCalendario {
  return {
    id: Number(f.id),
    nombre: f.nombre,
    desde: f.desde,
    hasta: f.hasta,
    tipo: f.tipo as EventoCalendario["tipo"],
    importancia: f.importancia as 1 | 2 | 3,
    anticipacionDias: f.anticipacion_dias,
    lanzamientoDias: f.lanzamiento_dias,
    marcas: f.marcas,
    estimada: f.estimada,
    nota: f.nota,
  };
}

/**
 * Todo lo que toca el rango: iniciativas que se cruzan con él (o que
 * siguen abiertas aunque hayan vencido antes, que son justamente las
 * atrasadas) y eventos cuya ventana de planificación se cruza con él.
 */
export async function leerPlan(desde: string, hasta: string) {
  const [ini, sub, ev] = await Promise.all([
    query<FilaIniciativa>(
      `select id, titulo, marca, tipo, evento_id, objetivo, kpi, meta, publico, canales,
              presupuesto, gasto, cupon, responsable, inicio::text, vence::text, estado,
              prioridad, entregado_en::text, resultado
         from bronze.mkt_iniciativas
        where (coalesce(inicio, vence) <= $2::date and vence >= $1::date)
           or (estado not in ('entregada', 'cancelada') and vence < $1::date)
        order by vence, id`,
      [desde, hasta],
    ),
    query<FilaSubtarea>(
      `select s.id, s.iniciativa_id, s.titulo, s.fase, s.responsable, s.vence::text, s.hecha,
              s.hecha_en::text, s.orden
         from bronze.mkt_subtareas s
         join bronze.mkt_iniciativas i on i.id = s.iniciativa_id
        where (coalesce(i.inicio, i.vence) <= $2::date and i.vence >= $1::date)
           or (i.estado not in ('entregada', 'cancelada') and i.vence < $1::date)
        order by s.iniciativa_id, s.orden, s.id`,
      [desde, hasta],
    ),
    query<FilaEvento>(
      `select id, nombre, desde::text, hasta::text, tipo, importancia, anticipacion_dias,
              lanzamiento_dias, marcas, estimada, nota
         from bronze.mkt_eventos
        where hasta >= $1::date - 30 and desde - anticipacion_dias <= $2::date
        order by desde`,
      [desde, hasta],
    ),
  ]);

  const porIniciativa = new Map<string, Subtarea[]>();
  for (const s of sub) {
    const lista = porIniciativa.get(s.iniciativa_id) ?? [];
    lista.push({
      id: Number(s.id),
      titulo: s.titulo,
      fase: s.fase as Subtarea["fase"],
      responsable: s.responsable,
      vence: s.vence,
      hecha: s.hecha,
      hechaEn: s.hecha_en,
      orden: s.orden,
    });
    porIniciativa.set(s.iniciativa_id, lista);
  }

  const iniciativas: Iniciativa[] = ini.map((f) => ({
    id: Number(f.id),
    titulo: f.titulo,
    marca: f.marca as Iniciativa["marca"],
    tipo: f.tipo as Iniciativa["tipo"],
    eventoId: n(f.evento_id),
    objetivo: f.objetivo,
    kpi: f.kpi,
    meta: n(f.meta),
    publico: f.publico,
    canales: f.canales ?? [],
    presupuesto: n(f.presupuesto),
    gasto: n(f.gasto),
    cupon: f.cupon,
    responsable: f.responsable,
    inicio: f.inicio,
    vence: f.vence,
    estado: f.estado as Iniciativa["estado"],
    prioridad: f.prioridad as 1 | 2 | 3,
    entregadoEn: f.entregado_en,
    resultado: f.resultado,
    subtareas: porIniciativa.get(f.id) ?? [],
  }));

  return { iniciativas, eventos: ev.map(aEvento) };
}

// ---------------------------------------------------------------------------
// Escritura
// ---------------------------------------------------------------------------

function limpiarIniciativa(d: Partial<Iniciativa>): Iniciativa {
  const titulo = texto(d.titulo, 200);
  const vence = fecha(d.vence);
  if (!titulo) throw new ErrorDeDatos("Falta el título");
  if (!vence) throw new ErrorDeDatos("Falta la fecha de entrega");
  const estado = de(d.estado, Object.keys(ESTADOS) as (keyof typeof ESTADOS)[], "planificada");
  const inicio = fecha(d.inicio);
  return {
    titulo,
    marca: de(d.marca, CLAVES_MARCA, "todas"),
    tipo: de(d.tipo, Object.keys(TIPOS_INICIATIVA) as (keyof typeof TIPOS_INICIATIVA)[], "campana"),
    eventoId: numero(d.eventoId),
    objetivo: texto(d.objetivo, 2000),
    kpi: texto(d.kpi, 200),
    meta: numero(d.meta),
    publico: texto(d.publico, 500),
    canales: Array.isArray(d.canales) ? d.canales.map((c) => texto(c, 60)).filter((c): c is string => !!c).slice(0, 20) : [],
    presupuesto: numero(d.presupuesto),
    gasto: numero(d.gasto),
    cupon: texto(d.cupon, 60)?.toUpperCase() ?? null,
    responsable: texto(d.responsable, 80),
    inicio: inicio && inicio > vence ? vence : inicio,
    vence,
    estado,
    prioridad: de(d.prioridad, [1, 2, 3] as const, 2),
    // La fecha de entrega se completa sola al marcarla entregada.
    entregadoEn: estado === "entregada" ? (fecha(d.entregadoEn) ?? hoy()) : null,
    resultado: texto(d.resultado, 2000),
    subtareas: (Array.isArray(d.subtareas) ? d.subtareas : [])
      .slice(0, 100)
      .map((s, orden) => ({
        id: numero(s?.id) ?? undefined,
        titulo: texto(s?.titulo, 300) ?? "",
        fase: de(s?.fase, Object.keys(FASES) as (keyof typeof FASES)[], "produccion"),
        responsable: texto(s?.responsable, 80),
        vence: fecha(s?.vence),
        hecha: s?.hecha === true,
        orden,
      }))
      .filter((s) => s.titulo),
  };
}

function hoy(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date());
}

/** Crea o actualiza una iniciativa y REEMPLAZA sus subtareas por las que vienen. */
export async function guardarIniciativa(datos: Partial<Iniciativa>, id: number | null, usuario: string | null) {
  const d = limpiarIniciativa(datos);
  return enTransaccion(async (q) => {
    const valores = [
      d.titulo, d.marca, d.tipo, d.eventoId, d.objetivo, d.kpi, d.meta, d.publico, d.canales,
      d.presupuesto, d.gasto, d.cupon, d.responsable, d.inicio, d.vence, d.estado, d.prioridad,
      d.entregadoEn, d.resultado,
    ];
    let nuevoId: number;
    if (id) {
      const r = await q<{ id: string }>(
        `update bronze.mkt_iniciativas set
           titulo = $1, marca = $2, tipo = $3, evento_id = $4, objetivo = $5, kpi = $6, meta = $7,
           publico = $8, canales = $9, presupuesto = $10, gasto = $11, cupon = $12,
           responsable = $13, inicio = $14, vence = $15, estado = $16, prioridad = $17,
           entregado_en = $18, resultado = $19, actualizado_en = now()
         where id = $20 returning id`,
        [...valores, id],
      );
      if (!r.length) throw new ErrorDeDatos("La iniciativa no existe");
      nuevoId = id;
    } else {
      const r = await q<{ id: string }>(
        `insert into bronze.mkt_iniciativas
           (titulo, marca, tipo, evento_id, objetivo, kpi, meta, publico, canales, presupuesto,
            gasto, cupon, responsable, inicio, vence, estado, prioridad, entregado_en, resultado,
            creado_por)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
         returning id`,
        [...valores, usuario],
      );
      nuevoId = Number(r[0].id);
    }

    // Las subtareas se reemplazan: las que ya existían conservan su id y la
    // fecha en que se hicieron; las que se sacaron de la lista se borran.
    const conservar = d.subtareas.map((s) => s.id).filter((x): x is number => !!x);
    await q(
      `delete from bronze.mkt_subtareas where iniciativa_id = $1 and not (id = any($2::bigint[]))`,
      [nuevoId, conservar],
    );
    for (const s of d.subtareas) {
      if (s.id) {
        await q(
          `update bronze.mkt_subtareas set titulo = $1, fase = $2, responsable = $3, vence = $4,
                  hecha = $5, hecha_en = case when $5 and not hecha then now() when not $5 then null else hecha_en end,
                  orden = $6
            where id = $7 and iniciativa_id = $8`,
          [s.titulo, s.fase, s.responsable, s.vence, s.hecha, s.orden, s.id, nuevoId],
        );
      } else {
        await q(
          `insert into bronze.mkt_subtareas (iniciativa_id, titulo, fase, responsable, vence, hecha, hecha_en, orden)
           values ($1, $2, $3, $4, $5, $6, case when $6 then now() end, $7)`,
          [nuevoId, s.titulo, s.fase, s.responsable, s.vence, s.hecha, s.orden],
        );
      }
    }
    return nuevoId;
  });
}

/** Tildar o destildar una subtarea, sin tocar el resto. */
export async function marcarSubtarea(id: number, hecha: boolean) {
  const r = await query<{ id: string }>(
    `update bronze.mkt_subtareas
        set hecha = $2, hecha_en = case when $2 then coalesce(hecha_en, now()) end
      where id = $1 returning id`,
    [id, hecha],
  );
  if (!r.length) throw new ErrorDeDatos("La subtarea no existe");
}

export async function borrarIniciativa(id: number) {
  await query(`delete from bronze.mkt_iniciativas where id = $1`, [id]);
}

function limpiarEvento(d: Partial<EventoCalendario>) {
  const nombre = texto(d.nombre, 120);
  const desde = fecha(d.desde);
  const hasta = fecha(d.hasta) ?? desde;
  if (!nombre) throw new ErrorDeDatos("Falta el nombre");
  if (!desde || !hasta) throw new ErrorDeDatos("Falta la fecha");
  const marcas = Array.isArray(d.marcas)
    ? d.marcas.filter((m) => CLAVES_MARCA.includes(m as never) && m !== "todas")
    : [];
  return {
    nombre,
    desde,
    hasta: hasta < desde ? desde : hasta,
    tipo: de(d.tipo, Object.keys(TIPOS_EVENTO) as (keyof typeof TIPOS_EVENTO)[], "comercial"),
    importancia: de(d.importancia, [1, 2, 3] as const, 2),
    anticipacionDias: Math.max(0, Math.min(365, Math.round(numero(d.anticipacionDias) ?? 45))),
    lanzamientoDias: Math.max(0, Math.min(120, Math.round(numero(d.lanzamientoDias) ?? 0))),
    marcas: marcas.length ? marcas : null,
    estimada: d.estimada === true,
    nota: texto(d.nota, 500),
  };
}

export async function guardarEvento(datos: Partial<EventoCalendario>, id: number | null, usuario: string | null) {
  const e = limpiarEvento(datos);
  const valores = [e.nombre, e.desde, e.hasta, e.tipo, e.importancia, e.anticipacionDias, e.lanzamientoDias, e.marcas, e.estimada, e.nota];
  if (id) {
    const r = await query<{ id: string }>(
      `update bronze.mkt_eventos set nombre = $1, desde = $2, hasta = $3, tipo = $4, importancia = $5,
              anticipacion_dias = $6, lanzamiento_dias = $7, marcas = $8, estimada = $9, nota = $10
        where id = $11 returning id`,
      [...valores, id],
    );
    if (!r.length) throw new ErrorDeDatos("La fecha no existe");
    return id;
  }
  const r = await query<{ id: string }>(
    `insert into bronze.mkt_eventos (nombre, desde, hasta, tipo, importancia, anticipacion_dias,
            lanzamiento_dias, marcas, estimada, nota, creado_por)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id`,
    [...valores, usuario],
  );
  return Number(r[0].id);
}

export async function borrarEvento(id: number) {
  await query(`delete from bronze.mkt_eventos where id = $1`, [id]);
}
