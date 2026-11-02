import { fmtFechaHora } from "@/lib/format";

/* ===========================================================================
   LA FECHA CON HORA DE LAS TABLAS DE MERCADO LIBRE

   Son cuatro líneas de código y una decisión que no se ve: NO construye un
   `Date`.

   La hora llega ya convertida a la de Buenos Aires por el servidor --en el SQL,
   con `at time zone`-- porque la tabla tiene que decir la misma hora para todos
   los que la miren. Si acá se hiciera `new Date(valor)`, el navegador la
   volvería a interpretar según su propio huso y la correría de nuevo. Y un
   corrimiento de tres horas en una tabla de ventas no se lee como un error de
   formato: se lee como que vendimos de madrugada.

   Por eso se parte el texto, igual que `fmtFechaCorta` y `fmtFechaCortaConAnio`.
   ========================================================================= */

const FALLOS: string[] = [];

function revisar(nombre: string, obtenido: unknown, esperado: unknown) {
  const ok = obtenido === esperado;
  console.log(
    ok
      ? `OK  ${nombre}`
      : `MAL ${nombre}\n     esperado: ${JSON.stringify(esperado)}\n     obtenido: ${JSON.stringify(obtenido)}`,
  );
  if (!ok) FALLOS.push(nombre);
}

/* --- LO QUE MANDA EL SERVIDOR -------------------------------------------- */

revisar("fecha y hora", fmtFechaHora("2026-10-31 14:07"), "31/10/26 14:07");
revisar("medianoche no se pierde", fmtFechaHora("2026-05-06 00:04"), "06/05/26 00:04");
revisar("la ultima del dia", fmtFechaHora("2026-11-01 21:52"), "01/11/26 21:52");

// Los segundos se tiran: en una tabla no aportan y alargan la columna.
revisar("se corta en los minutos", fmtFechaHora("2026-10-31 14:07:33"), "31/10/26 14:07");

// Con T en el medio también, por si alguna consulta devuelve ISO.
revisar("acepta el separador T", fmtFechaHora("2026-10-31T14:07"), "31/10/26 14:07");

/* --- SIN HORA NO SE INVENTA UNA ------------------------------------------ */

// Una orden sin hora es un dato que falta. Escribir "00:00" la haría pasar por
// medianoche, que es una hora como cualquier otra y además una hora rara: el
// que mire la tabla concluiría algo sobre cuándo se vendió.
revisar("solo fecha queda solo fecha", fmtFechaHora("2026-10-31"), "31/10/26");

/* --- LO QUE NO HAY SE DICE QUE NO HAY ------------------------------------ */

revisar("null", fmtFechaHora(null), "—");
revisar("undefined", fmtFechaHora(undefined), "—");
revisar("vacio", fmtFechaHora(""), "—");
revisar("solo espacios", fmtFechaHora("   "), "—");

/* --- NO SE PASA POR Date ------------------------------------------------- */

// LA PRUEBA DE QUE NO HAY CONVERSION DE HUSO: el texto de salida tiene que
// llevar exactamente los dígitos que entraron. Si alguien reescribiera esto con
// `new Date(...).toLocaleString()`, en un navegador fuera de Argentina esta
// prueba pasaría a dar otra hora.
for (const [entra, sale] of [
  ["2026-01-01 00:00", "01/01/26 00:00"],
  ["2026-12-31 23:59", "31/12/26 23:59"],
] as const) {
  revisar(`${entra} sale tal cual`, fmtFechaHora(entra), sale);
}

console.log(FALLOS.length ? `\n${FALLOS.length} FALLARON: ${FALLOS.join(", ")}` : "\nTODO OK");
process.exit(FALLOS.length ? 1 : 0);
