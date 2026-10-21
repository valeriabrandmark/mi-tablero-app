/**
 * El número de orden que devuelve Sigma al cargar una OC. Sin red.
 *
 * ---------------------------------------------------------------------------
 * POR QUE EXISTE
 *
 * Hasta ahora la orden vivía con dos identidades que no se conocían entre sí:
 * un número en Sigma que nosotros no veíamos, y un id en el tablero que Sigma
 * no veía. Pedido de ANA: poder nombrar la misma orden de los dos lados.
 *
 * El changelog de Sigma del 09/09/2026 dice que `ImportOrdenDeCompra` pasó a
 * devolver 200 con "Orden de compra importada correctamente. OC Nro: <n>".
 * Pero las órdenes que mandamos después --incluidas las del 19 y 20 de
 * octubre-- vuelven con el cuerpo VACIO. O no está desplegado en la instancia
 * de Quo, o el número viaja en un header.
 *
 * Por eso esto busca en los dos lados. Y por eso tiene pruebas: el día que el
 * número empiece a venir, tiene que quedar guardado sin que nadie toque nada.
 *
 *     node --experimental-strip-types --import ./pruebas/registrar.mjs pruebas/numero-oc-sigma.mts
 */

import { numeroDeOrdenSigma } from "@/lib/sigma-orden";

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

// --- El mensaje tal como lo documenta Sigma -------------------------------

revisar(
  "el mensaje de la documentación",
  numeroDeOrdenSigma("Orden de compra importada correctamente. OC Nro: 371"),
  "371",
);

// La API convive con dos formatos --texto plano y {"message": "..."}-- y este
// endpoint ya cambió de forma una vez. Buscar en el texto crudo funciona con
// los dos: un JSON también es texto.
revisar(
  "el mismo mensaje dentro de un JSON",
  numeroDeOrdenSigma(
    '{"message":"Orden de compra importada correctamente. OC Nro: 00000371"}',
  ),
  "00000371",
);

// Variantes de puntuación, porque el mensaje exacto lo escribe otro sistema.
revisar("sin dos puntos", numeroDeOrdenSigma("OC Nro 1234"), "1234");
revisar("con punto", numeroDeOrdenSigma("OC Nro.: 1234"), "1234");
revisar("en minúscula", numeroDeOrdenSigma("oc nro: 1234"), "1234");
revisar("con espacios de más", numeroDeOrdenSigma("OC   Nro :  1234  "), "1234");

// --- Cuándo NO hay número -------------------------------------------------
//
// Es el caso de HOY: las 37 órdenes que mandamos vuelven con el cuerpo vacío.
// Tiene que dar null y no inventar nada: un número equivocado al lado de una
// orden es peor que ninguno.

revisar("el cuerpo vacío no inventa un número", numeroDeOrdenSigma(""), null);
revisar(
  "un error tampoco",
  numeroDeOrdenSigma("Query with RESPONSE_CODE returned no rows"),
  null,
);
revisar(
  "ni un texto con números que no es el mensaje",
  numeroDeOrdenSigma("La orden 1234 ya existe"),
  null,
);

// --- Los headers ----------------------------------------------------------
//
// La doc llama al mensaje `RESPONSE_TEXT`, que es el nombre de una variable de
// su procedimiento y no necesariamente el cuerpo HTTP. Si viaja en un header,
// está acá.

revisar(
  "el número en un header",
  numeroDeOrdenSigma("", { "x-response-text": "OC Nro: 982" }),
  "982",
);
revisar(
  "revisa todos los headers, no sólo el primero",
  numeroDeOrdenSigma("", {
    "content-type": "application/json",
    date: "Tue, 21 Oct 2026 10:00:00 GMT",
    "x-sigma-mensaje": "Orden de compra importada correctamente. OC Nro: 77",
  }),
  "77",
);

// EL CUERPO MANDA SOBRE LOS HEADERS. Si los dos traen algo, el cuerpo es la
// respuesta documentada y el header sería un eco.
revisar(
  "el cuerpo gana",
  numeroDeOrdenSigma("OC Nro: 111", { "x-eco": "OC Nro: 222" }),
  "111",
);

revisar("sin headers no rompe", numeroDeOrdenSigma("sin nada"), null);
revisar(
  "un header vacío no rompe",
  numeroDeOrdenSigma("", { "x-vacio": "" }),
  null,
);

console.log(FALLOS.length ? `\n${FALLOS.length} FALLARON: ${FALLOS.join(", ")}` : "\nTODO OK");
process.exit(FALLOS.length ? 1 : 0);
