"use client";

import { CampoBusqueda, SelectorMultiple } from "@/components/SelectorFiltro";
import { fmtMes } from "@/lib/format";
import { vacio as sinValores } from "@/lib/filtros";
import type { Filtros, OpcionesFiltro } from "@/lib/types";

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
    sinValores(filtros.vendedor) && sinValores(filtros.empresa) && sinValores(filtros.mes) &&
    sinValores(filtros.proveedor) && sinValores(filtros.provincia) && !filtros.buscar;

  return (
    <div className="border-line bg-panel flex flex-wrap items-end gap-3 rounded-xl border p-3">
      <SelectorMultiple
        etiqueta="Vendedor"
        valores={filtros.vendedor}
        opciones={opciones?.vendedores ?? []}
        onChange={(v) => onChange({ ...filtros, vendedor: v })}
      />
      <SelectorMultiple
        etiqueta="Empresa"
        valores={filtros.empresa}
        opciones={opciones?.empresas ?? []}
        onChange={(v) => onChange({ ...filtros, empresa: v })}
      />
      <SelectorMultiple
        etiqueta="Mes comercial"
        valores={filtros.mes}
        opciones={opciones?.meses ?? []}
        onChange={(v) => onChange({ ...filtros, mes: v })}
        formato={fmtMes}
      />
      <SelectorMultiple
        etiqueta="Provincia"
        valores={filtros.provincia}
        opciones={opciones?.provincias ?? []}
        onChange={(v) => onChange({ ...filtros, provincia: v })}
      />

      <CampoBusqueda
        valor={filtros.buscar ?? ""}
        placeholder="Cliente, SKU o artículo"
        onChange={(v) => onChange({ ...filtros, buscar: v || undefined })}
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
