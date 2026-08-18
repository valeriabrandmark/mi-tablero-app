"use client";

import { fmtMes } from "@/lib/format";
import type { Filtros, OpcionesFiltro } from "@/lib/types";

const CLASE_SELECT =
  "border-line bg-panel-2 focus:border-c1 rounded-lg border px-3 py-1.5 text-sm outline-none";

function Selector({
  etiqueta,
  valor,
  opciones,
  onChange,
  formato,
}: {
  etiqueta: string;
  valor: string | undefined;
  opciones: string[];
  onChange: (v: string | undefined) => void;
  formato?: (v: string) => string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-muted text-[11px]">{etiqueta}</span>
      <select
        className={CLASE_SELECT}
        value={valor ?? ""}
        onChange={(e) => onChange(e.target.value || undefined)}
        disabled={opciones.length === 0}
      >
        <option value="">Todos</option>
        {opciones.map((o) => (
          <option key={o} value={o}>
            {formato ? formato(o) : o}
          </option>
        ))}
      </select>
    </label>
  );
}

export default function BarraFiltros({
  filtros,
  opciones,
  onChange,
}: {
  filtros: Filtros;
  opciones: OpcionesFiltro | null;
  onChange: (f: Filtros) => void;
}) {
  const vacio =
    !filtros.vendedor && !filtros.empresa && !filtros.mes && !filtros.proveedor && !filtros.provincia;

  return (
    <div className="border-line bg-panel flex flex-wrap items-end gap-3 rounded-xl border p-3">
      <Selector
        etiqueta="Vendedor"
        valor={filtros.vendedor}
        opciones={opciones?.vendedores ?? []}
        onChange={(v) => onChange({ ...filtros, vendedor: v })}
      />
      <Selector
        etiqueta="Empresa"
        valor={filtros.empresa}
        opciones={opciones?.empresas ?? []}
        onChange={(v) => onChange({ ...filtros, empresa: v })}
      />
      <Selector
        etiqueta="Mes comercial"
        valor={filtros.mes}
        opciones={opciones?.meses ?? []}
        onChange={(v) => onChange({ ...filtros, mes: v })}
        formato={fmtMes}
      />
      <Selector
        etiqueta="Provincia"
        valor={filtros.provincia}
        opciones={opciones?.provincias ?? []}
        onChange={(v) => onChange({ ...filtros, provincia: v })}
      />

      <button
        onClick={() => onChange({})}
        disabled={vacio}
        className="border-line hover:bg-panel-2 text-muted hover:text-ink rounded-lg border px-3 py-1.5 text-xs disabled:opacity-40"
      >
        Limpiar
      </button>

      <span className="text-muted ml-auto max-w-md text-[11px] leading-tight">
        Canal Mayorista, excluyendo <code>AGENCIA</code>. La provincia sale del envío
        (<code>reporte_logistica</code>), así que al usarla quedan solo las líneas que ya
        tienen logística cargada.
      </span>
    </div>
  );
}
