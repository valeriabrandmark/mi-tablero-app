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
import { TEMA } from "@/lib/paleta";
import type { PuntoResultado } from "@/lib/queries-crm";
import { CajaTooltip, FilaTooltip } from "./TooltipOscuro";

/**
 * NI VERDE NI ROJO PARA GANADO Y PERDIDO.
 *
 * Es la combinación que sale sola para "a favor nuestro" contra "a favor del
 * cliente", y es justo la que un daltónico no distingue: medidos sobre el
 * fondo de la app, #22c55e y #f43f5e quedan a ΔE 6,4 en deuteranopía --por
 * debajo del piso de 8--, o sea dos barras del mismo color para una de cada
 * doce personas.
 *
 * Azul contra rojo pasa las cinco verificaciones, con ΔE 23,3 en el peor caso
 * de daltonismo. Y los dos colores ya estaban en la paleta del tablero.
 */
const COLORES = {
  nosotros: "#3b82f6",
  otra_parte: "#f43f5e",
  // Gris a propósito: "los dos" es el punto medio de una escala divergente
  // --Mercado Libre partió la diferencia-- y no una tercera categoría. Pintarlo
  // de un color propio lo haría competir con los otros dos por la atención.
  los_dos: TEMA.muted,
} as const;

const ETIQUETAS = {
  nosotros: "A favor nuestro",
  otra_parte: "A favor del cliente",
  los_dos: "Partido",
} as const;

type Clave = keyof typeof COLORES;

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
  const total = payload.reduce((suma, i) => suma + (i.value ?? 0), 0);
  return (
    <CajaTooltip titulo={label}>
      {payload.map((item) => {
        const clave = String(item.dataKey) as Clave;
        if (!(clave in COLORES)) return null;
        return (
          <FilaTooltip
            key={clave}
            color={COLORES[clave]}
            label={ETIQUETAS[clave]}
            valor={String(item.value ?? 0)}
          />
        );
      })}
      <FilaTooltip color={TEMA.line} label="Resueltos en el mes" valor={String(total)} />
    </CajaTooltip>
  );
}

/**
 * A favor de quién se resolvieron los reclamos, mes a mes.
 *
 * APILADO Y NO AGRUPADO porque las tres partes son el mismo total repartido:
 * lo que se quiere leer es la proporción de un mes y cómo cambia, no comparar
 * la altura de tres barras sueltas.
 *
 * SOLO ENTRAN LOS RESUELTOS. Un reclamo cerrado sin resolución no dice a favor
 * de quién salió --en el sondeo eran 15 de 20-- y meterlo en alguna de las
 * tres columnas sería inventar justo el dato que el gráfico viene a mostrar.
 * El total de abajo de la pantalla aclara cuántos quedaron afuera.
 */
export default function ResultadoReclamos({ datos }: { datos: PuntoResultado[] }) {
  if (datos.length === 0) {
    return (
      <p className="text-muted py-16 text-center text-sm">
        Todavía no hay reclamos con resolución en el período elegido.
      </p>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={datos} margin={{ top: 4, right: 12, bottom: 0, left: 4 }}>
        <CartesianGrid stroke={TEMA.line} strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="mes"
          tick={{ fill: TEMA.muted, fontSize: 11 }}
          stroke={TEMA.line}
          minTickGap={16}
        />
        <YAxis
          allowDecimals={false}
          tick={{ fill: TEMA.muted, fontSize: 11 }}
          stroke={TEMA.line}
          width={40}
        />
        <Tooltip content={<Contenido />} cursor={{ fill: `${TEMA.muted}22` }} />
        <Legend
          wrapperStyle={{ fontSize: 11, color: TEMA.muted }}
          formatter={(valor) => ETIQUETAS[valor as Clave] ?? valor}
        />
        {/* El orden importa: lo nuestro abajo, apoyado en el eje, que es desde
            donde se compara una altura sin esfuerzo. */}
        <Bar
          dataKey="nosotros"
          stackId="r"
          fill={COLORES.nosotros}
          isAnimationActive={false}
          // 2px de fondo entre segmentos: sin eso, dos colores contiguos se
          // leen como uno solo cuando el mes tiene pocos casos.
          stroke={TEMA.panel}
          strokeWidth={2}
        />
        <Bar
          dataKey="otra_parte"
          stackId="r"
          fill={COLORES.otra_parte}
          isAnimationActive={false}
          stroke={TEMA.panel}
          strokeWidth={2}
        />
        <Bar
          dataKey="los_dos"
          stackId="r"
          fill={COLORES.los_dos}
          isAnimationActive={false}
          stroke={TEMA.panel}
          strokeWidth={2}
          radius={[4, 4, 0, 0]}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}
