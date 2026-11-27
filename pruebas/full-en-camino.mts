/**
 * Lo pendiente de ingreso a Full: el mayor entre ML y los envíos abiertos de
 * Digip, con sus dos frenos. Sin base: prueba la FORMA del SQL.
 *
 * Si alguien saca un freno, el pendiente puede inflarse con envíos viejos que
 * Digip nunca marcó como despachados (había de principios de octubre el
 * 27/11/2026), y el sugerido de Compras se queda corto. Si saca el `greatest`
 * y suma, cuenta dos veces las mismas unidades.
 *
 *     node --experimental-strip-types --import ./pruebas/registrar.mjs pruebas/full-en-camino.mts
 */

import {
  DIAS_ENVIO_FULL_ABIERTO,
  ENVIOS_FULL_ABIERTOS_POR_SKU,
  FULL_POR_SKU,
} from "@/lib/sql-meli";

const FALLOS: string[] = [];
function revisar(nombre: string, ok: boolean) {
  console.log(ok ? `OK  ${nombre}` : `MAL ${nombre}`);
  if (!ok) FALLOS.push(nombre);
}

const plano = (s: string) => s.replace(/\s+/g, " ");
const env = plano(ENVIOS_FULL_ABIERTOS_POR_SKU);
const full = plano(FULL_POR_SKU);

revisar("se toma el MAYOR entre ML y Digip, no la suma",
  full.includes("greatest(coalesce(ml.en_camino, 0), coalesce(dg.unidades, 0)) as en_camino"));
revisar("full outer: un artículo nuevo en Full no se pierde",
  full.includes("full outer join"));
revisar("incluye los envíos abiertos de Digip", full.includes("from bronze.digip_envios_full"));
revisar("freno 1: sólo envíos recientes",
  env.includes(`>= current_date - ${DIAS_ENVIO_FULL_ABIERTO}`) && DIAS_ENVIO_FULL_ABIERTO <= 14);
revisar("freno 1: los despachados no cuentan", env.includes("<> 'Despachado'"));
revisar("freno 2: nunca más de lo que Digip tiene reservado hoy",
  env.includes("least(e.u, coalesce(d.reserva, 0))") && env.includes('"stock.despachar"'));
revisar("no quedó una interpolación sin resolver", !full.includes("${") && !env.includes("${"));

console.log(FALLOS.length ? `\n${FALLOS.length} pruebas fallaron` : "\nTodo OK");
process.exit(FALLOS.length ? 1 : 0);
