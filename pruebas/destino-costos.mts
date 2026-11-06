import { problemaDelDestino, hoyEnArgentina } from "@/lib/destino-costos";
import { limitesMesComercial } from "@/lib/constantes";

/* ===========================================================================
   A DÓNDE VA EL TRAMO DE COSTOS: MES COMERCIAL Y VIGENCIA

   POR QUÉ ESTO TIENE PRUEBAS

   El botón de actualizar costos escribía siempre en el mes vigente con
   vigencia HOY. Eso falla justo el día que la lista del mes nuevo llega tarde:
   el 6 cerró octubre, la lista de noviembre se carga el 7, y los días 6 y 7
   quedan costeados con la lista vieja porque el tramo arranca el día en que se
   cargó y no el día desde el que vale.

   Ahora son dos datos. Y separarlos abre dos formas de equivocarse que NO DAN
   ERROR EN NINGUNA PARTE:

   1. UNA VIGENCIA POSTERIOR AL CIERRE no rige para ninguna venta de ese mes.
      `costo_vigente` busca el último tramo que ya había arrancado; uno que
      arranca después de que el mes terminó no arranca nunca. El tramo queda
      escrito, la pantalla dice "listo" y los costos no cambian. Nadie lo
      encuentra hasta que alguien pregunta por un margen raro.

   2. EL MES DEDUCIDO DE LA FECHA. Si el mes saliera de la vigencia, cargar la
      lista de noviembre con vigencia 05/11 la escribiría en el mes comercial
      OCTUBRE --el 5 todavía es octubre-- y noviembre seguiría sin lista. Es
      exactamente el bug del 06/11/2026, pero al revés.

   Estas pruebas fijan el rango de cada mes comercial, los cierres movidos y
   que por omisión no cambie nada.
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

function bien(nombre: string, mes: string, vigenteDesde: string) {
  revisar(nombre, problemaDelDestino({ mes, vigenteDesde }), null);
}

function mal(nombre: string, mes: string, vigenteDesde: string) {
  const p = problemaDelDestino({ mes, vigenteDesde });
  revisar(nombre, typeof p === "string" && p.length > 0, true);
}

/* --- LOS DOS CASOS REALES ------------------------------------------------ */

// LA LISTA DEL MES NUEVO. Noviembre comercial va del 06/11 al 05/12.
bien("la lista del mes, desde el primer dia", "2026-11", "2026-11-06");

// UN CAMBIO A MITAD DE MES: un proveedor aumenta el 16.
bien("un tramo a mitad de mes", "2026-11", "2026-11-16");

// Y el último día del mes comercial, que cae en el mes calendario siguiente.
bien("el ultimo dia del mes comercial", "2026-11", "2026-12-05");

/* --- EL CASO 1: UNA VIGENCIA QUE NO RIGE PARA NADA ---------------------- */

// El 06/12 ya es diciembre comercial: un tramo de noviembre con esa vigencia
// no le aplica a ninguna venta de noviembre.
mal("un dia despues del cierre no rige", "2026-11", "2026-12-06");
mal("un mes entero despues tampoco", "2026-11", "2027-01-10");

/* --- EL CASO 2: LA FECHA QUE PARECE DEL MES Y NO LO ES ------------------ */

// 05/11 es el ÚLTIMO día de octubre comercial. Para el mes 2026-11 no aplica.
// Es la prueba de que los dos datos van separados: si el mes se dedujera de la
// fecha, esto se escribiría en octubre sin que nadie lo note.
mal("el 05/11 no pertenece al mes comercial 2026-11", "2026-11", "2026-11-05");

// Y al revés: para octubre comercial, el 05/11 es perfectamente válido.
bien("el 05/11 SI pertenece al mes comercial 2026-10", "2026-10", "2026-11-05");

/* --- LOS CIERRES MOVIDOS ------------------------------------------------ */

// Agosto 2026 cerró el 06/09 y no el 05/09 (ver CIERRES_MES_COMERCIAL), así
// que septiembre arranca el 07/09. Esto no se puede calcular de memoria, y es
// justo donde el atajo "el mes arranca el 6" da la fecha equivocada.
revisar(
  "agosto 2026 cierra el 06/09",
  limitesMesComercial("2026-08"),
  { desde: "2026-08-06", hasta: "2026-09-06" },
);
revisar(
  "y septiembre arranca el 07/09",
  limitesMesComercial("2026-09"),
  { desde: "2026-09-07", hasta: "2026-10-05" },
);
bien("el 06/09 todavia es agosto comercial", "2026-08", "2026-09-06");
mal("el 06/09 NO es septiembre comercial", "2026-09", "2026-09-06");
bien("septiembre arranca el 07", "2026-09", "2026-09-07");

/* --- LO QUE ESTA MAL ESCRITO -------------------------------------------- */

mal("mes con formato de fecha", "2026-11-06", "2026-11-06");
mal("mes al reves", "11-2026", "2026-11-06");
mal("mes vacio", "", "2026-11-06");
mal("mes 00", "2026-00", "2026-11-06");
mal("mes 13", "2026-13", "2026-11-06");
mal("fecha sin dia", "2026-11", "2026-11");
mal("fecha vacia", "2026-11", "");
mal("fecha en DD/MM/AAAA", "2026-11", "06/11/2026");

/* --- EL MENSAJE TIENE QUE ALCANZAR PARA ARREGLARLO ---------------------- */

// Un error que no dice el rango obliga a ir a buscar cuándo cierra el mes, y
// con los cierres movidos eso no se sabe de memoria. El mensaje trae las dos
// puntas y la fecha que habría que poner.
const mensaje = problemaDelDestino({ mes: "2026-11", vigenteDesde: "2026-12-20" });
revisar("el mensaje dice desde cuando", mensaje?.includes("06/11/2026"), true);
revisar("y hasta cuando", mensaje?.includes("05/12/2026"), true);

/* --- POR OMISION NO CAMBIA NADA ----------------------------------------- */

// `hoyEnArgentina` es lo que se usa cuando no se elige vigencia, y lee la hora
// de Buenos Aires y no la del servidor: en Vercel el servidor corre en UTC, y
// entre las 21 y las 24 de Argentina daría el día siguiente -- que justo en el
// cambio de mes comercial escribiría el tramo en el mes equivocado.
revisar(
  "las 23 de Argentina siguen siendo el mismo dia",
  hoyEnArgentina(new Date("2026-11-07T02:30:00Z")), // 23:30 del 06 en Argentina
  "2026-11-06",
);
revisar(
  "y las 02 UTC del dia siguiente tambien",
  hoyEnArgentina(new Date("2026-11-06T02:00:00Z")), // 23:00 del 05 en Argentina
  "2026-11-05",
);
revisar(
  "al mediodia no hay duda",
  hoyEnArgentina(new Date("2026-11-06T15:00:00Z")),
  "2026-11-06",
);

console.log(
  FALLOS.length ? `\n${FALLOS.length} FALLARON: ${FALLOS.join(", ")}` : "\nTODO OK",
);
process.exit(FALLOS.length ? 1 : 0);
