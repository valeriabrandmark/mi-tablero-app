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

import { partirValorSellIn, valorSellIn } from "@/lib/compras";

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

console.log(FALLOS.length ? `\n${FALLOS.length} FALLARON: ${FALLOS.join(", ")}` : "\nTODO OK");
process.exit(FALLOS.length ? 1 : 0);
