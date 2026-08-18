"use client";

export const CLASE_SELECT =
  "border-line bg-panel-2 focus:border-c1 rounded-lg border px-3 py-1.5 text-sm outline-none";

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
  /** `string` simple, o `[valor, texto]` cuando el texto visible difiere. */
  opciones: (string | [string, string])[];
  onChange: (v: string | undefined) => void;
  formato?: (v: string) => string;
  todos?: string;
}) {
  const pares = opciones.map((o) => (Array.isArray(o) ? o : ([o, formato ? formato(o) : o] as const)));

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

export function BotonLimpiar({ onClick, deshabilitado }: { onClick: () => void; deshabilitado: boolean }) {
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
