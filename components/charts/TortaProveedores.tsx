"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { colorSerie, TEMA } from "@/lib/paleta";
import { fmtMoneda, fmtPct } from "@/lib/format";
import type { PuntoProveedor } from "@/lib/types";
import { CajaTooltip, FilaTooltip } from "./TooltipOscuro";

type ItemTooltip = { payload?: PuntoProveedor & { fill?: string } };

/** `total` llega por prop; recharts le inyecta `active` y `payload` al clonar. */
function Contenido({
  active,
  payload,
  total = 0,
}: {
  active?: boolean;
  payload?: ItemTooltip[];
  total?: number;
}) {
  const item = payload?.[0]?.payload;
  if (!active || !item) return null;
  return (
    <CajaTooltip>
      <FilaTooltip
        color={item.fill ?? TEMA.muted}
        label={item.label}
        valor={fmtMoneda(item.total)}
      />
      <p className="text-muted text-right">
        {total > 0 ? fmtPct(item.total / total) : "—"} del total
      </p>
    </CajaTooltip>
  );
}

export default function TortaProveedores({
  datos,
  totalGeneral,
  seleccionados,
  onSeleccionar,
}: {
  datos: PuntoProveedor[];
  /** Facturación neta de TODOS los proveedores, no solo los del top 12:
   *  los porcentajes tienen que ser sobre el total real. */
  totalGeneral: number;
  /** Valores resaltados; el resto se atenúa. Vacío = todos iguales. */
  seleccionados?: string[];
  /** Si se omite, la torta es solo de lectura (sin filtro cruzado). */
  onSeleccionar?: (proveedor: string) => void;
}) {
  if (datos.length === 0) {
    return <p className="text-muted py-16 text-center text-sm">Sin datos para el filtro elegido.</p>;
  }

  const total = totalGeneral;
  const cubierto = datos.reduce((acc, d) => acc + d.total, 0);

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
      <div className="min-w-0 flex-1">
        <ResponsiveContainer width="100%" height={300}>
          <PieChart>
            <Pie
              data={datos}
              dataKey="total"
              nameKey="label"
              innerRadius="55%"
              outerRadius="85%"
              paddingAngle={1}
              stroke={TEMA.panel}
              strokeWidth={2}
              isAnimationActive={false}
              onClick={(d: unknown) => {
                const label = (d as { payload?: PuntoProveedor })?.payload?.label;
                if (label) onSeleccionar?.(label);
              }}
              className={onSeleccionar ? "cursor-pointer" : undefined}
            >
              {datos.map((d, i) => (
                <Cell
                  key={d.label}
                  fill={colorSerie(i)}
                  // Al seleccionar uno, los demás se atenúan en vez de desaparecer.
                  fillOpacity={!seleccionados?.length || seleccionados.includes(d.label) ? 1 : 0.25}
                />
              ))}
            </Pie>
            <Tooltip content={<Contenido total={total} />} />
          </PieChart>
        </ResponsiveContainer>
      </div>

      {/* Leyenda propia: 12 proveedores no entran en la de recharts. */}
      <ul className="grid shrink-0 grid-cols-1 gap-x-6 gap-y-1.5 text-xs sm:grid-cols-2 lg:w-[42%] lg:grid-cols-1">
        {datos.map((d, i) => {
          const activo = !!seleccionados?.includes(d.label);
          return (
            <li key={d.label}>
              <button
                onClick={() => onSeleccionar?.(d.label)}
                disabled={!onSeleccionar}
                className={`hover:bg-panel-2 flex w-full items-center gap-2 rounded px-1 py-0.5 text-left ${
                  seleccionados?.length && !activo ? "opacity-40" : ""
                }`}
              >
                <span
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ background: colorSerie(i) }}
                />
                <span className={`truncate ${activo ? "text-ink" : "text-muted"}`} title={d.label}>
                  {d.label}
                </span>
                <span className="ml-auto shrink-0 tabular-nums">
                  {total > 0 ? fmtPct(d.total / total) : "—"}
                </span>
              </button>
            </li>
          );
        })}
        {total > cubierto && (
          <li className="text-muted border-line mt-1 flex items-center gap-2 border-t pt-1.5">
            <span className="size-2.5 shrink-0" />
            <span>Resto de proveedores</span>
            <span className="ml-auto shrink-0 tabular-nums">{fmtPct((total - cubierto) / total)}</span>
          </li>
        )}
      </ul>
    </div>
  );
}
