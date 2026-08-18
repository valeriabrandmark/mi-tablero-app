"use client";

import { fmtMetrica, fmtPct } from "@/lib/format";
import { PALETA } from "@/lib/paleta";
import type { FilaObjetivo } from "@/lib/types";

/**
 * Barra de avance contra objetivo.
 *
 * Se usa una barra de CSS y no un gráfico de recharts a propósito: acá hay una
 * sola magnitud por fila y lo que importa es leer "cuánto falta" de un vistazo,
 * no comparar categorías entre sí. Un BarChart agregaría ejes y tooltips para
 * mostrar lo mismo.
 *
 * La barra se recorta al 100% para que las filas sigan siendo comparables, pero
 * el número de la derecha muestra el porcentaje real, así un 240% no se lee
 * igual que un 100% justo.
 *
 * Cada fila se formatea según su métrica: en una misma lista puede convivir un
 * objetivo en pesos con uno en unidades, porque la barra es un porcentaje.
 */
export function BarraAvance({
  fila,
  etiqueta,
  seleccionada,
  onClick,
}: {
  fila: FilaObjetivo;
  etiqueta: string;
  seleccionada?: boolean;
  onClick?: () => void;
}) {
  const cumplido = fila.objetivo > 0 && fila.vendido >= fila.objetivo;
  const pct = fila.avancePct ?? 0;
  const ancho = Math.min(Math.max(pct, 0), 1) * 100;
  const color = cumplido ? PALETA[1] : PALETA[0];
  const fmt = fmtMetrica(fila.metrica);

  const Contenedor = onClick ? "button" : "div";

  return (
    <Contenedor
      onClick={onClick}
      className={`block w-full text-left ${onClick ? "cursor-pointer" : ""} ${
        seleccionada === false ? "opacity-40" : ""
      }`}
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="truncate text-xs">{etiqueta}</span>
        <span className="text-muted shrink-0 text-[11px] tabular-nums">
          {fmt(fila.vendido)} / {fmt(fila.objetivo)}
        </span>
      </div>
      <div className="mt-1.5 flex items-center gap-2">
        <div className="bg-panel-2 h-2 flex-1 overflow-hidden rounded-full">
          <div
            className="h-full rounded-full transition-[width]"
            style={{ width: `${ancho}%`, backgroundColor: color }}
          />
        </div>
        <span
          className="w-14 shrink-0 text-right text-[11px] tabular-nums"
          style={{ color: cumplido ? PALETA[1] : undefined }}
        >
          {fmtPct(fila.avancePct)}
        </span>
      </div>
    </Contenedor>
  );
}

export function ListaAvance({
  filas,
  etiqueta,
  clave,
  seleccionado,
  onSeleccionar,
  vacio = "Sin objetivos cargados para el filtro elegido.",
}: {
  filas: FilaObjetivo[];
  etiqueta: (f: FilaObjetivo) => string;
  /** Valor con el que filtra el click; si se omite, usa la etiqueta. */
  clave?: (f: FilaObjetivo) => string;
  seleccionado?: string;
  onSeleccionar?: (valor: string) => void;
  vacio?: string;
}) {
  if (filas.length === 0) {
    return <p className="text-muted py-10 text-center text-sm">{vacio}</p>;
  }

  return (
    <div className="space-y-3">
      {filas.map((f) => {
        const texto = etiqueta(f);
        const valor = clave ? clave(f) : texto;
        return (
          <BarraAvance
            key={`${valor}-${f.metrica}`}
            fila={f}
            etiqueta={texto}
            seleccionada={seleccionado ? seleccionado === valor : undefined}
            onClick={onSeleccionar ? () => onSeleccionar(valor) : undefined}
          />
        );
      })}
    </div>
  );
}
