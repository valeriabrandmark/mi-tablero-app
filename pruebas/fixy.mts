/**
 * Reglas de FIXY (lib/fixy.ts): sin base ni red.
 *
 *     node --experimental-strip-types --import ./pruebas/registrar.mjs pruebas/fixy.mts
 */

import {
  armarRecepcion,
  cajasPara,
  contactoDesdeEntorno,
  estadoDeDiferencia,
  leerEvento,
  leerRenglonesManual,
} from "@/lib/fixy";
import { esPublica } from "@/lib/rutas-sin-sesion";
import { moduloDeRuta } from "@/lib/modulos";

const FALLOS: string[] = [];

function revisar(que: string, real: unknown, esperado: unknown) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  console.log(`${ok ? "ok  " : "FALLA"}  ${que}${ok ? "" : `  (dio ${JSON.stringify(real)}, se esperaba ${JSON.stringify(esperado)})`}`);
  if (!ok) FALLOS.push(que);
}

// --- Cajas --------------------------------------------------------------
revisar("50 u. con bulto de 12 son 5 cajas", cajasPara(50, 12), 5);
revisar("justo un bulto es una caja", cajasPara(12, 12), 1);
revisar("sin dato de bulto, una caja", cajasPara(50, null), 1);
revisar("bulto absurdo (0), una caja", cajasPara(50, 0), 1);
revisar("cero unidades, cero cajas", cajasPara(0, 12), 0);

// --- Renglones a mano ---------------------------------------------------
const a = leerRenglonesManual("ss03006 120 10\nDG01001\t48\n\nHT1;5;1");
revisar("lee espacio, tab y punto y coma", a.renglones, [
  { sku: "SS03006", cantidad: 120, cajas: 10 },
  { sku: "DG01001", cantidad: 48, cajas: null },
  { sku: "HT1", cantidad: 5, cajas: 1 },
]);
revisar("sin errores", a.errores, []);
const b = leerRenglonesManual("A1 10 2\nA1 5 1");
revisar("un SKU repetido suma", b.renglones, [{ sku: "A1", cantidad: 15, cajas: 3 }]);
const c = leerRenglonesManual("A1 10 2\nA1 5");
revisar("si a una línea le faltan cajas, se recalculan todas", c.renglones[0].cajas, null);
revisar("miles con punto", leerRenglonesManual("A1 1.200").renglones[0].cantidad, 1200);
revisar("cantidad decimal es error", leerRenglonesManual("A1 1,5").errores.length, 1);
revisar("sin cantidad es error", leerRenglonesManual("A1").errores.length, 1);
revisar("cantidad cero es error", leerRenglonesManual("A1 0").errores.length, 1);

// --- Contacto -----------------------------------------------------------
const env = {
  FIXY_CONTACTO_NOMBRE: "Brandmark", FIXY_CONTACTO_CALLE: "X 1", FIXY_CONTACTO_CP: "4000",
  FIXY_CONTACTO_LOCALIDAD: "SMT", FIXY_CONTACTO_PROVINCIA: "Tucumán",
  FIXY_CONTACTO_EMAIL: "a@b.c", FIXY_CONTACTO_TELEFONO: "1",
};
revisar("contacto completo", contactoDesdeEntorno(env).faltantes, []);
revisar("contacto incompleto dice qué falta",
  contactoDesdeEntorno({ ...env, FIXY_CONTACTO_CP: " " }).faltantes, ["FIXY_CONTACTO_CP"]);

// --- Recepción ----------------------------------------------------------
const r = armarRecepcion({
  remito: "74430467", fechaPactada: "2026-11-27",
  contacto: contactoDesdeEntorno(env).contacto!,
  renglones: [{ sku: "A1", descripcion: "Uno", cantidad: 10, cajas: 1 }],
});
revisar("operación fija RECEPCION", r.operacion, "RECEPCION");
revisar("permite recepción parcial", r.permite_parcial, true);
revisar("no lleva el token", "api_token" in r, false);
revisar("productos con el formato de FIXY", r.productos,
  [{ sku: "A1", descripcion: "Uno", cajas: 1, cantidad: 10, trazable: false }]);

// --- Webhook ------------------------------------------------------------
revisar("lee el ejemplo de la doc",
  leerEvento({ usuario: "Presis", token: "t", estado: "Entregada", codigo_estado: "ENT", remito: "255", guia: 220 }),
  { guia: "220", remito: "255", estado: "Entregada", codigoEstado: "ENT", token: "t" });
revisar("cuerpo vacío no rompe", leerEvento(null).guia, null);

// --- Diferencias --------------------------------------------------------
revisar("falta 5 sin nada viajando: faltante", estadoDeDiferencia(-5, 0), "faltante");
revisar("falta 5 con 5 viajando: en orden", estadoDeDiferencia(-5, 5), "en_orden");
revisar("sobra 3: sobrante", estadoDeDiferencia(3, 0), "sobrante");
revisar("falta 1: en orden (bajo el umbral)", estadoDeDiferencia(-1, 0), "en_orden");

// --- Rutas --------------------------------------------------------------
revisar("el webhook pasa sin sesión", esPublica("/api/fixy/webhook"), true);
revisar("los datos de FIXY NO pasan sin sesión", esPublica("/api/fixy"), false);
revisar("avisar recepciones NO pasa sin sesión", esPublica("/api/fixy/recepciones"), false);
revisar("FIXY es del módulo Stock", moduloDeRuta("/api/fixy/recepciones"), "stock");
revisar("la pantalla es de Stock", moduloDeRuta("/stock/fixy"), "stock");

console.log(FALLOS.length ? `\n${FALLOS.length} FALLAS` : "\nTODO OK");
process.exit(FALLOS.length ? 1 : 0);
