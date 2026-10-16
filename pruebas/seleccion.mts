/**
 * El modo "todas menos" de los filtros múltiples. Sin base y sin navegador.
 *
 * LO QUE IMPORTA QUE NO SE ROMPA son dos cosas que fallan calladas:
 *
 *   1. Que "nada elegido" y "todo elegido" NO digan lo mismo. Para la consulta
 *      son idénticos --se ven todos los datos-- pero el próximo click hace
 *      cosas opuestas: desde el vacío, destildar no existe; desde el lleno,
 *      saca una. Si los dos dijeran "Todos", el desplegable parecería roto.
 *
 *   2. Que el panel se dé vuelta ANTES de que la zona de chips sea más larga
 *      que la lista. El corte está en la mitad justamente para que la zona de
 *      arriba sea siempre la más corta de las dos; con el corte mal puesto no
 *      falla nada, sólo quedan 349 chips apilados en un panel de 28 píxeles.
 *
 *     node --experimental-strip-types --import ./pruebas/registrar.mjs pruebas/seleccion.mts
 */

import { invertirSeleccion, resumenSeleccion } from "@/lib/seleccion";

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

// --- Cuándo se da vuelta el panel ------------------------------------------

revisar("nada elegido no invierte", invertirSeleccion(0, 350), false);
revisar("una de 350 no invierte", invertirSeleccion(1, 350), false);
revisar("la mitad JUSTA todavía no invierte", invertirSeleccion(175, 350), false);
revisar("una más que la mitad sí", invertirSeleccion(176, 350), true);
revisar("todas invierte", invertirSeleccion(350, 350), true);

// En impares la mitad cae en un decimal, así que el primero que invierte es el
// que pasa a ser mayoría real. Con 3 opciones: 2 ya son más que 1,5.
revisar("con 3 opciones, 1 no invierte", invertirSeleccion(1, 3), false);
revisar("con 3 opciones, 2 sí", invertirSeleccion(2, 3), true);

// Una sola opción NUNCA se da vuelta: invertir dejaría la lista de abajo con
// la única opción arriba y nada abajo, o sea un panel vacío.
revisar("con una sola opción no invierte nunca", invertirSeleccion(1, 1), false);
revisar("sin opciones tampoco", invertirSeleccion(0, 0), false);

// La zona de chips tiene que ser SIEMPRE la más corta. Es la propiedad que el
// corte en la mitad garantiza, y se prueba sobre todos los tamaños en vez de
// sobre un par de casos elegidos a mano.
let peor: string | null = null;
for (let total = 2; total <= 60; total++) {
  for (let elegidos = 0; elegidos <= total; elegidos++) {
    const invertido = invertirSeleccion(elegidos, total);
    const arriba = invertido ? total - elegidos : elegidos;
    const abajo = invertido ? elegidos : total - elegidos;
    if (arriba > abajo) peor = `${elegidos}/${total} deja ${arriba} chips contra ${abajo} de lista`;
  }
}
revisar("la zona de chips nunca es más larga que la lista", peor, null);

// --- El texto del botón ----------------------------------------------------

const nombre = (v: string) => ({ br: "Braun", gi: "Gillette", oa: "Oral-B" })[v] ?? v;
const resumen = (elegidos: string[], total: number) =>
  resumenSeleccion({
    elegidos,
    excluidos: ["br", "gi", "oa"].filter((v) => !elegidos.includes(v)).slice(0, total),
    total,
    todos: "Todos",
    nombre,
  });

revisar("nada elegido dice Todos", resumen([], 350), "Todos");
revisar("una dice su nombre", resumen(["br"], 350), "Braun");
revisar("dos dicen cuántas", resumen(["br", "gi"], 350), "2 elegidos");

// LOS DOS ESTADOS QUE SE PARECEN. Mismo resultado en pantalla, distinto en el
// próximo click: por eso no pueden decir lo mismo.
revisar(
  "todo elegido NO dice lo mismo que nada elegido",
  resumenSeleccion({ elegidos: ["br", "gi", "oa"], excluidos: [], total: 3, todos: "Todos", nombre }),
  "Todos (3)",
);

// Con una sola afuera se dice CUAL: es el caso de "seleccioné todo y saqué una"
// y "Todos menos 1" obligaría a abrir el desplegable para saber cuál.
revisar(
  "una sola afuera dice el nombre",
  resumenSeleccion({ elegidos: ["br", "gi"], excluidos: ["oa"], total: 3, todos: "Todos", nombre }),
  "Todos menos Oral-B",
);
revisar(
  "varias afuera dicen cuántas",
  resumenSeleccion({
    elegidos: Array.from({ length: 347 }, (_, i) => `m${i}`),
    excluidos: ["br", "gi", "oa"],
    total: 350,
    todos: "Todos",
    nombre,
  }),
  "Todos menos 3",
);

// La etiqueta de "todos" la pone cada filtro --algunos dicen "Todas"-- y tiene
// que respetarse en los tres textos, no sólo en el primero.
revisar(
  "respeta la etiqueta de cada filtro",
  resumenSeleccion({ elegidos: ["br", "gi"], excluidos: ["oa"], total: 3, todos: "Todas", nombre }),
  "Todas menos Oral-B",
);

// Más elegidos que opciones no debería pasar, pero si pasa es "todas" y no un
// "menos -1" que no significa nada.
revisar(
  "más elegidos que opciones cae en todas",
  resumenSeleccion({ elegidos: ["br", "gi", "oa"], excluidos: [], total: 2, todos: "Todos", nombre }),
  "Todos (2)",
);

console.log(FALLOS.length ? `\n${FALLOS.length} FALLARON: ${FALLOS.join(", ")}` : "\nTODO OK");
process.exit(FALLOS.length ? 1 : 0);
