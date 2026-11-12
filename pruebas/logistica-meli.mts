import {
  armarPorLogistica,
  colorLogistica,
  etiquetaLogistica,
  ordenLogistica,
  SIN_DATO,
} from "@/lib/logistica-meli";

/* ===========================================================================
   CÓMO SE DESPACHÓ CADA VENTA: LA TRADUCCIÓN Y EL ARMADO DEL GRÁFICO

   POR QUÉ ESTO TIENE PRUEBAS

   El panel "Cómo se despachó" es de los que se miran para decidir --cuánto
   depende la operación de Full-- y todos sus errores posibles son silenciosos.
   No hay una pantalla en blanco que avise: la torta se dibuja igual, con los
   números mal.

   Los tres que cubren estas pruebas:

   1. QUE UN MODO NUEVO SE COMA. Si ML empieza a mandar un `logistic_type` que
      no conocemos y la traducción lo mete en un "Otros" gris, nadie se entera
      nunca de que apareció. Lo que se fija acá es que pase DERECHO, con su
      nombre crudo a la vista.

   2. QUE "SIN DATO" SE MEZCLE CON "SIN ESPECIFICAR". Son dos cosas distintas:
      `not_specified` es un valor real de ML --el envío se arregla por fuera--
      y "Sin dato" es un agujero nuestro, el envío que todavía no se bajó. Si
      se juntan, el día que el pipeline se atrase la franja crece y se lee como
      un cambio en la operación.

   3. QUE LOS PORCENTAJES SE CALCULEN SOBRE LO QUE SABEMOS. "Sin dato" entra en
      el total a propósito. Si quedara afuera, Full daría 100 % con la mitad de
      los envíos sin bajar.
   ========================================================================= */

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

/* --- LOS MODOS QUE MANDA ML ---------------------------------------------- */

revisar("fulfillment es Full", etiquetaLogistica("fulfillment"), "Full");
revisar("self_service es Flex", etiquetaLogistica("self_service"), "Flex");
revisar("cross_docking es Colecta", etiquetaLogistica("cross_docking"), "Colecta");
revisar(
  "drop_off es punto de despacho",
  etiquetaLogistica("drop_off"),
  "Punto de despacho",
);
revisar(
  "xd_drop_off va separado de drop_off",
  etiquetaLogistica("xd_drop_off"),
  "Punto de despacho (XD)",
);
revisar(
  "default es logistica propia",
  etiquetaLogistica("default"),
  "Logística propia",
);

// Mayúsculas y espacios: el dato pasa por la API, por Postgres y por un JSON
// antes de llegar acá. Si en el camino quedara " Fulfillment ", la traducción
// tiene que seguir funcionando y no mostrar el crudo como si fuera un modo
// desconocido.
revisar("no le importan las mayusculas", etiquetaLogistica("FULFILLMENT"), "Full");
revisar("recorta los espacios", etiquetaLogistica("  self_service  "), "Flex");

/* --- "SIN DATO" NO ES UN MODO -------------------------------------------- */

revisar("null es sin dato", etiquetaLogistica(null), SIN_DATO);
revisar("undefined es sin dato", etiquetaLogistica(undefined), SIN_DATO);
revisar("vacio es sin dato", etiquetaLogistica(""), SIN_DATO);
revisar("solo espacios es sin dato", etiquetaLogistica("   "), SIN_DATO);

// LA PRUEBA DEL PUNTO 2. Si alguien decidiera que "no especificado" y "no lo
// sabemos" son lo mismo, esta prueba es la que se rompe.
revisar(
  "not_specified NO es sin dato",
  etiquetaLogistica("not_specified"),
  "Sin especificar",
);
revisar(
  "y tienen colores distintos",
  colorLogistica("Sin especificar") === colorLogistica(SIN_DATO),
  false,
);

/* --- LA PRUEBA DEL PUNTO 1: UN MODO QUE NO CONOCEMOS --------------------- */

revisar(
  "un modo nuevo se muestra tal cual",
  etiquetaLogistica("modo_nuevo_de_ml"),
  "modo_nuevo_de_ml",
);

// Y con un color que NO es el gris de "Sin dato": tiene que cantar que hay algo
// nuevo, no parecer un hueco.
revisar(
  "y con un color propio, no el del hueco",
  colorLogistica("modo_nuevo_de_ml") === colorLogistica(SIN_DATO),
  false,
);

// Entre los conocidos y el hueco: se ve, pero el hueco cierra la leyenda.
revisar(
  "se ordena antes que Sin dato",
  ordenLogistica("modo_nuevo_de_ml") < ordenLogistica(SIN_DATO),
  true,
);
revisar(
  "y despues de los conocidos",
  ordenLogistica("modo_nuevo_de_ml") > ordenLogistica("Colecta"),
  true,
);

