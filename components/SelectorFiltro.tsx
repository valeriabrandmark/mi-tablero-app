"use client";

import { useEffect, useId, useRef, useState } from "react";

export const CLASE_SELECT =
  "border-line bg-panel-2 focus:border-c1 rounded-lg border px-3 py-1.5 text-sm outline-none";

/** `string` simple, o `[valor, texto]` cuando el texto visible difiere. */
type Opcion = string | [string, string];

function aPares(opciones: Opcion[], formato?: (v: string) => string) {
  return opciones.map((o) =>
    Array.isArray(o) ? o : ([o, formato ? formato(o) : o] as [string, string]),
  );
}

/**
 * Selector de opción única. Queda solo para lo que NO es un filtro, como el
 * modo de flete de Logística, que elige un cálculo y no un recorte: ahí
 * "elegir varios" no significaría nada.
 */
export function SelectorFiltro({
  etiqueta,
  valor,
  opciones,
  onChange,
  formato,
  todos = "Todos",
}: {
  etiqueta: string;
  valor: string | undefined;
  opciones: Opcion[];
  onChange: (v: string | undefined) => void;
  formato?: (v: string) => string;
  todos?: string;
}) {
  const pares = aPares(opciones, formato);

  return (
    <label className="flex flex-col gap-1">
      <span className="text-muted text-[11px]">{etiqueta}</span>
      <select
        className={CLASE_SELECT}
        value={valor ?? ""}
        onChange={(e) => onChange(e.target.value || undefined)}
        disabled={pares.length === 0}
      >
        <option value="">{todos}</option>
        {pares.map(([v, txt]) => (
          <option key={v} value={v}>
            {txt}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * Selector de selección múltiple, que es como funcionan todos los filtros del
 * tablero.
 *
 * Es un desplegable con checkboxes y no un `<select multiple>` nativo: el
 * nativo obliga a hacer ctrl+click para sumar valores, no muestra cuántos hay
 * elegidos sin desplegarlo, y en móvil es directamente inusable.
 *
 * Sin nada tildado el filtro no se aplica: "ninguno elegido" es "todos", no
 * "ninguno". Es lo que espera cualquiera que use un tablero.
 */
export function SelectorMultiple({
  etiqueta,
  valores,
  opciones,
  onChange,
  formato,
  todos = "Todos",
}: {
  etiqueta: string;
  valores: string[] | undefined;
  opciones: Opcion[];
  onChange: (v: string[] | undefined) => void;
  formato?: (v: string) => string;
  todos?: string;
}) {
  const [abierto, setAbierto] = useState(false);
  const caja = useRef<HTMLDivElement>(null);
  const id = useId();

  const pares = aPares(opciones, formato);
  const elegidos = valores ?? [];

  // Cerrar al clickear afuera o con Escape. Sin esto quedan dos desplegables
  // abiertos a la vez y se tapan entre ellos.
  useEffect(() => {
    if (!abierto) return;
    const alClick = (e: MouseEvent) => {
      if (!caja.current?.contains(e.target as Node)) setAbierto(false);
    };
    const alTeclado = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAbierto(false);
    };
    document.addEventListener("mousedown", alClick);
    document.addEventListener("keydown", alTeclado);
    return () => {
      document.removeEventListener("mousedown", alClick);
      document.removeEventListener("keydown", alTeclado);
    };
  }, [abierto]);

  const alternarUno = (v: string) => {
    const nuevos = elegidos.includes(v)
      ? elegidos.filter((x) => x !== v)
      : [...elegidos, v];
    onChange(nuevos.length > 0 ? nuevos : undefined);
  };

  const resumen =
    elegidos.length === 0
      ? todos
      : elegidos.length === 1
        ? (pares.find(([v]) => v === elegidos[0])?.[1] ?? elegidos[0])
        : `${elegidos.length} elegidos`;

  return (
    <div className="relative flex flex-col gap-1" ref={caja}>
      <span className="text-muted text-[11px]" id={`${id}-etiqueta`}>
        {etiqueta}
      </span>

      <button
        type="button"
        aria-expanded={abierto}
        aria-labelledby={`${id}-etiqueta`}
        disabled={pares.length === 0}
        onClick={() => setAbierto((a) => !a)}
        className={`${CLASE_SELECT} flex min-w-[10rem] items-center gap-2 text-left disabled:opacity-40`}
      >
        <span className={`flex-1 truncate ${elegidos.length === 0 ? "text-muted" : ""}`}>
          {resumen}
        </span>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          className="text-muted size-4 shrink-0"
          aria-hidden="true"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {abierto && (
        <div className="border-line bg-panel absolute top-full left-0 z-30 mt-1 max-h-72 w-64 overflow-y-auto rounded-lg border p-1 shadow-xl">
          <button
            type="button"
            onClick={() => onChange(undefined)}
            disabled={elegidos.length === 0}
            className="hover:bg-panel-2 text-muted w-full rounded px-2 py-1.5 text-left text-xs disabled:opacity-40"
          >
            {todos}
          </button>

          <div className="border-line my-1 border-t" />

          {pares.map(([v, txt]) => {
            const tildado = elegidos.includes(v);
            return (
              <label
                key={v}
                className="hover:bg-panel-2 flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm"
              >
                <input
                  type="checkbox"
                  checked={tildado}
                  onChange={() => alternarUno(v)}
                  className="accent-c1 size-3.5 shrink-0"
                />
                <span className={`truncate ${tildado ? "" : "text-muted"}`}>{txt}</span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function BotonLimpiar({
  onClick,
  deshabilitado,
}: {
  onClick: () => void;
  deshabilitado: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={deshabilitado}
      className="border-line hover:bg-panel-2 text-muted hover:text-ink rounded-lg border px-3 py-1.5 text-xs disabled:opacity-40"
    >
      Limpiar
    </button>
  );
}
