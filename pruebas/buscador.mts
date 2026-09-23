/**
 * Pruebas del buscador de artículos por SKU, descripción y EAN. Sin base.
 *
 * POR QUE EXISTE. Esto arma SQL con un número de parámetro adentro, y si ese
 * número se corre una posición la consulta no falla: busca otra cosa. Un
 * buscador que devuelve resultados equivocados es peor que uno que no anda,
 * porque nadie lo revisa.
 *
 * Y lo usan SIETE consultas distintas --Stock, Antigüedad, Trazabilidad,
 * Compras, Precios TN (dos), Mercado Libre y Ventas Mayoristas-- así que un
 * cambio acá los toca a todos a la vez. Esa es la gracia y también el riesgo.
 *
 *     node --experimental-strip-types --import ./pruebas/registrar.mjs pruebas/buscador.mts
 */

import { buscadorDeArticulo, clausulaEan } from "@/lib/sql-ean";

const FALLOS: string[] = [];

function revisar(nombre: string, ok: boolean, detalle = "") {
  console.log(ok ? `OK  ${nombre}` : `MAL ${nombre}${detalle ? `\n     ${detalle}` : ""}`);
  if (!ok) FALLOS.push(nombre);
}

// --- El EAN entra sólo cuando el término tiene algún dígito ----------------
//
// Un EAN es sólo números, así que "shampoo" no puede coincidir con ninguno.
// Sin el corte, cada búsqueda por texto pagaría un recorrido del maestro de
// 8.265 artículos para no encontrar nada.

revisar("un texto sin números no busca EAN",
  clausulaEan("sku", "shampoo", 3) === null);
revisar("un EAN entero sí", clausulaEan("sku", "7790010012345", 3) !== null);
revisar("y los últimos dígitos también",
  clausulaEan("sku", "12345", 3) !== null);
// Mezclado: los SKU de Sigma tienen letras y números ("IM08004"), y buscar uno
// no tiene por qué apagar la parte del EAN.
revisar("un término mixto también lo intenta",
  clausulaEan("sku", "IM08004", 3) !== null);

// --- El número de parámetro es el mismo para los tres ----------------------
//
// Es el MISMO texto buscado, así que se reusa el mismo `$n`. Si alguna parte
// apuntara a otro parámetro, la consulta correría igual y buscaría otra cosa.

const sql = buscadorDeArticulo("7790010012345", 7);
revisar("las tres partes usan el mismo parámetro",
  (sql.match(/\$7\b/g) ?? []).length === 3, sql);
revisar("y ninguna usa otro", !/\$(?!7\b)\d/.test(sql), sql);

// --- Las columnas son las que se pasan ------------------------------------
//
// Cada tablero las llama distinto: `sku` a secas, `fv.sku`, `p.sku`, y la
// descripción es `producto` en unos y `descripcion` en otros.

const conAlias = buscadorDeArticulo("123", 1, "fv.sku", "fv.producto");
revisar("respeta el alias del SKU", conAlias.includes("fv.sku ilike $1"));
revisar("y el de la descripción", conAlias.includes("fv.producto ilike $1"));
// El EAN se busca por el SKU de ESA consulta, no por uno inventado.
revisar("el EAN filtra por el SKU que le dieron",
  conAlias.includes("fv.sku in (select trim(id)"));

// --- Sin EAN sigue siendo un buscador válido ------------------------------

const soloTexto = buscadorDeArticulo("chupete", 2);
revisar("sin EAN quedan las dos partes de siempre",
  soloTexto === "(sku ilike $2 or producto ilike $2)", soloTexto);
revisar("y sigue entre paréntesis",
  soloTexto.startsWith("(") && soloTexto.endsWith(")"));

// Con EAN también: sin los paréntesis, un `or` se escaparía del AND que lo
// rodea en el where y el filtro dejaría pasar todo.
revisar("con EAN también va entre paréntesis",
  sql.startsWith("(") && sql.endsWith(")"), sql);

// --- El EAN se compara por contenido, como el resto -----------------------
//
// Es común pegar sólo los últimos dígitos, o que venga con un espacio de más.
revisar("el EAN usa ilike y no igual", sql.includes(`"eanUnidad"), '') ilike`));
// Y los vacíos del maestro no cuentan como coincidencia: sin el nullif, un
// término de un espacio traería todos los artículos sin EAN cargado.
revisar("los EAN vacíos no coinciden", sql.includes("nullif(trim("));

console.log(FALLOS.length ? `\n${FALLOS.length} FALLARON: ${FALLOS.join(", ")}` : "\nTODO OK");
process.exit(FALLOS.length ? 1 : 0);
