/**
 * Pruebas del cruce entre los filtros de Compras. Sin base.
 *
 * POR QUÉ EXISTE. Un selector que ofrece de más no falla: deja elegir una
 * marca que no convive con el proveedor elegido, y lo que se ve es una
 * pantalla vacía sin ninguna explicación. Eso ya pasó --las 350 marcas se
 * ofrecían siempre-- y la única forma de darse cuenta era saberse de memoria
 * qué marca es de qué proveedor.
 *
 * Y ofrecer de menos es peor todavía: si el cruce se come una marca que YA
 * estaba elegida, el filtro queda puesto, invisible y sin forma de sacarlo.
 *
 *     node --experimental-strip-types --import ./pruebas/registrar.mjs pruebas/filtros-compras.mts
 */

import { opcionesCruzadas, type Combinacion } from "@/lib/compras";
import type { FiltrosCompras } from "@/lib/types";

const FALLOS: string[] = [];

function revisar(nombre: string, ok: boolean, detalle = "") {
  console.log(ok ? `OK  ${nombre}` : `MAL ${nombre}${detalle ? `\n     ${detalle}` : ""}`);
  if (!ok) FALLOS.push(nombre);
}

// El caso que pidió ANA, con los nombres de verdad.
const MAESTRO: Combinacion[] = [
  { grupo: "QUO MKT", proveedor: "IMPROM", marca: "NUK" },
  { grupo: "QUO MKT", proveedor: "IMPROM", marca: "CONTIGO" },
  { grupo: "QUO MKT", proveedor: "IMPROM", marca: "COLEMAN" },
  { grupo: "QUO MKT", proveedor: "IMPROM", marca: "THERMOS" },
  { grupo: "QUO MKT", proveedor: "SEVILLANITA", marca: "BUBBA" },
  { grupo: "NOA COMERCIAL", proveedor: "OTRO", marca: "DIAPER GENIE" },
  // Un artículo sin marca cargada en el maestro: existe, pero no es una opción.
  { grupo: "NOA COMERCIAL", proveedor: "OTRO", marca: null },
];

const NADA: FiltrosCompras = {} as FiltrosCompras;
const con = (f: Partial<FiltrosCompras>): FiltrosCompras => f as FiltrosCompras;

// --- Sin nada elegido, están todas ----------------------------------------

revisar("sin filtros, todas las marcas",
  opcionesCruzadas("marca", MAESTRO, NADA).join() ===
    "BUBBA,COLEMAN,CONTIGO,DIAPER GENIE,NUK,THERMOS");
revisar("y ordenadas en español",
  opcionesCruzadas("proveedor", MAESTRO, NADA).join() === "IMPROM,OTRO,SEVILLANITA");
// Un null del maestro no es una opción: nadie puede filtrar por "sin marca".
revisar("los nulos no son una opción",
  !opcionesCruzadas("marca", MAESTRO, NADA).includes("" as string));

// --- EL PEDIDO: el proveedor recorta las marcas ---------------------------

revisar("con IMPROM, sólo sus cuatro marcas",
  opcionesCruzadas("marca", MAESTRO, con({ proveedor: ["IMPROM"] })).join() ===
    "COLEMAN,CONTIGO,NUK,THERMOS",
  opcionesCruzadas("marca", MAESTRO, con({ proveedor: ["IMPROM"] })).join());

revisar("dos proveedores suman sus marcas",
  opcionesCruzadas("marca", MAESTRO, con({ proveedor: ["IMPROM", "SEVILLANITA"] })).join() ===
    "BUBBA,COLEMAN,CONTIGO,NUK,THERMOS");

// Y al revés: elegir una marca dice de qué proveedor es.
revisar("con NUK, sólo IMPROM",
  opcionesCruzadas("proveedor", MAESTRO, con({ marca: ["NUK"] })).join() === "IMPROM");

// La empresa también recorta.
revisar("con NOA COMERCIAL, sólo su proveedor",
  opcionesCruzadas("proveedor", MAESTRO, con({ grupo: ["NOA COMERCIAL"] })).join() === "OTRO");

// --- Un filtro NO se recorta a sí mismo -----------------------------------
//
// Si Marca se filtrara con lo elegido en Marca, al tildar NUK desaparecerían
// las demás y no habría forma de agregar una segunda.

revisar("elegir una marca no esconde las otras",
  opcionesCruzadas("marca", MAESTRO, con({ proveedor: ["IMPROM"], marca: ["NUK"] })).join() ===
    "COLEMAN,CONTIGO,NUK,THERMOS");

// --- Lo elegido sobrevive al cruce ----------------------------------------
//
// NUK no convive con SEVILLANITA. Si el cruce la sacara de la lista, quedaría
// filtrando sin aparecer en ningún lado: pantalla vacía y nada que destildar.

const huerfana = opcionesCruzadas(
  "marca", MAESTRO, con({ proveedor: ["SEVILLANITA"], marca: ["NUK"] }),
);
revisar("una marca que ya no convive sigue visible", huerfana.includes("NUK"), huerfana.join());
revisar("y aparece junto a las que sí", huerfana.join() === "BUBBA,NUK", huerfana.join());

// --- Una lista vacía no es lo mismo que no haber elegido ------------------

revisar("un filtro vacío no recorta",
  opcionesCruzadas("marca", MAESTRO, con({ proveedor: [] })).length === 6);

console.log(FALLOS.length ? `\n${FALLOS.length} FALLARON: ${FALLOS.join(", ")}` : "\nTODO OK");
process.exit(FALLOS.length ? 1 : 0);
