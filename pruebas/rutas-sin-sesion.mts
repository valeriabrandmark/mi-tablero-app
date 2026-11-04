/**
 * Qué pasa por la barrera de sesión sin estar logueado.
 *
 * POR QUÉ EXISTE. El botón de la planilla de markup lo llama un Apps Script,
 * que corre en Google y no tiene cookie del tablero. `proxy.ts` frenaba su
 * pedido con "No autenticado" ANTES de que la ruta pudiera mirar su token.
 *
 * Desde afuera eso se veía como un token mal puesto, y se cambió tres veces
 * un token que estaba bien: el navegador SÍ pasaba la barrera —tiene la
 * sesión— así que la MISMA URL contestaba una cosa desde el navegador y otra
 * desde el script. Lo que se vio nunca fue lo que fallaba.
 *
 * Esta prueba fija las dos mitades: que la ruta de la planilla pase, y que no
 * pase nada más. Sacarle la sesión a una ruta de más es abrir el tablero.
 *
 *     node --experimental-strip-types --import ./pruebas/registrar.mjs pruebas/rutas-sin-sesion.mts
 */

import { esPublica } from "@/lib/rutas-sin-sesion";

const FALLOS: string[] = [];

function revisar(que: string, real: unknown, esperado: unknown) {
  const ok = real === esperado;
  console.log(`${ok ? "ok  " : "FALLA"}  ${que}${ok ? "" : `  (dio ${real}, se esperaba ${esperado})`}`);
  if (!ok) FALLOS.push(que);
}

// --- Lo que tiene que pasar ---------------------------------------------
revisar("la planilla de markup pasa sin sesión", esPublica("/api/precios-tn/planilla"), true);
revisar("el login pasa", esPublica("/login"), true);
revisar("el canje del mail pasa", esPublica("/auth/confirmar"), true);

// --- Lo que NO tiene que pasar -------------------------------------------
//
// La ruta de la planilla se nombra ENTERA, no por prefijo: con `startsWith`
// cualquier cosa colgada abajo entraría gratis.
revisar("nada colgado abajo de la planilla", esPublica("/api/precios-tn/planilla/todo"), false);
revisar("ni la ruta padre", esPublica("/api/precios-tn"), false);
revisar("ni el resto de Precios TN", esPublica("/api/precios-tn/decidir"), false);
revisar("ni la de escribir precios", esPublica("/api/precios-tn/correr"), false);
revisar("ni las páginas del tablero", esPublica("/precios-tn"), false);
revisar("ni la API de usuarios", esPublica("/api/usuarios"), false);
revisar("ni la raíz", esPublica("/"), false);

console.log(FALLOS.length ? `\n${FALLOS.length} FALLARON: ${FALLOS.join(", ")}` : "\nTODO OK");
process.exit(FALLOS.length ? 1 : 0);
