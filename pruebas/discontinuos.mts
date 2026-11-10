/**
 * Qué descripción cuenta como DISCONTINUO. Sin base.
 *
 * La política: lo que empieza con "DF" o "DD" es discontinuo. Es texto libre
 * cargado a mano, así que la regla tolera cómo se escriba, pero no puede
 * llevarse puesto un nombre que sólo empiece con esas letras.
 *
 *     node --experimental-strip-types --import ./pruebas/registrar.mjs pruebas/discontinuos.mts
 */

import { esDescripcionDiscontinua } from "@/lib/compras";

const FALLOS: string[] = [];

function revisar(nombre: string, obtenido: unknown, esperado: unknown) {
  const ok = obtenido === esperado;
  console.log(ok ? `OK  ${nombre}` : `MAL ${nombre}: esperado ${esperado}, obtenido ${obtenido}`);
  if (!ok) FALLOS.push(nombre);
}

const SI = [
  "DF - ADERMICINA AE EMULSION 400 ML",
  "DD CONTENEDOR RUBBERMAID TAKE ALONGS",
  "df crema",
  "  DF - con espacios adelante",
  "DF-PEGADO CON GUION",
  "DD.punto",
  "DF",
];
const NO = [
  "DFENSE desodorante",
  "DD2000 algo",
  "ADERMICINA DF",
  "PACO DEO SPRAY 150ML",
  "",
];

for (const d of SI) revisar(`discontinuo: "${d}"`, esDescripcionDiscontinua(d), true);
for (const d of NO) revisar(`no discontinuo: "${d}"`, esDescripcionDiscontinua(d), false);
revisar("null no es discontinuo", esDescripcionDiscontinua(null), false);

console.log(FALLOS.length ? `\n${FALLOS.length} pruebas fallaron` : "\nTodo OK");
process.exit(FALLOS.length ? 1 : 0);
