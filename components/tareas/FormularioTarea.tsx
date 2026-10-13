"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import {
  ACCIONES,
  CATEGORIAS,
  DIA_CORTO,
  describirRecurrencia,
  type Frecuencia,
  type Prioridad,
  type Tarea,
} from "@/lib/tareas";
import { aISO, claveDia, horaDe } from "./fechas";

const DURACIONES = [5, 10, 15, 30, 45, 60, 90, 120, 180, 240];
const AVISOS = [
  { min: 0, texto: "A la hora" },
  { min: 5, texto: "5 min antes" },
  { min: 10, texto: "10 min antes" },
  { min: 15, texto: "15 min antes" },
  { min: 30, texto: "30 min antes" },
  { min: 60, texto: "1 hora antes" },
  { min: 1440, texto: "1 día antes" },
];

export type EnvioFormulario =
  | { tipo: "tarea"; datos: Record<string, unknown> }
  | { tipo: "recurrencia"; datos: Record<string, unknown> };

function Campo({ etiqueta, children }: { etiqueta: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="text-muted">{etiqueta}</span>
      {children}
    </label>
  );
}

const INPUT =
  "bg-panel-2 border-line focus:border-c1 rounded-lg border px-2.5 py-1.5 text-sm outline-none";

/**
 * Alta y edición de una tarea.
 *
 * Al EDITAR no se ofrece "se repite": se está tocando una ocurrencia (el lunes
 * 13), no la regla. Cambiar la regla es frenarla y crear otra, desde la lista
 * de repetitivas.
 */
