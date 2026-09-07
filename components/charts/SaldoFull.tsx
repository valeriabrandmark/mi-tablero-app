"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { fmtFechaCorta, fmtNumero } from "@/lib/format";
import { PALETA, TEMA } from "@/lib/paleta";
import type { PuntoTrazabilidad } from "@/lib/types";
import { CajaTooltip, FilaTooltip } from "./TooltipOscuro";

type ItemTooltip = { payload?: PuntoTrazabilidad };

function Contenido({
  active,
  label,
  payload,
}: {
  active?: boolean;
  label?: string;
  payload?: ItemTooltip[];
}) {
  const p = payload?.[0]?.payload;
  if (!active || !p) return null;
  return (
    <CajaTooltip titulo={label ? fmtFechaCorta(label) : undefined}>
      <FilaTooltip
        color={p.acumulado < 0 ? TEMA.negativo : PALETA[0]}
        label="Saldo acumulado"
        valor={`${p.acumulado > 0 ? "+" : ""}${fmtNumero(p.acumulado)} u.`}
      />
      {/* El detalle del día explica de dónde salió el movimiento. Sin esto, un
          escalón en la curva no se distingue de un envío que llegó. */}
      <FilaTooltip color={PALETA[1]} label="Enviado" valor={`${fmtNumero(p.enviado)} u.`} />
      <FilaTooltip color={PALETA[2]} label="Vendido" valor={`${fmtNumero(p.vendido)} u.`} />
    </CajaTooltip>
  );
}

/**
 * La cuenta corriente del stock en Full, día por día.
 *
 * UNA SOLA SERIE, a propósito. La tentación es superponer el movimiento diario
 * en barras y el acumulado en línea, pero son dos escalas distintas en el mismo
 * eje: un día de recepción mueve miles de unidades y el saldo se mide en
 * decenas, así que la curva que importa quedaría aplastada contra el cero.
 *
 * Lo que hay que leer es la FORMA: mientras se mantenga plana alrededor del
 * cero, la cuenta cierra. Si baja y se queda abajo, ahí hay algo que reclamar.
 * El detalle diario vive en el tooltip, que es donde se lo va a buscar.
 */
export default function SaldoFull({ datos }: { datos: PuntoTrazabilidad[] }) {
  if (datos.length === 0) {
    return (
      <p className="text-muted py-8 text-center text-xs">
        Todavía no hay dos días de foto con los que comparar.
      </p>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={240}>
      <AreaChart data={datos} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="saldoFull" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={PALETA[0]} stopOpacity={0.28} />
            <stop offset="100%" stopColor={PALETA[0]} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={TEMA.line} strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="fecha"
          tickFormatter={fmtFechaCorta}
          tick={{ fontSize: 11, fill: TEMA.muted }}
          tickLine={false}
          axisLine={{ stroke: TEMA.line }}
        />
        <YAxis
          tickFormatter={(v: number) => fmtNumero(v)}
          tick={{ fontSize: 11, fill: TEMA.muted }}
          tickLine={false}
          axisLine={false}
          width={56}
        />
        {/* El cero es la referencia de lectura: arriba sobra, abajo falta. */}
        <ReferenceLine y={0} stroke={TEMA.muted} strokeWidth={1} />
        <Tooltip content={<Contenido />} cursor={{ stroke: TEMA.line }} />
        <Area
          type="monotone"
          dataKey="acumulado"
          stroke={PALETA[0]}
          strokeWidth={2}
          fill="url(#saldoFull)"
          dot={false}
          activeDot={{ r: 4 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
