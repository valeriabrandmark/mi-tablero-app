"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

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
  /**
   * Celda de la fila de totales. Con que UNA columna lo defina, la fila
   * aparece; las demás quedan vacías.
   *
   * Es un valor y no una función de las filas a propósito. Hay totales que no
   * se pueden calcular sumando lo que se ve:
   *
   *   - Las ÓRDENES de una tabla por SKU. Una orden de tres productos ocupa
   *     tres filas, y sumarlas la contaría tres veces. El total bueno es un
   *     `count(distinct)` que ya viene resuelto del servidor.
   *   - Cualquier tabla recortada (top 100, top 300). La suma de lo que se ve
   *     no es el total del recorte, y quien arma la pantalla es el único que
   *     sabe cuál de los dos quiere mostrar.
   *
   * Ver `sumar` y `promedioPonderado` para los casos que sí son una suma.
   */
  total?: ReactNode;
};

/** Suma una columna de las filas. El caso fácil de un total. */
export function sumar<T>(
  filas: T[],
  valor: (fila: T) => number | null | undefined,
): number {
  return filas.reduce((a, f) => a + (valor(f) ?? 0), 0);
}

/**
 * El margen del conjunto: rentabilidad total sobre venta total.
 *
 * NO es el promedio simple de los porcentajes de cada fila, y la diferencia no
 * es un detalle. Con un artículo que vendió $ 500.000 al 8 % y otro que vendió
 * $ 1.000 al 80 %, el promedio simple da 44 % — un número que no describe a
 * ningún peso que haya entrado. Ponderado da 8,1 %, que es lo que efectivamente
 * quedó. Un artículo de una unidad no puede mover el margen del total.
 *
 * Devuelve `null` si no hay denominador, para que se muestre "—" en vez de un
 * cero que se leería como "margen cero".
 */
export function promedioPonderado<T>(
  filas: T[],
  parte: (fila: T) => number | null | undefined,
  total: (fila: T) => number | null | undefined,
): number | null {
  const den = sumar(filas, total);
  return den === 0 ? null : sumar(filas, parte) / den;
}

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
  etiquetaTotal = "Total",
}: {
  filas: T[];
  columnas: Columna<T>[];
  clave: (fila: T, i: number) => string;
  vacio?: string;
  /** Si se pasa, las filas son clickeables y filtran el resto del tablero. */
  onClickFila?: (fila: T) => void;
  /** Devuelve true para la fila que está actuando como filtro. */
  activa?: (fila: T) => boolean;
  /**
   * Texto de la primera celda de la fila de totales. Se cambia cuando la tabla
   * está recortada ("Total top 100"), para no dar a entender que ese número es
   * el total de todo.
   */
  etiquetaTotal?: ReactNode;
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

  // Aviso de que la tabla sigue hacia el costado.
  //
  // En un teléfono una tabla más ancha que la pantalla no se lee como
  // "scrolleá", se lee como CORTADA: quien la mira da por perdido lo que no
  // ve y ni prueba arrastrar. El degradado del borde derecho es lo único que
  // distingue una cosa de la otra, y por eso se apaga apenas se llega al
  // final — un degradado permanente vuelve a mentir, al revés.
  const contenedor = useRef<HTMLDivElement>(null);
  const [hayMasALaDerecha, setHayMasALaDerecha] = useState(false);

  useEffect(() => {
    const el = contenedor.current;
    if (!el) return;
    // 1px de tolerancia: con zoom o densidades raras, scrollWidth y clientWidth
    // difieren por una fracción de píxel en una tabla que entra entera.
    const medir = () =>
      setHayMasALaDerecha(el.scrollWidth - el.clientWidth - el.scrollLeft > 1);
    medir();
    el.addEventListener("scroll", medir, { passive: true });
    // Hace falta además del scroll: girar el teléfono o plegar el menú cambia
    // el ancho disponible sin que nadie haya scrolleado.
    const observador = new ResizeObserver(medir);
    observador.observe(el);
    return () => {
      el.removeEventListener("scroll", medir);
      observador.disconnect();
    };
  }, [filas, columnas]);

  if (filas.length === 0) {
    return <p className="text-muted py-10 text-center text-sm">{vacio}</p>;
  }

  const hayTotales = columnas.some((c) => c.total != null);

  return (
    <div className="relative">
      {/* Las tablas anchas scrollean solas, la página nunca scrollea en horizontal. */}
      <div ref={contenedor} className="-mx-1 max-h-[420px] overflow-auto px-1">
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
                      // Las celdas numéricas no parten: en un celular la tabla
                      // se comprime hasta donde puede, y un importe cortado en
                      // dos renglones ("$ 1.506." / "510") deja de leerse como
                      // un número. Sin partir, la tabla se ensancha y scrollea,
                      // que es el comportamiento correcto.
                      className={`py-1.5 pr-3 ${
                        c.numerica ? "text-right whitespace-nowrap tabular-nums" : ""
                      }`}
                    >
                      {c.celda(fila)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>

          {/* La fila de totales queda pegada abajo, igual que el encabezado queda
              pegado arriba: en una tabla de 300 filas con scroll propio, un total
              al final del todo no lo ve nadie.

              Los totales NO se recalculan al ordenar ni al filtrar la tabla por
              dentro, y está bien: ordenar cambia en qué orden se ven las mismas
              filas, no cuáles son. */}
          {hayTotales && (
            <tfoot className="sticky bottom-0">
              <tr className="border-line bg-panel-2 border-t-2">
                {columnas.map((c, i) => (
                  <td
                    key={c.titulo}
                    className={`text-ink py-2 pr-3 font-medium ${
                      c.numerica ? "text-right whitespace-nowrap tabular-nums" : ""
                    }`}
                  >
                    {c.total ??
                      (i === 0 ? (
                        <span className="text-muted">{etiquetaTotal}</span>
                      ) : null)}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* Decorativo y no clickeable: si atajara el click o el arrastre, taparía
          justo la columna que se está tratando de alcanzar. */}
      {hayMasALaDerecha && (
        <div
          aria-hidden
          className="from-panel pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l to-transparent"
        />
      )}
    </div>
  );
}
