"use client";

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { colorSerie, TEMA } from "@/lib/paleta";
import { fmtFechaCorta, fmtMoneda, fmtMonedaCorta } from "@/lib/format";
import type { SerieDiaria } from "@/lib/types";
import { CajaTooltip, FilaTooltip } from "./TooltipOscuro";

type ItemTooltip = { dataKey?: string | number; value?: number; color?: string };

function Contenido({
  active,
  label,
  payload,
}: {
  active?: boolean;
  label?: string;
  payload?: ItemTooltip[];
}) {
  if (!active || !payload?.length) return null;

  const filas = payload
    .filter((p) => typeof p.value === "number" && p.value !== 0)
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

  if (filas.length === 0) return null;
  const total = filas.reduce((acc, p) => acc + (p.value ?? 0), 0);

  return (
    <CajaTooltip titulo={label}>
      {filas.map((p) => (
        <FilaTooltip
          key={String(p.dataKey)}
          color={p.color ?? TEMA.muted}
          label={String(p.dataKey)}
          valor={fmtMoneda(p.value ?? 0)}
        />
      ))}
      {filas.length > 1 && (
        <div className="border-line text-muted mt-1 flex gap-2 border-t pt-1">
          <span>Total del día</span>
          <span className="text-ink ml-auto tabular-nums">{fmtMoneda(total)}</span>
        </div>
      )}
    </CajaTooltip>
  );
}

export default function LineasPorVendedor({ serie }: { serie: SerieDiaria }) {
  if (serie.data.length === 0) {
    return <p className="text-muted py-16 text-center text-sm">Sin datos para el filtro elegido.</p>;
  }

  return (
    <ResponsiveContainer width="100%" height={340}>
      <LineChart data={serie.data} margin={{ top: 4, right: 12, bottom: 0, left: 4 }}>
        <CartesianGrid stroke={TEMA.line} strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="fecha"
          tickFormatter={fmtFechaCorta}
          tick={{ fill: TEMA.muted, fontSize: 11 }}
          stroke={TEMA.line}
          minTickGap={24}
        />
        <YAxis
          tickFormatter={fmtMonedaCorta}
          tick={{ fill: TEMA.muted, fontSize: 11 }}
          stroke={TEMA.line}
          width={70}
        />
        <Tooltip content={<Contenido />} cursor={{ stroke: TEMA.muted, strokeDasharray: "3 3" }} />
        <Legend
          wrapperStyle={{ fontSize: 12, color: TEMA.muted, paddingTop: 8 }}
          iconType="plainline"
        />
        {serie.vendedores.map((vendedor, i) => (
          <Line
            key={vendedor}
            type="monotone"
            dataKey={vendedor}
            stroke={colorSerie(i)}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 3 }}
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
