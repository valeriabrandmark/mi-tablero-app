"use client";

import { useState } from "react";
import { Panel, TarjetaKpi } from "@/components/ui";
import { PALETA } from "@/lib/paleta";
import {
  describirRecurrencia,
  fmtDuracion,
  minutosReales,
  resumir,
  sugerir,
  type Recurrencia,
  type Resumen,
  type Sugerencia,
  type Tarea,
} from "@/lib/tareas";
import { claveDia, diaLargo, horaDe } from "./fechas";

export type Periodo = "hoy" | "semana" | "mes";

const NOMBRE_PERIODO: Record<Periodo, string> = {
  hoy: "Hoy",
  semana: "Esta semana",
  mes: "Este mes",
};

/**
 * El resumen en texto, para pegárselo a Claude y pedirle que sugiera cómo
 * organizar mejor el trabajo. Va el detalle tarea por tarea --no sólo los
 * totales-- porque las sugerencias útiles salen de ver QUÉ se hace, cuándo y
 * cuánto lleva, no de un porcentaje.
 */
export function resumenParaClaude(
  titulo: string,
  r: Resumen,
  tareas: Tarea[],
  recurrencias: Recurrencia[],
  sugerencias: Sugerencia[],
): string {
  const lineas: string[] = [
    `# Mis tareas — ${titulo}`,
    "",
    `- Hechas: ${r.hechas} de ${r.total}${r.cumplimiento !== null ? ` (${Math.round(r.cumplimiento)}% de lo que vencía)` : ""}`,
    `- Atrasadas: ${r.atrasadas} · Pendientes: ${r.pendientes} · Canceladas: ${r.canceladas}`,
    `- Tiempo en tareas hechas: ${fmtDuracion(r.minutosHechos)} · Automáticas ejecutadas: ${r.automaticas}`,
    "",
    "## Por categoría",
    ...r.porCategoria.map((c) => `- ${c.categoria}: ${c.hechas}/${c.total} hechas, ${fmtDuracion(c.minutos)}`),
    "",
    "## Detalle",
    "| Día | Hora | Tarea | Categoría | Prioridad | Estado | Estimado | Real | Postergada | Tipo |",
    "|---|---|---|---|---|---|---|---|---|---|",
    ...[...tareas]
      .sort((a, b) => a.inicio.localeCompare(b.inicio))
      .map((t) => {
        const d = new Date(t.inicio);
        const real = minutosReales(t);
        return `| ${claveDia(d)} | ${horaDe(d)} | ${t.titulo.replace(/\|/g, "/")} | ${t.categoria ?? ""} | ${t.prioridad} | ${t.estado} | ${t.duracionMin} min | ${real !== null ? `${Math.round(real)} min` : ""} | ${t.vecesPostergada || ""} | ${t.accion ? "automática" : t.recurrenciaId ? "repetida" : "suelta"} |`;
      }),
  ];
  if (recurrencias.length > 0) {
    lineas.push("", "## Tareas que se repiten");
    for (const rec of recurrencias) {
      lineas.push(`- ${rec.titulo}: ${describirRecurrencia(rec)}${rec.accion ? " (automática)" : ""}`);
    }
  }
  if (sugerencias.length > 0) {
    lineas.push("", "## Lo que ya marcó el tablero");
    for (const s of sugerencias) lineas.push(`- ${s.titulo}`);
  }
  lineas.push(
    "",
    "¿Qué flujos de trabajo me sugerís para organizar mejor esto? ¿Qué agruparías, qué automatizarías y qué sacarías?",
  );
  return lineas.join("\n");
}

