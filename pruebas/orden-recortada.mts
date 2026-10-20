/**
 * La diferencia entre LA VISTA y LA ORDEN, en Compras. Sin base ni navegador.
 *
 * ---------------------------------------------------------------------------
 * POR QUE EXISTE
 *
 * La orden de compra es del proveedor ENTERO, pero se arma mirando de a poco:
 * una marca, lo que tiene oferta, lo discontinuado. Son dos cosas distintas
 * que viven en la misma pantalla, y confundirlas se paga afuera.
 *
 * Antes la orden que se bajaba eran las filas visibles, y bajar con un filtro
 * puesto no daba ningún error: daba una orden incompleta que parecía correcta
 * y que alguien le mandaba a un proveedor. Eso se arregló en la raíz --el
 * archivo sale de la lista completa-- y quedaron estas dos cuentas:
 *
 *   queRecortaLaOrden    qué está mostrando menos que la orden, para poder
 *                        decir "el archivo trae más de lo que ves".
 *   totalesDeLaOrden     los números, que la pantalla saca DOS VECES: con la
 *                        orden entera y con las filas a la vista.
 *
 * Si una de las dos se desincroniza, el síntoma es que el total de la pantalla
 * no coincida con el del archivo -- y eso se descubre cuando llega la
 * mercadería, o cuando no llega.
 *
 *     node --experimental-strip-types --import ./pruebas/registrar.mjs pruebas/orden-recortada.mts
 */

import {
  alcanceDisponible,
  entraEnLaOrden,
  nombreDelAlcanceMarca,
  queRecortaLaOrden,
  RECORTES_POR_DEFECTO,
  totalesDeLaOrden,
  type RenglonOrden,
} from "@/lib/compras";
import type { FilaCompra } from "@/lib/types";

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

// --- Los totales de la orden -----------------------------------------------
//
// La pantalla los saca dos veces: con la orden entera del proveedor --que es
// lo que va al archivo-- y con las filas que se están viendo. Es la MISMA
// función a propósito: dos copias de esta cuenta se desincronizan, y la forma
// en que se notaría es que el total de la pantalla no coincida con el del
// archivo.

/** Una fila de Compras con lo que la cuenta mira, y el resto en cero. */
function fila(p: Partial<FilaCompra> & { sku: string }): FilaCompra {
  return {
    costo: 0,
    costoLista: 0,
    unidadesPorBulto: 1,
    sugerido: 0,
    sugeridoMinimo: false,
    codigoCompra: "COD",
    ...p,
  } as FilaCompra;
}

const renglon = (p: Partial<RenglonOrden>): RenglonOrden => ({
  unidad: "unidad",
  cantidad: 0,
  descuento: 0,
  descuento2: 0,
  ...p,
});

revisar(
  "sin filas no hay orden",
  totalesDeLaOrden([], new Map()).renglones,
  0,
);

// CANTIDAD 0 ES "NO LO PIDAS", no "pedí cero": no es un renglón de la orden.
// Es lo que hace que vaciar una marca la saque del archivo en vez de mandarla
// con cero unidades.
revisar(
  "un renglón en cero no es un renglón",
  totalesDeLaOrden(
    [fila({ sku: "A", costoLista: 100 })],
    new Map([["A", renglon({ cantidad: 0 })]]),
  ).renglones,
  0,
);

revisar(
  "una fila sin renglón tampoco",
  totalesDeLaOrden([fila({ sku: "A" })], new Map()).renglones,
  0,
);

// UN BULTO SON VARIAS UNIDADES, y la plata sale de las unidades. Si esto se
// equivocara, el total del Excel que recibe el proveedor estaría dividido por
// las unidades que trae el bulto.
revisar(
  "pedido en bultos: 3 bultos de 12 son 36 unidades",
  totalesDeLaOrden(
    [fila({ sku: "A", costoLista: 100, unidadesPorBulto: 12 })],
    new Map([["A", renglon({ unidad: "bulto", cantidad: 3 })]]),
  ),
  {
    renglones: 1,
    unidades: 36,
    bultos: 3,
    bruto: 3600,
    neto: 3600,
    recortados: 0,
    sinCodigo: 0,
    minimos: 0,
  },
);

// LOS DOS DESCUENTOS VAN EN CASCADA, no sumados: 10 y 10 dan 19, no 20. Sigma
// los aplica así, y un neto calculado de otra forma es una orden que no
// coincide con la factura.
revisar(
  "los descuentos se aplican en cascada",
  totalesDeLaOrden(
    [fila({ sku: "A", costoLista: 1000 })],
    new Map([["A", renglon({ cantidad: 1, descuento: 10, descuento2: 10 })]]),
  ).neto,
  810,
);

// SIN COSTO DE LISTA SE VALORIZA CON EL COSTO REAL, que es lo único que hay.
// El mismo respaldo que usa el Excel; si difirieran, la pantalla y el archivo
// mostrarían plata distinta.
revisar(
  "sin costo de lista usa el costo real",
  totalesDeLaOrden(
    [fila({ sku: "A", costo: 50, costoLista: 0 })],
    new Map([["A", renglon({ cantidad: 2 })]]),
  ).bruto,
  100,
);

