"use client";

import { createContext, useContext, type ReactNode } from "react";
import { fmtPct } from "@/lib/format";
import { PALETA, TEMA } from "@/lib/paleta";

/**
 * Alarma de margen negativo.
 *
 * Cuando el recorte que se está mirando pierde plata, TODAS las tarjetas del
 * tablero se ponen en rojo, no solo la del margen. Es a propósito: la señal
 * tiene que verse de un vistazo, sin buscar cuál de las diez tarjetas es la que
 * está mal. Un cliente filtrado con margen negativo prende la fila entera.
 *
 * Va por contexto y no por prop para no tocar los ~70 usos de `TarjetaKpi`:
 * cada tablero envuelve sus tarjetas y adentro no se cambia nada.
 */
const AlarmaMargen = createContext(false);

export function ConAlarmaMargen({
  activa,
  children,
}: {
  activa: boolean;
  children: ReactNode;
}) {
  return <AlarmaMargen.Provider value={activa}>{children}</AlarmaMargen.Provider>;
}

export function Panel({
  titulo,
  nota,
  children,
  className = "",
}: {
  titulo: string;
  nota?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`border-line bg-panel rounded-xl border p-4 ${className}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium">{titulo}</h2>
        {nota && <span className="text-muted text-xs">{nota}</span>}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function TarjetaKpi({
  titulo,
  valor,
  detalle,
  acento,
  compacta = false,
}: {
  titulo: string;
  valor: string;
  /** Nodo y no string: hay tarjetas que muestran la variación con color. */
  detalle?: ReactNode;
  acento?: string;
  /**
   * Achica padding y tipografía para que entren más por fila.
   *
   * Es opt-in y no el default a propósito: esta tarjeta la usan diez tableros,
   * y el que tiene once KPIs es uno solo. Achicarla para todos cambiaría nueve
   * pantallas que nadie pidió tocar.
   */
  compacta?: boolean;
}) {
  // Con el margen en negativo la alarma pisa el acento propio de la tarjeta:
  // si no, quedaba una fila mitad roja y mitad de colores, que es justo lo que
  // hace que no se note.
  const alarma = useContext(AlarmaMargen);
  const color = alarma ? TEMA.negativo : acento;

  return (
    <div
      className={`bg-panel rounded-xl border ${
        compacta ? "p-2.5 sm:p-3" : "p-3 sm:p-4"
      } ${alarma ? "border-rose-500/40" : "border-line"}`}
    >
      <p
        className={`text-muted leading-tight ${
          compacta ? "text-[10px] sm:text-[11px]" : "text-[11px] sm:text-xs"
        }`}
      >
        {titulo}
      </p>
      {/* EL VALOR ACHICA UN ESCALÓN EN CELULAR, y no es cosmético: con dos
        tarjetas por fila en una pantalla de 360px cada una queda en unos
        160px, y un importe como "$ 1.506.510" a 20px no entra. De `sm` para
        arriba vuelve al tamaño de siempre, así que en la compu no cambia nada. */}
      <p
        className={`font-semibold tabular-nums tracking-tight ${
          compacta ? "mt-1.5 text-sm sm:text-base" : "mt-1.5 text-lg sm:mt-2 sm:text-xl"
        }`}
        style={color ? { color } : undefined}
      >
        {valor}
      </p>
      {detalle && (
        <p
          className={`text-muted mt-1 leading-tight ${
            compacta ? "text-[10px]" : "text-[11px]"
          }`}
        >
          {detalle}
        </p>
      )}
    </div>
  );
}

export function Aviso({ children, tono = "error" }: { children: ReactNode; tono?: "error" | "info" }) {
  const clases =
    tono === "error"
      ? "border-rose-500/30 bg-rose-500/10 text-rose-300"
      : "border-line bg-panel-2 text-muted";
  return <div className={`rounded-xl border p-4 text-sm ${clases}`}>{children}</div>;
}

export function Esqueleto({ className = "" }: { className?: string }) {
  return <div className={`bg-panel-2 animate-pulse rounded-xl ${className}`} />;
}


/**
 * Variación contra el período anterior.
 *
 * Muestra el PORCENTAJE y no la diferencia en pesos porque la pregunta es
 * "¿venimos mejor o peor?", y para eso 100.000 pesos más no dice nada sin saber
 * sobre cuánto.
 *
 * Cuando el período anterior fue 0 no se dibuja la variación: un "+∞ %" salido
 * de dividir por cero se lee como un dato y no lo es.
 *
 * `contra` tiene que decir SOBRE QUÉ se comparó ("vs 18/08 hasta 17:05", "vs
 * 2026-07 hasta el día 14"). Un porcentaje sin eso no se puede interpretar: si
 * el período actual está a medio pasar, la comparación contra uno completo da
 * una caída que no existe.
 */
export function Delta({
  actual,
  anterior,
  contra,
}: {
  actual: number;
  anterior: number;
  contra: string;
}) {
  if (!Number.isFinite(anterior) || anterior === 0) {
    return <span className="text-muted">{contra}: sin datos</span>;
  }
  const variacion = (actual - anterior) / Math.abs(anterior);
  const sube = variacion >= 0;
  return (
    <>
      <span style={{ color: sube ? PALETA[1] : TEMA.negativo }}>
        {sube ? "▲" : "▼"} {fmtPct(Math.abs(variacion))}
      </span>{" "}
      <span className="text-muted">{contra}</span>
    </>
  );
}
