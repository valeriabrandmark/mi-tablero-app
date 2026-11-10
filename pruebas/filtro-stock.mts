/**
 * El filtro por stock de Precios TN.
 *
 * POR QUÉ TIENE PRUEBA. Desde la migración 016 el motor repricia también lo
 * que no tiene unidades, así que la cola pasó de 343 a unas 3.500 propuestas
 * y este filtro es lo único que permite separar lo urgente —un artículo con
 * stock se está vendiendo mal AHORA— de lo preventivo.
 *
 * Y porque el valor viaja en la query string, que es texto que escribe
 * cualquiera. Un valor que no sea uno de los dos tiene que caer en "las dos
 * mitades" y no en un `where` que no coincide con nada: una pantalla vacía se
 * lee como "no hay nada que revisar", que es la respuesta contraria.
 *
 *     node --experimental-strip-types --import ./pruebas/registrar.mjs pruebas/filtro-stock.mts
 */

import assert from "node:assert/strict";
import test from "node:test";

import { leerFiltros } from "@/lib/precios-tn";

const leer = (qs: string) => leerFiltros(new URLSearchParams(qs));

test("sin el parámetro, se ven las dos mitades", () => {
  assert.equal(leer("").stock, null);
});

test("los dos valores válidos se entienden", () => {
  assert.equal(leer("stock=con").stock, "con");
  assert.equal(leer("stock=sin").stock, "sin");
});

test("cualquier otra cosa cae en las dos mitades, no en una pantalla vacía", () => {
  for (const basura of ["0", "1", "true", "CON", " con", "ninguno", "null", "sin+stock"]) {
    assert.equal(
      leer(`stock=${basura}`).stock,
      null,
      `"${basura}" tendría que caer en null`,
    );
  }
});

test("el filtro de stock no pisa a los demás", () => {
  const f = leer("stock=sin&marca=CHICCO&grupo=bajo_piso&q=C04004");
  assert.equal(f.stock, "sin");
  assert.equal(f.marca, "CHICCO");
  assert.equal(f.busqueda, "C04004");
});
