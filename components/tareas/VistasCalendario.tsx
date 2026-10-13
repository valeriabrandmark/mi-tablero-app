"use client";

import { estaAtrasada, fmtDuracion, nombreAccion, type Tarea } from "@/lib/tareas";
import {
  claveDia,
  diaLargo,
  horaDe,
  inicioDeMes,
  inicioDeSemana,
  mismoDia,
  sumarDias,
} from "./fechas";

const COLOR_PRIORIDAD = {
  alta: "border-l-rose-400",
  media: "border-l-c3",
  baja: "border-l-c5",
} as const;

/** Las tareas agrupadas por día local, ya ordenadas por hora. */
export function porDia(tareas: Tarea[]): Map<string, Tarea[]> {
  const m = new Map<string, Tarea[]>();
  for (const t of [...tareas].sort((a, b) => a.inicio.localeCompare(b.inicio))) {
    const k = claveDia(new Date(t.inicio));
    m.set(k, [...(m.get(k) ?? []), t]);
  }
  return m;
}

/** Una tarea en el calendario: hora, título y cómo está. */
export function ChipTarea({
  tarea,
  ahora,
  compacta = false,
  alAbrir,
}: {
  tarea: Tarea;
  ahora: Date;
  compacta?: boolean;
  alAbrir: (t: Tarea) => void;
}) {
  const hecha = tarea.estado === "hecha";
  const cancelada = tarea.estado === "cancelada";
  const atrasada = estaAtrasada(tarea, ahora);
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        alAbrir(tarea);
      }}
      title={`${horaDe(new Date(tarea.inicio))} · ${tarea.titulo}${tarea.categoria ? ` · ${tarea.categoria}` : ""}`}
      className={`bg-panel-2 hover:bg-line w-full truncate rounded-md border-l-[3px] text-left ${
        COLOR_PRIORIDAD[tarea.prioridad]
      } ${compacta ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-1 text-xs"} ${
        hecha || cancelada ? "opacity-50" : ""
      } ${atrasada ? "ring-1 ring-rose-500/50" : ""}`}
    >
      <span className="text-muted tabular-nums">{horaDe(new Date(tarea.inicio))}</span>{" "}
      {tarea.accion && <span title="Automática">⚙️ </span>}
      {tarea.recurrenciaId && !compacta && <span title="Se repite">↻ </span>}
      {tarea.estado === "en_curso" && <span title="En curso">▶ </span>}
      <span className={hecha ? "line-through" : cancelada ? "line-through" : ""}>{tarea.titulo}</span>
    </button>
  );
}

