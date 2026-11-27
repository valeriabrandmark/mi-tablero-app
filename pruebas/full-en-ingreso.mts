/**
 * Las unidades que ML ya recibió y está ingresando cuentan como EN CAMINO.
 * Sin base: prueba la FORMA del SQL.
 *
 * GL26019 el 27/11/2026: 122 aptas + 151 en `internalProcess`. El panel de ML
 * decía 211 en camino y el tablero 60, porque restaba esas 151 como si ya
 * estuvieran en Full.
 *
 *     node --experimental-strip-types --import ./pruebas/registrar.mjs pruebas/full-en-ingreso.mts
 */

import { EN_INGRESO_FULL, FULL_POR_SKU } from "@/lib/sql-meli";

const FALLOS: string[] = [];
function revisar(nombre: string, ok: boolean) {
  console.log(ok ? `OK  ${nombre}` : `MAL ${nombre}`);
  if (!ok) FALLOS.push(nombre);
}

const plano = (s: string) => s.replace(/\s+/g, " ");

revisar("suma sólo las internalProcess", EN_INGRESO_FULL.includes("d->>'status' = 'internalProcess'"));
revisar("las demás no disponibles no entran (lost, withdrawal...)",
  !/lost|withdrawal|notSupported/.test(EN_INGRESO_FULL));
revisar("un detalle que no es una lista JSON no rompe la consulta",
  EN_INGRESO_FULL.includes("else '[]'::jsonb"));
revisar("el pendiente de Full las suma",
  plano(FULL_POR_SKU).includes(plano(EN_INGRESO_FULL)));
revisar("las aptas siguen siendo sólo available_quantity",
  plano(FULL_POR_SKU).includes("sum(coalesce(f.available_quantity, 0)) as unidades"));

console.log(FALLOS.length ? `\n${FALLOS.length} pruebas fallaron` : "\nTodo OK");
process.exit(FALLOS.length ? 1 : 0);
