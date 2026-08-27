"use client";

import {
  BotonLimpiar,
  CampoBusqueda,
  CLASE_SELECT,
  SelectorMultiple,
} from "@/components/SelectorFiltro";
import { fmtFechaCorta } from "@/lib/format";
import {
  NIVELES_ALERTA,
  NOMBRE_ALERTA,
  PRESETS,
  hoyArgentina,
  type Rango,
} from "@/lib/meli";
import type { FiltrosMeli, OpcionesMeli } from "@/lib/types";

/**
 * Barra de filtros de la sección Mercado Libre.
 *
 * El filtro principal es un RANGO DE FECHAS y no el mes comercial: en este
 * canal se mira el día —cuánto vendimos hoy, cómo venimos contra ayer— y el mes
 * del 6 al 5 no significa nada acá. El mes comercial sigue disponible como uno
 * de los atajos, para quien quiera cerrar el mes.
 *
 * La comparten el tablero y las alertas para que un filtro puesto en una
 * pestaña se entienda igual en la otra; el selector de nivel de alerta solo
 * aparece donde significa algo.
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
  const hoy = hoyArgentina();
  const aplicar = (r: Rango) => onChange({ ...filtros, ...r });

  /** Un preset está activo cuando el rango elegido es exactamente el suyo. */
  const activo = (r: Rango) =>
    filtros.desde === r.desde && filtros.hasta === r.hasta;

  // Mover una punta más allá de la otra deja un rango vacío y la página se ve
  // rota sin motivo. Se arrastra la otra punta en vez de permitirlo.
  const cambiarDesde = (v: string) =>
    onChange({
      ...filtros,
      desde: v,
      hasta: filtros.hasta && filtros.hasta < v ? v : filtros.hasta,
    });
  const cambiarHasta = (v: string) =>
    onChange({
      ...filtros,
      hasta: v,
      desde: filtros.desde && filtros.desde > v ? v : filtros.desde,
    });

  return (
    <div className="border-line bg-panel flex flex-col gap-3 rounded-xl border p-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-muted text-[11px]">Desde</span>
          <input
            type="date"
            value={filtros.desde ?? ""}
            max={filtros.hasta ?? opciones?.ultimaVenta ?? undefined}
            min={opciones?.primeraVenta ?? undefined}
            onChange={(e) => e.target.value && cambiarDesde(e.target.value)}
            className={`${CLASE_SELECT} [color-scheme:dark]`}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-muted text-[11px]">Hasta</span>
          <input
            type="date"
            value={filtros.hasta ?? ""}
            min={filtros.desde ?? opciones?.primeraVenta ?? undefined}
            onChange={(e) => e.target.value && cambiarHasta(e.target.value)}
            className={`${CLASE_SELECT} [color-scheme:dark]`}
          />
        </label>

        <div className="flex flex-wrap gap-1 self-end pb-0.5">
          {PRESETS.map((p) => {
            const r = p.rango(hoy);
            const esActivo = activo(r);
            return (
              <button
                key={p.label}
                type="button"
                onClick={() => aplicar(r)}
                aria-pressed={esActivo}
                className={`rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${
                  esActivo
                    ? "border-c1 bg-c1/15 text-c1"
                    : "border-line text-muted hover:bg-panel-2 hover:text-ink"
                }`}
              >
                {p.label}
              </button>
            );
          })}
        </div>

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
            opciones={NIVELES_ALERTA.map(
              (n) => [n, NOMBRE_ALERTA[n]] as [string, string],
            )}
            onChange={(v) => onChange({ ...filtros, alerta: v })}
            todos="Todos los niveles"
          />
        )}

        <CampoBusqueda
          valor={filtros.buscar ?? ""}
          placeholder="N° orden, N° venta, SKU o producto"
          onChange={(v) => onChange({ ...filtros, buscar: v || undefined })}
        />

        <BotonLimpiar onClick={onLimpiar} deshabilitado={sinCambios} />
      </div>

      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="text-muted text-[11px]">
          {filtros.desde === filtros.hasta
            ? `Mostrando ${fmtFechaCorta(filtros.desde ?? "")}`
            : `Mostrando ${fmtFechaCorta(filtros.desde ?? "")} a ${fmtFechaCorta(filtros.hasta ?? "")}`}
        </span>
        <span className="text-muted max-w-xl text-[11px] leading-tight">
          {nota}
        </span>
      </div>
    </div>
  );
}