// Un descuento imposible se recorta a 100 al exportar (ver DESCUENTO_MAXIMO):
// acá sólo se cuenta, para poder avisar cuáles se tocaron.
revisar(
  "cuenta los descuentos imposibles",
  totalesDeLaOrden(
    [fila({ sku: "A", costoLista: 10 })],
    new Map([["A", renglon({ cantidad: 1, descuento: 973 })]]),
  ).recortados,
  1,
);

revisar(
  "cuenta los que no tienen código del proveedor y los mínimos",
  (() => {
    const t = totalesDeLaOrden(
      [
        fila({ sku: "A", costoLista: 10, codigoCompra: "" }),
        fila({ sku: "B", costoLista: 10, sugeridoMinimo: true }),
      ],
      new Map([
        ["A", renglon({ cantidad: 1 })],
        ["B", renglon({ cantidad: 1 })],
      ]),
    );
    return { sinCodigo: t.sinCodigo, minimos: t.minimos, renglones: t.renglones };
  })(),
  { sinCodigo: 1, minimos: 1, renglones: 2 },
);

// EL CASO DE TODOS LOS DIAS: se revisa marca por marca y se baja la orden
// entera. El mapa de la orden tiene las dos marcas; la vista, una sola. Los
// dos totales salen de la misma función con listas distintas, y el de la orden
// es el que va al archivo.
revisar(
  "la vista es un subtotal de la orden",
  (() => {
    const todas = [
      fila({ sku: "A", costoLista: 100 }),
      fila({ sku: "B", costoLista: 100 }),
    ];
    const orden = new Map([
      ["A", renglon({ cantidad: 1 })],
      ["B", renglon({ cantidad: 4 })],
    ]);
    const entera = totalesDeLaOrden(todas, orden);
    const vista = totalesDeLaOrden([todas[0]!], orden);
    return { orden: entera.unidades, vista: vista.unidades };
  })(),
  { orden: 5, vista: 1 },
);

// --- Hasta dónde llega la orden -------------------------------------------
//
// Los dos casos son reales y conviven: hay proveedores donde la OC va siempre
// por marca, y hay veces que se filtra una marca sólo para vaciarle cantidades
// y la OC igual va por todo el proveedor. Por eso se elige.
//
// LO UNICO QUE PUEDE RECORTAR ES LA MARCA. El buscador y el selector Mostrar
// no: son la lupa con la que se mira, no un conjunto que alguien pueda
// nombrar. Si recortaran, olvidarse una palabra tipeada mandaría media orden
// sin que nada avisara.

revisar("sin marca elegida no hay nada que elegir", alcanceDisponible(undefined), false);
revisar("ni con la lista vacía", alcanceDisponible([]), false);
revisar("con una marca sí", alcanceDisponible(["AVENT"]), true);

revisar("una marca se nombra", nombreDelAlcanceMarca(["AVENT"]), "AVENT");
revisar(
  "varias se cuentan",
  nombreDelAlcanceMarca(["AVENT", "CHICCO", "DOVE"]),
  "las 3 marcas elegidas",
);
revisar("sin marcas no inventa una", nombreDelAlcanceMarca([]), "la marca elegida");

// Con alcance de proveedor entra TODO, incluso lo que no se está viendo: es el
// caso de "filtro AVENT para vaciarle cantidades, pero la OC va completa".
revisar(
  "alcance de proveedor: entra un CHICCO aunque esté filtrada AVENT",
  entraEnLaOrden({ marca: "CHICCO" }, "proveedor", ["AVENT"]),
  true,
);

// Con alcance de marca, el CHICCO queda afuera. Es el caso de "a PARALLEL las
// OC le van por marca".
revisar(
  "alcance de marca: el CHICCO queda afuera",
  entraEnLaOrden({ marca: "CHICCO" }, "marca", ["AVENT"]),
  false,
);
revisar(
  "alcance de marca: el AVENT entra",
  entraEnLaOrden({ marca: "AVENT" }, "marca", ["AVENT"]),
  true,
);
revisar(
  "con dos marcas elegidas entran las dos",
  [
    entraEnLaOrden({ marca: "AVENT" }, "marca", ["AVENT", "CHICCO"]),
    entraEnLaOrden({ marca: "CHICCO" }, "marca", ["AVENT", "CHICCO"]),
    entraEnLaOrden({ marca: "DOVE" }, "marca", ["AVENT", "CHICCO"]),
  ],
  [true, true, false],
);

// Un artículo SIN marca cargada no puede colarse en una orden de marca: nadie
// lo revisó al mirar AVENT, así que mandarlo sería mandar algo que no se vio.
revisar(
  "sin marca cargada no entra en una orden de marca",
  entraEnLaOrden({ marca: null }, "marca", ["AVENT"]),
  false,
);
// Pero sí en la del proveedor, que es todo lo que tiene.
revisar(
  "sin marca cargada sí entra en la del proveedor",
  entraEnLaOrden({ marca: null }, "proveedor", ["AVENT"]),
  true,
);

// Sin marcas elegidas el alcance de marca no puede recortar nada: sería una
// orden vacía. La pantalla ya no lo ofrece, pero la función no puede depender
// de eso.
revisar(
  "alcance de marca sin marcas no vacía la orden",
  entraEnLaOrden({ marca: "CHICCO" }, "marca", []),
  true,
);

console.log(FALLOS.length ? `\n${FALLOS.length} FALLARON: ${FALLOS.join(", ")}` : "\nTODO OK");
process.exit(FALLOS.length ? 1 : 0);