export default function FormularioTarea({
  tarea,
  diaInicial,
  guardando,
  error,
  alGuardar,
  alCerrar,
  alBorrar,
  alFrenarRepeticion,
}: {
  tarea: Tarea | null;
  diaInicial: Date;
  guardando: boolean;
  error: string | null;
  alGuardar: (envio: EnvioFormulario) => void;
  alCerrar: () => void;
  alBorrar?: () => void;
  alFrenarRepeticion?: () => void;
}) {
  const inicio = tarea ? new Date(tarea.inicio) : diaInicial;
  const [titulo, setTitulo] = useState(tarea?.titulo ?? "");
  const [nota, setNota] = useState(tarea?.nota ?? "");
  const [categoria, setCategoria] = useState(tarea?.categoria ?? "");
  const [prioridad, setPrioridad] = useState<Prioridad>(tarea?.prioridad ?? "media");
  const [fecha, setFecha] = useState(claveDia(inicio));
  // Una tarea nueva para hoy arranca en la próxima hora en punto; para otro
  // día, a las 9. Proponer las 9 de un día que ya va por la tarde es proponer
  // algo que ya pasó.
  const [hora, setHora] = useState(() => {
    if (tarea) return horaDe(inicio);
    const ahora = new Date();
    if (claveDia(inicio) !== claveDia(ahora) || ahora.getHours() >= 23) return "09:00";
    return `${String(ahora.getHours() + 1).padStart(2, "0")}:00`;
  });
  const [duracion, setDuracion] = useState(tarea?.duracionMin ?? 30);
  const [aviso, setAviso] = useState(tarea?.recordarMinAntes ?? 0);
  const [automatica, setAutomatica] = useState(Boolean(tarea?.accion));
  const [accion, setAccion] = useState<string>(tarea?.accion ?? ACCIONES[0].clave);

  const [repite, setRepite] = useState(false);
  const [frecuencia, setFrecuencia] = useState<Frecuencia>("semanal");
  const [cada, setCada] = useState(1);
  const diaSemanaInicial = ((inicio.getDay() + 6) % 7) + 1;
  const [dias, setDias] = useState<number[]>([diaSemanaInicial]);
  const [diaMes, setDiaMes] = useState(inicio.getDate());
  const [hasta, setHasta] = useState("");

  function alternarDia(d: number) {
    setDias((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort()));
  }

  function enviar(e: FormEvent) {
    e.preventDefault();
    const base = {
      titulo,
      nota,
      categoria,
      prioridad,
      duracionMin: duracion,
      recordarMinAntes: automatica ? 0 : aviso,
      accion: automatica ? accion : null,
    };
    if (repite && !tarea) {
      alGuardar({
        tipo: "recurrencia",
        datos: { ...base, frecuencia, cada, diasSemana: dias, diaMes, hora, desde: fecha, hasta },
      });
    } else {
      alGuardar({ tipo: "tarea", datos: { ...base, inicio: aISO(fecha, hora) } });
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4"
      onClick={alCerrar}
    >
      <form
        onSubmit={enviar}
        onClick={(e) => e.stopPropagation()}
        className="bg-panel border-line max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl border p-5 sm:rounded-2xl"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">{tarea ? "Editar tarea" : "Nueva tarea"}</h2>
          <button type="button" onClick={alCerrar} className="text-muted hover:text-ink text-xl leading-none">
            ×
          </button>
        </div>

        <div className="mt-4 grid gap-3">
          <Campo etiqueta="Qué hay que hacer">
            <input
              autoFocus
              required
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              placeholder="Ej.: revisar cuentas corrientes vencidas"
              className={INPUT}
            />
          </Campo>

          <div className="grid grid-cols-2 gap-3">
            <Campo etiqueta="Categoría">
              <input
                list="categorias-tareas"
                value={categoria}
                onChange={(e) => setCategoria(e.target.value)}
                placeholder="Elegí o escribí"
                className={INPUT}
              />
              <datalist id="categorias-tareas">
                {CATEGORIAS.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </Campo>
            <Campo etiqueta="Prioridad">
              <select value={prioridad} onChange={(e) => setPrioridad(e.target.value as Prioridad)} className={INPUT}>
                <option value="alta">Alta</option>
                <option value="media">Media</option>
                <option value="baja">Baja</option>
              </select>
            </Campo>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <Campo etiqueta={repite ? "Empieza el" : "Día"}>
              <input type="date" required value={fecha} onChange={(e) => setFecha(e.target.value)} className={INPUT} />
            </Campo>
            <Campo etiqueta="Hora">
              <input type="time" required value={hora} onChange={(e) => setHora(e.target.value)} className={INPUT} />
            </Campo>
            <Campo etiqueta="Duración">
              <select value={duracion} onChange={(e) => setDuracion(Number(e.target.value))} className={INPUT}>
                {[...new Set([...DURACIONES, duracion])].sort((a, b) => a - b).map((d) => (
                  <option key={d} value={d}>
                    {d < 60 ? `${d} min` : `${d / 60} h`}
                  </option>
                ))}
              </select>
            </Campo>
          </div>

          {/* Recordatorio o automática */}
          <div className="border-line rounded-xl border p-3">
            <div className="flex gap-2 text-xs">
              <button
                type="button"
                onClick={() => setAutomatica(false)}
                className={`rounded-lg px-3 py-1.5 ${!automatica ? "bg-c1 text-white" : "bg-panel-2 text-muted"}`}
              >
                🔔 Recordatorio
              </button>
              <button
                type="button"
                onClick={() => setAutomatica(true)}
                className={`rounded-lg px-3 py-1.5 ${automatica ? "bg-c4 text-black" : "bg-panel-2 text-muted"}`}
              >
                ⚙️ Automática
              </button>
            </div>
            {automatica ? (
              <div className="mt-3 grid gap-2">
                <select value={accion} onChange={(e) => setAccion(e.target.value)} className={INPUT}>
                  {ACCIONES.map((a) => (
                    <option key={a.clave} value={a.clave}>
                      {a.nombre}
                    </option>
                  ))}
                </select>
                <p className="text-muted text-xs">
                  {ACCIONES.find((a) => a.clave === accion)?.detalle} Se ejecuta sola a la hora, aunque el
                  tablero esté cerrado.
                </p>
              </div>
            ) : (
              <div className="mt-3">
                <Campo etiqueta="Avisarme">
                  <select value={aviso} onChange={(e) => setAviso(Number(e.target.value))} className={INPUT}>
                    {AVISOS.map((a) => (
                      <option key={a.min} value={a.min}>
                        {a.texto}
                      </option>
                    ))}
                  </select>
                </Campo>
              </div>
            )}
          </div>

          {/* Repetición: sólo al crear */}
          {!tarea && (
            <div className="border-line rounded-xl border p-3">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={repite} onChange={(e) => setRepite(e.target.checked)} />
                Se repite
              </label>
              {repite && (
                <div className="mt-3 grid gap-3">
                  <div className="grid grid-cols-2 gap-3">
                    <Campo etiqueta="Cada">
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          min={1}
                          max={52}
                          value={cada}
                          onChange={(e) => setCada(Math.max(1, Number(e.target.value) || 1))}
                          className={`${INPUT} w-16`}
                        />
                        <select
                          value={frecuencia}
                          onChange={(e) => setFrecuencia(e.target.value as Frecuencia)}
                          className={`${INPUT} flex-1`}
                        >
                          <option value="diaria">{cada === 1 ? "día" : "días"}</option>
                          <option value="semanal">{cada === 1 ? "semana" : "semanas"}</option>
                          <option value="mensual">{cada === 1 ? "mes" : "meses"}</option>
                        </select>
                      </div>
                    </Campo>
                    <Campo etiqueta="Hasta (opcional)">
                      <input type="date" value={hasta} min={fecha} onChange={(e) => setHasta(e.target.value)} className={INPUT} />
                    </Campo>
                  </div>
                  {frecuencia === "semanal" && (
                    <div className="flex flex-wrap gap-1.5">
                      {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                        <button
                          key={d}
                          type="button"
                          onClick={() => alternarDia(d)}
                          className={`size-9 rounded-full text-xs ${
                            dias.includes(d) ? "bg-c1 text-white" : "bg-panel-2 text-muted"
                          }`}
                        >
                          {DIA_CORTO[d]}
                        </button>
                      ))}
                    </div>
                  )}
                  {frecuencia === "mensual" && (
                    <Campo etiqueta="Día del mes">
                      <input
                        type="number"
                        min={1}
                        max={31}
                        value={diaMes}
                        onChange={(e) => setDiaMes(Number(e.target.value))}
                        className={`${INPUT} w-20`}
                      />
                    </Campo>
                  )}
                  <p className="text-c5 text-xs">
                    {describirRecurrencia({ frecuencia, cada, diasSemana: dias, diaMes, hora })}
                  </p>
                </div>
              )}
            </div>
          )}

          <Campo etiqueta="Notas (opcional)">
            <textarea
              rows={2}
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              placeholder="Pasos, links, a quién hay que llamar…"
              className={INPUT}
            />
          </Campo>

          {tarea?.resultadoAccion && (
            <p className="text-muted text-xs">
              Última ejecución: <span className="text-ink">{tarea.resultadoAccion}</span>
            </p>
          )}

          {error && <p className="text-sm text-rose-300">{error}</p>}
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-2">
            {alBorrar && (
              <button type="button" onClick={alBorrar} className="rounded-lg px-3 py-2 text-xs text-rose-300 hover:bg-rose-500/10">
                Borrar
              </button>
            )}
            {alFrenarRepeticion && (
              <button
                type="button"
                onClick={alFrenarRepeticion}
                className="text-c3 hover:bg-c3/10 rounded-lg px-3 py-2 text-xs"
              >
                Dejar de repetir
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={alCerrar} className="bg-panel-2 rounded-lg px-4 py-2 text-sm">
              Cancelar
            </button>
            <button
              type="submit"
              disabled={guardando || (repite && frecuencia === "semanal" && dias.length === 0)}
              className="bg-c1 rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {guardando ? "Guardando…" : "Guardar"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
