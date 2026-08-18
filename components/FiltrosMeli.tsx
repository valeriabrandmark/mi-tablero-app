"use client";

import { BotonLimpiar, SelectorMultiple } from "@/components/SelectorFiltro";
import { fmtMes } from "@/lib/format";
import { NIVELES_ALERTA, NOMBRE_ALERTA } from "@/lib/meli";
import type { FiltrosMeli, OpcionesMeli } from "@/lib/types";

/**
 * Barra de filtros de la sección Mercado Libre. La comparten el tablero y las
 * alertas para que un filtro puesto en una pestaña se entienda igual en la otra;
 * el selector de nivel de alerta solo aparece donde significa algo.
 */
export default function BarraFiltrosMeli({
  filtros,
  opciones,
  onChange,
  onLimpiar,
  sinCambios,
  conAlerta = false,
  nota,
}: {
  filtros: FiltrosMeli;
  opciones: OpcionesMeli | null;
  onChange: (f: FiltrosMeli) => void;
  onLimpiar: () => void;
  sinCambios: boolean;
  conAlerta?: boolean;
  nota: string;
}) {
  return (
    <div className="border-line bg-panel flex flex-wrap items-end gap-3 rounded-xl border p-3">
      <SelectorMultiple
        etiqueta="Mes comercial"
        valores={filtros.mes}
        opciones={opciones?.meses ?? []}
        onChange={(v) => onChange({ ...filtros, mes: v })}
        formato={fmtMes}
        todos="Todos los meses"
      />
      <SelectorMultiple
        etiqueta="Proveedor"
        valores={filtros.proveedor}
        opciones={opciones?.proveedores ?? []}
        onChange={(v) => onChange({ ...filtros, proveedor: v })}
      />
      <SelectorMultiple
        etiqueta="Marca"
        valores={filtros.marca}
        opciones={opciones?.marcas ?? []}
        onChange={(v) => onChange({ ...filtros, marca: v })}
      />
      {conAlerta && (
        <SelectorMultiple
          etiqueta="Nivel"
          valores={filtros.alerta}
          opciones={NIVELES_ALERTA.map((n) => [n, NOMBRE_ALERTA[n]] as [string, string])}
          onChange={(v) => onChange({ ...filtros, alerta: v })}
          todos="Todos los niveles"
        />
      )}

      <BotonLimpiar onClick={onLimpiar} deshabilitado={sinCambios} />

      <span className="text-muted ml-auto max-w-md text-[11px] leading-tight">{nota}</span>
    </div>
  );
}