export function VistaSemana({
  referencia,
  tareas,
  ahora,
  alAbrir,
  alNueva,
}: {
  referencia: Date;
  tareas: Tarea[];
  ahora: Date;
  alAbrir: (t: Tarea) => void;
  alNueva: (dia: Date) => void;
}) {
  const lunes = inicioDeSemana(referencia);
  const dias = Array.from({ length: 7 }, (_, i) => sumarDias(lunes, i));
  const mapa = porDia(tareas);

  return (
    // En celular la semana scrollea de costado: siete columnas no entran en
    // 360 px y achicarlas dejaría los títulos ilegibles.
    <div className="overflow-x-auto">
      <div className="grid min-w-[840px] grid-cols-7 gap-2">
        {dias.map((d) => {
          const lista = mapa.get(claveDia(d)) ?? [];
          const minutos = lista
            .filter((t) => !t.accion && t.estado !== "cancelada")
            .reduce((s, t) => s + t.duracionMin, 0);
          const esHoy = mismoDia(d, ahora);
          return (
            <div
              key={claveDia(d)}
              onClick={() => alNueva(d)}
              className={`border-line hover:border-c1/40 min-h-48 cursor-pointer rounded-xl border p-2 ${
                esHoy ? "bg-c1/5 border-c1/40" : "bg-panel"
              }`}
            >
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-1">
                <span className={`text-xs capitalize ${esHoy ? "text-c1 font-semibold" : "text-muted"}`}>
                  {diaLargo(d)}
                </span>
                {minutos > 0 && <span className="text-muted text-[10px]">{fmtDuracion(minutos)}</span>}
              </div>
              <div className="flex flex-col gap-1">
                {lista.map((t) => (
                  <ChipTarea key={t.id} tarea={t} ahora={ahora} alAbrir={alAbrir} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function VistaMes({
  referencia,
  tareas,
  ahora,
  alAbrir,
  alElegirDia,
}: {
  referencia: Date;
  tareas: Tarea[];
  ahora: Date;
  alAbrir: (t: Tarea) => void;
  alElegirDia: (dia: Date) => void;
}) {
  const primero = inicioDeMes(referencia);
  const desde = inicioDeSemana(primero);
  const semanas = Math.ceil((((primero.getDay() + 6) % 7) + new Date(primero.getFullYear(), primero.getMonth() + 1, 0).getDate()) / 7);
  const dias = Array.from({ length: semanas * 7 }, (_, i) => sumarDias(desde, i));
  const mapa = porDia(tareas);
  const MAX = 3;

  return (
    <div className="overflow-x-auto">
      <div className="grid min-w-[700px] grid-cols-7 gap-1">
        {["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"].map((d) => (
          <div key={d} className="text-muted pb-1 text-center text-[11px]">
            {d}
          </div>
        ))}
        {dias.map((d) => {
          const lista = mapa.get(claveDia(d)) ?? [];
          const delMes = d.getMonth() === primero.getMonth();
          const esHoy = mismoDia(d, ahora);
          return (
            <div
              key={claveDia(d)}
              onClick={() => alElegirDia(d)}
              className={`border-line hover:border-c1/40 min-h-24 cursor-pointer rounded-lg border p-1 ${
                esHoy ? "bg-c1/5 border-c1/40" : "bg-panel"
              } ${delMes ? "" : "opacity-40"}`}
            >
              <div className={`mb-1 text-right text-[11px] ${esHoy ? "text-c1 font-semibold" : "text-muted"}`}>
                {d.getDate()}
              </div>
              <div className="flex flex-col gap-0.5">
                {lista.slice(0, MAX).map((t) => (
                  <ChipTarea key={t.id} tarea={t} ahora={ahora} compacta alAbrir={alAbrir} />
                ))}
                {lista.length > MAX && (
                  <span className="text-muted px-1 text-[10px]">+{lista.length - MAX} más</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Lo de hoy, con los botones para moverlo. Es lo primero de la pantalla: el
 * calendario sirve para planificar, esto es para trabajar.
 *
 * Las atrasadas van arriba de todo, separadas: si se mezclan con las de hoy
 * por hora, quedan escondidas al principio de la lista y se pasan de largo.
 */
export function ListaDelDia({
  tareas,
  ahora,
  alAbrir,
  alCambiarEstado,
  alPostergar,
}: {
  tareas: Tarea[];
  ahora: Date;
  alAbrir: (t: Tarea) => void;
  alCambiarEstado: (t: Tarea, estado: Tarea["estado"]) => void;
  alPostergar: (t: Tarea, minutos: number) => void;
}) {
  const hoy = tareas
    .filter((t) => mismoDia(new Date(t.inicio), ahora))
    .sort((a, b) => a.inicio.localeCompare(b.inicio));
  const atrasadas = tareas
    .filter((t) => !mismoDia(new Date(t.inicio), ahora) && estaAtrasada(t, ahora))
    .sort((a, b) => a.inicio.localeCompare(b.inicio));

  if (hoy.length === 0 && atrasadas.length === 0) {
    return <p className="text-muted text-sm">Nada agendado para hoy. Tocá un día del calendario o “Nueva tarea”.</p>;
  }

  const fila = (t: Tarea, mostrarDia: boolean) => {
    const abierta = t.estado === "pendiente" || t.estado === "en_curso";
    return (
      <li key={t.id} className="border-line flex flex-wrap items-center gap-2 border-b py-2 last:border-0">
        <button
          type="button"
          title={t.estado === "hecha" ? "Reabrir" : "Marcar hecha"}
          onClick={() => alCambiarEstado(t, t.estado === "hecha" ? "pendiente" : "hecha")}
          disabled={Boolean(t.accion)}
          className={`flex size-5 shrink-0 items-center justify-center rounded-full border text-[11px] ${
            t.estado === "hecha" ? "border-c2 bg-c2 text-black" : "border-muted"
          }`}
        >
          {t.estado === "hecha" ? "✓" : ""}
        </button>
        <button type="button" onClick={() => alAbrir(t)} className="min-w-[14rem] flex-1 text-left">
          <span className="text-muted mr-2 text-xs tabular-nums">
            {mostrarDia ? `${diaLargo(new Date(t.inicio))} ` : ""}
            {horaDe(new Date(t.inicio))}
          </span>
          <span className={`text-sm ${t.estado === "hecha" || t.estado === "cancelada" ? "text-muted line-through" : ""}`}>
            {t.titulo}
          </span>
          <span className="text-muted ml-2 text-xs">
            {[t.categoria, fmtDuracion(t.duracionMin), t.accion ? `⚙️ ${nombreAccion(t.accion)}` : null]
              .filter(Boolean)
              .join(" · ")}
          </span>
          {t.resultadoAccion && <span className="text-muted block text-[11px]">→ {t.resultadoAccion}</span>}
        </button>
        {abierta && !t.accion && (
          <div className="flex gap-1 text-[11px]">
            {t.estado === "pendiente" ? (
              <button
                type="button"
                onClick={() => alCambiarEstado(t, "en_curso")}
                className="bg-c1/15 text-c1 hover:bg-c1/25 rounded-md px-2 py-1"
              >
                ▶ Arrancar
              </button>
            ) : (
              <span className="text-c1 px-2 py-1">En curso…</span>
            )}
            <button
              type="button"
              onClick={() => alPostergar(t, 60)}
              className="bg-panel-2 text-muted hover:text-ink rounded-md px-2 py-1"
            >
              +1 h
            </button>
            <button
              type="button"
              onClick={() => alPostergar(t, 24 * 60)}
              className="bg-panel-2 text-muted hover:text-ink rounded-md px-2 py-1"
            >
              Mañana
            </button>
          </div>
        )}
      </li>
    );
  };

  return (
    <div className="grid gap-4">
      {atrasadas.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-medium text-rose-300">Atrasadas ({atrasadas.length})</p>
          <ul>{atrasadas.map((t) => fila(t, true))}</ul>
        </div>
      )}
      {hoy.length > 0 && <ul>{hoy.map((t) => fila(t, false))}</ul>}
    </div>
  );
}