export default function ResumenTareas({
  periodo,
  alCambiarPeriodo,
  tareas,
  todas,
  recurrencias,
  ahora,
}: {
  periodo: Periodo;
  alCambiarPeriodo: (p: Periodo) => void;
  /** Las del período elegido. */
  tareas: Tarea[];
  /** Todas las cargadas: las sugerencias miran más historia que el período. */
  todas: Tarea[];
  recurrencias: Recurrencia[];
  ahora: Date;
}) {
  const r = resumir(tareas, ahora);
  const sugerencias = sugerir(todas, recurrencias, ahora);
  const [copiado, setCopiado] = useState(false);
  const maxMin = Math.max(1, ...r.porCategoria.map((c) => c.minutos));

  async function copiar() {
    const texto = resumenParaClaude(NOMBRE_PERIODO[periodo], r, tareas, recurrencias, sugerencias);
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2500);
    } catch {
      // Sin permiso de portapapeles: se ofrece para copiar a mano.
      window.prompt("Copiá el resumen:", texto);
    }
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="bg-panel border-line flex rounded-lg border p-0.5 text-xs">
          {(Object.keys(NOMBRE_PERIODO) as Periodo[]).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => alCambiarPeriodo(p)}
              className={`rounded-md px-3 py-1.5 ${periodo === p ? "bg-panel-2 text-ink" : "text-muted"}`}
            >
              {NOMBRE_PERIODO[p]}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={copiar}
          className="bg-c4/15 text-c4 hover:bg-c4/25 rounded-lg px-3 py-1.5 text-xs"
          title="Copia el resumen con el detalle de las tareas, para pegárselo a Claude y pedirle sugerencias"
        >
          {copiado ? "✓ Copiado" : "📋 Copiar resumen para Claude"}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <TarjetaKpi titulo="Hechas" valor={`${r.hechas} / ${r.total}`} acento={PALETA[1]}
          detalle={r.automaticas > 0 ? `+ ${r.automaticas} automáticas ejecutadas` : undefined} />
        <TarjetaKpi
          titulo="Cumplimiento"
          valor={r.cumplimiento === null ? "—" : `${Math.round(r.cumplimiento)}%`}
          detalle="de lo que ya vencía"
        />
        <TarjetaKpi titulo="Atrasadas" valor={String(r.atrasadas)} acento={r.atrasadas > 0 ? "#fb7185" : undefined} />
        <TarjetaKpi titulo="Tiempo en lo hecho" valor={fmtDuracion(r.minutosHechos)}
          detalle="real si lo arrancaste con ▶, si no el estimado" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel titulo="Por categoría">
          {r.porCategoria.length === 0 ? (
            <p className="text-muted text-sm">Sin tareas en el período.</p>
          ) : (
            <ul className="grid gap-2">
              {r.porCategoria.map((c, i) => (
                <li key={c.categoria} className="text-xs">
                  <div className="flex justify-between">
                    <span>{c.categoria}</span>
                    <span className="text-muted tabular-nums">
                      {c.hechas}/{c.total} · {fmtDuracion(c.minutos)}
                    </span>
                  </div>
                  <div className="bg-panel-2 mt-1 h-1.5 rounded-full">
                    <div
                      className="h-1.5 rounded-full"
                      style={{ width: `${(c.minutos / maxMin) * 100}%`, backgroundColor: PALETA[i % PALETA.length] }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel titulo="Sugerencias" nota="según tu historial">
          {sugerencias.length === 0 ? (
            <p className="text-muted text-sm">
              Todavía no hay patrones para señalar. A medida que cargues y completes tareas van a aparecer acá. Para un
              análisis más a fondo, copiá el resumen y pedímelo en una sesión.
            </p>
          ) : (
            <ul className="grid gap-3">
              {sugerencias.map((s) => (
                <li key={s.clave} className="border-c4/30 border-l-2 pl-3">
                  <p className="text-sm">{s.titulo}</p>
                  <p className="text-muted mt-0.5 text-xs">{s.detalle}</p>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel titulo="Lo que hiciste" nota={`${r.hechasLista.length} tareas`}>
          {r.hechasLista.length === 0 ? (
            <p className="text-muted text-sm">Nada terminado todavía en este período.</p>
          ) : (
            <ul className="grid gap-1 text-xs">
              {r.hechasLista.map((t) => (
                <li key={t.id} className="flex justify-between gap-2">
                  <span className="truncate">
                    <span className="text-c2">✓</span> {t.titulo}
                  </span>
                  <span className="text-muted shrink-0 capitalize">{diaLargo(new Date(t.inicio))}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel titulo="Atrasadas" nota={`${r.atrasadasLista.length}`}>
          {r.atrasadasLista.length === 0 ? (
            <p className="text-muted text-sm">Nada atrasado. 👏</p>
          ) : (
            <ul className="grid gap-1 text-xs">
              {r.atrasadasLista.map((t) => (
                <li key={t.id} className="flex justify-between gap-2">
                  <span className="truncate">{t.titulo}</span>
                  <span className="shrink-0 text-rose-300 capitalize">{diaLargo(new Date(t.inicio))}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
