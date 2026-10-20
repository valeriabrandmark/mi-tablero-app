/**
 * Pruebas del buscador de artículos: SKU, descripción, código del proveedor y
 * EAN. Sin base.
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

import {
  buscadorDeArticulo,
  clausulaCodigosDelProveedor,
} from "@/lib/sql-codigos";

const FALLOS: string[] = [];

function revisar(nombre: string, ok: boolean, detalle = "") {
  console.log(ok ? `OK  ${nombre}` : `MAL ${nombre}${detalle ? `\n     ${detalle}` : ""}`);
  if (!ok) FALLOS.push(nombre);
}

// --- Los dos códigos ajenos, y por qué no se tratan igual -----------------
//
// EL CASO QUE LO MOTIVO: ANA buscó "3340004" --el código con el que ALGABO
// vende el jabón de glicerina-- y no encontró nada, pero con el SKU AL01070 sí.
// Ese artículo no tiene EAN cargado, así que no había por dónde llegarle.
//
// Y andaba A VECES: de los 7.722 artículos con código de compra, escribirlo
// encontraba 1.938 por casualidad --porque ese código era parte del EAN, del
// SKU o de la descripción-- y los otros 5.801 no.

const conCodigo = clausulaCodigosDelProveedor("sku", "3340004", 3);
revisar("busca el código del proveedor",
  conCodigo.includes(`"codigoCompra"), '') ilike $3`), conCodigo);
revisar("y también el EAN cuando hay dígitos",
  conCodigo.includes(`"eanUnidad"), '') ilike $3`), conCodigo);

// EL EAN ES SOLO NUMEROS, así que "shampoo" no puede coincidir con ninguno y
// esa mitad se omite.
const soloTextoCodigo = clausulaCodigosDelProveedor("sku", "shampoo", 3);
revisar("un texto sin números no busca EAN",
  !soloTextoCodigo.includes("eanUnidad"), soloTextoCodigo);

// PERO EL CODIGO DEL PROVEEDOR SÍ PUEDE TENER LETRAS: 2.560 de los 7.722
// mezclan, y 30 no tienen un solo dígito. Si se le aplicara el mismo corte que
// al EAN, esos quedarían sin forma de encontrarse.
revisar("un texto sin números sí busca el código del proveedor",
  soloTextoCodigo.includes("codigoCompra"), soloTextoCodigo);

// Por eso ya no devuelve null nunca: siempre hay algo que buscar.
revisar("siempre hay cláusula", typeof soloTextoCodigo === "string" && soloTextoCodigo.length > 0);

// Mezclado: los SKU de Sigma tienen letras y números ("IM08004"), y buscar uno
// no tiene por qué apagar ninguna de las dos mitades.
const mixto = clausulaCodigosDelProveedor("sku", "IM08004", 3);
revisar("un término mixto intenta las dos",
  mixto.includes("codigoCompra") && mixto.includes("eanUnidad"), mixto);

// --- El número de parámetro es el mismo para los tres ----------------------
//
// Es el MISMO texto buscado, así que se reusa el mismo `$n`. Si alguna parte
// apuntara a otro parámetro, la consulta correría igual y buscaría otra cosa.

const sql = buscadorDeArticulo("7790010012345", 7);
// Cuatro: SKU, descripción, código del proveedor y EAN.
revisar("las cuatro partes usan el mismo parámetro",
  (sql.match(/\$7\b/g) ?? []).length === 4, sql);
revisar("y ninguna usa otro", !/\$(?!7\b)\d/.test(sql), sql);

// --- Las columnas son las que se pasan ------------------------------------
//
// Cada tablero las llama distinto: `sku` a secas, `fv.sku`, `p.sku`, y la
// descripción es `producto` en unos y `descripcion` en otros.

const conAlias = buscadorDeArticulo("123", 1, "fv.sku", "fv.producto");
revisar("respeta el alias del SKU", conAlias.includes("fv.sku ilike $1"));
revisar("y el de la descripción", conAlias.includes("fv.producto ilike $1"));
// Los códigos ajenos se buscan por el SKU de ESA consulta, no por uno
// inventado: si apuntara a otra columna, traería artículos de otra fila.
revisar("los códigos filtran por el SKU que le dieron",
  conAlias.includes("fv.sku in (select trim(id)"));

// --- Sin EAN sigue siendo un buscador válido ------------------------------

const soloTexto = buscadorDeArticulo("chupete", 2);
revisar("sin EAN quedan el SKU, la descripción y el código del proveedor",
  soloTexto.includes("sku ilike $2") &&
    soloTexto.includes("producto ilike $2") &&
    soloTexto.includes("codigoCompra") &&
    !soloTexto.includes("eanUnidad"), soloTexto);
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
revisar("el código del proveedor también",
  sql.includes(`"codigoCompra"), '') ilike`));
// Y los vacíos del maestro no cuentan como coincidencia: sin el nullif, un
// término de un espacio traería todos los artículos sin EAN ni código cargado
// -- 574 sin código de compra, 346 sin EAN.
revisar("los códigos vacíos no coinciden",
  (sql.match(/nullif\(trim\(/g) ?? []).length === 2, sql);

console.log(FALLOS.length ? `\n${FALLOS.length} FALLARON: ${FALLOS.join(", ")}` : "\nTODO OK");
process.exit(FALLOS.length ? 1 : 0);
