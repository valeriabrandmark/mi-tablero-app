/**
 * El promedio móvil de la línea de tendencia. Sin base y sin navegador.
 *
 * LO QUE IMPORTA QUE NO SE ROMPA: que la serie real quede intacta y que la
 * tendencia esté CENTRADA. Un promedio hacia atrás --el de los últimos 7--
 * corre la curva media semana a la derecha, y entonces el pico de un lunes
 * aparece el jueves. Sobre un gráfico que se usa para ubicar CUANDO pasó algo,
 * eso es peor que no tener la línea, y es un error que no se ve: la curva
 * queda igual de linda, sólo que miente la fecha.
 *
 *     node --experimental-strip-types --import ./pruebas/registrar.mjs pruebas/tendencia.mts
 */

import { promedioMovil, PUNTOS_PARA_TENDENCIA } from "@/lib/format";

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

const n = (xs: number[]) => xs.map((venta) => ({ venta }));

// --- Una serie plana queda plana ------------------------------------------
revisar(
  "todo igual da lo mismo",
  promedioMovil(n([10, 10, 10, 10, 10]), (d) => d.venta, 3),
  [10, 10, 10, 10, 10],
);

// --- EL CENTRADO, que es lo que no se puede romper -------------------------
//
// Un solo pico en el medio. Con ventana 3, la media reparte ese pico en el
// punto anterior, el pico y el siguiente --simétrico. Con un promedio hacia
// atrás, el reparto caería en el pico y los DOS siguientes.
{
  const serie = n([0, 0, 30, 0, 0]);
  const media = promedioMovil(serie, (d) => d.venta, 3);
  revisar("el pico se reparte parejo", media, [0, 10, 10, 10, 0]);
  revisar(
    "el máximo de la tendencia cae en el mismo índice que el del dato",
    media.indexOf(Math.max(...media)) === 2 || media[2] === Math.max(...media),
    true,
  );
}

// --- Las puntas promedian con lo que hay, no quedan en null ----------------
{
  const media = promedioMovil(n([6, 0, 0, 0, 0, 0, 0]), (d) => d.venta, 7);
  revisar("ninguna punta queda vacía", media.every((v) => typeof v === "number"), true);
  // El primer punto mira 3 para atrás --no hay-- y 3 para adelante: 4 valores.
  revisar("la primera punta promedia sobre lo que existe", media[0], 6 / 4);
}

// --- NO TOCA LA SERIE REAL -------------------------------------------------
{
  const serie = n([1, 2, 3]);
  const copia = JSON.parse(JSON.stringify(serie));
  promedioMovil(serie, (d) => d.venta, 3);
  revisar("la serie de entrada queda igual", serie, copia);
}

// --- La suma total se conserva aproximadamente ----------------------------
//
// No es exacta por las puntas, pero si la tendencia sumara el doble o la mitad
// que la serie real, estaría mostrando otra magnitud.
{
  const serie = n([5, 12, 3, 20, 8, 1, 14, 9, 11, 2, 17, 6, 13, 4]);
  const total = serie.reduce((a, d) => a + d.venta, 0);
  const totalMedia = promedioMovil(serie, (d) => d.venta).reduce((a, v) => a + v, 0);
  revisar("la tendencia suma parecido a la serie", Math.abs(totalMedia / total - 1) < 0.15, true);
}

// --- Casos de borde --------------------------------------------------------
revisar("una serie vacía no rompe", promedioMovil([], () => 0), []);
revisar("un solo punto se devuelve igual", promedioMovil(n([7]), (d) => d.venta), [7]);
revisar(
  "los nulos cuentan como cero y no como NaN",
  promedioMovil([{ venta: NaN }, { venta: 4 }], (d) => d.venta, 3),
  [2, 2],
);

// --- El umbral -------------------------------------------------------------
revisar("el umbral son dos semanas", PUNTOS_PARA_TENDENCIA, 14);

console.log(FALLOS.length ? `\n${FALLOS.length} FALLARON: ${FALLOS.join(", ")}` : "\nTODO OK");
process.exit(FALLOS.length ? 1 : 0);
