import type { ReactNode } from "react";
import { fmtPct } from "@/lib/format";
import { PALETA, TEMA } from "@/lib/paleta";

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
}: {
  titulo: string;
  valor: string;
  /** Nodo y no string: hay tarjetas que muestran la variación con color. */
  detalle?: ReactNode;
  acento?: string;
}) {
  return (
    <div className="border-line bg-panel rounded-xl border p-4">
      <p className="text-muted text-xs leading-tight">{titulo}</p>
      <p
        className="mt-2 text-xl font-semibold tabular-nums tracking-tight"
        style={acento ? { color: acento } : undefined}
      >
        {valor}
      </p>
      {detalle && <p className="text-muted mt-1 text-[11px] leading-tight">{detalle}</p>}
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
