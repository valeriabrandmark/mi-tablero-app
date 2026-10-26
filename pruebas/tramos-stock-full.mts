/**
 * Los tramos de "Stock Full · días sin venta". Sin base y sin navegador.
 *
 * LO QUE IMPORTA QUE NO SE ROMPA es la partición del "nunca vendió", que es la
 * única regla de este archivo que no se ve cuando está mal:
 *
 *   Un artículo sin ventas puede ser el peor caso de la pantalla --está hace
 *   cinco meses y no se movió-- o ninguno --llegó la semana pasada. Los dos
 *   dicen "nunca vendió" y antes caían en la misma barra. Si el corte se
 *   corriera, o si los que no tienen fecha confiable se colaran en "parado",
 *   la pantalla seguiría dibujando ocho barras llenas y nadie se enteraría:
 *   el error se ve recién cuando alguien retira mercadería que acababa de
 *   mandar.
 *
 *     node --experimental-strip-types --import ./pruebas/registrar.mjs pruebas/tramos-stock-full.mts
 */

import { NOMBRES_PLAZO, NOMBRES_RECOMENDACION } from "@/lib/reposicion-full";
import {
  DIAS_PARA_PARADO,
  esTramoNunca,
  limitesDelTramo,
  TRAMOS,
  tramoDe,
} from "@/lib/stock-full";

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

// --- Los tramos de siempre, que no se tenían que mover --------------------

revisar("vendió hoy", tramoDe(0), "0-5");
revisar("5 días es el borde de abajo", tramoDe(5), "0-5");
revisar("6 ya es el siguiente", tramoDe(6), "6-10");
revisar("20 es el último tramo normal", tramoDe(20), "16-20");
revisar("21 cae en 21+", tramoDe(21), "21+");
revisar("500 también", tramoDe(500), "21+");

// Que haya vendido manda sobre todo lo demás: los días en Full no se miran.
revisar(
  "si vendió, los días en Full no cambian nada",
  tramoDe(3, 500, true),
  "0-5",
);

// --- La partición del "nunca vendió" --------------------------------------

revisar(
  "nunca vendió y está hace 60 días: parado",
  tramoDe(null, 60, true),
  "nunca-parado",
);
revisar(
  "nunca vendió y está hace 59: todavía no",
  tramoDe(null, 59, true),
  "nunca-nuevo",
);
revisar(
  "nunca vendió y llegó hace una semana: recién llegado",
  tramoDe(null, 7, true),
  "nunca-nuevo",
);
revisar(
  "nunca vendió y está hace cinco meses: parado",
  tramoDe(null, 164, true),
  "nunca-parado",
);

// EL CASO QUE NO SE PUEDE AFIRMAR. 60 días sería "parado", pero la fecha es un
// piso y no una medición: el artículo ya estaba la primera vez que miramos.
// Meterlo en "parado" sería afirmar algo que no medimos.
revisar(
  "con fecha dudosa no entra en parado aunque el número alcance",
  tramoDe(null, 60, false),
  "nunca-sindato",
);
revisar(
  "con fecha dudosa tampoco entra en recién llegado",
  tramoDe(null, 10, false),
  "nunca-sindato",
);
revisar("sin ninguna fecha, sin dato", tramoDe(null, null, true), "nunca-sindato");
revisar("sin nada de nada, sin dato", tramoDe(null), "nunca-sindato");

// El corte sale de la constante y no de un 60 escrito acá: si alguien lo mueve,
// esta prueba lo sigue en vez de empezar a fallar por el motivo equivocado.
revisar(
  "el corte es el de la constante",
  [tramoDe(null, DIAS_PARA_PARADO, true), tramoDe(null, DIAS_PARA_PARADO - 1, true)],
  ["nunca-parado", "nunca-nuevo"],
);

// --- Los tramos y sus límites ---------------------------------------------

