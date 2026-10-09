/**
 * Pruebas de los links que llevan a Mercado Libre. Sin base y sin red.
 *
 * POR QUÉ EXISTE. Ninguno de estos patrones está documentado por Mercado
 * Libre, así que son lo más frágil del tablero de CRM: el día que ML cambie
 * una URL, acá se ve qué tiene que devolver cada función y se arregla en un
 * lugar.
 *
 * Lo que más se cuida es el caso vacío. Un link armado con un id que no
 * existe manda a una página en blanco, que es peor que no ofrecer el link:
 * la persona hizo clic, perdió el contexto y no se enteró de por qué. Por eso
 * todas devuelven `null` cuando no pueden armar algo válido, y el componente
 * muestra texto pelado en vez de un enlace muerto.
 *
 *     node --experimental-strip-types --import ./pruebas/registrar.mjs pruebas/enlaces-meli.mts
 */

import {
  dominio,
  enlaceMensajes,
  enlacePregunta,
  enlacePublicacion,
  enlaceReclamo,
  enlaceVenta,
} from "@/lib/enlaces-meli";

const FALLOS: string[] = [];

function revisar(nombre: string, ok: boolean, detalle = "") {
  console.log(ok ? `OK  ${nombre}` : `MAL ${nombre}${detalle ? `\n     ${detalle}` : ""}`);
  if (!ok) FALLOS.push(nombre);
}

// --- El dominio sale del site_id del reclamo ------------------------------

revisar("MLA es Argentina", dominio("MLA") === "mercadolibre.com.ar");
revisar("MLB es Brasil", dominio("MLB") === "mercadolivre.com.br");
revisar("sin sitio, Argentina", dominio(null) === "mercadolibre.com.ar");
revisar("un sitio desconocido no rompe", dominio("XXX") === "mercadolibre.com.ar");

// --- La venta --------------------------------------------------------------

revisar(
  "la venta lleva la orden",
  enlaceVenta("2000018876214156") ===
    "https://mercadolibre.com.ar/ventas/2000018876214156/detalle",
  String(enlaceVenta("2000018876214156")),
);
revisar("sin orden no hay link", enlaceVenta(null) === null);
revisar("con orden vacía tampoco", enlaceVenta("") === null);

// --- El reclamo cae en la venta, a propósito -------------------------------
//
// Mercado Libre no publica una URL de reclamo. Mientras no esté confirmada,
// el link lleva a la venta --desde donde se llega al reclamo en un clic-- y
// no a una URL inventada.

revisar(
  "el reclamo cae en la venta mientras no haya URL propia",
  enlaceReclamo("2000018876214156") === enlaceVenta("2000018876214156"),
);
revisar("y sin orden, tampoco hay link", enlaceReclamo(null) === null);

// --- Los mensajes van por PACK ---------------------------------------------

revisar(
  "los mensajes van por pack",
  enlaceMensajes("2000018876214156") ===
    "https://mercadolibre.com.ar/mensajes/2000018876214156",
);
revisar("sin pack no hay link", enlaceMensajes(undefined) === null);

// --- La publicación: la única confiable ------------------------------------
//
// El guión entre el prefijo del país y el número no es decorativo: sin él la
// URL no resuelve. Los ids vienen de la API todo junto, "MLA123456789".

revisar(
  "el id se parte con guión",
  enlacePublicacion("MLA123456789") ===
    "https://articulo.mercadolibre.com.ar/MLA-123456789",
  String(enlacePublicacion("MLA123456789")),
);
revisar(
  "en minúscula también",
  enlacePublicacion("mla123456789") ===
    "https://articulo.mercadolibre.com.ar/MLA-123456789",
);
revisar("con espacios de más", enlacePublicacion("  MLA123456789 ") !== null);
revisar(
  "el dominio del artículo sigue al sitio",
  enlacePublicacion("MLB123", "MLB") === "https://articulo.mercadolivre.com.br/MLB-123",
);

// Un id con otra forma NO arma link. Es la diferencia entre "no te puedo
// llevar" y mandar a una página que no existe.
revisar("un id sin números no arma link", enlacePublicacion("MLA") === null);
revisar("un id con guión adentro no arma link", enlacePublicacion("MLA-123") === null);
revisar("texto cualquiera no arma link", enlacePublicacion("hola") === null);
revisar("vacío no arma link", enlacePublicacion("") === null);
revisar("null no arma link", enlacePublicacion(null) === null);

// --- La pregunta se contesta en la publicación -----------------------------

revisar(
  "la pregunta cae en la publicación",
  enlacePregunta("MLA123456789") === enlacePublicacion("MLA123456789"),
);
revisar("una pregunta sin publicación no arma link", enlacePregunta(null) === null);

console.log(FALLOS.length ? `\n${FALLOS.length} FALLARON: ${FALLOS.join(", ")}` : "\nTODO OK");
process.exit(FALLOS.length ? 1 : 0);
