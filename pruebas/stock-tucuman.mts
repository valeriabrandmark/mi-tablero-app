import { resumenStockTucuman } from "@/lib/stock-tucuman";
import type { PuntoStockTucuman } from "@/lib/types";

/* ===========================================================================
   EL RESUMEN DE LA SERIE DE STOCK DE TUCUMAN

   POR QUE ESTO SE PRUEBA

   La serie de Tucuman arranca el 10/11/2026 y el grafico abarca TODO el rango
   filtrado, que puede ser de mayo. O sea que lo normal, durante meses, va a
   ser una serie casi toda en `null` con dos o tres dias al final.

   Eso convierte a los nulos en el caso COMUN y no en el borde raro. Y el error
   facil --tratarlos como cero-- no rompe nada: devuelve numeros perfectamente
   creibles y equivocados. "El deposito tiene 1.300 unidades promedio" cuando
   en realidad tiene 128.000 y lo que pasa es que 188 dias no se midieron.

   Las tres cosas que se fijan:

   1. QUE LOS NULOS NO CUENTEN COMO CERO en ninguna cuenta.
   2. QUE LA ULTIMA SEA LA ULTIMA CON FOTO, no el ultimo dia del rango --que
      casi siempre es un dia sin foto, porque el rango termina donde termina la
      venta y la foto puede faltar justo ahi.
   3. QUE LA VARIACION COMPARE LAS DOS ULTIMAS FOTOS, aunque no sean dias
      consecutivos. Un sabado sin corrida no tiene que inventar una caida.
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

/** Un dia sin foto. */
const vacio = (fecha: string): PuntoStockTucuman => ({
  fecha,
  unidades: null,
  skus: null,
});

/** Un dia con foto. */
const foto = (
  fecha: string,
  unidades: number,
  skus = 100,
): PuntoStockTucuman => ({ fecha, unidades, skus });

/* --- EL CASO REAL DE HOY -------------------------------------------------- */

// Un rango largo con foto solo en los dos ultimos dias, que es exactamente lo
// que se ve el 11/11/2026.
{
  const serie = [
    vacio("2026-11-07"),
    vacio("2026-11-08"),
    vacio("2026-11-09"),
    foto("2026-11-10", 131294, 2585),
    foto("2026-11-11", 128420, 2579),
  ];
  const r = resumenStockTucuman(serie);
  revisar("cuenta los dias con foto", r.conFoto, 2);
  revisar("y los dias del rango", r.dias, 5);
  revisar("la ultima foto es la del 11", r.ultima?.fecha, "2026-11-11");
  revisar("con sus unidades", r.ultima?.unidades, 128420);
  revisar("la variacion es contra la foto anterior", r.variacion, -2874);
}

/* --- 1. LOS NULOS NO SON CEROS ------------------------------------------- */

// Si alguien reescribe esto con `?? 0`, esta es la que se rompe: con nulos
// tratados como cero, conFoto daria 5 y la variacion -131.294.
{
  const serie = [
    foto("2026-11-10", 131294),
    vacio("2026-11-11"),
    vacio("2026-11-12"),
  ];
  const r = resumenStockTucuman(serie);
  revisar("un nulo despues de una foto no cuenta", r.conFoto, 1);
  revisar("la ultima sigue siendo la foto", r.ultima?.fecha, "2026-11-10");
  revisar("y no hay variacion con una sola foto", r.variacion, null);
}

/* --- 2. LA ULTIMA ES LA ULTIMA CON FOTO ---------------------------------- */

// El rango termina donde termina la venta, y la foto de ese dia puede no
// existir todavia (el paso corre mas tarde). Mirar el ultimo elemento del
// arreglo daria null justo el dia que alguien abre el tablero a la mañana.
{
  const serie = [foto("2026-11-10", 500), foto("2026-11-11", 400), vacio("2026-11-12")];
  const r = resumenStockTucuman(serie);
  revisar("saltea el dia sin foto del final", r.ultima?.fecha, "2026-11-11");
  revisar("y la variacion usa las dos fotos", r.variacion, -100);
}

/* --- 3. LAS DOS ULTIMAS FOTOS, AUNQUE NO SEAN SEGUIDAS ------------------- */

// Un fin de semana sin corrida deja un hueco en el medio. La variacion tiene
// que ser entre las dos fotos que hay, no inventar una caida contra el hueco.
{
  const serie = [
    foto("2026-11-06", 1000),
    vacio("2026-11-07"),
    vacio("2026-11-08"),
    foto("2026-11-09", 1200),
  ];
  const r = resumenStockTucuman(serie);
  revisar("el hueco del medio no corta la comparacion", r.variacion, 200);
  revisar("y los dias con foto son dos", r.conFoto, 2);
}

/* --- LOS BORDES ---------------------------------------------------------- */

{
  const r = resumenStockTucuman([]);
  revisar("serie vacia", r, { conFoto: 0, dias: 0, ultima: null, variacion: null });
}

{
  const r = resumenStockTucuman([vacio("2026-05-07"), vacio("2026-05-08")]);
  revisar("todo sin foto no tiene ultima", r.ultima, null);
  revisar("ni variacion", r.variacion, null);
  revisar("pero los dias del rango se cuentan igual", r.dias, 2);
}

// UN CERO SI ES UN DATO: el deposito vacio es una foto, no un hueco. Tiene que
// contar como foto y poder ser la ultima.
{
  const r = resumenStockTucuman([foto("2026-11-10", 300), foto("2026-11-11", 0, 0)]);
  revisar("un cero cuenta como foto", r.conFoto, 2);
  revisar("y puede ser la ultima", r.ultima?.unidades, 0);
  revisar("con su variacion", r.variacion, -300);
}

// Dos fotos iguales: variacion cero, que NO es lo mismo que null.
{
  const r = resumenStockTucuman([foto("2026-11-10", 700), foto("2026-11-11", 700)]);
  revisar("sin movimiento la variacion es 0 y no null", r.variacion, 0);
}

console.log(
  FALLOS.length ? `\n${FALLOS.length} FALLARON: ${FALLOS.join(", ")}` : "\nTODO OK",
);
process.exit(FALLOS.length ? 1 : 0);
