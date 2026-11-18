import { ayudaDelCosto, pesoSobreVentaNeta } from "@/lib/meli";

/* ===========================================================================
   CUANTO PESAN LA COMISION Y EL ENVIO SOBRE LA VENTA NETA

   LAS TARJETAS SE MUESTRAN SOBRE LA VENTA C/IVA, y eso esta bien: Mercado
   Libre cobra la comision como un % del precio publicado, que lleva el IVA
   adentro, asi que sobre c/IVA da la tarifa que ML publica --~13 %-- y sobre
   s/IVA daria un numero que no existe en ningun lado.

   Pero cuando la pregunta es "cuanto me come", el denominador que importa es
   la venta NETA: es con el que se mide el margen y el unico contra el que
   comparar la comision con el costo de la mercaderia tiene sentido. Por eso
   uno va a la vista y el otro en la ayuda.

   LO QUE SE PRUEBA ES EL CASO SIN VENTA. Un recorte sin facturacion no es
   "pesa 0 %": es que no hay sobre que calcularlo. Dividir igual da Infinity o
   NaN, y las dos cosas se imprimen -- "Infinity %", "NaN %" -- o peor, un 0 %
   prolijo que dice justo lo contrario de lo que pasa cuando hay comision y no
   hay facturacion.
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

/* --- LA CUENTA ----------------------------------------------------------- */

// El caso real del 13/11/2026: comision 198.063 sobre una venta neta de
// 854.698 da 23,17 %, contra el 19,15 % que la tarjeta muestra sobre c/IVA.
revisar(
  "la comision sobre la venta neta",
  pesoSobreVentaNeta(198063, 854698)?.toFixed(4),
  "0.2317",
);

revisar("un costo que es la mitad", pesoSobreVentaNeta(50, 100), 0.5);
revisar("y uno que es todo", pesoSobreVentaNeta(100, 100), 1);

// Un costo CERO sobre una venta que existe si es 0 %: ahi el cero es un dato
// --no hubo envios-- y no un hueco.
revisar("costo cero con venta es 0 %", pesoSobreVentaNeta(0, 100), 0);

/* --- SIN VENTA NO HAY PORCENTAJE ----------------------------------------- */

revisar("venta cero devuelve null", pesoSobreVentaNeta(1000, 0), null);
revisar("venta negativa tambien", pesoSobreVentaNeta(1000, -50), null);
revisar("un monto que no es numero", pesoSobreVentaNeta(NaN, 100), null);
revisar("una venta que no es numero", pesoSobreVentaNeta(100, NaN), null);
revisar("infinito tampoco pasa", pesoSobreVentaNeta(100, Infinity), null);

/* --- EL TEXTO DE LA AYUDA ------------------------------------------------ */

{
  const texto = ayudaDelCosto(198063, 854698, "Porque sí.");
  // Sin espacio antes del %: es como escribe `fmtPct`, que es el formateador
  // de todo el tablero. La prueba se ata a lo que de verdad sale.
  revisar("dice el porcentaje sobre la neta", texto.includes("23,17%"), true);
  revisar("y aclara que es sin IVA", texto.includes("sin IVA"), true);
  revisar("y arrastra la explicacion propia", texto.endsWith("Porque sí."), true);
}

// LA PRUEBA QUE IMPORTA. Sin venta, el texto lo DICE en vez de imprimir un
// numero. Si alguien reescribe esto dividiendo sin guarda, acá aparece
// "Infinity %" o "NaN %" y la prueba se rompe.
{
  const texto = ayudaDelCosto(1000, 0, "Porque sí.");
  revisar("sin venta no inventa un porcentaje", /\d/.test(texto.split("Porque")[0]!), false);
  revisar("y lo explica", texto.includes("no hay sobre qué calcular"), true);
  revisar("sin NaN", texto.includes("NaN"), false);
  revisar("ni Infinity", texto.includes("Infinity"), false);
  revisar("y conserva la explicacion propia", texto.endsWith("Porque sí."), true);
}

// Todo en cero --ni venta ni costo-- es el caso de abrir el tablero en un
// recorte vacio, y tiene que decir lo mismo.
{
  const texto = ayudaDelCosto(0, 0, "x");
  revisar("recorte vacio tampoco inventa", texto.includes("no hay sobre qué calcular"), true);
}

console.log(
  FALLOS.length ? `\n${FALLOS.length} FALLARON: ${FALLOS.join(", ")}` : "\nTODO OK",
);
process.exit(FALLOS.length ? 1 : 0);
