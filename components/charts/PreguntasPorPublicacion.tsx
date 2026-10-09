"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { PALETA, TEMA } from "@/lib/paleta";
import type { PuntoPublicacion } from "@/lib/queries-crm";
import { CajaTooltip, FilaTooltip } from "./TooltipOscuro";

const COLOR_TOTAL = PALETA[0];
const COLOR_PENDIENTE = "#f43f5e";

type ItemTooltip = { payload?: PuntoPublicacion };

function Contenido({ active, payload }: { active?: boolean; payload?: ItemTooltip[] }) {
  const fila = payload?.[0]?.payload;
  if (!active || !fila) return null;
  return (
    <CajaTooltip titulo={fila.publicacion}>
      <FilaTooltip color={COLOR_TOTAL} label="Preguntas" valor={String(fila.preguntas)} />
      {fila.sin_contestar > 0 && (
        <FilaTooltip
          color={COLOR_PENDIENTE}
          label="Sin contestar"
          valor={String(fila.sin_contestar)}
        />
      )}
    </CajaTooltip>
  );
}

/**
 * Las publicaciones que más preguntas reciben.
 *
 * BARRAS HORIZONTALES porque la etiqueta es un id largo ("MLA1234567890"): en
 * vertical queda en diagonal o cortada, y acá el nombre de cada fila es
 * justamente lo que hay que poder leer para ir a mirarla.
 *
 * ORDENADO DE MAYOR A MENOR y cortado en las primeras. Con 2.004 preguntas
 * repartidas en cientos de publicaciones, el gráfico con todas es una mancha;
 * lo que sirve son las de arriba, que son donde algo de la publicación no se
 * entiende y conviene corregir la descripción.
 *
 * LAS DOS SERIES NO SE APILAN: "sin contestar" es un SUBCONJUNTO de
 * "preguntas", no una parte aparte. Apiladas, una publicación con 10
 * preguntas y 3 sin contestar mediría 13 y mentiría. Van superpuestas, la
 * pendiente adelante y más angosta, que es como se lee "de estas, estas".
 */
export default function PreguntasPorPublicacion({ datos }: { datos: PuntoPublicacion[] }) {
  if (datos.length === 0) {
    return (
      <p className="text-muted py-16 text-center text-sm">
        Todavía no hay preguntas cargadas.
      </p>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={Math.max(200, datos.length * 34 + 56)}>
      <BarChart
        data={datos}
        layout="vertical"
        margin={{ top: 4, right: 16, bottom: 0, left: 4 }}
        barGap={-18}
      >
        <CartesianGrid stroke={TEMA.line} strokeDasharray="3 3" horizontal={false} />
        <XAxis
          type="number"
          allowDecimals={false}
          tick={{ fill: TEMA.muted, fontSize: 11 }}
          stroke={TEMA.line}
        />
        <YAxis
          type="category"
          dataKey="publicacion"
          tick={{ fill: TEMA.muted, fontSize: 11 }}
          stroke={TEMA.line}
          width={110}
        />
        <Tooltip content={<Contenido />} cursor={{ fill: `${TEMA.muted}22` }} />
        <Legend
          wrapperStyle={{ fontSize: 11, color: TEMA.muted }}
          formatter={(valor) =>
            valor === "preguntas" ? "Preguntas recibidas" : "Sin contestar"
          }
        />
        <Bar
          dataKey="preguntas"
          fill={COLOR_TOTAL}
          isAnimationActive={false}
          radius={[0, 4, 4, 0]}
          barSize={18}
        />
        <Bar
          dataKey="sin_contestar"
          fill={COLOR_PENDIENTE}
          isAnimationActive={false}
          radius={[0, 4, 4, 0]}
          barSize={8}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}