// Todo tramo que no sea "nunca" tiene límites, y los tres "nunca" no: es lo que
// usa el filtro para saber cuáles trata como rango y cuáles aparte.
const sinLimites = TRAMOS.filter((t) => limitesDelTramo(t.clave) == null).map(
  (t) => t.clave,
);
revisar("sólo los «nunca» quedan fuera del rango de días", sinLimites, [
  "nunca-parado",
  "nunca-nuevo",
  "nunca-sindato",
]);

revisar("esTramoNunca reconoce los tres", TRAMOS.filter((t) => esTramoNunca(t.clave)).length, 3);

// Los límites tienen que cubrir la recta sin huecos ni solapes: si "6 a 10"
// empezara en 5, un artículo de 5 días caería en dos barras a la vez.
revisar("0-5 va de 0 a 5", limitesDelTramo("0-5"), { desde: 0, hasta: 5 });
revisar("6-10 arranca donde termina el anterior", limitesDelTramo("6-10"), { desde: 6, hasta: 10 });
revisar("11-15", limitesDelTramo("11-15"), { desde: 11, hasta: 15 });
revisar("16-20", limitesDelTramo("16-20"), { desde: 16, hasta: 20 });
revisar("21+ no tiene techo", limitesDelTramo("21+"), { desde: 21, hasta: null });

// Y que cada día caiga en EL tramo que sus límites dicen, no en otro. Recorre
// la recta entera en vez de probar los bordes a mano.
let desacuerdo: string | null = null;
for (let d = 0; d <= 400; d++) {
  const clave = tramoDe(d);
  const lim = limitesDelTramo(clave);
  if (lim == null || d < lim.desde || (lim.hasta != null && d > lim.hasta)) {
    desacuerdo = `${d} días cae en ${clave}, que no lo contiene`;
    break;
  }
}
revisar("cada día cae en el tramo que sus límites dicen", desacuerdo, null);

// --- Las etiquetas ---------------------------------------------------------

// El gráfico usa `corto` y lo busca de vuelta por `corto` para saber qué se
// clickeó: si dos tramos compartieran uno, el click filtraría el equivocado.
revisar(
  "las etiquetas cortas son únicas",
  new Set(TRAMOS.map((t) => t.corto)).size,
  TRAMOS.length,
);
revisar(
  "las etiquetas largas también",
  new Set(TRAMOS.map((t) => t.label)).size,
  TRAMOS.length,
);

/* --- LOS NOMBRES DE LA REPOSICION ----------------------------------------

   La columna "Envio a Full" muestra lo que contesta la API de Mercado Libre.
   Lo que no este traducido sale con el nombre crudo en ingles -- a proposito,
   para que un codigo nuevo se vea en vez de esconderse, que es justo como
   aparecio NO_REPLENISHMENT en pantalla el 26/10/2026.

   Esta prueba fija los tres que la cuenta contesta HOY. Si manana aparece uno
   nuevo no va a fallar nada (ni tiene que fallar: el crudo es la red), pero
   estos tres no pueden volver a salir en ingles sin que alguien se entere.
   ------------------------------------------------------------------------ */

const LOS_TRES = [
  "NO_REPLENISHMENT",
  "REPLENISH",
  "NO_REPLENISHMENT_BY_RESTRICTION",
];

for (const codigo of LOS_TRES) {
  const nombre = NOMBRES_RECOMENDACION[codigo];
  revisar(`${codigo} tiene nombre`, typeof nombre === "string" && nombre.length > 0, true);
  revisar(`y no es el codigo crudo`, nombre === codigo, false);
}

// LOS PLAZOS QUE LA CUENTA DEVUELVE, por lo mismo.
for (const plazo of ["THIS_WEEK", "NEXT_WEEK", "IN_TWO_WEEKS", "NOT_REPLENISHMENT_NEEDED"]) {
  revisar(`el plazo ${plazo} tiene nombre`, Boolean(NOMBRES_PLAZO[plazo]), true);
}

console.log(FALLOS.length ? `\n${FALLOS.length} FALLARON: ${FALLOS.join(", ")}` : "\nTODO OK");
process.exit(FALLOS.length ? 1 : 0);
