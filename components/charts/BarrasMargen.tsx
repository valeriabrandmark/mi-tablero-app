"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { PALETA, TEMA } from "@/lib/paleta";
import { fmtNumero, fmtPct } from "@/lib/format";
import type { MargenProveedor } from "@/lib/types";
import { CajaTooltip, FilaTooltip } from "./TooltipOscuro";

type ItemTooltip = { payload?: MargenProveedor };

function Contenido({ active, payload }: { active?: boolean; payload?: ItemTooltip[] }) {
  const item = payload?.[0]?.payload;
  if (!active || !item) return null;
  return (
    <CajaTooltip>
      <FilaTooltip
        color={(item.margenPct ?? 0) >= 0 ? PALETA[1] : TEMA.negativo}
        label={item.label}
        valor={fmtPct(item.margenPct)}
      />
      <p className="text-muted text-right">{fmtNumero(item.unidades)} unidades</p>
    </CajaTooltip>
  );
}

export default function BarrasMargen({
  datos,
  seleccionados,
  onSeleccionar,
}: {
  datos: MargenProveedor[];
  /** Valores resaltados; el resto se atenúa. Vacío = todos iguales. */
  seleccionados?: string[];
  onSeleccionar: (proveedor: string) => void;
}) {
  if (datos.length === 0) {
    return (
      <p className="text-muted py-16 text-center text-sm">
        Ningún proveedor tiene ventas para el filtro elegido.
      </p>
    );
  }

  // Barras horizontales: se leen mejor los nombres largos de proveedor.
  const alto = Math.max(260, datos.length * 26 + 40);

  return (
    <ResponsiveContainer width="100%" height={alto}>
      <BarChart
        data={datos}
        layout="vertical"
        margin={{ top: 4, right: 48, bottom: 0, left: 4 }}
        barCategoryGap="20%"
      >
        <CartesianGrid stroke={TEMA.line} strokeDasharray="3 3" horizontal={false} />
        <XAxis
          type="number"
          tickFormatter={(v: number) => fmtPct(v)}
          tick={{ fill: TEMA.muted, fontSize: 11 }}
          stroke={TEMA.line}
        />
        <YAxis
          type="category"
          dataKey="label"
          tick={{ fill: TEMA.muted, fontSize: 11 }}
          stroke={TEMA.line}
          width={180}
          interval={0}
        />
        <Tooltip content={<Contenido />} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
        <Bar
          dataKey="margenPct"
          radius={[0, 4, 4, 0]}
          isAnimationActive={false}
          onClick={(d: unknown) => {
            const label = (d as { payload?: MargenProveedor })?.payload?.label;
            if (label) onSeleccionar(label);
          }}
          className="cursor-pointer"
        >
          {datos.map((d) => (
            <Cell
              key={d.label}
              fill={(d.margenPct ?? 0) >= 0 ? PALETA[1] : TEMA.negativo}
              fillOpacity={!seleccionados?.length || seleccionados.includes(d.label) ? 1 : 0.25}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
