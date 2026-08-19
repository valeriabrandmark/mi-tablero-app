"use client";

import { BotonLimpiar, CLASE_SELECT, SelectorMultiple } from "@/components/SelectorFiltro";
import { fmtFechaCorta } from "@/lib/format";
import { hoyArgentina, PRESETS, type Rango } from "@/lib/tiendanube";
import type { FiltrosTiendaNube, OpcionesTiendaNube } from "@/lib/types";

/**
 * Barra de filtros de la sección Tienda Nube.
 *
 * Se parece a la de Mercado Libre pero no es la misma, y las diferencias son
 * las que hacen que el tablero sea usable en un canal de poco volumen:
 *
 * - Los atajos arrancan en 7 días. "Hoy" y "Ayer" existen en Mercado Libre
 *   porque ahí entran cientos de ventas por día; acá entran unos ocho pedidos
 *   por MES, así que un botón "Hoy" daría vacío tres de cada cuatro días.
 *
 * - Hay un atajo "Todo", que en Mercado Libre no tendría sentido (38.000
 *   líneas) y acá sí: la historia entera son treinta pedidos. Sale de las
 *   opciones y no de una fecha fija, así que se corre solo.
 *
 * Al cliente NO se llega por un desplegable sino clickeando su fila: uno ve un
 * pedido raro y quiere saber qué más compró esa persona. Elegir a ciegas de una
 * lista de nombres no era un camino que nadie fuera a usar.
 */
export default function BarraFiltrosTiendaNube({
  filtros,
  opciones,
  onChange,
  onLimpiar,
  sinCambios,
  nota,
}: {
  filtros: FiltrosTiendaNube;
  opciones: OpcionesTiendaNube | null;
  onChange: (f: FiltrosTiendaNube) => void;
  onLimpiar: () => void;
  sinCambios: boolean;
  nota: string;
}) {
  const hoy = hoyArgentina();
  const aplicar = (r: Rango) => onChange({ ...filtros, ...r });

  /** Un preset está activo cuando el rango elegido es exactamente el suyo. */
  const activo = (r: Rango) => filtros.desde === r.desde && filtros.hasta === r.hasta;

  // "Todo" solo se puede armar cuando ya llegaron las opciones: antes de eso no
  // sabemos cuál fue la primera venta. Mientras tanto el botón no se dibuja, en
  // vez de dibujarse y no hacer nada al tocarlo.
  const todo: Rango | null = opciones?.primeraVenta
    ? { desde: opciones.primeraVenta, hasta: opciones.ultimaVenta ?? hoy }
    : null;

  // Mover una punta más allá de la otra deja un rango vacío y la página se ve
  // rota sin motivo. Se arrastra la otra punta en vez de permitirlo.
  const cambiarDesde = (v: string) =>
    onChange({ ...filtros, desde: v, hasta: filtros.hasta && filtros.hasta < v ? v : filtros.hasta });
  const cambiarHasta = (v: string) =>
    onChange({ ...filtros, hasta: v, desde: filtros.desde && filtros.desde > v ? v : filtros.desde });

  const boton = (label: string, r: Rango) => {
    const esActivo = activo(r);
    return (
      <button
        key={label}
        type="button"
        onClick={() => aplicar(r)}
        aria-pressed={esActivo}
        className={`rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${
          esActivo
            ? "border-c1 bg-c1/15 text-c1"
            : "border-line text-muted hover:bg-panel-2 hover:text-ink"
        }`}
      >
        {label}
      </button>
    );
  };

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
          {PRESETS.map((p) => boton(p.label, p.rango(hoy)))}
          {todo && boton("Todo", todo)}
        </div>

        {/* No hay selector de Cliente a propósito. Al cliente se llega
            clickeando su fila en el panel de Clientes o en el de Pedidos, que
            es como se lo busca de verdad: uno ve un pedido raro y quiere ver
            qué más compró esa persona. Un desplegable con 27 nombres para
            elegir a ciegas no servía para nada. */}
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

        <BotonLimpiar onClick={onLimpiar} deshabilitado={sinCambios} />
      </div>

      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="text-muted text-[11px]">
          {filtros.desde === filtros.hasta
            ? `Mostrando ${fmtFechaCorta(filtros.desde ?? "")}`
            : `Mostrando ${fmtFechaCorta(filtros.desde ?? "")} a ${fmtFechaCorta(filtros.hasta ?? "")}`}
        </span>
        <span className="text-muted max-w-xl text-[11px] leading-tight">{nota}</span>
      </div>
    </div>
  );
}
