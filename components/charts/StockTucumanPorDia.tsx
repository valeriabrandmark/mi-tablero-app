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
import { fmtFechaCorta, fmtNumero } from "@/lib/format";
import { PALETA, TEMA } from "@/lib/paleta";
import type { PuntoStockTucuman } from "@/lib/types";
import { CajaTooltip, FilaTooltip } from "./TooltipOscuro";

type ItemTooltip = { payload?: PuntoStockTucuman };

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
      {p.unidades == null ? (
        // UN DIA SIN FOTO LO DICE CON ESAS PALABRAS. Si el tooltip mostrara
        // "0 unidades", el día que el pipeline no corra alguien va a salir a
        // reponer un depósito lleno.
        <p className="text-muted">Sin registro de stock ese día.</p>
      ) : (
        <>
          <FilaTooltip
            color={PALETA[2]}
            label="Disponible en Tucumán"
            valor={fmtNumero(p.unidades)}
          />
          {p.skus != null && (
            <div className="text-muted pl-4 text-[11px]">
              {fmtNumero(p.skus)} {p.skus === 1 ? "artículo" : "artículos"} con
              stock
            </div>
          )}
          {p.unidades === 0 && (
            <div className="text-muted pl-4 text-[11px]">
              El depósito quedó sin stock ese día.
            </div>
          )}
        </>
      )}
    </CajaTooltip>
  );
}

/**
 * El stock del depósito de Tucumán, día por día.
 *
 * ---------------------------------------------------------------------------
 * ES EL HERMANO DEL PANEL DE STOCK EN FULL
 *
 * Misma forma, mismo ámbar, misma altura y el mismo lugar --debajo de las
 * ventas-- porque contesta la misma pregunta de este lado del negocio: si un
 * artículo no vendió, ¿fue que nadie lo quiso o que no había?
 *
 * El ámbar no es casual: es el color que el tablero ya usa para "stock" en
 * Mercado Libre, y el par más separado del azul de la venta (ΔE 38 a vista
 * normal, 32,8 en protanopía). Quien mira las dos pantallas no tiene que
 * aprender dos códigos de color.
 *
 * ---------------------------------------------------------------------------
 * LA LINEA SE CORTA, NO SE INVENTA
 *
 * `connectNulls` queda en FALSE a propósito. La serie de Tucumán arranca el
 * 10/11/2026 y el gráfico abarca todo el rango filtrado, así que lo normal
 * durante meses va a ser un eje largo con la línea sólo al final.
 *
 * Con `connectNulls` en true, recharts uniría el último día con foto con el
 * primero, dibujando una recta prolija a través de medio año sin datos: una
 * línea que afirma un stock que nadie midió. Cortada, el hueco se ve, y la
 * bajada del panel dice cuántos días del rango tienen foto.
 *
 * ---------------------------------------------------------------------------
 * POR QUE EL EJE IGUAL LLEGA HASTA EL FINAL
 *
 * Los días sin foto vienen en la serie con `unidades: null`. Podrían no venir
 * --el gráfico sería más corto y más limpio-- pero entonces este panel y el de
 * ventas tendrían ejes distintos, y están uno debajo del otro para leerse
 * juntos: un pico de venta del 12/06 tiene que caer en la misma vertical en
 * los dos.
 */
export default function StockTucumanPorDia({
  datos,
}: {
  datos: PuntoStockTucuman[];
}) {
  if (datos.length === 0) {
    return (
      <p className="text-muted py-10 text-center text-sm">
        Sin días en el recorte elegido.
      </p>
    );
  }

  if (datos.every((p) => p.unidades == null)) {
    return (
      <p className="text-muted py-10 text-center text-sm">
        Sin registro de stock en el recorte elegido. El stock de Tucumán empezó
        a registrarse el 10/11/2026.
      </p>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={180}>
      <AreaChart data={datos} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
        <defs>
          <linearGradient id="gradStockTucuman" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={PALETA[2]} stopOpacity={0.3} />
            <stop offset="100%" stopColor={PALETA[2]} stopOpacity={0} />
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
        {/* EL EJE ARRANCA EN CERO, igual que el de Full: acá el cero es un
            valor con sentido --quiebre de stock-- y un eje ajustado al mínimo
            haría ver una caída del 2 % como si se hubiera vaciado el depósito.
            Entre el 10 y el 11/11 el stock bajó de 131.294 a 128.420: con el
            eje en cero eso se lee como lo que es, un movimiento chico. */}
        <YAxis
          tickFormatter={fmtNumero}
          tick={{ fill: TEMA.muted, fontSize: 11 }}
          stroke={TEMA.line}
          width={56}
          domain={[0, "auto"]}
        />
        <Tooltip content={<Contenido />} cursor={{ stroke: TEMA.line }} />

        <Area
          type="monotone"
          dataKey="unidades"
          stroke={PALETA[2]}
          strokeWidth={1.5}
          fill="url(#gradStockTucuman)"
          connectNulls={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
