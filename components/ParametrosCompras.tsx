"use client";

import { useCallback, useState } from "react";
import {
  DEFINICIONES_PARAMETROS,
  type ClaveParametro,
  type GrupoParametro,
  type ParametrosCompras as Parametros,
} from "@/lib/compras-parametros";

/**
 * El panel de las REGLAS DEL SUGERIDO.
 *
 * Se abre desde un botón al lado de "Recargar" y edita `app.compras_parametros`
 * (ver lib/compras-parametros.ts). Las reglas son de TODOS: el panel lo dice,
 * y sólo deja guardar a quien puede editar Compras. El resto lo ve en modo
 * lectura, que también sirve: es la forma de saber con qué números se calculó.
 *
 * Al guardar llama a `onGuardado` para que la tabla se recalcule con las
 * reglas nuevas.
 */

type Cambio = {
  clave: string;
  valorAnterior: number | null;
  valor: number | null;
  usuario: string;
  creadoEn: string;
};

type Respuesta = {
  parametros: Parametros;
  porDefecto: Parametros;
  historial: Cambio[];
  puedeEditar: boolean;
};

const GRUPOS: { clave: GrupoParametro; titulo: string }[] = [
  { clave: "ritmo", titulo: "Cómo se mide lo que se vende" },
  { clave: "necesidad", titulo: "Cuánto hace falta" },
  { clave: "oferta", titulo: "Cuánto se adelanta por una oferta" },
];

function etiquetaDe(clave: string): string {
  return DEFINICIONES_PARAMETROS.find((d) => d.clave === clave)?.label ?? clave;
}

function fmtValor(v: number | null, unidad?: string): string {
  if (v == null) return "por defecto";
  if (unidad === "sí/no") return v >= 1 ? "sí" : "no";
  const n = v.toLocaleString("es-AR", { maximumFractionDigits: 2 });
  return unidad ? `${n} ${unidad}` : n;
}