/* --- LOS COLORES SON ESTABLES -------------------------------------------- */

// El color sale de la ETIQUETA y no de la posición en la torta. Si saliera de
// la posición, Full sería azul un día y verde al otro según cuántas ventas
// tuvo cada modo, y dos capturas del mismo panel no se podrían comparar.
//
// NO SE FIJA EL HEX, y antes sí: desde que hay modo claro los colores salen de
// variables de CSS --en claro son los tonos 600/700, porque los del oscuro se
// lavan sobre el crema-- así que atar la prueba a un hex ataba el tablero a un
// solo tema. Lo que importa es que el mismo modo dé siempre lo mismo y que dos
// modos distintos no se confundan.
revisar(
  "Full siempre el mismo color",
  colorLogistica("Full") === colorLogistica("Full"),
  true,
);
revisar(
  "y no se confunde con Flex",
  colorLogistica("Full") === colorLogistica("Flex"),
  false,
);
revisar(
  "los seis modos conocidos tienen colores distintos entre si",
  new Set(
    ["Full", "Flex", "Colecta", "Punto de despacho", "Punto de despacho (XD)",
     "Logística propia"].map(colorLogistica),
  ).size,
  6,
);

/* --- EL ARMADO DE LA TORTA ----------------------------------------------- */

revisar(
  "ordena por el orden fijo, no por tamano",
  armarPorLogistica([
    { logistica: "cross_docking", ordenes: 14 },
    { logistica: "fulfillment", ordenes: 5182 },
    { logistica: "self_service", ordenes: 3 },
  ]),
  [
    { label: "Full", total: 5182 },
    { label: "Flex", total: 3 },
    { label: "Colecta", total: 14 },
  ],
);

revisar(
  "el hueco va ultimo aunque llegue primero",
  armarPorLogistica([
    { logistica: null, ordenes: 261 },
    { logistica: "fulfillment", ordenes: 10 },
  ]),
  [
    { label: "Full", total: 10 },
    { label: SIN_DATO, total: 261 },
  ],
);

// La base devuelve los conteos como TEXTO (pg no convierte los bigint), así que
// sumarlos sin pasarlos a número daría "1020" en vez de 30.
revisar(
  "los conteos llegan como texto y se suman como numeros",
  armarPorLogistica([
    { logistica: "fulfillment", ordenes: "10" },
    { logistica: "fulfillment", ordenes: "20" },
  ]),
  [{ label: "Full", total: 30 }],
);

// Dos crudos con la misma etiqueta son UNA porción. Hoy el mapa es uno a uno,
// pero si mañana `drop_off` y `xd_drop_off` se muestran igual, la base seguiría
// mandando dos filas: sin esto, la torta dibujaría dos porciones del mismo
// color con el mismo nombre.
revisar(
  "los crudos que comparten etiqueta se juntan",
  armarPorLogistica([
    { logistica: "fulfillment", ordenes: 5 },
    { logistica: "FULFILLMENT", ordenes: 7 },
  ]),
  [{ label: "Full", total: 12 }],
);

revisar(
  "una etiqueta en cero no es una porcion",
  armarPorLogistica([
    { logistica: "fulfillment", ordenes: 5 },
    { logistica: "self_service", ordenes: 0 },
  ]),
  [{ label: "Full", total: 5 }],
);

revisar(
  "un conteo ilegible no rompe la torta",
  armarPorLogistica([
    { logistica: "fulfillment", ordenes: "no es un numero" },
    { logistica: "self_service", ordenes: 4 },
  ]),
  [{ label: "Flex", total: 4 }],
);

revisar("sin ventas no hay porciones", armarPorLogistica([]), []);

/* --- LA PRUEBA DEL PUNTO 3: EL DENOMINADOR ------------------------------- */

// El total de la torta es la suma de TODAS las porciones, "Sin dato" incluido.
// Es la cuenta que hace el panel; si "Sin dato" quedara afuera, Full daría
// 100 % teniendo la mitad de los envíos sin bajar.
const conHueco = armarPorLogistica([
  { logistica: "fulfillment", ordenes: 50 },
  { logistica: null, ordenes: 50 },
]);
const total = conHueco.reduce((acc, p) => acc + p.total, 0);
revisar("el hueco entra en el total", total, 100);
revisar(
  "asi Full no da 100% con la mitad sin bajar",
  (conHueco[0].total / total) * 100,
  50,
);

console.log(
  FALLOS.length ? `\n${FALLOS.length} FALLARON: ${FALLOS.join(", ")}` : "\nTODO OK",
);
process.exit(FALLOS.length ? 1 : 0);
