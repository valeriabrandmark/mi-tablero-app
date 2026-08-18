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
import { colorSerie, TEMA } from "@/lib/paleta";
import type { PuntoEtiqueta } from "@/lib/types";
import { CajaTooltip, FilaTooltip } from "./TooltipOscuro";

type ItemTooltip = { payload?: PuntoEtiqueta & { fill?: string } };

/** `formato` y `colorUnico` llegan por prop; recharts inyecta el resto al clonar. */
function Contenido({
  active,
  payload,
  formato,
  colorUnico,
}: {
  active?: boolean;
  payload?: ItemTooltip[];
  formato?: (n: number) => string;
  colorUnico?: string;
}) {
  const item = payload?.[0]?.payload;
  if (!active || !item || !formato) return null;
  return (
    <CajaTooltip>
      <FilaTooltip
        color={item.fill ?? colorUnico ?? TEMA.muted}
        label={item.label}
        valor={formato(item.valor)}
      />
    </CajaTooltip>
  );
}

/**
 * Barras para rankings por categoría. Horizontales por default porque los
 * nombres largos (proveedores, provincias, razones sociales) se leen mejor.
 */
export default function BarrasCategoria({
  datos,
  formato,
  horizontal = true,
  colorUnico,
  alturaMinima = 240,
  vacio = "Sin datos para el filtro elegido.",
  seleccionado,
  onSeleccionar,
}: {
  datos: PuntoEtiqueta[];
  formato: (n: number) => string;
  horizontal?: boolean;
  /** Si se omite, cada barra toma un color distinto de la paleta. */
  colorUnico?: string;
  alturaMinima?: number;
  vacio?: string;
  seleccionado?: string;
  /** Si se omite, las barras son solo de lectura (sin filtro cruzado). */
  onSeleccionar?: (label: string) => void;
}) {
  if (datos.length === 0) {
    return <p className="text-muted py-16 text-center text-sm">{vacio}</p>;
  }

  const alto = horizontal ? Math.max(alturaMinima, datos.length * 26 + 40) : alturaMinima;

  const ejeCategoria = (
    <YAxis
      type="category"
      dataKey="label"
      tick={{ fill: TEMA.muted, fontSize: 11 }}
      stroke={TEMA.line}
      width={170}
      interval={0}
    />
  );
  const ejeValor = (
    <XAxis
      type="number"
      tickFormatter={formato}
      tick={{ fill: TEMA.muted, fontSize: 11 }}
      stroke={TEMA.line}
    />
  );

  return (
    <ResponsiveContainer width="100%" height={alto}>
      <BarChart
        data={datos}
        layout={horizontal ? "vertical" : "horizontal"}
        margin={{ top: 4, right: 32, bottom: 0, left: 4 }}
        barCategoryGap="20%"
      >
        <CartesianGrid stroke={TEMA.line} strokeDasharray="3 3" horizontal={!horizontal} vertical={horizontal} />
        {horizontal ? ejeValor : <XAxis dataKey="label" tick={{ fill: TEMA.muted, fontSize: 11 }} stroke={TEMA.line} interval={0} />}
        {horizontal ? ejeCategoria : <YAxis tickFormatter={formato} tick={{ fill: TEMA.muted, fontSize: 11 }} stroke={TEMA.line} width={70} />}
        <Tooltip
          content={<Contenido formato={formato} colorUnico={colorUnico} />}
          cursor={{ fill: "rgba(255,255,255,0.04)" }}
        />
        <Bar
          dataKey="valor"
          radius={horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]}
          isAnimationActive={false}
          onClick={(d: unknown) => {
            const label = (d as { payload?: PuntoEtiqueta })?.payload?.label;
            if (label) onSeleccionar?.(label);
          }}
          className={onSeleccionar ? "cursor-pointer" : undefined}
        >
          {datos.map((d, i) => (
            <Cell
              key={d.label}
              fill={colorUnico ?? colorSerie(i)}
              // Con algo seleccionado, el resto se atenúa en vez de desaparecer.
              fillOpacity={!seleccionado || seleccionado === d.label ? 1 : 0.25}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
