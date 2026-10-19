/**
 * El aviso de "lo que se baja es sólo lo que estás viendo". Sin base ni
 * navegador.
 *
 * ---------------------------------------------------------------------------
 * POR QUE EXISTE
 *
 * La orden de compra que se baja son LAS FILAS VISIBLES. Eso está bien
 * mientras se arma --se revisa marca por marca, se vacía lo que no va-- pero
 * en el momento de bajar es una trampa: bajar con un filtro puesto no da
 * ningún error, da una orden incompleta que parece correcta y que alguien
 * manda a un proveedor.
 *
 * Este aviso es lo único que avisa. Si dejara de dispararse, la pantalla
 * seguiría funcionando perfecto y el error aparecería recién cuando llegue la
 * mercadería -- o cuando no llegue.
 *
 *     node --experimental-strip-types --import ./pruebas/registrar.mjs pruebas/orden-recortada.mts
 */

import {
  contarEditadosFuera,
  queRecortaLaOrden,
  RECORTES_POR_DEFECTO,
} from "@/lib/compras";

const FALLOS: string[] = [];

function revisar(nombre: string, obtenido: unknown, esperado: unknown) {
  const ok = JSON.stringify(obtenido) === JSON.stringify(esperado);
  console.log(
    ok
      ? `OK  ${nombre}`
      : `MAL ${nombre}\n     esperado: ${JSON.stringify(esperado)}\n     obtenido: ${JSON.stringify(obtenido)}`,
  );
  if (!ok) FALLOS.push(nombre);
}

const POR_DEFECTO = RECORTES_POR_DEFECTO;

// --- Cuándo NO hay que avisar ----------------------------------------------
//
// Si avisara de más, el aviso se vuelve ruido y se deja de leer -- que es
// exactamente igual de malo que no avisar.

revisar("sin nada puesto no avisa", queRecortaLaOrden({}, POR_DEFECTO), []);
revisar(
  "elegir el proveedor no recorta: la orden ES de un proveedor",
  queRecortaLaOrden({ marca: undefined }, POR_DEFECTO),
  [],
);
revisar("una lista de marcas vacía no avisa", queRecortaLaOrden({ marca: [] }, POR_DEFECTO), []);
revisar("el buscador vacío tampoco", queRecortaLaOrden({ buscar: "" }, POR_DEFECTO), []);
revisar("ni con espacios", queRecortaLaOrden({ buscar: "   " }, POR_DEFECTO), []);
// El orden de los recortes no significa nada: lo que importa es el conjunto.
revisar(
  "los recortes de siempre en otro orden siguen siendo los de siempre",
  queRecortaLaOrden({}, [...POR_DEFECTO].reverse()),
  [],
);

// --- Cuándo SÍ -------------------------------------------------------------

revisar("una marca", queRecortaLaOrden({ marca: ["BRAUN"] }, POR_DEFECTO), ["la marca"]);
revisar(
  "varias marcas dicen cuántas",
  queRecortaLaOrden({ marca: ["BRAUN", "ORAL-B", "GILLETTE"] }, POR_DEFECTO),
  ["3 marcas"],
);
revisar(
  "el buscador dice qué se buscó",
  queRecortaLaOrden({ buscar: "ger" }, POR_DEFECTO),
  ["el buscador («ger»)"],
);

// EL MAS SILENCIOSO DE LOS TRES. Un discontinuo nunca entra por "Hay que
// comprar" --su sugerido es 0 a propósito-- así que lo que se cargó a mano
// entrando por ese recorte desaparece al volver al recorte de siempre.
revisar(
  "cambiar el selector Mostrar también recorta",
  queRecortaLaOrden({}, ["discontinuo"]),
  ["el selector Mostrar"],
);
revisar(
  "agregar un recorte a los de siempre también",
  queRecortaLaOrden({}, [...POR_DEFECTO, "oferta"]),
  ["el selector Mostrar"],
);

// Los tres a la vez, en el orden en que se enumeran en el aviso.
revisar(
  "los tres juntos",
  queRecortaLaOrden({ marca: ["BRAUN"], buscar: "ger" }, ["discontinuo"]),
  ["la marca", "el buscador («ger»)", "el selector Mostrar"],
);

// --- Cuántos renglones cargados quedan afuera ------------------------------

const edicion = (cantidad: number) => ({ cantidad });

revisar(
  "sin ediciones no hay nada afuera",
  contarEditadosFuera(new Map(), ["A", "B"]),
  0,
);
revisar(
  "lo editado que se ve no cuenta",
  contarEditadosFuera(new Map([["A", edicion(5)]]), ["A", "B"]),
  0,
);
revisar(
  "lo editado que NO se ve, sí",
  contarEditadosFuera(new Map([["Z", edicion(5)]]), ["A", "B"]),
  1,
);

// LOS CEROS NO CUENTAN, y es la mitad del diseño: trabajar marca por marca
// vaciando las que no van deja decenas de ceros fuera de la vista. Si contaran,
// el aviso diría "47 renglones quedan afuera" en el caso más normal de todos y
// nadie lo volvería a leer.
revisar(
  "un cero afuera no es una pérdida",
  contarEditadosFuera(new Map([["Z", edicion(0)]]), ["A"]),
  0,
);
revisar(
  "mezcla: sólo los que tienen cantidad",
  contarEditadosFuera(
    new Map([
      ["A", edicion(10)], // visible
      ["Z", edicion(3)], // afuera, con cantidad
      ["Y", edicion(0)], // afuera, vaciado
      ["X", edicion(7)], // afuera, con cantidad
    ]),
    ["A", "B"],
  ),
  2,
);

// Sin nada visible --la marca filtrada no tiene artículos-- todo lo cargado
// queda afuera. Es el caso extremo del aviso y tiene que contar bien.
revisar(
  "con la vista vacía cuenta todo lo cargado",
  contarEditadosFuera(new Map([["A", edicion(1)], ["B", edicion(2)]]), []),
  2,
);

console.log(FALLOS.length ? `\n${FALLOS.length} FALLARON: ${FALLOS.join(", ")}` : "\nTODO OK");
process.exit(FALLOS.length ? 1 : 0);
