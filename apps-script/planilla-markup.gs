/**
 * Botón "Precios TN → Actualizar precios y competencia" en la planilla
 * "markup tienda nube".
 *
 * ===========================================================================
 *  QUE HACE, Y SOBRE TODO QUE NO TOCA
 * ===========================================================================
 *
 * Llena DOS columnas de la pestaña PRODUCTOS, buscando cada SKU en la
 * columna A:
 *
 *   I   Precio de venta actual (con IVA)   -> lo que la tienda tiene hoy
 *   N   Precio de la competencia (con IVA) -> el competidor mas barato
 *
 * Y NADA MAS. Las columnas O, P, Q y R --markup, margen peor caso, margen
 * 1 pago y estado contra la competencia-- ya son formulas de la planilla y se
 * recalculan solas cuando N se llena. Lo mismo J a M cuando se llena I.
 * Escribirlas desde acá seria calcular con otros supuestos lo que la planilla
 * ya calcula con los suyos, y terminar con dos numeros peleados en la misma
 * fila.
 *
 * LOS SKU QUE EL COMPARADOR NO CONOCE NO SE TOCAN. No se borran ni se ponen
 * en cero: una celda vacia en N significa "no sabemos", y es lo que las
 * formulas de la planilla ya esperan. Un cero significaria "la competencia lo
 * regala", que es una afirmacion, y haria que R diga PIERDE sobre un dato
 * que no existe.
 *
 * ===========================================================================
 *  COMO SE INSTALA (una sola vez)
 * ===========================================================================
 *
 *   1. En la planilla: Extensiones -> Apps Script.
 *   2. Pegar este archivo entero y guardar.
 *   3. Configuracion del proyecto -> Propiedades del script -> agregar dos:
 *        TABLERO_URL    https://<el dominio del tablero>
 *        PLANILLA_TOKEN el mismo valor que PLANILLA_PRECIOS_TOKEN en Vercel
 *   4. Recargar la planilla. Aparece el menu "Precios TN".
 *
 * El token va en las propiedades del script y NO escrito acá adentro: este
 * archivo vive en el repositorio y cualquiera que lo lea veria la llave.
 */

var HOJA = "PRODUCTOS";
var FILA_ENCABEZADO = 6;      // los datos arrancan en la 7
var COL_SKU = 1;              // A
var COL_NUESTRO = 9;          // I
var COL_COMPETENCIA = 14;     // N

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Precios TN")
    .addItem("Actualizar precios y competencia", "actualizarPrecios")
    .addToUi();
}

function actualizarPrecios() {
  var ui = SpreadsheetApp.getUi();
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty("TABLERO_URL");
  var token = props.getProperty("PLANILLA_TOKEN");

  if (!url || !token) {
    ui.alert(
      "Falta configurar el script",
      "En Configuracion del proyecto -> Propiedades del script hay que cargar " +
      "TABLERO_URL y PLANILLA_TOKEN. Ver el comentario de arriba del archivo.",
      ui.ButtonSet.OK
    );
    return;
  }

  var hoja = SpreadsheetApp.getActive().getSheetByName(HOJA);
  if (!hoja) {
    ui.alert("No encuentro la pestaña " + HOJA + " en esta planilla.");
    return;
  }

  var respuesta;
  try {
    respuesta = UrlFetchApp.fetch(
      url.replace(/\/+$/, "") + "/api/precios-tn/planilla",
      {
        headers: { Authorization: "Bearer " + token },
        muteHttpExceptions: true,
      }
    );
  } catch (e) {
    ui.alert("No se pudo hablar con el tablero", String(e), ui.ButtonSet.OK);
    return;
  }

  if (respuesta.getResponseCode() !== 200) {
    ui.alert(
      "El tablero contesto " + respuesta.getResponseCode(),
      respuesta.getResponseCode() === 401
        ? "El token no coincide con el que tiene el tablero (PLANILLA_PRECIOS_TOKEN)."
        : respuesta.getContentText().slice(0, 300),
      ui.ButtonSet.OK
    );
    return;
  }

  var datos = JSON.parse(respuesta.getContentText());
  var porSku = {};
  for (var i = 0; i < datos.precios.length; i++) {
    porSku[String(datos.precios[i].sku).trim()] = datos.precios[i];
  }

  var ultima = hoja.getLastRow();
  if (ultima <= FILA_ENCABEZADO) {
    ui.alert("La pestaña " + HOJA + " no tiene filas de datos.");
    return;
  }
  var cuantas = ultima - FILA_ENCABEZADO;

  // SE LEE TODO DE UNA Y SE ESCRIBE TODO DE UNA. Apps Script cobra cada
  // llamada a la hoja: fila por fila, 7.000 filas se van de los 6 minutos que
  // dura un script y queda a medio escribir.
  var skus = hoja.getRange(FILA_ENCABEZADO + 1, COL_SKU, cuantas, 1).getValues();
  var nuestros = hoja.getRange(FILA_ENCABEZADO + 1, COL_NUESTRO, cuantas, 1).getValues();
  var competencias = hoja.getRange(FILA_ENCABEZADO + 1, COL_COMPETENCIA, cuantas, 1).getValues();

  var conNuestro = 0, conCompetencia = 0, sinDato = 0;

  for (var f = 0; f < cuantas; f++) {
    var sku = String(skus[f][0] || "").trim();
    if (!sku) continue;
    var fila = porSku[sku];
    if (!fila) {
      sinDato++;
      continue;   // no lo conocemos: se deja como esta
    }
    if (fila.nuestro !== null && fila.nuestro !== undefined) {
      nuestros[f][0] = fila.nuestro;
      conNuestro++;
    }
    if (fila.competencia !== null && fila.competencia !== undefined) {
      competencias[f][0] = fila.competencia;
      conCompetencia++;
    }
  }

  hoja.getRange(FILA_ENCABEZADO + 1, COL_NUESTRO, cuantas, 1).setValues(nuestros);
  hoja.getRange(FILA_ENCABEZADO + 1, COL_COMPETENCIA, cuantas, 1).setValues(competencias);
  SpreadsheetApp.flush();

  var cuando = new Date(datos.generadoEn).toLocaleString("es-AR");
  ui.alert(
    "Listo",
    "Precio de venta actual escrito en " + conNuestro + " articulos.\n" +
    "Precio de la competencia escrito en " + conCompetencia + ".\n" +
    sinDato + " SKU de la planilla no estan en la ultima comparacion y " +
    "quedaron como estaban.\n\nDatos del tablero al " + cuando + ".",
    ui.ButtonSet.OK
  );
}
