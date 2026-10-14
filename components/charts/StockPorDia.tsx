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
import type { PuntoStockDia } from "@/lib/types";
import { CajaTooltip, FilaTooltip } from "./TooltipOscuro";

type ItemTooltip = { payload?: PuntoStockDia };

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
        color={PALETA[2]}
        label="Unidades publicadas"
        valor={fmtNumero(p.unidades)}
      />
      {/* CUANTOS ARTICULOS DISTINTOS, aparte de las unidades. Sin filtro son
          dos lecturas distintas: 35.000 unidades repartidas en 1.600 SKU no es
          lo mismo que las mismas unidades en 200. */}
      <div className="text-muted pl-4 text-[11px]">
        {fmtNumero(p.skus)} {p.skus === 1 ? "artículo" : "artículos"} ·{" "}
        {fmtNumero(p.publicaciones)}{" "}
        {p.publicaciones === 1 ? "publicación" : "publicaciones"}
      </div>
      {p.unidades === 0 && (
        <div className="text-muted pl-4 text-[11px]">
          No se podía comprar ese día.
        </div>
      )}
    </CajaTooltip>
  );
}

/**
 * El stock que el pulso midió, día por día.
 *
 * ---------------------------------------------------------------------------
 * PARA QUE ESTA ACA, DEBAJO DE LAS VENTAS
 *
 * Un artículo que no vendió pudo no vender por dos razones opuestas: nadie lo
 * quiso, o no se podía comprar. En el gráfico de ventas las dos se ven igual
 * --una línea en cero-- y llevan a decisiones contrarias: una dice "bajá el
 * precio", la otra "reponé". Esta serie contesta cuál de las dos fue.
 *
 * VA EN SU PROPIO PANEL Y NO ENCIMA DE LA VENTA. Son unidades contra pesos:
 * meterlas en el mismo gráfico pide dos escalas, y con dos escalas el pico de
 * stock y el pico de venta se dibujan del mismo alto aunque no tengan nada que
 * ver. Compartir el eje de fechas y apilar los paneles dice lo mismo sin esa
 * mentira.
 *
 * EN AMBAR Y NO EN EL AZUL DE LA VENTA, justamente para que no se lean como la
 * misma magnitud. Es el par más separado de la paleta: ΔE 38 a vista normal y
 * 32,8 en protanopía.
 *
 * ---------------------------------------------------------------------------
 * UN HUECO NO ES UN CERO
 *
 * La serie sólo trae los días en que el pulso efectivamente corrió. Un día que
 * el pipeline no midió no aparece, en vez de aparecer en cero: cero significa
 * "no había nada para vender", y eso es una afirmación muy distinta de "no
 * miramos". El pulso arranca el 21/08/2026; para un rango anterior esto viene
 * vacío y lo dice.
 */
export default function StockPorDia({ datos }: { datos: PuntoStockDia[] }) {
  if (datos.length === 0) {
    return (
      <p className="text-muted py-10 text-center text-sm">
        Sin mediciones de stock en el recorte elegido. El pulso empezó a
        registrar el 21/08/2026.
      </p>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={180}>
      <AreaChart data={datos} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
        <defs>
          <linearGradient id="gradStockDia" x1="0" y1="0" x2="0" y2="1">
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
        {/* EL EJE ARRANCA EN CERO Y NO SE AJUSTA A LOS DATOS. Acá el cero es un
            valor con sentido --quiebre de stock-- así que un eje que empieza en
            el mínimo haría ver una caída del 5 % como si se hubiera vaciado
            todo. */}
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
          fill="url(#gradStockDia)"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
