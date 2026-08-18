"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { fmtFechaCorta, fmtMoneda, fmtMonedaCorta } from "@/lib/format";
import { PALETA, TEMA } from "@/lib/paleta";
import type { PuntoFacturacion } from "@/lib/types";
import { CajaTooltip, FilaTooltip } from "./TooltipOscuro";

type ItemTooltip = { value?: number };

function Contenido({
  active,
  label,
  payload,
}: {
  active?: boolean;
  label?: string;
  payload?: ItemTooltip[];
}) {
  const valor = payload?.[0]?.value;
  if (!active || typeof valor !== "number") return null;
  return (
    <CajaTooltip titulo={label ? fmtFechaCorta(label) : undefined}>
      <FilaTooltip color={PALETA[0]} label="Facturación neta" valor={fmtMoneda(valor)} />
    </CajaTooltip>
  );
}

/**
 * Facturación neta por día del vendedor.
 *
 * Es una sola serie, así que va como área y no como línea: el relleno hace que
 * un mes con pocos días cargados se lea como lo que es (poco volumen) en vez de
 * como una línea flotando en el vacío.
 */
export default function LineaFacturacion({ datos }: { datos: PuntoFacturacion[] }) {
  if (datos.length === 0) {
    return (
      <p className="text-muted py-16 text-center text-sm">
        Sin facturación en el recorte elegido.
      </p>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart data={datos} margin={{ top: 4, right: 12, bottom: 0, left: 4 }}>
        <defs>
          <linearGradient id="degradadoFacturacion" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={PALETA[0]} stopOpacity={0.35} />
            <stop offset="100%" stopColor={PALETA[0]} stopOpacity={0} />
          </linearGradient>
        </defs>
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
        <Area
          type="monotone"
          dataKey="total"
          stroke={PALETA[0]}
          strokeWidth={2}
          fill="url(#degradadoFacturacion)"
          isAnimationActive={false}
          activeDot={{ r: 3 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
