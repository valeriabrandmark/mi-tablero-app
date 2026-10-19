/**
 * Que ningún componente de SERVIDOR dibuje una `<Tabla>`.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ESTA PRUEBA EXISTE
 *
 * La pantalla de Posventa devolvía "This page couldn't load" entera, y una de
 * las razones era ésta: `PosventaMeli` no tenía `"use client"` y le pasaba a
 * `Tabla` --que sí es de cliente-- su API entera, que son FUNCIONES: `celda`,
 * `orden`, `clave`. Una función no se puede serializar para mandarla al
 * navegador, así que React corta con
 *
 *     Functions cannot be passed directly to Client Components
 *
 * y como eso pasa al renderizar del lado del servidor, no rompe la tabla: se
 * lleva puesta la página.
 *
 * ---------------------------------------------------------------------------
 * POR QUE NO LO AGARRA NADA MAS
 *
 * No lo agarra TypeScript, porque los tipos son correctos: una función es un
 * valor válido para esa prop. No lo agarra `eslint`. Y NO LO AGARRA
 * `next build`, que es lo que lo hace peligroso: la ruta es `force-dynamic`,
 * así que no se prerenderiza y el build pasa en verde. El error aparece recién
 * cuando alguien abre la página.
 *
 * Verificado: una página de prueba con exactamente esta forma, pero SIN
 * `force-dynamic`, hace fallar el build con ese mensaje. Con `force-dynamic`,
 * compila perfecto y explota en producción. Esa diferencia es toda la razón de
 * que esta prueba sea un archivo y no un comentario.
 *
 *     node --experimental-strip-types --import ./pruebas/registrar.mjs pruebas/componentes-cliente.mts
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

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

/** Todos los .tsx de una carpeta, hacia abajo. */
function tsx(dir: string): string[] {
  const salida: string[] = [];
  for (const nombre of readdirSync(dir)) {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) salida.push(...tsx(ruta));
    else if (nombre.endsWith(".tsx")) salida.push(ruta);
  }
  return salida;
}

const archivos = [...tsx("components"), ...tsx("app")];

// Que la prueba esté mirando algo: si un cambio de carpetas dejara la lista
// vacía, pasaría en verde sin revisar nada, que es la peor clase de prueba.
revisar("encuentra los componentes", archivos.length > 30, true);

const esCliente = (texto: string) =>
  texto.trimStart().startsWith('"use client"') ||
  texto.trimStart().startsWith("'use client'");

/**
 * Los que DIBUJAN una tabla, no los que importan un tipo de ella.
 * `columnasVencidos.tsx` arma columnas y no renderiza nada, y sus dos únicos
 * consumidores ya son de cliente: ahí no hay límite que cruzar.
 */
const conTabla = archivos.filter((f) => /<Tabla[\s>]/.test(readFileSync(f, "utf8")));

revisar("hay pantallas con tabla", conTabla.length > 5, true);

const servidorConTabla = conTabla.filter((f) => !esCliente(readFileSync(f, "utf8")));

revisar("ninguna tabla se dibuja desde el servidor", servidorConTabla, []);

// Y que PosventaMeli siga siendo de cliente, por nombre: es el que se rompió,
// y una prueba que sólo mira el conjunto no dice cuál era el caso real.
revisar(
  "PosventaMeli es de cliente",
  esCliente(readFileSync("components/PosventaMeli.tsx", "utf8")),
  true,
);

console.log(FALLOS.length ? `\n${FALLOS.length} FALLARON: ${FALLOS.join(", ")}` : "\nTODO OK");
process.exit(FALLOS.length ? 1 : 0);
