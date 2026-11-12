"use client";

import { usePathname, useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CLASE_SELECT } from "@/components/SelectorFiltro";
import { ATAJOS, type Periodo } from "@/lib/marketing-periodo";
import type { Rango } from "@/lib/rangos";

/**
 * El filtro de período del Tablero de Marca: desde/hasta y atajos (mes,
 * mes comercial, últimos días).
 *
 * El período va en la URL (`?desde=&hasta=`) y no en un estado del navegador:
 * los datos se piden en el servidor (Meta y la base, con el token del lado del
 * servidor), así que cambiar el período es pedir la página de nuevo. De paso
 * se puede compartir el link y el botón Atrás vuelve al período anterior.
 *
 * Aplica a TODAS las pestañas (Consolidado y cada marca): es un solo período
 * para el tablero entero, y cambiar de marca no lo pierde.
 */
export default function FiltroPeriodoMarketing({ periodo }: { periodo: Periodo }) {
  const router = useRouter();
  const pathname = usePathname();
  const [cargando, startTransition] = useTransition();
  // Las fechas a mano se aplican con el botón, no al tipear: cada cambio es
  // una consulta a Meta y a la base, y un rango a medio escribir no sirve.
  const [desde, setDesde] = useState(periodo.desde);
  const [hasta, setHasta] = useState(periodo.hasta);

  const ir = (r: Rango) => {
    setDesde(r.desde);
    setHasta(r.hasta);
    startTransition(() => router.push(`${pathname}?desde=${r.desde}&hasta=${r.hasta}`, { scroll: false }));
  };

  const boton = (label: string, r: Rango) => {
    const activo = periodo.desde === r.desde && periodo.hasta === r.hasta;
    return (
      <button
        key={label}
        type="button"
        onClick={() => ir(r)}
        aria-pressed={activo}
        className={`rounded-lg border px-2.5 py-1.5 text-xs whitespace-nowrap transition-colors ${
          activo ? "border-c1 bg-c1/15 text-c1" : "border-line text-muted hover:bg-panel-2 hover:text-ink"
        }`}
      >
        {label}
      </button>
    );
  };

  const cambio = desde !== periodo.desde || hasta !== periodo.hasta;

  return (
    <div className="border-line bg-panel flex flex-wrap items-end gap-3 rounded-xl border p-3">
      <label className="flex flex-col gap-1">
        <span className="text-muted text-[11px]">Desde</span>
        <input
          type="date"
          value={desde}
          max={hasta}
          onChange={(e) => e.target.value && setDesde(e.target.value)}
          className={`${CLASE_SELECT} [color-scheme:dark]`}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-muted text-[11px]">Hasta</span>
        <input
          type="date"
          value={hasta}
          min={desde}
          onChange={(e) => e.target.value && setHasta(e.target.value)}
          className={`${CLASE_SELECT} [color-scheme:dark]`}
        />
      </label>
      {cambio && (
        <button
          type="button"
          onClick={() => ir({ desde, hasta })}
          className="bg-c1 rounded-lg px-3 py-1.5 text-xs font-medium text-white"
        >
          Aplicar
        </button>
      )}
      <div className="flex flex-wrap gap-1 self-end pb-0.5">
        {ATAJOS.map((a) => boton(a.label, a.rango(periodo.hoy)))}
      </div>
      {cargando && <span className="text-muted self-center text-xs">Actualizando…</span>}
    </div>
  );
}
