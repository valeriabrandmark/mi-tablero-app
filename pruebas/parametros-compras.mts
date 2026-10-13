/**
 * Que la consulta de Compras reciba tantos parámetros como pide.
 *
 * POR QUE EXISTE. Esto ya rompió la pantalla entera dos veces, y de la peor
 * manera: TypeScript no lo ve --`params` es un `unknown[]`, cualquier largo es
 * válido-- y Postgres no dice qué falta, dice
 *
 *     bind message supplies 5 parameters, but prepared statement "" requires 6
 *
 * y el panel no carga NADA. Las dos veces fue lo mismo: se agregó un parámetro
 * al SQL --el evento, después el mes de los costos-- y alguna de las listas de
 * `params` se quedó corta.
 *
 * La prueba lee el módulo y compara el `$N` más alto que usa el SQL contra la
 * cantidad de parámetros fijos que arma `where()`. Es una prueba de la FORMA
 * del archivo, no de su comportamiento, y por eso es rara; pero es el único
 * lugar donde este error se puede atajar sin una base de datos.
 *
 *     node --experimental-strip-types --import ./pruebas/registrar.mjs pruebas/parametros-compras.mts
 */

import { readFileSync } from "node:fs";

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

const FUENTE = readFileSync("lib/queries-compras.ts", "utf8");

/** El `$N` más alto que aparece en el SQL del módulo. */
function maximoParametro(src: string): number {
  const usos = [...src.matchAll(/\$(\d+)(?:::|\s|\))/g)].map((m) => Number(m[1]));
  return usos.length ? Math.max(...usos) : 0;
}

/**
 * Cuántos parámetros FIJOS empuja `where()` antes de los de la persona.
 *
 * Son las líneas con un valor a cuatro espacios de sangría dentro del
 * `const params: unknown[] = [...]`. Los comentarios no cuentan.
 */
function parametrosFijos(src: string): number {
  const desde = src.indexOf("const params: unknown[] = [");
  if (desde < 0) throw new Error("no se encontró el `params` de where()");
  const bloque = src.slice(desde);
  const cuerpo = bloque.slice(0, bloque.indexOf("];"));
  return cuerpo.split("\n").filter((l) => /^ {4}[A-Za-z_]/.test(l)).length;
}

const pide = maximoParametro(FUENTE);
const da = parametrosFijos(FUENTE);

revisar("el SQL usa al menos un parámetro", pide > 0, true);
revisar(`where() da los ${pide} que el SQL pide`, da, pide);

// Y que los armen en UN solo lugar: si vuelve a aparecer una lista de
// parámetros escrita a mano, esta prueba lo dice antes que Postgres.
const aMano = FUENTE.split("\n").filter((l) =>
  /^\s*(const|let)\s+params\s*(:|=)/.test(l),
).length;
revisar("hay una sola lista de parámetros", aMano, 1);

console.log(FALLOS.length ? `\n${FALLOS.length} FALLARON: ${FALLOS.join(", ")}` : "\nTODO OK");
process.exit(FALLOS.length ? 1 : 0);
