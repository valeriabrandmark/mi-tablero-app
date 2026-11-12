"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Aviso, Panel, TarjetaKpi } from "@/components/ui";
import { fmtMoneda } from "@/lib/format";
import {
  aTiempo,
  avance,
  CANALES_PLAN,
  colorMarca,
  desdePlantilla,
  diasHasta,
  ESTADOS,
  FASES,
  fechaCorta,
  iniciativaVacia,
  inicioPlanificacion,
  lanzamientoDe,
  MARCAS_PLAN,
  nombreMarca,
  PLANTILLAS,
  riesgo,
  RIESGOS,
  sumarDiasIso,
  TIPOS_EVENTO,
  TIPOS_INICIATIVA,
  type Estado,
  type EventoCalendario,
  type Fase,
  type Iniciativa,
  type Subtarea,
} from "@/lib/planificacion";

/**
 * MARKETING → PLANIFICACIÓN.
 *
 * Donde se cargan las responsabilidades del área de marca: un calendario con
 * las fechas comerciales que vienen, las iniciativas (campañas,
 * colaboraciones, revista, ferias) con su brief, y las subtareas de cada una
 * con responsable y fecha. El avance se mide solo, por subtareas hechas.
 *
 * Cinco vistas del MISMO plan, como en las herramientas de planificación de
 * marketing: calendario (qué cae cada día), línea de tiempo (qué se superpone),
 * tablero por estado (qué está trabado), lista y fechas comerciales.
 */

const VERDE = "#22c55e";
const AMBAR = "#f59e0b";
const ROJO = "#f43f5e";

const RESPONSABLES_SUGERIDOS = ["Agatina", "Lucila", "Diseñador externo", "Ana", "Alejandro"];

type Vista = "pendientes" | "calendario" | "linea" | "tablero" | "lista" | "fechas";
const VISTAS: { clave: Vista; label: string }[] = [
  { clave: "pendientes", label: "Pendientes" },
  { clave: "calendario", label: "Calendario" },
  { clave: "linea", label: "Línea de tiempo" },
  { clave: "tablero", label: "Tablero por estado" },
  { clave: "lista", label: "Lista" },
  { clave: "fechas", label: "Fechas comerciales" },
];

function hoyAr(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date());
}

const MESES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

// ---------------------------------------------------------------------------
// Piezas chicas
// ---------------------------------------------------------------------------

function Chip({ color, children, title }: { color: string; children: ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className="inline-block rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap"
      style={{ color, borderColor: `${color}55`, background: `${color}1a` }}
    >
      {children}
    </span>
  );
}

function Barra({ valor, color }: { valor: number; color: string }) {
  return (
    <div className="bg-panel-2 h-1.5 w-full overflow-hidden rounded-full">
      <div className="h-full rounded-full" style={{ width: `${Math.round(valor * 100)}%`, background: color }} />
    </div>
  );
}

const CAMPO =
  "border-line bg-panel-2 text-ink w-full rounded-lg border px-2.5 py-1.5 text-sm [color-scheme:dark] focus:border-c1 focus:outline-none";

function Campo({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={`flex flex-col gap-1 ${className}`}>
      <span className="text-muted text-[11px]">{label}</span>
      {children}
    </label>
  );
}

