"use client";

import { useMemo, useState, type ReactNode } from "react";

export type Columna<T> = {
  titulo: string;
  celda: (fila: T) => ReactNode;
  /** Los números van alineados a la derecha y con cifras de ancho fijo. */
  numerica?: boolean;
  /**
   * El valor por el que se ordena esta columna. Si está, el encabezado se
   * vuelve clickeable.
   *
   * Es una función aparte de `celda` y no se deduce de ella a propósito:
   * `celda` devuelve JSX ya formateado ("$ 1.234,50", un `<span>` en rojo), y
   * ordenar por ese texto daría un orden alfabético — con "$ 9" arriba de
   * "$ 10". Acá se devuelve el número crudo.
   *
   * `null` ordena siempre al final, sin importar la dirección: una fila sin
   * dato no es "la peor", es una fila de la que no sabemos.
   */
  orden?: (fila: T) => number | string | null;
};

type Direccion = "asc" | "desc";

/** Compara dos valores del mismo tipo. Los `null` van siempre al final. */
function comparar(a: number | string | null, b: number | string | null): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), "es");
}

function Flecha({ direccion }: { direccion: Direccion | null }) {
  if (!direccion) {
    // Un indicador tenue en las columnas ordenables: sin esto no hay forma de
    // saber cuáles se pueden clickear hasta que uno prueba.
    return <span className="ml-1 opacity-0 transition-opacity group-hover:opacity-40">↓</span>;
  }
  return <span className="text-c1 ml-1">{direccion === "asc" ? "↑" : "↓"}</span>;
}

export function Tabla<T>({
  filas,
  columnas,
  clave,
  vacio = "Sin datos para el filtro elegido.",
  onClickFila,
  activa,
}: {
  filas: T[];
  columnas: Columna<T>[];
  clave: (fila: T, i: number) => string;
  vacio?: string;
  /** Si se pasa, las filas son clickeables y filtran el resto del tablero. */
  onClickFila?: (fila: T) => void;
  /** Devuelve true para la fila que está actuando como filtro. */
  activa?: (fila: T) => boolean;
}) {
  // Guarda el TÍTULO y no el índice: si el tablero cambia sus columnas —pasa
  // al filtrar—, un índice apuntaría a otra columna sin avisar.
  const [orden, setOrden] = useState<{ titulo: string; direccion: Direccion } | null>(null);

  const alClickearEncabezado = (c: Columna<T>) => {
    if (!c.orden) return;
    setOrden((actual) => {
      if (actual?.titulo !== c.titulo) {
        // Primer click: de mayor a menor. En un tablero de plata, lo que se
        // busca al ordenar por "rentabilidad" es el que más dejó, no el que
        // menos. Para las columnas de texto, en cambio, alfabético.
        return { titulo: c.titulo, direccion: c.numerica ? "desc" : "asc" };
      }
      // Tercer click: vuelve al orden original de la consulta.
      if (actual.direccion === (c.numerica ? "desc" : "asc")) {
        return { titulo: c.titulo, direccion: c.numerica ? "asc" : "desc" };
      }
      return null;
    });
  };

  const ordenadas = useMemo(() => {
    if (!orden) return filas;
    const col = columnas.find((c) => c.titulo === orden.titulo);
    if (!col?.orden) return filas;
    const signo = orden.direccion === "asc" ? 1 : -1;
    // Copia antes de ordenar: `sort` muta, y `filas` viene del estado del
    // tablero. Ordenar en el lugar lo dejaría desordenado para todo lo demás.
    return [...filas].sort((a, b) => signo * comparar(col.orden!(a), col.orden!(b)));
  }, [filas, columnas, orden]);

  if (filas.length === 0) {
    return <p className="text-muted py-10 text-center text-sm">{vacio}</p>;
  }

  return (
    // Las tablas anchas scrollean solas, la página nunca scrollea en horizontal.
    <div className="-mx-1 max-h-[420px] overflow-auto px-1">
      <table className="w-full text-xs">
        <thead className="bg-panel sticky top-0">
          <tr className="border-line border-b">
            {columnas.map((c) => {
              const ordenable = c.orden != null;
              const direccion = orden?.titulo === c.titulo ? orden.direccion : null;
              return (
                <th
                  key={c.titulo}
                  aria-sort={
                    !ordenable
                      ? undefined
                      : direccion === "asc"
                        ? "ascending"
                        : direccion === "desc"
                          ? "descending"
                          : "none"
                  }
                  className={`text-muted py-2 pr-3 font-medium whitespace-nowrap ${
                    c.numerica ? "text-right" : "text-left"
                  }`}
                >
                  {ordenable ? (
                    <button
                      type="button"
                      onClick={() => alClickearEncabezado(c)}
                      className={`group hover:text-ink cursor-pointer transition-colors ${
                        direccion ? "text-ink" : ""
                      }`}
                    >
                      {c.titulo}
                      <Flecha direccion={direccion} />
                    </button>
                  ) : (
                    c.titulo
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {ordenadas.map((fila, i) => {
            const esActiva = activa?.(fila) ?? false;
            const hayActiva = activa != null && ordenadas.some((x) => activa(x));
            return (
              <tr
                key={clave(fila, i)}
                onClick={onClickFila ? () => onClickFila(fila) : undefined}
                className={`border-line/60 hover:bg-panel-2 border-b ${
                  onClickFila ? "cursor-pointer" : ""
                } ${esActiva ? "bg-c1/15" : hayActiva ? "opacity-40" : ""}`}
              >
                {columnas.map((c) => (
                  <td
                    key={c.titulo}
                    className={`py-1.5 pr-3 ${c.numerica ? "text-right tabular-nums" : ""}`}
                  >
                    {c.celda(fila)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
