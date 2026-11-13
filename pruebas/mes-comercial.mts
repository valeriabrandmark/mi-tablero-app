import {
  limitesMesComercial,
  mesComercialActual,
  mesComercialAnterior,
} from "@/lib/constantes";

/* ===========================================================================
   EL MES COMERCIAL VA DEL 6 AL 5

   POR QUE ESTO TIENE PRUEBAS, Y POR QUE ESTAS

   El 13/11/2026 la pantalla de Compras decia "sin venta" para GE07009 en la
   columna "Rent. oct 2026". El articulo habia vendido 60 unidades en octubre
   comercial... todas entre el 2 y el 5 de NOVIEMBRE. En octubre calendario no
   vendio ni una.

   La consulta medía "el mes pasado" con date_trunc('month'), o sea el mes
   calendario, mientras el rotulo decía el mes comercial. Medido sobre la base:
   de 2.233 articulos con venta, 236 pasaban de "sin venta" a tener numero, 149
   al reves y 1.185 cambiaban de valor. El 70% de la columna estaba mal.

   NO FALLABA NADA. Cada numero era plausible, y "sin venta" para un articulo
   que vende es la clase de dato que lleva a NO comprar algo que se esta
   vendiendo.

   Lo que se fija acá es la regla que hace que eso no vuelva: que el mes
   comercial sea del 6 al 5, que el anterior sea el anterior COMERCIAL, y que
   los dos respeten los cierres que se movieron -- que es lo que ninguna cuenta
   de fechas improvisada puede hacer.
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

/** Mediodía UTC: en Argentina (UTC-3) sigue siendo el mismo día. */
const dia = (iso: string) => new Date(`${iso}T12:00:00Z`);

/* --- EL MES CORRIENTE ---------------------------------------------------- */

revisar("el 6 arranca el mes nuevo", mesComercialActual(dia("2026-11-06")), "2026-11");
revisar("el 5 todavia es el anterior", mesComercialActual(dia("2026-11-05")), "2026-10");
revisar("el 1 tambien", mesComercialActual(dia("2026-11-01")), "2026-10");
revisar("y el 30 es del suyo", mesComercialActual(dia("2026-11-30")), "2026-11");

// EL CASO DEL BUG, dicho en una linea: el 02/11 pertenece a octubre.
revisar("el 02/11/2026 es octubre comercial", mesComercialActual(dia("2026-11-02")), "2026-10");

// El salto de año no se rompe.
revisar("el 03/01 es diciembre del año anterior", mesComercialActual(dia("2027-01-03")), "2026-12");
revisar("el 06/01 ya es enero", mesComercialActual(dia("2027-01-06")), "2027-01");

/* --- EL MES QUE ACABA DE CERRAR ------------------------------------------ */

// LA PRUEBA DEL BUG. El 13/11/2026 el mes que cerro es OCTUBRE comercial
// --06/10 a 05/11--, no el 1 al 31 de octubre.
revisar("el 13/11/2026 el mes cerrado es octubre", mesComercialAnterior(dia("2026-11-13")), "2026-10");

// Y antes del 6, el que cerro es el ANTERIOR al calendario anterior. Acá el
// metodo viejo se equivocaba el doble: decía "oct 2026" y medía del 1 al 31 de
// octubre, un rango que ni siquiera habia terminado.
revisar("el 03/11/2026 el mes cerrado es septiembre", mesComercialAnterior(dia("2026-11-03")), "2026-09");
revisar("el 05/11/2026 todavia septiembre", mesComercialAnterior(dia("2026-11-05")), "2026-09");
revisar("el 06/11/2026 ya es octubre", mesComercialAnterior(dia("2026-11-06")), "2026-10");

revisar("en enero el cerrado es diciembre", mesComercialAnterior(dia("2027-01-20")), "2026-12");
revisar("y el 02/01 es noviembre", mesComercialAnterior(dia("2027-01-02")), "2026-11");

/* --- LOS CIERRES QUE SE MOVIERON ----------------------------------------- */

// Agosto 2026 cerro el 06/09 y no el 05/09, asi que septiembre arranca el 07.
// Esto NO se puede calcular de memoria, y es justo lo que una cuenta de fechas
// escrita a mano en una consulta no sabe. Por eso el SQL filtra por la columna
// mes_comercial, que estampa el orquestador con esta misma tabla.
revisar("agosto 2026 va del 06/08 al 06/09", limitesMesComercial("2026-08"), {
  desde: "2026-08-06",
  hasta: "2026-09-06",
});
revisar("y septiembre arranca el 07/09", limitesMesComercial("2026-09"), {
  desde: "2026-09-07",
  hasta: "2026-10-05",
});
revisar("el 06/09/2026 todavia es agosto", mesComercialActual(dia("2026-09-06")), "2026-08");
revisar("el 07/09/2026 ya es septiembre", mesComercialActual(dia("2026-09-07")), "2026-09");
revisar(
  "y el mes cerrado el 07/09/2026 es agosto",
  mesComercialAnterior(dia("2026-09-07")),
  "2026-08",
);

/* --- UN MES NORMAL ------------------------------------------------------- */

revisar("octubre 2026 va del 06/10 al 05/11", limitesMesComercial("2026-10"), {
  desde: "2026-10-06",
  hasta: "2026-11-05",
});
revisar("noviembre 2026 del 06/11 al 05/12", limitesMesComercial("2026-11"), {
  desde: "2026-11-06",
  hasta: "2026-12-05",
});
revisar("diciembre cruza el año", limitesMesComercial("2026-12"), {
  desde: "2026-12-06",
  hasta: "2027-01-05",
});

/* --- LOS DOS CONCUERDAN -------------------------------------------------- */

// Que el primer dia de un mes comercial caiga en ese mes, y el ultimo tambien.
// Si alguna vez `limitesMesComercial` y `mesComercialActual` discreparan, el
// filtro de fechas del tablero traeria un dia de mas o de menos que lo que los
// datos tienen etiquetado.
for (const mes of ["2026-08", "2026-09", "2026-10", "2026-11", "2026-12"]) {
  const { desde, hasta } = limitesMesComercial(mes);
  revisar(`${mes}: su primer dia le pertenece`, mesComercialActual(dia(desde)), mes);
  revisar(`${mes}: su ultimo dia tambien`, mesComercialActual(dia(hasta)), mes);
}

console.log(
  FALLOS.length ? `\n${FALLOS.length} FALLARON: ${FALLOS.join(", ")}` : "\nTODO OK",
);
process.exit(FALLOS.length ? 1 : 0);