function Modal({ titulo, onCerrar, children }: { titulo: string; onCerrar: () => void; children: ReactNode }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-2 sm:p-6"
      onMouseDown={(e) => e.target === e.currentTarget && onCerrar()}
    >
      <div className="border-line bg-panel w-full max-w-4xl rounded-xl border p-4 shadow-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold">{titulo}</h2>
          <button type="button" onClick={onCerrar} className="text-muted hover:text-ink px-2 text-lg" aria-label="Cerrar">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Editor de iniciativa (brief + ejecución + subtareas)
// ---------------------------------------------------------------------------

function EditorIniciativa({
  hoy,
  inicial,
  eventos,
  responsables,
  onGuardar,
  onBorrar,
  onCerrar,
  guardando,
  error,
}: {
  hoy: string;
  inicial: Iniciativa;
  eventos: EventoCalendario[];
  responsables: string[];
  onGuardar: (i: Iniciativa) => void;
  onBorrar: (() => void) | null;
  onCerrar: () => void;
  guardando: boolean;
  error: string | null;
}) {
  const [i, setI] = useState<Iniciativa>(inicial);
  const set = <K extends keyof Iniciativa>(k: K, v: Iniciativa[K]) => setI((x) => ({ ...x, [k]: v }));
  const setSub = (idx: number, cambios: Partial<Subtarea>) =>
    setI((x) => ({ ...x, subtareas: x.subtareas.map((s, j) => (j === idx ? { ...s, ...cambios } : s)) }));
  const nuevo = !i.id;
  const hechas = i.subtareas.filter((s) => s.hecha).length;

  const aplicarPlantilla = (clave: string) => {
    const p = PLANTILLAS.find((x) => x.clave === clave);
    if (!p) return;
    const base = desdePlantilla(p, i.vence, { responsable: i.responsable ?? "Agatina" }, hoy);
    setI((x) => ({
      ...x,
      tipo: x.titulo ? x.tipo : base.tipo,
      kpi: x.kpi ?? base.kpi,
      canales: x.canales.length ? x.canales : base.canales,
      inicio: base.inicio,
      subtareas: base.subtareas,
    }));
  };

  const num = (v: string) => (v.trim() === "" ? null : Number(v.replace(/\./g, "").replace(",", ".")));

  return (
    <div className="space-y-4">
      <datalist id="responsables">
        {responsables.map((r) => (
          <option key={r} value={r} />
        ))}
      </datalist>

      <section className="space-y-3">
        <h3 className="text-muted text-xs font-medium tracking-wide uppercase">Brief</h3>
        <div className="grid gap-3 sm:grid-cols-6">
          <Campo label="Título" className="sm:col-span-4">
            <input className={CAMPO} value={i.titulo} onChange={(e) => set("titulo", e.target.value)} placeholder="Ej.: Día del Niño 2027 — Hola Toys" />
          </Campo>
          <Campo label="Marca">
            <select className={CAMPO} value={i.marca} onChange={(e) => set("marca", e.target.value as Iniciativa["marca"])}>
              {MARCAS_PLAN.map((m) => (
                <option key={m.clave} value={m.clave}>{m.nombre}</option>
              ))}
            </select>
          </Campo>
          <Campo label="Tipo">
            <select className={CAMPO} value={i.tipo} onChange={(e) => set("tipo", e.target.value as Iniciativa["tipo"])}>
              {Object.entries(TIPOS_INICIATIVA).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </Campo>
          <Campo label="Objetivo: qué se busca y por qué" className="sm:col-span-6">
            <textarea className={`${CAMPO} min-h-16`} value={i.objetivo ?? ""} onChange={(e) => set("objetivo", e.target.value)} />
          </Campo>
          <Campo label="KPI" className="sm:col-span-2">
            <input className={CAMPO} value={i.kpi ?? ""} onChange={(e) => set("kpi", e.target.value)} placeholder="Ej.: venta con cupón" />
          </Campo>
          <Campo label="Meta (número)">
            <input className={CAMPO} inputMode="decimal" value={i.meta ?? ""} onChange={(e) => set("meta", num(e.target.value))} />
          </Campo>
          <Campo label="Público" className="sm:col-span-3">
            <input className={CAMPO} value={i.publico ?? ""} onChange={(e) => set("publico", e.target.value)} placeholder="Ej.: mamás 25-40, AMBA y NOA" />
          </Campo>
          <Campo label="Presupuesto ($)">
            <input className={CAMPO} inputMode="decimal" value={i.presupuesto ?? ""} onChange={(e) => set("presupuesto", num(e.target.value))} />
          </Campo>
          <Campo label="Gastado ($)">
            <input className={CAMPO} inputMode="decimal" value={i.gasto ?? ""} onChange={(e) => set("gasto", num(e.target.value))} />
          </Campo>
          <Campo label="Fecha comercial" className="sm:col-span-2">
            <select className={CAMPO} value={i.eventoId ?? ""} onChange={(e) => set("eventoId", e.target.value ? Number(e.target.value) : null)}>
              <option value="">— Ninguna —</option>
              {eventos.map((ev) => (
                <option key={ev.id} value={ev.id}>{ev.nombre} ({fechaCorta(ev.desde)}/{ev.desde.slice(2, 4)})</option>
              ))}
            </select>
          </Campo>
          {i.tipo === "influencer" && (
            <Campo label="Cupón único (mide la venta)">
              <input className={CAMPO} value={i.cupon ?? ""} onChange={(e) => set("cupon", e.target.value.toUpperCase())} placeholder="HOLA-ANA10" />
            </Campo>
          )}
          <div className="sm:col-span-6">
            <span className="text-muted text-[11px]">Canales</span>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {CANALES_PLAN.map((c) => {
                const activo = i.canales.includes(c);
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => set("canales", activo ? i.canales.filter((x) => x !== c) : [...i.canales, c])}
                    className={`rounded-lg border px-2 py-1 text-xs ${activo ? "border-c1 bg-c1/15 text-c1" : "border-line text-muted hover:text-ink"}`}
                  >
                    {c}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-muted text-xs font-medium tracking-wide uppercase">Ejecución</h3>
        <div className="grid gap-3 sm:grid-cols-6">
          <Campo label="Responsable">
            <input className={CAMPO} list="responsables" value={i.responsable ?? ""} onChange={(e) => set("responsable", e.target.value)} />
          </Campo>
          <Campo label="Inicio">
            <input type="date" className={CAMPO} value={i.inicio ?? ""} onChange={(e) => set("inicio", e.target.value || null)} />
          </Campo>
          <Campo label="Entrega / lanzamiento">
            <input type="date" className={CAMPO} value={i.vence} onChange={(e) => e.target.value && set("vence", e.target.value)} />
          </Campo>
          <Campo label="Estado">
            <select className={CAMPO} value={i.estado} onChange={(e) => set("estado", e.target.value as Estado)}>
              {Object.entries(ESTADOS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </Campo>
          <Campo label="Prioridad">
            <select className={CAMPO} value={i.prioridad} onChange={(e) => set("prioridad", Number(e.target.value) as 1 | 2 | 3)}>
              <option value={3}>Alta</option>
              <option value={2}>Media</option>
              <option value={1}>Baja</option>
            </select>
          </Campo>
          {i.estado === "entregada" && (
            <Campo label="Entregada el">
              <input type="date" className={CAMPO} value={i.entregadoEn ?? ""} onChange={(e) => set("entregadoEn", e.target.value || null)} />
            </Campo>
          )}
          <Campo label="Resultado contra el KPI (después del lanzamiento)" className="sm:col-span-6">
            <textarea className={`${CAMPO} min-h-14`} value={i.resultado ?? ""} onChange={(e) => set("resultado", e.target.value)} placeholder="Qué pasó, número contra la meta y qué se aprendió" />
          </Campo>
        </div>
      </section>

      <section className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-muted text-xs font-medium tracking-wide uppercase">
            Subtareas · {hechas} de {i.subtareas.length} hechas
          </h3>
          <label className="text-muted flex items-center gap-2 text-xs">
            Cargar desde plantilla:
            <select className={`${CAMPO} w-auto py-1 text-xs`} value="" onChange={(e) => aplicarPlantilla(e.target.value)}>
              <option value="">Elegir…</option>
              {PLANTILLAS.filter((p) => p.pasos.length).map((p) => (
                <option key={p.clave} value={p.clave}>{p.nombre}</option>
              ))}
            </select>
          </label>
        </div>
        <Barra valor={i.subtareas.length ? hechas / i.subtareas.length : 0} color={VERDE} />
        <p className="text-muted text-[11px]">
          La plantilla arma las subtareas hacia atrás desde la fecha de entrega (si no alcanza el tiempo,
          comprime los pasos entre hoy y el lanzamiento). Si después cambiás la fecha, volvé a cargarla o
          ajustá las fechas a mano.
        </p>
        <div className="space-y-1.5">
          {i.subtareas.map((s, idx) => (
            <div key={s.id ?? `n${idx}`} className="border-line grid grid-cols-[auto_1fr] items-center gap-2 rounded-lg border p-2 sm:grid-cols-[auto_1fr_120px_140px_130px_auto]">
              <input type="checkbox" className="size-4 accent-emerald-500" checked={s.hecha} onChange={(e) => setSub(idx, { hecha: e.target.checked })} />
              <input className={`${CAMPO} ${s.hecha ? "text-muted line-through" : ""}`} value={s.titulo} onChange={(e) => setSub(idx, { titulo: e.target.value })} />
              <select className={CAMPO} value={s.fase} onChange={(e) => setSub(idx, { fase: e.target.value as Fase })}>
                {Object.entries(FASES).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
              <input className={CAMPO} list="responsables" placeholder="Responsable" value={s.responsable ?? ""} onChange={(e) => setSub(idx, { responsable: e.target.value })} />
              <input type="date" className={CAMPO} value={s.vence ?? ""} onChange={(e) => setSub(idx, { vence: e.target.value || null })} />
              <button
                type="button"
                onClick={() => setI((x) => ({ ...x, subtareas: x.subtareas.filter((_, j) => j !== idx) }))}
                className="text-muted px-2 text-sm hover:text-rose-400"
                aria-label="Quitar subtarea"
              >
                Quitar
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() =>
              setI((x) => ({
                ...x,
                subtareas: [
                  ...x.subtareas,
                  { titulo: "", fase: "produccion", responsable: x.responsable, vence: x.vence, hecha: false },
                ],
              }))
            }
            className="border-line text-muted hover:text-ink rounded-lg border border-dashed px-3 py-1.5 text-xs"
          >
            + Agregar subtarea
          </button>
        </div>
      </section>

      {error && <Aviso>{error}</Aviso>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          {onBorrar && (
            <button
              type="button"
              onClick={() => confirm("¿Borrar esta iniciativa y sus subtareas?") && onBorrar()}
              className="rounded-lg border border-rose-500/40 px-3 py-1.5 text-sm text-rose-300 hover:bg-rose-500/10"
            >
              Borrar
            </button>
          )}
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={onCerrar} className="border-line text-muted hover:text-ink rounded-lg border px-3 py-1.5 text-sm">
            Cancelar
          </button>
          <button
            type="button"
            disabled={guardando || !i.titulo.trim()}
            onClick={() => onGuardar({ ...i, subtareas: i.subtareas.filter((s) => s.titulo.trim()) })}
            className="bg-c1 rounded-lg px-4 py-1.5 text-sm font-medium text-white disabled:opacity-40"
          >
            {guardando ? "Guardando…" : nuevo ? "Crear iniciativa" : "Guardar cambios"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Editor de fecha comercial
// ---------------------------------------------------------------------------

function EditorEvento({
  inicial,
  onGuardar,
  onBorrar,
  onCerrar,
  guardando,
  error,
}: {
  inicial: Partial<EventoCalendario>;
  onGuardar: (e: Partial<EventoCalendario>) => void;
  onBorrar: (() => void) | null;
  onCerrar: () => void;
  guardando: boolean;
  error: string | null;
}) {
  const [e, setE] = useState<Partial<EventoCalendario>>(inicial);
  const set = <K extends keyof EventoCalendario>(k: K, v: EventoCalendario[K]) => setE((x) => ({ ...x, [k]: v }));
  const marcas = e.marcas ?? [];
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-6">
        <Campo label="Nombre" className="sm:col-span-3">
          <input className={CAMPO} value={e.nombre ?? ""} onChange={(x) => set("nombre", x.target.value)} />
        </Campo>
        <Campo label="Desde">
          <input type="date" className={CAMPO} value={e.desde ?? ""} onChange={(x) => set("desde", x.target.value)} />
        </Campo>
        <Campo label="Hasta">
          <input type="date" className={CAMPO} value={e.hasta ?? ""} onChange={(x) => set("hasta", x.target.value)} />
        </Campo>
        <Campo label="Tipo">
          <select className={CAMPO} value={e.tipo ?? "comercial"} onChange={(x) => set("tipo", x.target.value as EventoCalendario["tipo"])}>
            {Object.entries(TIPOS_EVENTO).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </Campo>
        <Campo label="Importancia">
          <select className={CAMPO} value={e.importancia ?? 2} onChange={(x) => set("importancia", Number(x.target.value) as 1 | 2 | 3)}>
            <option value={3}>Clave del año</option>
            <option value={2}>Importante</option>
            <option value={1}>Oportunidad de contenido</option>
          </select>
        </Campo>
        <Campo label="Empezar a planificar (días antes)">
          <input type="number" min={0} className={CAMPO} value={e.anticipacionDias ?? 45} onChange={(x) => set("anticipacionDias", Number(x.target.value))} />
        </Campo>
        <Campo label="Salir al aire (días antes)">
          <input type="number" min={0} className={CAMPO} value={e.lanzamientoDias ?? 0} onChange={(x) => set("lanzamientoDias", Number(x.target.value))} />
        </Campo>
        <label className="text-muted flex items-center gap-2 self-end pb-2 text-xs sm:col-span-2">
          <input type="checkbox" checked={e.estimada ?? false} onChange={(x) => set("estimada", x.target.checked)} />
          Fecha estimada (sin confirmar)
        </label>
        <div className="sm:col-span-6">
          <span className="text-muted text-[11px]">Marcas (ninguna = todas)</span>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {MARCAS_PLAN.filter((m) => m.clave !== "todas").map((m) => {
              const activo = marcas.includes(m.clave);
              return (
                <button
                  key={m.clave}
                  type="button"
                  onClick={() => set("marcas", activo ? marcas.filter((x) => x !== m.clave) : [...marcas, m.clave])}
                  className={`rounded-lg border px-2 py-1 text-xs ${activo ? "border-c1 bg-c1/15 text-c1" : "border-line text-muted hover:text-ink"}`}
                >
                  {m.nombre}
                </button>
              );
            })}
          </div>
        </div>
        <Campo label="Nota" className="sm:col-span-6">
          <input className={CAMPO} value={e.nota ?? ""} onChange={(x) => set("nota", x.target.value)} />
        </Campo>
      </div>
      {error && <Aviso>{error}</Aviso>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          {onBorrar && (
            <button
              type="button"
              onClick={() => confirm("¿Borrar esta fecha del calendario?") && onBorrar()}
              className="rounded-lg border border-rose-500/40 px-3 py-1.5 text-sm text-rose-300 hover:bg-rose-500/10"
            >
              Borrar
            </button>
          )}
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={onCerrar} className="border-line text-muted hover:text-ink rounded-lg border px-3 py-1.5 text-sm">
            Cancelar
          </button>
          <button
            type="button"
            disabled={guardando || !e.nombre || !e.desde}
            onClick={() => onGuardar({ ...e, hasta: e.hasta || e.desde })}
            className="bg-c1 rounded-lg px-4 py-1.5 text-sm font-medium text-white disabled:opacity-40"
          >
            {guardando ? "Guardando…" : "Guardar fecha"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Vistas
// ---------------------------------------------------------------------------

function TarjetaIniciativa({ i, hoy, onAbrir }: { i: Iniciativa; hoy: string; onAbrir: () => void }) {
  const r = riesgo(i, hoy);
  const a = avance(i);
  return (
    <button
      type="button"
      onClick={onAbrir}
      className="border-line bg-panel-2 hover:border-c1/50 w-full space-y-2 rounded-lg border p-2.5 text-left"
    >
      <div className="flex items-start gap-2">
        <span className="mt-1.5 size-2 shrink-0 rounded-full" style={{ background: colorMarca(i.marca) }} />
        <span className="text-sm leading-tight">{i.titulo}</span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Chip color={RIESGOS[r].color}>{RIESGOS[r].label}</Chip>
        <span className="text-muted text-[11px]">
          {nombreMarca(i.marca)} · vence {fechaCorta(i.vence)}
          {i.responsable && ` · ${i.responsable}`}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <Barra valor={a} color={RIESGOS[r].color} />
        <span className="text-muted w-9 text-right text-[11px] tabular-nums">{Math.round(a * 100)}%</span>
      </div>
    </button>
  );
}

/** Calendario mensual: fechas comerciales, lanzamientos y vencimientos de subtareas. */
function VistaCalendario({
  mes,
  setMes,
  iniciativas,
  eventos,
  hoy,
  onAbrir,
  onEvento,
}: {
  mes: string;
  setMes: (m: string) => void;
  iniciativas: Iniciativa[];
  eventos: EventoCalendario[];
  hoy: string;
  onAbrir: (i: Iniciativa) => void;
  onEvento: (e: EventoCalendario) => void;
}) {
  const [a, m] = mes.split("-").map(Number);
  const primero = `${mes}-01`;
  // Semana de lunes a domingo, como se planifica acá.
  const corrimiento = (new Date(`${primero}T12:00:00Z`).getUTCDay() + 6) % 7;
  const inicio = sumarDiasIso(primero, -corrimiento);
  const dias = Array.from({ length: 42 }, (_, i) => sumarDiasIso(inicio, i));
  const mover = (pasos: number) => {
    const t = a * 12 + (m - 1) + pasos;
    setMes(`${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`);
  };

  return (
    <Panel titulo={`${MESES[m - 1]} ${a}`} nota="Bandas = fechas comerciales · tarjetas = lanzamientos · puntos = subtareas">
      <div className="mb-3 flex gap-1">
        <button type="button" onClick={() => mover(-1)} className="border-line text-muted hover:text-ink rounded-lg border px-2.5 py-1 text-xs">‹ Anterior</button>
        <button type="button" onClick={() => setMes(hoy.slice(0, 7))} className="border-line text-muted hover:text-ink rounded-lg border px-2.5 py-1 text-xs">Hoy</button>
        <button type="button" onClick={() => mover(1)} className="border-line text-muted hover:text-ink rounded-lg border px-2.5 py-1 text-xs">Siguiente ›</button>
      </div>
      <div className="overflow-x-auto">
        <div className="grid min-w-[760px] grid-cols-7 gap-px overflow-hidden rounded-lg bg-[#242a33]">
          {["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"].map((d) => (
            <div key={d} className="bg-panel text-muted px-2 py-1 text-[11px]">{d}</div>
          ))}
          {dias.map((d) => {
            const delMes = d.slice(0, 7) === mes;
            const evs = eventos.filter((e) => e.desde <= d && d <= e.hasta);
            const planificar = eventos.filter((e) => inicioPlanificacion(e) === d);
            const lanz = iniciativas.filter((i) => i.vence === d);
            const subs = iniciativas.flatMap((i) => i.subtareas.filter((s) => s.vence === d).map((s) => ({ s, i })));
            return (
              <div key={d} className={`bg-panel min-h-24 space-y-1 p-1.5 ${delMes ? "" : "opacity-40"} ${d === hoy ? "ring-c1 ring-1 ring-inset" : ""}`}>
                <div className={`text-[11px] tabular-nums ${d === hoy ? "text-c1 font-semibold" : "text-muted"}`}>{Number(d.slice(8))}</div>
                {evs.map((e) => (
                  <button key={e.id} type="button" onClick={() => onEvento(e)} title={e.nota ?? undefined}
                    className="block w-full truncate rounded px-1 py-0.5 text-left text-[10px] font-medium"
                    style={{ background: e.importancia === 3 ? "#f59e0b33" : "#a78bfa26", color: e.importancia === 3 ? AMBAR : "#c4b5fd" }}>
                    {e.importancia === 3 ? "★ " : ""}{e.nombre}{e.estimada ? " (est.)" : ""}
                  </button>
                ))}
                {planificar.map((e) => (
                  <div key={`p${e.id}`} className="truncate text-[10px]" style={{ color: AMBAR }} title="Desde hoy hay que estar planificando esta fecha">
                    ⏰ Planificar {e.nombre}
                  </div>
                ))}
                {lanz.map((i) => {
                  const r = riesgo(i, hoy);
                  return (
                    <button key={i.id} type="button" onClick={() => onAbrir(i)}
                      className="block w-full truncate rounded border px-1 py-0.5 text-left text-[10px]"
                      style={{ borderColor: `${colorMarca(i.marca)}88`, color: RIESGOS[r].color }}>
                      🚀 {i.titulo}
                    </button>
                  );
                })}
                {subs.slice(0, 3).map(({ s, i }) => (
                  <button key={`${i.id}-${s.id ?? s.titulo}`} type="button" onClick={() => onAbrir(i)}
                    className={`flex w-full items-center gap-1 truncate text-left text-[10px] ${s.hecha ? "text-muted line-through" : ""}`}>
                    <span className="size-1.5 shrink-0 rounded-full" style={{ background: s.hecha ? VERDE : !s.hecha && d < hoy ? ROJO : colorMarca(i.marca) }} />
                    <span className="truncate">{s.titulo}</span>
                  </button>
                ))}
                {subs.length > 3 && <div className="text-muted text-[10px]">+{subs.length - 3} más</div>}
              </div>
            );
          })}
        </div>
      </div>
    </Panel>
  );
}

/** Línea de tiempo de 13 semanas: qué se superpone y qué viene. */
function VistaLinea({
  iniciativas,
  eventos,
  hoy,
  onAbrir,
}: {
  iniciativas: Iniciativa[];
  eventos: EventoCalendario[];
  hoy: string;
  onAbrir: (i: Iniciativa) => void;
}) {
  const lunes = sumarDiasIso(hoy, -((new Date(`${hoy}T12:00:00Z`).getUTCDay() + 6) % 7) - 7);
  const total = 13 * 7;
  const fin = sumarDiasIso(lunes, total - 1);
  const pos = (f: string) => Math.max(0, Math.min(100, (diasHasta(lunes, f) / total) * 100));
  const visibles = iniciativas.filter((i) => (i.inicio ?? i.vence) <= fin && i.vence >= lunes);
  const evs = eventos.filter((e) => e.desde <= fin && e.hasta >= lunes);
  const semanas = Array.from({ length: 13 }, (_, k) => sumarDiasIso(lunes, k * 7));

  const fila = (contenido: ReactNode, etiqueta: ReactNode, key: string | number) => (
    <div key={key} className="grid grid-cols-[180px_1fr] items-center gap-2 sm:grid-cols-[240px_1fr]">
      <div className="truncate text-xs">{etiqueta}</div>
      <div className="bg-panel-2 relative h-6 rounded">{contenido}</div>
    </div>
  );

  return (
    <Panel titulo="Línea de tiempo" nota={`${fechaCorta(lunes)} al ${fechaCorta(fin)} · barra = inicio a entrega, relleno = avance`}>
      <div className="overflow-x-auto">
        <div className="min-w-[760px] space-y-1.5">
          <div className="grid grid-cols-[180px_1fr] gap-2 sm:grid-cols-[240px_1fr]">
            <div />
            <div className="text-muted relative h-4 text-[10px]">
              {semanas.map((s) => (
                <span key={s} className="absolute" style={{ left: `${pos(s)}%` }}>{fechaCorta(s)}</span>
              ))}
            </div>
          </div>
          {fila(
            <>
              {evs.map((e) => (
                <div key={e.id} title={`${e.nombre} · planificar desde ${fechaCorta(inicioPlanificacion(e))}`}
                  className="absolute top-0 h-full rounded"
                  style={{
                    left: `${pos(e.desde)}%`,
                    width: `max(4px, ${pos(e.hasta) - pos(e.desde) + 100 / total}%)`,
                    background: e.importancia === 3 ? AMBAR : "#a78bfa",
                  }} />
              ))}
              <div className="bg-c1 absolute top-0 h-full w-0.5" style={{ left: `${pos(hoy)}%` }} title="Hoy" />
            </>,
            <span className="text-muted">Fechas comerciales {evs.length > 0 && `(${evs.map((e) => e.nombre).join(", ")})`}</span>,
            "eventos",
          )}
          {visibles.length === 0 && <p className="text-muted py-4 text-center text-sm">No hay iniciativas en estas semanas.</p>}
          {visibles.map((i) => {
            const r = riesgo(i, hoy);
            const desde = pos(i.inicio ?? i.vence);
            const ancho = Math.max(1, pos(i.vence) - desde + 100 / total);
            return fila(
              <>
                <button type="button" onClick={() => onAbrir(i)} title={`${i.titulo} · ${Math.round(avance(i) * 100)}%`}
                  className="absolute top-0.5 h-5 overflow-hidden rounded border"
                  style={{ left: `${desde}%`, width: `${ancho}%`, borderColor: RIESGOS[r].color, background: `${RIESGOS[r].color}22` }}>
                  <span className="block h-full" style={{ width: `${avance(i) * 100}%`, background: `${RIESGOS[r].color}66` }} />
                </button>
                <div className="bg-c1/60 absolute top-0 h-full w-px" style={{ left: `${pos(hoy)}%` }} />
              </>,
              <button type="button" onClick={() => onAbrir(i)} className="hover:text-c1 flex items-center gap-1.5 truncate text-left">
                <span className="size-2 shrink-0 rounded-full" style={{ background: colorMarca(i.marca) }} />
                <span className="truncate">{i.titulo}</span>
              </button>,
              i.id ?? i.titulo,
            );
          })}
        </div>
      </div>
    </Panel>
  );
}

function VistaTablero({
  iniciativas,
  hoy,
  onAbrir,
  onEstado,
}: {
  iniciativas: Iniciativa[];
  hoy: string;
  onAbrir: (i: Iniciativa) => void;
  onEstado: (i: Iniciativa, e: Estado) => void;
}) {
  const columnas: Estado[] = ["idea", "planificada", "en_curso", "en_revision", "entregada"];
  return (
    <div className="overflow-x-auto">
      <div className="grid min-w-[980px] grid-cols-5 gap-3">
        {columnas.map((c) => {
          const items = iniciativas.filter((i) => i.estado === c);
          return (
            <div key={c} className="border-line bg-panel min-h-40 space-y-2 rounded-xl border p-2">
              <div className="flex items-center justify-between px-1">
                <span className="text-sm font-medium">{ESTADOS[c]}</span>
                <span className="text-muted text-xs">{items.length}</span>
              </div>
              {items.map((i) => (
                <div key={i.id} className="space-y-1">
                  <TarjetaIniciativa i={i} hoy={hoy} onAbrir={() => onAbrir(i)} />
                  <select
                    aria-label="Mover a"
                    value={i.estado}
                    onChange={(e) => onEstado(i, e.target.value as Estado)}
                    className="border-line bg-panel text-muted w-full rounded-md border px-1.5 py-0.5 text-[11px]"
                  >
                    {Object.entries(ESTADOS).map(([k, v]) => (
                      <option key={k} value={k}>Mover a: {v}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * LO PENDIENTE, agrupado por cuándo hay que hacerlo. Es la vista con la que
 * abre la página: es "Mis tareas", y lo primero que se mira es qué hay que
 * hacer hoy.
 *
 * Entran las subtareas sin hacer y, además, las iniciativas abiertas que no
 * tienen subtareas (su propia entrega es la tarea). Lo tildado en los últimos
 * 7 días queda abajo, para poder destildar un error.
 */
function VistaPendientes({
  iniciativas,
  hoy,
  responsable,
  guardando,
  onAbrir,
  onTildar,
}: {
  iniciativas: Iniciativa[];
  hoy: string;
  responsable: string;
  guardando: boolean;
  onAbrir: (i: Iniciativa) => void;
  onTildar: (s: Subtarea, hecha: boolean) => void;
}) {
  type Item = { s: Subtarea | null; i: Iniciativa; vence: string | null; titulo: string; quien: string | null };
  const abiertas = iniciativas.filter((i) => i.estado !== "entregada" && i.estado !== "cancelada");
  const items: Item[] = abiertas.flatMap<Item>((i) =>
    i.subtareas.length
      ? i.subtareas
          .filter((s) => !s.hecha)
          .map((s) => ({ s, i, vence: s.vence, titulo: s.titulo, quien: s.responsable ?? i.responsable }))
      : [{ s: null, i, vence: i.vence, titulo: `Entregar: ${i.titulo}`, quien: i.responsable }],
  );
  const mias = items.filter((x) => !responsable || x.quien === responsable);
  const semana = sumarDiasIso(hoy, 7);
  const mes = sumarDiasIso(hoy, 30);
  const grupos: { titulo: string; color: string; items: Item[] }[] = [
    { titulo: "Vencidas", color: ROJO, items: mias.filter((x) => x.vence && x.vence < hoy) },
    { titulo: "Hoy", color: AMBAR, items: mias.filter((x) => x.vence === hoy) },
    { titulo: "Próximos 7 días", color: "#3b82f6", items: mias.filter((x) => x.vence && x.vence > hoy && x.vence <= semana) },
    { titulo: "Próximos 30 días", color: "#a78bfa", items: mias.filter((x) => x.vence && x.vence > semana && x.vence <= mes) },
    { titulo: "Más adelante", color: "#8b93a1", items: mias.filter((x) => x.vence && x.vence > mes) },
    { titulo: "Sin fecha", color: "#8b93a1", items: mias.filter((x) => !x.vence) },
  ];
  for (const g of grupos) g.items.sort((a, b) => (a.vence ?? "").localeCompare(b.vence ?? ""));

  const hace7 = sumarDiasIso(hoy, -7);
  const hechas = iniciativas
    .flatMap((i) => i.subtareas.filter((s) => s.hecha && (s.hechaEn ?? "").slice(0, 10) >= hace7).map((s) => ({ s, i })))
    .filter(({ s, i }) => !responsable || (s.responsable ?? i.responsable) === responsable)
    .sort((a, b) => (b.s.hechaEn ?? "").localeCompare(a.s.hechaEn ?? ""));

  const fila = (x: Item) => (
    <li key={`${x.i.id}-${x.s?.id ?? "entrega"}`} className="border-line flex items-start gap-3 border-t py-2 first:border-t-0">
      {x.s ? (
        <input
          type="checkbox"
          className="mt-1 size-4 accent-emerald-500"
          checked={false}
          disabled={!x.s.id || guardando}
          onChange={() => onTildar(x.s!, true)}
          aria-label={`Marcar hecha: ${x.titulo}`}
        />
      ) : (
        <span className="mt-1 size-4 shrink-0 rounded-full border-2" style={{ borderColor: colorMarca(x.i.marca) }} title="Entrega de la iniciativa: se marca desde la iniciativa" />
      )}
      <button type="button" onClick={() => onAbrir(x.i)} className="min-w-0 flex-1 text-left">
        <span className="block text-sm leading-tight">{x.titulo}</span>
        <span className="text-muted mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px]">
          <span className="inline-flex items-center gap-1">
            <span className="size-1.5 rounded-full" style={{ background: colorMarca(x.i.marca) }} />
            {x.i.titulo}
          </span>
          {x.s && <span>{FASES[x.s.fase]}</span>}
          {x.quien && <span>· {x.quien}</span>}
        </span>
      </button>
      <span className={`shrink-0 text-xs tabular-nums ${x.vence && x.vence < hoy ? "text-rose-400" : "text-muted"}`}>
        {x.vence ? fechaCorta(x.vence) : "—"}
      </span>
    </li>
  );

  return (
    <div className="space-y-4">
      {mias.length === 0 && (
        <Panel titulo="Pendientes">
          <p className="text-muted text-sm">
            {iniciativas.length ? "No hay nada pendiente" : "Todavía no hay iniciativas cargadas"}
            {responsable ? ` para ${responsable}` : ""}.
          </p>
        </Panel>
      )}
      {grupos
        .filter((g) => g.items.length)
        .map((g) => (
          <Panel key={g.titulo} titulo={g.titulo} nota={`${g.items.length} tarea(s)`}>
            <div className="-mt-2 mb-1 h-0.5 w-10 rounded" style={{ background: g.color }} />
            <ul>{g.items.map(fila)}</ul>
          </Panel>
        ))}
      {hechas.length > 0 && (
        <Panel titulo="Hechas en los últimos 7 días" nota="Destildá si fue un error">
          <ul>
            {hechas.map(({ s, i }) => (
              <li key={`${i.id}-${s.id}`} className="border-line flex items-start gap-3 border-t py-2 first:border-t-0">
                <input
                  type="checkbox"
                  className="mt-1 size-4 accent-emerald-500"
                  checked
                  disabled={!s.id || guardando}
                  onChange={() => onTildar(s, false)}
                  aria-label={`Marcar pendiente: ${s.titulo}`}
                />
                <button type="button" onClick={() => onAbrir(i)} className="text-muted min-w-0 flex-1 text-left text-sm line-through">
                  {s.titulo}
                  <span className="ml-2 text-[11px] no-underline">· {i.titulo}</span>
                </button>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}

function VistaLista({ iniciativas, hoy, onAbrir }: { iniciativas: Iniciativa[]; hoy: string; onAbrir: (i: Iniciativa) => void }) {
  return (
    <Panel titulo="Todas las iniciativas" nota="Ordenadas por fecha de entrega">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-muted border-line border-b text-left text-xs">
              {["Iniciativa", "Marca", "Tipo", "Responsable", "Entrega", "Avance", "Estado", "Presupuesto", "KPI"].map((h) => (
                <th key={h} className="px-2 py-2 font-medium whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-line divide-y">
            {[...iniciativas].sort((a, b) => a.vence.localeCompare(b.vence)).map((i) => {
              const r = riesgo(i, hoy);
              return (
                <tr key={i.id} className="hover:bg-panel-2 cursor-pointer" onClick={() => onAbrir(i)}>
                  <td className="px-2 py-2">{i.titulo}</td>
                  <td className="px-2 py-2 whitespace-nowrap">
                    <span className="mr-1.5 inline-block size-2 rounded-full" style={{ background: colorMarca(i.marca) }} />
                    {nombreMarca(i.marca)}
                  </td>
                  <td className="text-muted px-2 py-2 text-xs">{TIPOS_INICIATIVA[i.tipo]}</td>
                  <td className="text-muted px-2 py-2 text-xs">{i.responsable ?? "—"}</td>
                  <td className="px-2 py-2 tabular-nums">{fechaCorta(i.vence)}</td>
                  <td className="w-32 px-2 py-2">
                    <div className="flex items-center gap-2">
                      <Barra valor={avance(i)} color={RIESGOS[r].color} />
                      <span className="text-muted w-9 text-right text-[11px] tabular-nums">{Math.round(avance(i) * 100)}%</span>
                    </div>
                  </td>
                  <td className="px-2 py-2">
                    <Chip color={RIESGOS[r].color}>{i.estado === "entregada" || i.estado === "cancelada" ? ESTADOS[i.estado] : `${ESTADOS[i.estado]} · ${RIESGOS[r].label}`}</Chip>
                  </td>
                  <td className="px-2 py-2 whitespace-nowrap tabular-nums">{i.presupuesto ? fmtMoneda(i.presupuesto) : "—"}</td>
                  <td className="text-muted px-2 py-2 text-xs">{i.kpi ?? "—"}{i.meta ? ` · meta ${i.meta.toLocaleString("es-AR")}` : ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {iniciativas.length === 0 && <p className="text-muted py-6 text-center text-sm">Todavía no hay iniciativas cargadas.</p>}
      </div>
    </Panel>
  );
}

function VistaFechas({
  eventos,
  iniciativas,
  hoy,
  onEvento,
  onPlanificar,
}: {
  eventos: EventoCalendario[];
  iniciativas: Iniciativa[];
  hoy: string;
  onEvento: (e: EventoCalendario) => void;
  onPlanificar: (e: EventoCalendario) => void;
}) {
  return (
    <Panel titulo="Calendario comercial" nota="Cuándo empezar a planificar cada fecha y cuándo salir al aire">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-muted border-line border-b text-left text-xs">
              {["Fecha", "Cuándo", "Tipo", "Marcas", "Planificar desde", "Salir al aire", "Faltan", "Iniciativas", ""].map((h) => (
                <th key={h} className="px-2 py-2 font-medium whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-line divide-y">
            {eventos.map((e) => {
              const faltan = diasHasta(hoy, e.desde);
              const ligadas = iniciativas.filter((i) => i.eventoId === e.id);
              const enVentana = hoy >= inicioPlanificacion(e) && e.hasta >= hoy;
              return (
                <tr key={e.id}>
                  <td className="px-2 py-2">
                    <button type="button" onClick={() => onEvento(e)} className="hover:text-c1 text-left">
                      {e.importancia === 3 && <span style={{ color: AMBAR }}>★ </span>}
                      {e.nombre}
                    </button>
                    {e.estimada && <span className="text-muted ml-1.5 text-[11px]">(estimada)</span>}
                  </td>
                  <td className="px-2 py-2 whitespace-nowrap tabular-nums">
                    {fechaCorta(e.desde)}{e.hasta !== e.desde && ` al ${fechaCorta(e.hasta)}`}/{e.desde.slice(2, 4)}
                  </td>
                  <td className="text-muted px-2 py-2 text-xs">{TIPOS_EVENTO[e.tipo]}</td>
                  <td className="text-muted px-2 py-2 text-xs">{e.marcas?.map(nombreMarca).join(", ") ?? "Todas"}</td>
                  <td className="px-2 py-2 tabular-nums" style={{ color: enVentana && !ligadas.length ? AMBAR : undefined }}>
                    {fechaCorta(inicioPlanificacion(e))}
                  </td>
                  <td className="px-2 py-2 tabular-nums">{fechaCorta(lanzamientoDe(e))}</td>
                  <td className="px-2 py-2 tabular-nums">{faltan < 0 ? "Pasó" : `${faltan} días`}</td>
                  <td className="px-2 py-2 text-xs">
                    {ligadas.length ? (
                      <Chip color={VERDE}>{ligadas.length} cargada(s)</Chip>
                    ) : enVentana ? (
                      <Chip color={AMBAR}>Sin planificar</Chip>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td className="px-2 py-2">
                    {faltan >= 0 && (
                      <button type="button" onClick={() => onPlanificar(e)} className="text-c1 text-xs whitespace-nowrap hover:underline">
                        Planificar →
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Página
// ---------------------------------------------------------------------------

type Editando =
  | { tipo: "iniciativa"; datos: Iniciativa }
  | { tipo: "evento"; datos: Partial<EventoCalendario> }
  | null;

export default function Planificacion() {
  const [hoy] = useState(hoyAr);
  // Se trae una ventana amplia (2 meses atrás, 14 adelante) y se filtra en la
  // pantalla: son decenas de filas, y así el calendario se navega sin esperas.
  const desde = sumarDiasIso(hoy, -60);
  const hasta = sumarDiasIso(hoy, 420);

  const [iniciativas, setIniciativas] = useState<Iniciativa[]>([]);
  const [eventos, setEventos] = useState<EventoCalendario[]>([]);
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [vista, setVista] = useState<Vista>("pendientes");
  const [mes, setMes] = useState(hoy.slice(0, 7));
  const [marca, setMarca] = useState<string>("");
  const [responsable, setResponsable] = useState<string>("");
  const [ocultarCerradas, setOcultarCerradas] = useState(false);
  const [editando, setEditando] = useState<Editando>(null);
  const [guardando, setGuardando] = useState(false);
  const [errorGuardar, setErrorGuardar] = useState<string | null>(null);

  async function cargar() {
    try {
      const r = await fetch(`/api/marketing/planificacion?desde=${desde}&hasta=${hasta}`);
      const j = (await r.json()) as { iniciativas?: Iniciativa[]; eventos?: EventoCalendario[]; error?: string };
      if (!r.ok) throw new Error(j.error ?? `Error ${r.status}`);
      setIniciativas(j.iniciativas ?? []);
      setEventos(j.eventos ?? []);
      setErrorCarga(null);
    } catch (e) {
      setErrorCarga(e instanceof Error ? e.message : String(e));
    } finally {
      setCargando(false);
    }
  }

  useEffect(() => {
    // La primera carga. El rango sale de `hoy`, que no cambia en la vida de
    // la pantalla: no hay nada de qué depender. Los setState de `cargar` pasan
    // después del fetch, no en el cuerpo del efecto.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function enviar(metodo: "POST" | "PATCH" | "DELETE", cuerpo?: unknown, qs = "") {
    setGuardando(true);
    setErrorGuardar(null);
    try {
      const r = await fetch(`/api/marketing/planificacion${qs}`, {
        method: metodo,
        headers: cuerpo ? { "Content-Type": "application/json" } : undefined,
        body: cuerpo ? JSON.stringify(cuerpo) : undefined,
      });
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) throw new Error(j.error ?? `Error ${r.status}`);
      await cargar();
      return true;
    } catch (e) {
      setErrorGuardar(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setGuardando(false);
    }
  }

  const guardarIniciativa = async (i: Iniciativa) => {
    const ok = await enviar(i.id ? "PATCH" : "POST", { tipo: "iniciativa", id: i.id, datos: i });
    if (ok) setEditando(null);
  };
  const guardarEvento = async (e: Partial<EventoCalendario>) => {
    const ok = await enviar(e.id ? "PATCH" : "POST", { tipo: "evento", id: e.id, datos: e });
    if (ok) setEditando(null);
  };
  const tildar = async (s: Subtarea, hecha: boolean) => {
    // Optimista: se tilda en pantalla y después se confirma.
    setIniciativas((xs) => xs.map((i) => ({ ...i, subtareas: i.subtareas.map((x) => (x.id === s.id ? { ...x, hecha } : x)) })));
    await enviar("PATCH", { tipo: "subtarea", id: s.id, hecha });
  };

  const planificarEvento = (e: EventoCalendario) => {
    const p = PLANTILLAS.find((x) => x.clave === "estacional")!;
    const lanz = lanzamientoDe(e);
    setErrorGuardar(null);
    setEditando({
      tipo: "iniciativa",
      datos: desdePlantilla(
        p,
        lanz < hoy ? hoy : lanz,
        {
          titulo: `${e.nombre} ${e.desde.slice(0, 4)}`,
          eventoId: e.id,
          marca: (e.marcas?.length === 1 ? e.marcas[0] : "todas") as Iniciativa["marca"],
        },
        hoy,
      ),
    });
  };

  const responsables = useMemo(() => {
    const s = new Set(RESPONSABLES_SUGERIDOS);
    for (const i of iniciativas) {
      if (i.responsable) s.add(i.responsable);
      for (const t of i.subtareas) if (t.responsable) s.add(t.responsable);
    }
    return [...s];
  }, [iniciativas]);

  const filtradas = iniciativas.filter(
    (i) =>
      (!marca || i.marca === marca || i.marca === "todas") &&
      (!responsable || i.responsable === responsable || i.subtareas.some((s) => s.responsable === responsable)) &&
      (!ocultarCerradas || (i.estado !== "entregada" && i.estado !== "cancelada")),
  );
  const eventosFiltrados = eventos.filter((e) => !marca || !e.marcas || e.marcas.includes(marca));

  // KPIs del plan.
  const abiertas = filtradas.filter((i) => i.estado !== "entregada" && i.estado !== "cancelada" && i.estado !== "idea");
  const riesgos = abiertas.map((i) => riesgo(i, hoy));
  const atrasadas = riesgos.filter((r) => r === "atrasada").length;
  const enRiesgo = riesgos.filter((r) => r === "en_riesgo").length;
  const avancePromedio = abiertas.length ? abiertas.reduce((s, i) => s + avance(i), 0) / abiertas.length : 0;
  const entregadas = filtradas.filter((i) => i.estado === "entregada");
  const puntuales = entregadas.filter((i) => aTiempo(i)).length;
  const presupuesto = filtradas.filter((i) => i.estado !== "cancelada").reduce((s, i) => s + (i.presupuesto ?? 0), 0);
  const semana = sumarDiasIso(hoy, 7);

  // Mis próximas: subtareas sin hacer vencidas o que vencen en 14 días.
  const proximas = filtradas
    .flatMap((i) => i.subtareas.filter((s) => !s.hecha && s.vence && s.vence <= sumarDiasIso(hoy, 14)).map((s) => ({ s, i })))
    .filter(({ s }) => !responsable || s.responsable === responsable)
    .sort((a, b) => (a.s.vence ?? "").localeCompare(b.s.vence ?? ""));
  const vencenSemana = proximas.filter(({ s }) => s.vence! >= hoy && s.vence! <= semana).length;

  // Alertas: fechas en ventana de planificación sin ninguna iniciativa.
  const sinPlanificar = eventosFiltrados.filter(
    (e) => hoy >= inicioPlanificacion(e) && e.desde >= hoy && !iniciativas.some((i) => i.eventoId === e.id),
  );
  const proximasFechas = eventosFiltrados.filter((e) => e.desde >= hoy).slice(0, 6);

  const abrir = (i: Iniciativa) => {
    setErrorGuardar(null);
    setEditando({ tipo: "iniciativa", datos: i });
  };
  const abrirEvento = (e: EventoCalendario) => {
    setErrorGuardar(null);
    setEditando({ tipo: "evento", datos: e });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Mis tareas · Marketing</h1>
          <p className="text-muted text-sm">
            Lo pendiente, el calendario comercial y la planificación de cada iniciativa: brief, subtareas con responsable y fecha, y avance.
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => { setErrorGuardar(null); setEditando({ tipo: "evento", datos: { desde: hoy, hasta: hoy, tipo: "comercial", importancia: 2, anticipacionDias: 45, lanzamientoDias: 0 } }); }}
            className="border-line text-muted hover:text-ink rounded-lg border px-3 py-1.5 text-sm">
            + Fecha
          </button>
          <button type="button" onClick={() => { setErrorGuardar(null); setEditando({ tipo: "iniciativa", datos: iniciativaVacia(hoy) }); }}
            className="bg-c1 rounded-lg px-3 py-1.5 text-sm font-medium text-white">
            + Iniciativa
          </button>
        </div>
      </div>

      {errorCarga && (
        <Aviso>
          {errorCarga}
        </Aviso>
      )}

      {sinPlanificar.length > 0 && (
        <div className="space-y-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3">
          <p className="text-sm font-medium text-amber-200">Fechas que ya hay que estar planificando</p>
          <div className="flex flex-wrap gap-2">
            {sinPlanificar.map((e) => (
              <button key={e.id} type="button" onClick={() => planificarEvento(e)}
                className="rounded-lg border border-amber-500/40 px-3 py-1.5 text-left text-xs text-amber-100 hover:bg-amber-500/15">
                <b>{e.nombre}</b> · {fechaCorta(e.desde)} · faltan {diasHasta(hoy, e.desde)} días · salir al aire el {fechaCorta(lanzamientoDe(e))}
                <span className="ml-2 underline">Planificar con plantilla →</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <TarjetaKpi titulo="Iniciativas abiertas" valor={String(abiertas.length)} detalle={`${filtradas.filter((i) => i.estado === "idea").length} ideas sin planificar`} />
        <TarjetaKpi titulo="Avance promedio" valor={`${Math.round(avancePromedio * 100)}%`} detalle="Subtareas hechas de las abiertas" />
        <TarjetaKpi titulo="Atrasadas" valor={String(atrasadas)} acento={atrasadas ? ROJO : VERDE} detalle="Vencidas o con subtareas vencidas" />
        <TarjetaKpi titulo="En riesgo" valor={String(enRiesgo)} acento={enRiesgo ? AMBAR : VERDE} detalle="El avance va detrás del tiempo" />
        <TarjetaKpi titulo="Entregas a tiempo" valor={entregadas.length ? `${Math.round((puntuales / entregadas.length) * 100)}%` : "—"} acento={entregadas.length && puntuales < entregadas.length ? AMBAR : undefined} detalle={`${puntuales} de ${entregadas.length} entregadas · meta 100 %`} />
        <TarjetaKpi titulo="Presupuesto planificado" valor={presupuesto ? fmtMoneda(presupuesto) : "—"} detalle={`${vencenSemana} subtarea(s) vencen esta semana`} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
        <div className="min-w-0 space-y-3">
          <div className="border-line bg-panel flex flex-wrap items-end gap-3 rounded-xl border p-3">
            <Campo label="Marca">
              <select className={`${CAMPO} w-auto`} value={marca} onChange={(e) => setMarca(e.target.value)}>
                <option value="">Todas</option>
                {MARCAS_PLAN.filter((m) => m.clave !== "todas").map((m) => (
                  <option key={m.clave} value={m.clave}>{m.nombre}</option>
                ))}
              </select>
            </Campo>
            <Campo label="Responsable">
              <select className={`${CAMPO} w-auto`} value={responsable} onChange={(e) => setResponsable(e.target.value)}>
                <option value="">Todos</option>
                {responsables.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </Campo>
            <label className="text-muted flex items-center gap-2 pb-2 text-xs">
              <input type="checkbox" checked={ocultarCerradas} onChange={(e) => setOcultarCerradas(e.target.checked)} />
              Ocultar entregadas y canceladas
            </label>
            {cargando && <span className="text-muted pb-2 text-xs">Cargando…</span>}
          </div>

          <nav className="border-line -mx-1 flex gap-1 overflow-x-auto border-b px-1">
            {VISTAS.map((v) => (
              <button key={v.clave} type="button" onClick={() => setVista(v.clave)}
                className={`border-b-2 px-3 py-2 text-sm whitespace-nowrap ${vista === v.clave ? "border-c1 text-ink" : "text-muted hover:text-ink border-transparent"}`}>
                {v.label}
              </button>
            ))}
          </nav>

          {vista === "pendientes" && (
            <VistaPendientes iniciativas={filtradas} hoy={hoy} responsable={responsable} guardando={guardando} onAbrir={abrir} onTildar={(s, h) => void tildar(s, h)} />
          )}
          {vista === "calendario" && (
            <VistaCalendario mes={mes} setMes={setMes} iniciativas={filtradas} eventos={eventosFiltrados} hoy={hoy} onAbrir={abrir} onEvento={abrirEvento} />
          )}
          {vista === "linea" && <VistaLinea iniciativas={filtradas} eventos={eventosFiltrados} hoy={hoy} onAbrir={abrir} />}
          {vista === "tablero" && (
            <VistaTablero iniciativas={filtradas} hoy={hoy} onAbrir={abrir} onEstado={(i, e) => void enviar("PATCH", { tipo: "iniciativa", id: i.id, datos: { ...i, estado: e } })} />
          )}
          {vista === "lista" && <VistaLista iniciativas={filtradas} hoy={hoy} onAbrir={abrir} />}
          {vista === "fechas" && (
            <VistaFechas eventos={eventosFiltrados} iniciativas={iniciativas} hoy={hoy} onEvento={abrirEvento} onPlanificar={planificarEvento} />
          )}
        </div>

        <div className="space-y-4">
          {/* En la vista Pendientes sería repetir lo mismo al lado. */}
          {vista !== "pendientes" && (
          <Panel titulo="Próximas subtareas" nota={responsable ? responsable : "Vencidas y próximos 14 días"}>
            {proximas.length === 0 ? (
              <p className="text-muted text-sm">Nada pendiente en los próximos 14 días.</p>
            ) : (
              <ul className="space-y-1.5">
                {proximas.slice(0, 14).map(({ s, i }) => {
                  const vencida = s.vence! < hoy;
                  return (
                    <li key={`${i.id}-${s.id}`} className="flex items-start gap-2 text-sm">
                      <input type="checkbox" className="mt-1 size-4 accent-emerald-500" checked={s.hecha} disabled={!s.id || guardando} onChange={(e) => void tildar(s, e.target.checked)} />
                      <button type="button" onClick={() => abrir(i)} className="min-w-0 flex-1 text-left">
                        <span className="block leading-tight">{s.titulo}</span>
                        <span className="text-muted block truncate text-[11px]">
                          <span style={{ color: vencida ? ROJO : undefined }}>{vencida ? `Venció ${fechaCorta(s.vence)}` : fechaCorta(s.vence)}</span>
                          {" · "}{i.titulo}{s.responsable && ` · ${s.responsable}`}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
          )}

          <Panel titulo="Fechas que vienen" nota="★ = clave del año">
            <ul className="space-y-2">
              {proximasFechas.map((e) => {
                const faltan = diasHasta(hoy, e.desde);
                const ligadas = iniciativas.filter((i) => i.eventoId === e.id);
                return (
                  <li key={e.id} className="text-sm">
                    <button type="button" onClick={() => abrirEvento(e)} className="hover:text-c1 text-left">
                      {e.importancia === 3 && <span style={{ color: AMBAR }}>★ </span>}
                      {e.nombre} <span className="text-muted">· {fechaCorta(e.desde)}{e.estimada ? " (est.)" : ""}</span>
                    </button>
                    <div className="text-muted text-[11px]">
                      Faltan {faltan} días · planificar desde {fechaCorta(inicioPlanificacion(e))} ·{" "}
                      {ligadas.length ? (
                        <span style={{ color: VERDE }}>{ligadas.length} iniciativa(s)</span>
                      ) : (
                        <button type="button" onClick={() => planificarEvento(e)} className="text-c1 hover:underline">planificar</button>
                      )}
                    </div>
                  </li>
                );
              })}
              {proximasFechas.length === 0 && <li className="text-muted text-sm">Sin fechas cargadas.</li>}
            </ul>
          </Panel>

          <Panel titulo="Cómo se usa">
            <ol className="text-muted list-decimal space-y-1 pl-4 text-xs">
              <li>Las <b className="text-ink">fechas comerciales</b> avisan cuándo empezar a planificar (★ las clave).</li>
              <li>Cada <b className="text-ink">iniciativa</b> arranca con su brief: objetivo, KPI y meta, público, canales y presupuesto.</li>
              <li>La <b className="text-ink">plantilla</b> arma las subtareas hacia atrás desde el lanzamiento, por fase.</li>
              <li>Tildar subtareas mueve el <b className="text-ink">avance</b>; el semáforo marca lo atrasado o en riesgo.</li>
              <li>Después del lanzamiento, cargar el <b className="text-ink">resultado</b> contra el KPI.</li>
            </ol>
          </Panel>
        </div>
      </div>

      {editando?.tipo === "iniciativa" && (
        <Modal titulo={editando.datos.id ? "Editar iniciativa" : "Nueva iniciativa"} onCerrar={() => setEditando(null)}>
          <EditorIniciativa
            hoy={hoy}
            key={editando.datos.id ?? "nueva"}
            inicial={editando.datos}
            eventos={eventos}
            responsables={responsables}
            guardando={guardando}
            error={errorGuardar}
            onCerrar={() => setEditando(null)}
            onGuardar={guardarIniciativa}
            onBorrar={
              editando.datos.id
                ? async () => {
                    if (await enviar("DELETE", undefined, `?tipo=iniciativa&id=${editando.datos.id}`)) setEditando(null);
                  }
                : null
            }
          />
        </Modal>
      )}
      {editando?.tipo === "evento" && (
        <Modal titulo={editando.datos.id ? "Editar fecha comercial" : "Nueva fecha comercial"} onCerrar={() => setEditando(null)}>
          <EditorEvento
            inicial={editando.datos}
            guardando={guardando}
            error={errorGuardar}
            onCerrar={() => setEditando(null)}
            onGuardar={guardarEvento}
            onBorrar={
              editando.datos.id
                ? async () => {
                    if (await enviar("DELETE", undefined, `?tipo=evento&id=${editando.datos.id}`)) setEditando(null);
                  }
                : null
            }
          />
        </Modal>
      )}
    </div>
  );
}
