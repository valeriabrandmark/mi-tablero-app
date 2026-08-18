import type { ReactNode } from "react";

export type Columna<T> = {
  titulo: string;
  celda: (fila: T) => ReactNode;
  /** Los números van alineados a la derecha y con cifras de ancho fijo. */
  numerica?: boolean;
};

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
  if (filas.length === 0) {
    return <p className="text-muted py-10 text-center text-sm">{vacio}</p>;
  }

  return (
    // Las tablas anchas scrollean solas, la página nunca scrollea en horizontal.
    <div className="-mx-1 max-h-[420px] overflow-auto px-1">
      <table className="w-full text-xs">
        <thead className="bg-panel sticky top-0">
          <tr className="border-line border-b">
            {columnas.map((c) => (
              <th
                key={c.titulo}
                className={`text-muted py-2 pr-3 font-medium whitespace-nowrap ${
                  c.numerica ? "text-right" : "text-left"
                }`}
              >
                {c.titulo}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filas.map((fila, i) => {
            const esActiva = activa?.(fila) ?? false;
            const hayActiva = activa != null && filas.some((x) => activa(x));
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