export default function ParametrosCompras({
  onGuardado,
}: {
  onGuardado: () => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const [datos, setDatos] = useState<Respuesta | null>(null);
  const [borrador, setBorrador] = useState<Partial<Record<ClaveParametro, string>>>({});
  const [estado, setEstado] = useState<"" | "cargando" | "guardando" | "error">("");
  const [mensaje, setMensaje] = useState("");

  const cargar = useCallback(async () => {
    setEstado("cargando");
    setMensaje("");
    try {
      const r = await fetch("/api/compras/parametros", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `Error ${r.status}`);
      setDatos(j as Respuesta);
      setBorrador({});
      setEstado("");
    } catch (e) {
      setEstado("error");
      setMensaje(e instanceof Error ? e.message : "No se pudieron leer las reglas");
    }
  }, []);

  const editados = Object.keys(borrador) as ClaveParametro[];

  async function guardar(cambios: Partial<Record<ClaveParametro, number | null>>) {
    setEstado("guardando");
    setMensaje("");
    try {
      const r = await fetch("/api/compras/parametros", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cambios }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `Error ${r.status}`);
      setDatos((d) => (d ? { ...d, parametros: j.parametros, historial: j.historial } : d));
      setBorrador({});
      setEstado("");
      setMensaje("Guardado. La tabla se recalcula con las reglas nuevas.");
      onGuardado();
    } catch (e) {
      setEstado("error");
      setMensaje(e instanceof Error ? e.message : "No se pudo guardar");
    }
  }

  function guardarEditados() {
    const cambios: Partial<Record<ClaveParametro, number | null>> = {};
    for (const k of editados) {
      const crudo = borrador[k];
      if (crudo == null || crudo.trim() === "") continue;
      const n = Number(crudo.replace(",", "."));
      if (Number.isFinite(n)) cambios[k] = n;
    }
    void guardar(cambios);
  }

  const cambiadas = datos
    ? DEFINICIONES_PARAMETROS.filter(
        (d) => datos.parametros[d.clave] !== datos.porDefecto[d.clave],
      ).length
    : 0;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => {
          // Se lee al abrir y cada vez que se vuelve a abrir: otra persona
          // pudo cambiar las reglas mientras tanto.
          if (!abierto) void cargar();
          setAbierto(!abierto);
        }}
        aria-expanded={abierto}
        title="Las reglas con las que se calcula cuántas unidades sugerir."
        className="border-line hover:bg-panel-2 text-muted hover:text-ink rounded-lg border px-3 py-1.5 text-xs"
      >
        Reglas del sugerido{cambiadas > 0 ? ` · ${cambiadas} cambiada${cambiadas > 1 ? "s" : ""}` : ""}
      </button>

      {abierto && (
        <div className="border-line bg-panel absolute right-0 z-30 mt-2 w-[min(92vw,560px)] rounded-xl border p-4 shadow-xl">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <p className="text-ink text-sm font-medium">Reglas del sugerido</p>
              <p className="text-muted text-[11px] leading-tight">
                Cambian el sugerido que ve <strong>todo el que abre Compras</strong>,
                no sólo el tuyo.
                {datos && !datos.puedeEditar &&
                  " Estás viéndolas en modo lectura: cambiarlas pide permiso de edición en Compras."}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setAbierto(false)}
              className="text-muted hover:text-ink text-xs"
              aria-label="Cerrar"
            >
              ✕
            </button>
          </div>

          {estado === "cargando" && <p className="text-muted text-xs">Cargando…</p>}

          {datos && (
            <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto pr-1">
              {GRUPOS.map((g) => (
                <fieldset key={g.clave} className="flex flex-col gap-2">
                  <legend className="text-muted mb-1 text-[11px] font-medium tracking-wide uppercase">
                    {g.titulo}
                  </legend>
                  {DEFINICIONES_PARAMETROS.filter((d) => d.grupo === g.clave).map((d) => {
                    const vigente = datos.parametros[d.clave];
                    const defecto = datos.porDefecto[d.clave];
                    const enBorrador = borrador[d.clave];
                    const distinto = vigente !== defecto;
                    const id = `param-${d.clave}`;
                    return (
                      <div key={d.clave} className="border-line rounded-lg border p-2.5">
                        <div className="flex items-center justify-between gap-3">
                          <label htmlFor={id} className="text-ink text-xs font-medium">
                            {d.label}
                          </label>
                          {d.unidad === "sí/no" ? (
                            <input
                              id={id}
                              type="checkbox"
                              disabled={!datos.puedeEditar}
                              checked={(enBorrador ?? String(vigente)) === "1"}
                              onChange={(e) =>
                                setBorrador((b) => ({ ...b, [d.clave]: e.target.checked ? "1" : "0" }))
                              }
                            />
                          ) : (
                            <span className="flex items-center gap-1">
                              <input
                                id={id}
                                type="number"
                                inputMode="decimal"
                                min={d.min}
                                max={d.max}
                                step={d.paso}
                                disabled={!datos.puedeEditar}
                                value={enBorrador ?? String(vigente)}
                                onChange={(e) =>
                                  setBorrador((b) => ({ ...b, [d.clave]: e.target.value }))
                                }
                                className="border-line bg-panel-2 text-ink w-20 rounded-md border px-2 py-1 text-right text-xs"
                              />
                              <span className="text-muted w-12 text-[11px]">{d.unidad}</span>
                            </span>
                          )}
                        </div>
                        <p className="text-muted mt-1 text-[11px] leading-tight">{d.ayuda}</p>
                        <p className="mt-1 flex items-center gap-2 text-[11px]">
                          <span className="text-muted">
                            Por defecto: {fmtValor(defecto, d.unidad)} · entre {d.min} y {d.max}
                          </span>
                          {distinto && datos.puedeEditar && (
                            <button
                              type="button"
                              onClick={() => void guardar({ [d.clave]: null })}
                              disabled={estado === "guardando"}
                              className="text-c1 hover:underline"
                            >
                              volver al defecto
                            </button>
                          )}
                        </p>
                      </div>
                    );
                  })}
                </fieldset>
              ))}

              {datos.historial.length > 0 && (
                <details className="text-[11px]">
                  <summary className="text-muted cursor-pointer">
                    Últimos cambios ({datos.historial.length})
                  </summary>
                  <ul className="mt-1 flex flex-col gap-0.5">
                    {datos.historial.map((c, i) => (
                      <li key={i} className="text-muted">
                        {new Date(c.creadoEn).toLocaleString("es-AR")} · {c.usuario}:{" "}
                        <span className="text-ink">{etiquetaDe(c.clave)}</span>{" "}
                        {fmtValor(c.valorAnterior)} → {fmtValor(c.valor)}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}

          {mensaje && (
            <p
              className={`mt-3 text-xs ${estado === "error" ? "text-[var(--negativo,#e5484d)]" : "text-muted"}`}
            >
              {mensaje}
            </p>
          )}

          {datos?.puedeEditar && (
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setBorrador({})}
                disabled={editados.length === 0 || estado === "guardando"}
                className="border-line text-muted hover:text-ink rounded-lg border px-3 py-1.5 text-xs disabled:opacity-40"
              >
                Descartar
              </button>
              <button
                type="button"
                onClick={guardarEditados}
                disabled={editados.length === 0 || estado === "guardando"}
                className="border-c1 bg-c1/15 text-c1 rounded-lg border px-3 py-1.5 text-xs disabled:opacity-40"
              >
                {estado === "guardando" ? "Guardando…" : "Guardar"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
