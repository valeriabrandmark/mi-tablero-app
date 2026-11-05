/**
 * El CSV de PVP: lo que se baja y lo que vuelve.
 *
 * POR QUÉ TIENE PRUEBA PROPIA. Un error acá no se ve: pone un precio
 * equivocado en un artículo que nadie está mirando, porque justamente son
 * las marcas que el motor no toca. Y las tres cosas que pueden salir mal
 * —el separador, la coma decimal y la columna corrida— dependen de con qué
 * programa se abrió el archivo, que no se puede controlar.
 *
 *     node --experimental-strip-types --import ./pruebas/registrar.mjs pruebas/pvp.mts
 */

import assert from "node:assert/strict";
import test from "node:test";

import { aCsvPvp, leerCsvPvp, parsearNumero } from "@/lib/pvp";

test("las tres formas de escribir un precio se entienden igual", () => {
  assert.equal(parsearNumero("184917,48"), 184917.48);
  assert.equal(parsearNumero("184.917,48"), 184917.48);
  assert.equal(parsearNumero("184917.48"), 184917.48);
  assert.equal(parsearNumero("$ 184.917,48"), 184917.48);
  // Un punto con tres cifras atrás son miles, no decimales.
  assert.equal(parsearNumero("184.917"), 184917);
  assert.equal(parsearNumero("1.500"), 1500);
  // Con una o dos cifras, es decimal.
  assert.equal(parsearNumero("184.91"), 184.91);
  assert.equal(parsearNumero(""), null);
  assert.equal(parsearNumero("  "), null);
});

test("lo que se baja se puede volver a leer igual", () => {
  const csv = aCsvPvp([
    { sku: "HO3130", nombre: "Hola Cuna", precio: 199999, oferta: 0.2 },
    { sku: "AC01002", nombre: "Diaper; Genie", precio: 304405.08, oferta: null },
  ]);
  const { filas, errores } = leerCsvPvp(csv);
  assert.deepEqual(errores, []);
  assert.equal(filas.length, 2);
  assert.equal(filas[0].sku, "HO3130");
  assert.equal(filas[0].precio, 199999);
  assert.equal(filas[0].oferta, 0.2);
  assert.equal(filas[1].precio, 304405.08);
  assert.equal(filas[1].oferta, null);
});

test("un punto y coma en la descripción no corre las columnas", () => {
  // "Diaper; Genie" sale entrecomillado; si no, la fila tendría una celda de
  // más y el precio se leería de la columna equivocada.
  const csv = aCsvPvp([{ sku: "X", nombre: "Diaper; Genie", precio: 100, oferta: null }]);
  assert.ok(csv.includes('"Diaper; Genie"'));
  assert.equal(leerCsvPvp(csv).filas[0].precio, 100);
});

test("se acepta el archivo venga con ; o con ,", () => {
  const conComa = "sku,nombre,precio,oferta_%\nHO3130,Hola,199999.00,20\n";
  const { filas, separador } = leerCsvPvp(conComa);
  assert.equal(separador, ",");
  assert.equal(filas[0].precio, 199999);
  assert.equal(filas[0].oferta, 0.2);
});

test("las columnas se buscan por título, no por posición", () => {
  // Alguien abrió el archivo y metió una columna para hacer una cuenta.
  const movido = "sku;cuenta mia;nombre;precio;oferta_%\nHO3130;=A1*2;Hola;199999,00;20\n";
  const { filas, errores } = leerCsvPvp(movido);
  assert.deepEqual(errores, []);
  assert.equal(filas[0].precio, 199999);
});

test("un SKU repetido se devuelve en vez de elegir uno", () => {
  const csv = "sku;precio\nHO3130;100\nHO3130;200\n";
  const { filas, errores } = leerCsvPvp(csv);
  assert.equal(filas.length, 1);
  assert.equal(errores.length, 1);
  assert.match(errores[0].motivo, /repetido/);
});

test("una oferta menor a 1 no se adivina", () => {
  // 0,2 puede ser 0,2 % o 20 %. Las dos ponen un tachado distinto.
  const { filas, errores } = leerCsvPvp("sku;precio;oferta_%\nHO3130;100;0,2\n");
  assert.equal(filas.length, 0);
  assert.match(errores[0].motivo, /ambigua/);
});

test("una oferta fuera de rango se rechaza", () => {
  const { errores } = leerCsvPvp("sku;precio;oferta_%\nHO3130;100;120\n");
  assert.match(errores[0].motivo, /entre 0 y 100/);
});

test("un precio vacío o roto no pasa", () => {
  const { filas, errores } = leerCsvPvp("sku;precio\nHO3130;\nAC01002;abc\nHO806;500\n");
  assert.equal(filas.length, 1);
  assert.equal(filas[0].sku, "HO806");
  assert.equal(errores.length, 2);
});

test("sin las columnas que hacen falta se dice cuál falta", () => {
  const { errores } = leerCsvPvp("codigo;valor\nHO3130;100\n");
  assert.match(errores[0].motivo, /sku.*precio/);
});

test("el archivo arranca con BOM para que Excel no rompa los acentos", () => {
  assert.ok(aCsvPvp([{ sku: "X", nombre: "Pezoneras Nº2", precio: 1, oferta: null }]).startsWith("﻿"));
});
