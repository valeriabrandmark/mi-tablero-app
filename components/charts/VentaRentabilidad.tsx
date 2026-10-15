"use client";

import { useMemo } from "react";
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
import {
  fmtFechaCorta,
  fmtMoneda,
  fmtMonedaCorta,
  promedioMovil,
  PUNTOS_PARA_TENDENCIA,
} from "@/lib/format";
import { PALETA, TEMA } from "@/lib/paleta";
import type { MouseHandlerDataParam } from "recharts";
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
  const tendencia = valor("tendencia");

  return (
    <CajaTooltip titulo={label ? fmtFechaCorta(label) : undefined}>
      <FilaTooltip color={PALETA[0]} label="Venta c/IVA" valor={fmtMoneda(venta)} />
      {/* La tendencia va DEBAJO de la venta del día y con su mismo color: es
          la misma magnitud leída de otra forma, no una tercera cosa. */}
      {tendencia != null && (
        <FilaTooltip
          color={PALETA[0]}
          label="Tendencia (7 días)"
          valor={fmtMoneda(tendencia)}
        />
      )}
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
export default function VentaRentabilidad({
  datos,
  onElegirDia,
}: {
  datos: PuntoDiaMeli[];
  /**
   * Clickear un día recorta TODO el tablero a ese día.
   *
   * ES OPCIONAL A PROPOSITO. Sin esto el gráfico es el de siempre, así que
   * una pantalla que lo use y no quiera el recorte no hereda un click que no
   * pidió —y, sobre todo, no hereda un cursor de mano que promete algo que no
   * va a pasar.
   *
   * El recorte no lo hace este componente: devuelve la fecha y el tablero
   * decide. Es el mismo `desde`/`hasta` que ya mueve la barra de filtros, así
   * que todo lo de la pantalla se recalcula solo y no hay una segunda forma
   * de filtrar que pueda discrepar de la primera.
   */
  onElegirDia?: (fecha: string) => void;
}) {
  // LA TENDENCIA SE CALCULA ACA Y NO EN LA BASE, a propósito: es una lectura
  // del mismo dato, no un dato nuevo. Así la serie real que viaja del servidor
  // queda intacta y la línea de arriba no puede quedar desfasada de ella.
  const hayTendencia = datos.length >= PUNTOS_PARA_TENDENCIA;
  const conTendencia = useMemo(() => {
    if (datos.length < PUNTOS_PARA_TENDENCIA) return datos;
    const media = promedioMovil(datos, (d) => d.venta);
    return datos.map((d, i) => ({ ...d, tendencia: media[i] }));
  }, [datos]);

  if (datos.length === 0) {
    return <p className="text-muted py-10 text-center text-sm">Sin ventas en el recorte elegido.</p>;
  }

  return (
    <>
      {/* LA LEYENDA APARECE CON LA TERCERA LINEA. Con dos --venta y
          rentabilidad-- el tooltip alcanzaba y el gráfico quedaba más limpio
          sin ella. Con la tendencia ya no: son dos líneas del MISMO azul, y
          sin decir cuál es cuál la distinción queda en el grosor, que es
          demasiado sutil para cargar sola con la identidad. */}
      {hayTendencia && (
        <div className="text-muted mb-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
          <span className="flex items-center gap-1.5">
            <svg width="16" height="8" aria-hidden="true">
              <line
                x1="0" y1="4" x2="16" y2="4"
                stroke={PALETA[0]} strokeWidth="1" strokeOpacity="0.45"
              />
            </svg>
            Venta del día
          </span>
          <span className="flex items-center gap-1.5">
            <svg width="16" height="8" aria-hidden="true">
              <line x1="0" y1="4" x2="16" y2="4" stroke={PALETA[0]} strokeWidth="2.5" />
            </svg>
            Tendencia (promedio de 7 días)
          </span>
          <span className="flex items-center gap-1.5">
            <svg width="16" height="8" aria-hidden="true">
              <line x1="0" y1="4" x2="16" y2="4" stroke={PALETA[1]} strokeWidth="1.5" />
            </svg>
            Rentabilidad
          </span>
          {/* QUE SE PUEDE CLICKEAR HAY QUE DECIRLO. Un cursor de mano sólo lo
              descubre quien ya pasa el mouse por encima, y lo que el click
              hace --recortar el tablero entero-- no se adivina. */}
          {onElegirDia && (
            <span className="text-muted/70">· clickeá un día para ver sólo ese día</span>
          )}
        </div>
      )}
    <ResponsiveContainer width="100%" height={260}>
      <ComposedChart
        data={conTendencia}
        margin={{ top: 4, right: 8, bottom: 0, left: 8 }}
        // EL CLICK VA EN EL GRAFICO Y NO EN CADA PUNTO. Recharts da el día
        // bajo el cursor en `activeLabel`, que es el mismo que ya usa el
        // tooltip: así se puede hacer click en cualquier parte de la columna
        // del día --no hay que acertarle a un punto de la línea-- y lo que se
        // elige es exactamente lo que el tooltip estaba mostrando.
        onClick={
          onElegirDia
            ? (estado: MouseHandlerDataParam) => {
                // `activeLabel` es `string | number | undefined` segun recharts
                // --el eje podria ser numerico-- y el nuestro es la fecha. Se
                // verifica en vez de castear: un cast silenciaria el dia que
                // alguien cambie el dataKey del eje.
                const dia = estado?.activeLabel;
                if (typeof dia === "string" && dia) onElegirDia(dia);
              }
            : undefined
        }
        style={onElegirDia ? { cursor: "pointer" } : undefined}
      >
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

        {/* LA VENTA REAL, SIN TOCAR. Con la tendencia encima se afina y se
            baja la opacidad: deja de ser lo que se lee primero y pasa a ser el
            ruido del que la tendencia sale. Sigue entera y sigue en el tooltip. */}
        <Area
          type="monotone"
          dataKey="venta"
          stroke={PALETA[0]}
          strokeWidth={hayTendencia ? 1 : 1.5}
          strokeOpacity={hayTendencia ? 0.45 : 1}
          fill="url(#gradVentaDia)"
        />
        {/* LA TENDENCIA, EN EL MISMO AZUL. No es otra serie: es la misma venta
            promediada, así que otro color la haría leer como otra magnitud. Lo
            que la separa es el grosor, que es lo que hay que mirar primero. */}
        {hayTendencia && (
          <Line
            type="monotone"
            dataKey="tendencia"
            stroke={PALETA[0]}
            strokeWidth={2.5}
            dot={false}
            isAnimationActive={false}
          />
        )}
        <Line
          type="monotone"
          dataKey="rentabilidad"
          stroke={PALETA[1]}
          strokeWidth={1.5}
          dot={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
    </>
  );
}
