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

/** Segunda serie apilada encima de la primera. */
export type SerieApilada = {
  titulo: string;
  color: string;
  tituloBase: string;
};

/** `formato` y `colorUnico` llegan por prop; recharts inyecta el resto al clonar. */
function Contenido({
  active,
  payload,
  formato,
  colorUnico,
  apilado,
}: {
  active?: boolean;
  payload?: ItemTooltip[];
  formato?: (n: number) => string;
  colorUnico?: string;
  apilado?: SerieApilada;
}) {
  const item = payload?.[0]?.payload;
  if (!active || !item || !formato) return null;

  // Sin segunda serie, el tooltip es una línea sola y el label de la barra
  // alcanza. Con dos, hace falta decir cuál es cuál y cuánto suman: el alto de
  // la barra ya no es ninguna de las dos.
  if (!apilado) {
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

  const segundo = item.valor2 ?? 0;
  return (
    <CajaTooltip titulo={item.label}>
      <FilaTooltip
        color={colorUnico ?? TEMA.muted}
        label={apilado.tituloBase}
        valor={formato(item.valor)}
      />
      <FilaTooltip
        color={apilado.color}
        label={apilado.titulo}
        valor={formato(segundo)}
      />
      {segundo > 0 && (
        <div className="border-line mt-1 flex items-center gap-2 border-t pt-1">
          <span className="text-muted">Total</span>
          <span className="ml-auto tabular-nums">
            {formato(item.valor + segundo)}
          </span>
        </div>
      )}
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
  seleccionados,
  onSeleccionar,
  apilado,
}: {
  datos: PuntoEtiqueta[];
  formato: (n: number) => string;
  horizontal?: boolean;
  /** Si se omite, cada barra toma un color distinto de la paleta. */
  colorUnico?: string;
  alturaMinima?: number;
  vacio?: string;
  /** Valores resaltados; el resto se atenúa. Vacío = todos iguales. */
  seleccionados?: string[];
  /** Si se omite, las barras son solo de lectura (sin filtro cruzado). */
  onSeleccionar?: (label: string) => void;
  /**
   * Apila una segunda serie (`valor2` de cada punto) encima de la primera.
   * Con esto la barra deja de ser una magnitud y pasa a ser dos, así que el
   * tooltip cambia para desglosarlas.
   */
  apilado?: SerieApilada;
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
  const ejeCategoriaAbajo = (
    <XAxis
      dataKey="label"
      tick={{ fill: TEMA.muted, fontSize: 11 }}
      stroke={TEMA.line}
      // NO `interval={0}`, que es lo que hacía que las 24 horas del gráfico de
      // Mercado Libre se pisaran entre sí hasta no leerse ninguna. Forzar
      // todas las etiquetas es peor que mostrar menos: una etiqueta ilegible
      // no informa, y encima tapa a la de al lado.
      //
      // `equidistantPreserveStart` saltea de a paso fijo —de dos en dos, de
      // tres en tres— hasta que entran. El paso fijo importa: saltear parejo
      // deja un eje que se sigue leyendo como una escala de horas, mientras
      // que esconder las que se pisan dejaría huecos arbitrarios y habría que
      // ir leyendo número por número para saber dónde se está parado.
      //
      // Cuando las categorías son pocas —los tramos de Cuentas Corrientes, los
      // de Elasticidad— entran todas y esto no cambia nada.
      interval="equidistantPreserveStart"
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
        {horizontal ? ejeValor : ejeCategoriaAbajo}
        {horizontal ? ejeCategoria : <YAxis tickFormatter={formato} tick={{ fill: TEMA.muted, fontSize: 11 }} stroke={TEMA.line} width={70} />}
        <Tooltip
          content={
            <Contenido
              formato={formato}
              colorUnico={colorUnico}
              apilado={apilado}
            />
          }
          cursor={{ fill: "rgba(255,255,255,0.04)" }}
        />
        <Bar
          dataKey="valor"
          stackId={apilado ? "a" : undefined}
          // Apilada, la primera serie va SIN esquinas redondeadas: el redondeo
          // arriba dejaría una muesca justo donde empieza la segunda.
          radius={
            apilado ? undefined : horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]
          }
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
              fillOpacity={!seleccionados?.length || seleccionados.includes(d.label) ? 1 : 0.25}
            />
          ))}
        </Bar>
        {apilado && (
          <Bar
            dataKey="valor2"
            stackId="a"
            fill={apilado.color}
            radius={horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]}
            isAnimationActive={false}
            onClick={(d: unknown) => {
              const label = (d as { payload?: PuntoEtiqueta })?.payload?.label;
              if (label) onSeleccionar?.(label);
            }}
            className={onSeleccionar ? "cursor-pointer" : undefined}
          >
            {datos.map((d) => (
              <Cell
                key={d.label}
                fillOpacity={
                  !seleccionados?.length || seleccionados.includes(d.label)
                    ? 1
                    : 0.25
                }
              />
            ))}
          </Bar>
        )}
      </BarChart>
    </ResponsiveContainer>
  );
}
