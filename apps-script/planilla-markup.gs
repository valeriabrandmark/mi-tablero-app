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
    // EL CARTEL DICE CUAL DE LAS DOS COSAS ES, Y ANTES NO.
    //
    // Decia "el token no coincide" ante cualquier 401, y la primera vez que
    // fallo de verdad la causa era la otra: la variable estaba cargada en
    // Vercel pero no desplegada. Se reviso tres veces un token que estaba
    // bien. Un mensaje que afirma una causa que no comprobó es peor que uno
    // que dice "no se".
    var cuerpo = respuesta.getContentText();
    var motivo = "";
    var detalle = "";
    try {
      var json = JSON.parse(cuerpo);
      motivo = json.motivo || "";
      detalle = json.detalle || "";
    } catch (e) {
      // El tablero no contesto JSON: lo mas probable es que ni siquiera haya
      // llegado a la ruta (404 de Vercel, una URL mal escrita, un login de
      // por medio). Se muestra crudo, que es lo unico honesto.
    }

    var titulo = "El tablero contesto " + respuesta.getResponseCode();
    var texto;
    if (motivo === "sin_configurar") {
      titulo = "Al tablero le falta el token";
      texto = detalle;
    } else if (motivo === "token_invalido") {
      titulo = "El token no coincide";
      texto =
        "El PLANILLA_TOKEN de este script no es igual al " +
        "PLANILLA_PRECIOS_TOKEN del tablero. Ojo con los espacios o el salto " +
        "de linea al final cuando se copia y pega.";
    } else if (respuesta.getResponseCode() === 404) {
      texto =
        "La direccion existe pero no esa ruta. Revisa TABLERO_URL, y que el " +
        "tablero ya se haya desplegado con la ruta /api/precios-tn/planilla.";
    } else {
      texto = cuerpo.slice(0, 300);
    }
    ui.alert(titulo, texto, ui.ButtonSet.OK);
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

  // SE MUESTRA CUANDO CORRIO LA COMPARACION, no cuando contesto el tablero.
  // Antes decia la hora de la respuesta --siempre "ahora"-- al lado de unos
  // precios que podian ser de hace tres dias.
  var cuando = datos.comparadoEn
    ? new Date(datos.comparadoEn).toLocaleString("es-AR")
    : null;
  var dias = cuando
    ? Math.floor((new Date() - new Date(datos.comparadoEn)) / 86400000)
    : null;

  var pie;
  if (!cuando) {
    pie = "No se sabe de cuando es la comparacion.";
  } else if (dias >= 1) {
    // SE AVISA CUANDO EL DATO NO ES DE HOY. Una comparacion vieja se pega
    // igual de prolija que una de hoy: sin esto, la planilla se ve recien
    // actualizada y los precios de la competencia son de la semana pasada.
    pie =
      "OJO: la competencia es de la comparacion del " + cuando +
      " (" + dias + (dias === 1 ? " dia" : " dias") + " atras). " +
      "Para traer la de hoy hay que correr la comparacion primero.";
  } else {
    pie = "Comparacion del " + cuando + ".";
  }

  ui.alert(
    "Listo",
    "Precio de venta actual escrito en " + conNuestro + " articulos.\n" +
    "Precio de la competencia escrito en " + conCompetencia + ".\n" +
    sinDato + " SKU de la planilla no estan en la ultima comparacion y " +
    "quedaron como estaban.\n\n" + pie,
    ui.ButtonSet.OK
  );
}
