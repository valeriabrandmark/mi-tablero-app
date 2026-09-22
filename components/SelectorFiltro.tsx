"use client";

import { useEffect, useId, useRef, useState } from "react";
import { coincide, MINIMO_PARA_BUSCAR } from "@/lib/coincide";

export const CLASE_SELECT =
  "border-line bg-panel-2 focus:border-c1 rounded-lg border px-3 py-1.5 text-sm outline-none";

/** `string` simple, o `[valor, texto]` cuando el texto visible difiere. */
type Opcion = string | [string, string];

function aPares(opciones: Opcion[], formato?: (v: string) => string) {
  return opciones.map((o) =>
    Array.isArray(o) ? o : ([o, formato ? formato(o) : o] as [string, string]),
  );
}

/**
 * Selector de opción única. Queda solo para lo que NO es un filtro, como el
 * modo de flete de Logística, que elige un cálculo y no un recorte: ahí
 * "elegir varios" no significaría nada.
 */
export function SelectorFiltro({
  etiqueta,
  valor,
  opciones,
  onChange,
  formato,
  todos = "Todos",
  conTodos = true,
}: {
  etiqueta: string;
  valor: string | undefined;
  opciones: Opcion[];
  onChange: (v: string | undefined) => void;
  formato?: (v: string) => string;
  todos?: string;
  /**
   * Si la lista ya cubre todos los casos, no va la opción vacía.
   *
   * El modo de flete de Logística tiene su propio "Sin flete" en la lista, y
   * con la opción vacía encima el desplegable mostraba "Sin flete" DOS VECES,
   * las dos haciendo lo mismo.
   */
  conTodos?: boolean;
}) {
  const pares = aPares(opciones, formato);

  return (
    <label className="flex flex-col gap-1">
      <span className="text-muted text-[11px]">{etiqueta}</span>
      <select
        className={CLASE_SELECT}
        value={valor ?? ""}
        onChange={(e) => onChange(e.target.value || undefined)}
        disabled={pares.length === 0}
      >
        {conTodos && <option value="">{todos}</option>}
        {pares.map(([v, txt]) => (
          <option key={v} value={v}>
            {txt}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * Selector de selección múltiple, que es como funcionan todos los filtros del
 * tablero.
 *
 * Es un desplegable con checkboxes y no un `<select multiple>` nativo: el
 * nativo obliga a hacer ctrl+click para sumar valores, no muestra cuántos hay
 * elegidos sin desplegarlo, y en móvil es directamente inusable.
 *
 * Sin nada tildado el filtro no se aplica: "ninguno elegido" es "todos", no
 * "ninguno". Es lo que espera cualquiera que use un tablero.
 *
 * ---------------------------------------------------------------------------
 * CON MUCHAS OPCIONES, SE ESCRIBE EN VEZ DE SCROLLEAR
 *
 * Marcas y proveedores son cientos. Buscar una en una lista de ese largo es
 * scrollear a ojo hasta encontrarla, y peor todavía cuando hay varias
 * parecidas --"Bubba" y "Buba" a dos renglones de distancia-- porque hay que
 * leerlas con cuidado en vez de escribir "bu" y verlas juntas.
 *
 * Así que pasadas unas pocas opciones (`MINIMO_PARA_BUSCAR`) el desplegable
 * trae un campo de texto arriba, con el foco puesto: se abre y se escribe.
 * Abajo de ese número no aparece, porque un buscador sobre cinco opciones es
 * una cosa más que leer para algo que se resuelve mirando.
 *
 * Lo que se escribe NO es un filtro del tablero: recorta esta lista y nada
 * más. Se borra al cerrar el desplegable, y lo que quedó tildado sigue
 * tildado aunque el término lo deje fuera de la vista --el resumen del botón
 * lo sigue contando.
 */
export function SelectorMultiple({
  etiqueta,
  valores,
  opciones,
  onChange,
  formato,
  todos = "Todos",
}: {
  etiqueta: string;
  valores: string[] | undefined;
  opciones: Opcion[];
  onChange: (v: string[] | undefined) => void;
  formato?: (v: string) => string;
  todos?: string;
}) {
  const [abierto, setAbierto] = useState(false);
  const [termino, setTermino] = useState("");
  const caja = useRef<HTMLDivElement>(null);
  const id = useId();

  const pares = aPares(opciones, formato);
  const elegidos = valores ?? [];

  const hayBuscador = pares.length >= MINIMO_PARA_BUSCAR;

  // Sin `useMemo`: `opciones` y `formato` llegan nuevos en cada render de cada
  // tablero, así que memorizar esto no ahorraría una sola pasada --recalcularía
  // igual-- y a cambio escondería que son unos cientos de `includes`.
  const visibles = termino
    ? pares.filter(([v, txt]) => coincide(v, txt, termino))
    : pares;

  /** Cerrar deja el buscador limpio: reabrirlo tiene que mostrar todo de nuevo. */
  const cerrar = () => {
    setAbierto(false);
    setTermino("");
  };

  // Cerrar al clickear afuera o con Escape. Sin esto quedan dos desplegables
  // abiertos a la vez y se tapan entre ellos.
  useEffect(() => {
    if (!abierto) return;
    const alClick = (e: MouseEvent) => {
      if (!caja.current?.contains(e.target as Node)) cerrar();
    };
    const alTeclado = (e: KeyboardEvent) => {
      if (e.key === "Escape") cerrar();
    };
    document.addEventListener("mousedown", alClick);
    document.addEventListener("keydown", alTeclado);
    return () => {
      document.removeEventListener("mousedown", alClick);
      document.removeEventListener("keydown", alTeclado);
    };
  }, [abierto]);

  const alternarUno = (v: string) => {
    const nuevos = elegidos.includes(v)
      ? elegidos.filter((x) => x !== v)
      : [...elegidos, v];
    onChange(nuevos.length > 0 ? nuevos : undefined);
  };

  const resumen =
    elegidos.length === 0
      ? todos
      : elegidos.length === 1
        ? (pares.find(([v]) => v === elegidos[0])?.[1] ?? elegidos[0])
        : `${elegidos.length} elegidos`;

  return (
    <div className="relative flex flex-col gap-1" ref={caja}>
      <span className="text-muted text-[11px]" id={`${id}-etiqueta`}>
        {etiqueta}
      </span>

      <button
        type="button"
        aria-expanded={abierto}
        aria-labelledby={`${id}-etiqueta`}
        disabled={pares.length === 0}
        onClick={() => (abierto ? cerrar() : setAbierto(true))}
        className={`${CLASE_SELECT} flex min-w-[10rem] items-center gap-2 text-left disabled:opacity-40`}
      >
        <span
          className={`flex-1 truncate ${elegidos.length === 0 ? "text-muted" : ""}`}
        >
          {resumen}
        </span>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          className="text-muted size-4 shrink-0"
          aria-hidden="true"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {abierto && (
        /* El buscador y el "Todos" quedan FIJOS y solo scrollea la lista. Con
           todo junto adentro de un solo div con scroll, escribir tres letras y
           bajar a mirar los resultados dejaba el campo fuera de pantalla: para
           corregir el término había que volver a subir. */
        <div className="border-line bg-panel absolute top-full left-0 z-30 mt-1 flex w-64 flex-col rounded-lg border p-1 shadow-xl">
          {hayBuscador && (
            <input
              type="text"
              // Se abre y se escribe, sin un click de más. El desplegable ya es
              // un gesto deliberado: quien lo abrió sabe qué está buscando.
              autoFocus
              value={termino}
              onChange={(e) => setTermino(e.target.value)}
              onKeyDown={(e) => {
                // Escape con texto borra el texto; vacío, cierra. Así el mismo
                // reflejo sirve para "me equivoqué" y para "listo", sin que
                // corregir una letra cueste reabrir el desplegable.
                if (e.key === "Escape" && termino) {
                  e.stopPropagation();
                  setTermino("");
                }
                // Enter tilda la primera que quedó: escribir "bu" y confirmar
                // es el camino corto cuando se sabe qué se busca.
                if (e.key === "Enter" && visibles.length > 0) {
                  e.preventDefault();
                  alternarUno(visibles[0][0]);
                }
              }}
              placeholder={`Buscar en ${pares.length}…`}
              aria-label={`Buscar dentro de ${etiqueta}`}
              className="border-line bg-panel-2 text-ink placeholder:text-muted focus:border-c1 mb-1 rounded border px-2 py-1.5 text-xs outline-none"
            />
          )}

          <button
            type="button"
            onClick={() => onChange(undefined)}
            disabled={elegidos.length === 0}
            className="hover:bg-panel-2 text-muted shrink-0 rounded px-2 py-1.5 text-left text-xs disabled:opacity-40"
          >
            {todos}
          </button>

          <div className="border-line my-1 shrink-0 border-t" />

          <div className="max-h-60 overflow-y-auto">
            {visibles.length === 0 ? (
              /* Decir que la lista existe y que el término es el que no
                 encuentra nada. Un hueco en blanco se lee como "no hay
                 marcas cargadas", que es otra cosa y manda a buscar un
                 problema donde no lo hay. */
              <p className="text-muted px-2 py-3 text-center text-xs">
                Ninguna de las {pares.length} coincide con «{termino}».
              </p>
            ) : (
              visibles.map(([v, txt]) => {
                const tildado = elegidos.includes(v);
                return (
                  <label
                    key={v}
                    className="hover:bg-panel-2 flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={tildado}
                      onChange={() => alternarUno(v)}
                      className="accent-c1 size-3.5 shrink-0"
                    />
                    <span className={`truncate ${tildado ? "" : "text-muted"}`}>
                      {txt}
                    </span>
                  </label>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function BotonLimpiar({
  onClick,
  deshabilitado,
}: {
  onClick: () => void;
  deshabilitado: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={deshabilitado}
      className="border-line hover:bg-panel-2 text-muted hover:text-ink rounded-lg border px-3 py-1.5 text-xs disabled:opacity-40"
    >
      Limpiar
    </button>
  );
}

/**
 * Buscador de texto libre. Lo comparten Mercado Libre y Ventas Mayoristas.
 *
 * UN campo contra varias columnas a la vez, en vez de varios campos o un
 * selector de "buscar por…". Quien está controlando una venta tiene UN dato en
 * la mano —un número, un SKU, el nombre de un cliente— y no tiene por qué
 * decidir de antemano contra qué columna buscarlo. Se pega y listo. Contra qué
 * busca cada tablero lo decide su consulta; acá solo va el `placeholder`.
 *
 * NO busca mientras se tipea: espera al Enter o a que el campo pierda el foco.
 * Cada búsqueda son varias consultas contra la base, y dispararlas por cada
 * tecla sería castigar al servidor para mostrar resultados de términos a medio
 * escribir. Escape limpia.
 */
export function CampoBusqueda({
  valor,
  onChange,
  placeholder,
  ancho = "w-60",
}: {
  valor: string;
  onChange: (v: string) => void;
  placeholder: string;
  ancho?: string;
}) {
  const [texto, setTexto] = useState(valor);
  const [valorPrevio, setValorPrevio] = useState(valor);

  // Si el término se limpia desde afuera (el botón Limpiar), el campo tiene que
  // seguirlo: sin esto queda con el texto viejo sobre datos sin filtrar.
  //
  // Va durante el render y no en un `useEffect`. Es el patrón que documenta
  // React para ajustar estado cuando cambia una prop: el efecto haría un render
  // de más con el valor viejo pintado en pantalla.
  if (valor !== valorPrevio) {
    setValorPrevio(valor);
    setTexto(valor);
  }

  const aplicar = () => {
    if (texto.trim() !== valor) onChange(texto.trim());
  };

  return (
    <label className="flex flex-col gap-1">
      <span className="text-muted text-[11px]">Buscar</span>
      <div className="relative">
        <input
          type="search"
          value={texto}
          placeholder={placeholder}
          onChange={(e) => setTexto(e.target.value)}
          onBlur={aplicar}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              aplicar();
            }
            if (e.key === "Escape") {
              setTexto("");
              onChange("");
            }
          }}
          className={`${CLASE_SELECT} ${ancho} pr-7`}
        />
        {texto && (
          <button
            type="button"
            aria-label="Borrar la búsqueda"
            onClick={() => {
              setTexto("");
              onChange("");
            }}
            className="text-muted hover:text-ink absolute top-1/2 right-2 -translate-y-1/2 text-sm leading-none"
          >
            ×
          </button>
        )}
      </div>
    </label>
  );
}
