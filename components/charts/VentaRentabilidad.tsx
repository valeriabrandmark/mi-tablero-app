"use client";

import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { fmtFechaCorta, fmtMoneda, fmtMonedaCorta } from "@/lib/format";
import { PALETA, TEMA } from "@/lib/paleta";
import type { PuntoDiaMeli } from "@/lib/types";
import { CajaTooltip, FilaTooltip } from "./TooltipOscuro";

type ItemTooltip = { dataKey?: string | number; value?: number };

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
  const valor = (clave: string) => payload.find((p) => p.dataKey === clave)?.value;
  const venta = valor("venta");
  const rentabilidad = valor("rentabilidad");

  return (
    <CajaTooltip titulo={label ? fmtFechaCorta(label) : undefined}>
      <FilaTooltip color={PALETA[0]} label="Venta c/IVA" valor={fmtMoneda(venta)} />
      <FilaTooltip
        color={PALETA[1]}
        label="Rentabilidad"
        valor={fmtMoneda(rentabilidad)}
      />
    </CajaTooltip>
  );
}

/**
 * Venta y rentabilidad del día, en el mismo gráfico.
 *
 * Van juntas y no en dos paneles porque lo que importa es si se mueven igual:
 * un día de mucha venta con la rentabilidad plana es exactamente el problema
 * que la pestaña de alertas después desglosa línea por línea.
 *
 * Comparten eje: son los dos pesos y la rentabilidad es una fracción de la
 * venta, así que un segundo eje escalado a la rentabilidad la haría parecer del
 * mismo tamaño que la venta.
 */
export default function VentaRentabilidad({ datos }: { datos: PuntoDiaMeli[] }) {
  if (datos.length === 0) {
    return <p className="text-muted py-10 text-center text-sm">Sin ventas en el recorte elegido.</p>;
  }

  return (
    <ResponsiveContainer width="100%" height={260}>
      <ComposedChart data={datos} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
        <defs>
          <linearGradient id="gradVentaDia" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={PALETA[0]} stopOpacity={0.35} />
            <stop offset="100%" stopColor={PALETA[0]} stopOpacity={0} />
          </linearGradient>
        </defs>

        <CartesianGrid stroke={TEMA.line} vertical={false} />
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
          width={72}
        />
        <Tooltip content={<Contenido />} cursor={{ stroke: TEMA.line }} />

        <Area
          type="monotone"
          dataKey="venta"
          stroke={PALETA[0]}
          strokeWidth={1.5}
          fill="url(#gradVentaDia)"
        />
        <Line
          type="monotone"
          dataKey="rentabilidad"
          stroke={PALETA[1]}
          strokeWidth={1.5}
          dot={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
