/**
 * Las reglas del sugerido como parámetros. Sin base.
 *
 * Se prueban dos cosas que, si fallan, no las ve nadie hasta que el sugerido
 * da cualquier cosa:
 *
 *   1. Que NADA que no sea un número en rango llegue al SQL: los valores se
 *      interpolan, así que `normalizarParametros` es la única barrera.
 *   2. Que con la tabla vacía todo valga lo de siempre: la migración no puede
 *      mover un solo sugerido por sí sola.
 *
 *     node --experimental-strip-types --import ./pruebas/registrar.mjs pruebas/compras-parametros.mts
 */

import {
  DEFINICIONES_PARAMETROS,
  normalizarParametros,
  parametrosPorDefecto,
  valorValido,
} from "@/lib/compras-parametros";
import { ritmoPorDeposito } from "@/lib/compras";
import { DIAS_MINIMOS_DE_RITMO, PLAZO_REPOSICION_DIAS } from "@/lib/stock";
import type { FilaCompra } from "@/lib/types";

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

// --- Los de siempre ---------------------------------------------------------
const def = parametrosPorDefecto();
revisar("plazo por defecto = la constante de siempre", def.plazo_reposicion_dias, PLAZO_REPOSICION_DIAS);
revisar("piso por defecto = la constante de siempre", def.dias_minimos_de_ritmo, DIAS_MINIMOS_DE_RITMO);
revisar("tabla vacía = los de siempre", normalizarParametros({}), def);
revisar("null = los de siempre", normalizarParametros(null), def);

for (const d of DEFINICIONES_PARAMETROS) {
  revisar(`${d.clave}: el defecto está adentro de su rango`,
    d.porDefecto >= d.min && d.porDefecto <= d.max, true);
}

// --- La barrera hacia el SQL --------------------------------------------------
revisar("un texto no entra", valorValido("plazo_reposicion_dias", "10; drop table x"), null);
revisar("vacío no entra", valorValido("plazo_reposicion_dias", ""), null);
revisar("infinito no entra", valorValido("plazo_reposicion_dias", Infinity), null);
revisar("se recorta al máximo", valorValido("cobertura_maxima_compra_dias", 9999), 365);
revisar("se recorta al mínimo", valorValido("factor_oferta_max", 0), 1);
revisar("los enteros se redondean", valorValido("plazo_reposicion_dias", 12.6), 13);
revisar("los decimales van al paso", valorValido("factor_oferta_max", 1.94), 1.9);
revisar("sí/no queda en 0 o 1", valorValido("ritmo_sobre_dias_con_stock", 0.7), 1);
revisar("el número viene de la base como texto", valorValido("plazo_reposicion_dias", "15"), 15);

const mezclado = normalizarParametros({
  plazo_reposicion_dias: "20",
  clave_inventada: 5,
  factor_oferta_max: "no es número",
});
revisar("guardado válido pisa el defecto", mezclado.plazo_reposicion_dias, 20);
revisar("una fila rota cae al defecto", mezclado.factor_oferta_max, def.factor_oferta_max);
revisar("una clave inventada no aparece", "clave_inventada" in mezclado, false);

// --- La explicación del ritmo sobre días con stock --------------------------
// El caso de compras: 12 que entraron y se vendieron en 2 días por Full.
const fila = {
  ritmoSobreStock: true,
  udsTuc: 0,
  udsFull: 12,
  diasStockTuc: 30,
  diasStockFull: 2,
} as FilaCompra;

const lineas = ritmoPorDeposito(fila, def);
revisar("explica Full y no Tucumán (que no vendió)", lineas.length, 2);
revisar("usa el piso de días y lo dice",
  lineas[1]?.includes("en 7 días con stock (tuvo stock 2; se toma el mínimo de 7)"), true);
revisar("y el ritmo que da", lineas[1]?.endsWith("= 1.71 por día"), true);
revisar("sin la regla, no explica nada",
  ritmoPorDeposito({ ...fila, ritmoSobreStock: false }, def), []);

console.log(FALLOS.length ? `\n${FALLOS.length} pruebas fallaron` : "\nTodo OK");
process.exit(FALLOS.length ? 1 : 0);
