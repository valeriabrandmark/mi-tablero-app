/**
 * Pruebas del selector de columna del sell in. Sin base y sin red.
 *
 * POR QUE EXISTE. La planilla tiene una columna por oferta y NO todas son un
 * mes:
 *
 *     1/10/2026         la oferta de octubre              mes, sin evento
 *     1/7/2026 (Glam)   un segundo corte de julio         mes + evento
 *     HOT SALE          una promo sin mes                 evento solo
 *
 * El selector listaba `mes_comercial` a secas, asi que las dos ultimas no se
 * podian elegir: la de Glam se veia como "jul 2026" --idéntica a la columna
 * comun-- y la consulta filtraba `evento = ''`, de modo que traia la comun
 * igual. Estaban cargadas en la base y eran inalcanzables desde la pantalla.
 *
 * Lo que se prueba es el ida y vuelta del valor que viaja en la URL. Si se
 * rompe, el sintoma no es un error: es que el panel muestra OTRO descuento, y
 * ese descuento baja a una orden de compra.
 *
 *     node --experimental-strip-types --import ./pruebas/registrar.mjs pruebas/sell-in-columna.mts
 */

import {
  opcionesSellInDesde,
  partirValorSellIn,
  valorSellIn,
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

// --- La columna comun de un mes: el valor sigue siendo el mes pelado --------
//
// Importa que no cambie: los links guardados y las URLs escritas a mano
// traen "2026-07" desde siempre, y tienen que seguir cayendo en la columna
// comun de julio.

revisar("un mes sin evento es el mes pelado", valorSellIn("2026-07"), "2026-07");
revisar("y con evento vacio tambien", valorSellIn("2026-07", ""), "2026-07");
revisar("se parte de vuelta", partirValorSellIn("2026-07"), { mes: "2026-07", evento: "" });

// --- Un corte dentro de un mes ---------------------------------------------

revisar("mes + evento", valorSellIn("2026-07", "Glam"), "2026-07|Glam");
revisar(
  "y se parte de vuelta",
  partirValorSellIn("2026-07|Glam"),
  { mes: "2026-07", evento: "Glam" },
);

// --- Una promo sin mes -----------------------------------------------------

revisar("promo sin mes", valorSellIn("", "HOT SALE"), "|HOT SALE");
revisar(
  "y se parte de vuelta",
  partirValorSellIn("|HOT SALE"),
  { mes: "", evento: "HOT SALE" },
);

// --- Los eventos reales de la planilla van y vuelven enteros ---------------
//
// Son los tres que hay cargados hoy. El de Cyber Monday tiene un numero y
// espacios; el separador no puede aparecer adentro de ninguno.

for (const [mes, evento] of [
  ["2026-07", "Glam"],
  ["", "HOT SALE"],
  ["", "Cyber Monday 2026"],
  ["2026-10", ""],
] as const) {
  revisar(
    `ida y vuelta de ${JSON.stringify([mes, evento])}`,
    partirValorSellIn(valorSellIn(mes, evento)),
    { mes, evento },
  );
}

// --- Lo que puede llegar de una URL escrita a mano -------------------------
//
// Nada de esto puede reventar: el valor se valida despues contra la lista
// real de columnas, y lo que no existe cae en la primera.

revisar("vacio", partirValorSellIn(""), { mes: "", evento: "" });
revisar("undefined", partirValorSellIn(undefined), { mes: "", evento: "" });
revisar("null", partirValorSellIn(null), { mes: "", evento: "" });
revisar("solo el separador", partirValorSellIn("|"), { mes: "", evento: "" });
// Un evento con un separador adentro no deberia existir, pero si llega, se
// parte en el PRIMERO: lo que sobra queda en el evento y no se pierde.
revisar(
  "dos separadores: corta en el primero",
  partirValorSellIn("2026-07|a|b"),
  { mes: "2026-07", evento: "a|b" },
);

// --- LAS OPCIONES DEL DESPLEGABLE ------------------------------------------
//
// Las filas, en el orden en que las devuelve la consulta: los meses de más
// nuevo a más viejo, con el corte pegado a su mes, y las promos al final.

const FILAS = [
  { mes: "2026-10", evento: "" },
  { mes: "2026-09", evento: "" },
  { mes: "2026-07", evento: "" },
  { mes: "2026-07", evento: "Glam" },
  { mes: "", evento: "Cyber Monday 2026" },
  { mes: "", evento: "HOT SALE" },
];

const nombre = (m: string) => (m ? `mes ${m}` : "");
const OPCIONES = opcionesSellInDesde(FILAS, nombre);

revisar("sale una opcion por columna", OPCIONES.length, 6);
revisar("la primera es el mes mas nuevo", OPCIONES[0].valor, "2026-10");
revisar(
  "el corte lleva su mes y su evento",
  {
    valor: OPCIONES[3].valor,
    mesColumna: OPCIONES[3].mesColumna,
    mesCostos: OPCIONES[3].mesCostos,
    evento: OPCIONES[3].evento,
  },
  { valor: "2026-07|Glam", mesColumna: "2026-07", mesCostos: "2026-07", evento: "Glam" },
);

// EL INVARIANTE QUE SE ROMPIO. Para una promo, `valor` lleva el mes VACIO
// --es lo que identifica la columna-- y `mes` lleva el ultimo con costos.
// Son distintos A PROPOSITO.
const promo = OPCIONES[5];
revisar("la promo vale con el mes vacio", promo.valor, "|HOT SALE");
// LOS DOS MESES DE UNA PROMO, que son distintos y es TODO el punto. Con el de
// costos se busca el costo de lista; con el de la columna --vacio-- se busca el
// DESCUENTO en bronze.sell_in. Usar el de costos para buscar el descuento daba
// cero filas y la pantalla salia sin un solo descuento.
revisar("el mes de la columna es vacio", promo.mesColumna, "");
revisar("pero sus costos salen del ultimo mes", promo.mesCostos, "2026-10");
// LA ETIQUETA ES EL NOMBRE DE LA COLUMNA Y NADA MAS. De que mes salen los
// costos no va en el desplegable --en 23 renglones es ruido-- sino en el
// detalle del panel, que es donde se esta leyendo la plata.
revisar("la etiqueta de la promo es su nombre pelado", promo.etiqueta, "HOT SALE");
revisar("la del corte lleva mes y evento", OPCIONES[3].etiqueta, "mes 2026-07 · Glam");
revisar("y la de un mes comun es solo el mes", OPCIONES[0].etiqueta, "mes 2026-10");

// Y ESTA ES LA PRUEBA QUE HABRIA ATAJADO EL BUG. La pantalla rearmaba el value
// del <select> con valorSellIn(mes, evento) y para una promo daba
// "2026-10|HOT SALE", que no es ninguna opcion. Un <select> con un value que
// no existe no selecciona nada: mostraba la primera opcion y parecia que no
// tomaba, aunque la tabla si estuviera mostrando la promo.
for (const o of OPCIONES) {
  const rearmado = valorSellIn(o.mesCostos, o.evento);
  const coincide = OPCIONES.some((x) => x.valor === rearmado);
  // Una promo se reconoce por su VALOR --que no lleva mes--, no por `o.mes`,
  // que nunca está vacío: siempre tiene el mes del que salen los costos. Ese
  // es justamente el detalle que hacía que los dos no coincidieran.
  const esPromo = partirValorSellIn(o.valor).mes === "";
  if (esPromo) {
    revisar(`rearmar ${o.valor} NO da una opcion valida`, coincide, false);
    revisar(`...porque da ${rearmado}`, rearmado, `${o.mesCostos}|${o.evento}`);
  } else {
    revisar(`rearmar ${o.valor} da la misma opcion`, rearmado, o.valor);
  }
}

// El ida y vuelta por el `valor` --que es lo que ahora hace la pantalla-- SI
// tiene que encontrar siempre la opcion.
for (const o of OPCIONES) {
  revisar(
    `buscar por valor encuentra ${o.valor}`,
    OPCIONES.find((x) => x.valor === o.valor)?.etiqueta,
    o.etiqueta,
  );
}

// EL VALOR SE ARMA CON `mesColumna`, no con `mesCostos`. Es lo que lo hace
// coincidir con la opcion, y lo que separa "con que mes busco el descuento"
// de "con que mes busco el costo".
for (const o of OPCIONES) {
  revisar(
    `${o.valor} se arma con mesColumna`,
    valorSellIn(o.mesColumna, o.evento),
    o.valor,
  );
}

// Una fila sin mes ni evento no puede nombrarse: no va al desplegable.
revisar(
  "una fila vacia no es una opcion",
  opcionesSellInDesde([{ mes: "", evento: "" }, { mes: "2026-10", evento: "" }], nombre).length,
  1,
);

console.log(FALLOS.length ? `\n${FALLOS.length} FALLARON: ${FALLOS.join(", ")}` : "\nTODO OK");
process.exit(FALLOS.length ? 1 : 0);
