/**
 * Planilla "Marketing Brandmark — Colaboraciones y presupuesto".
 *
 * ===========================================================================
 *  QUÉ HACE
 * ===========================================================================
 *
 * La planilla es UNA para las cuatro marcas (Diaper Genie, Hola Toys,
 * Unibrandco, Litter Genie) y se llena a mano. Este script:
 *
 *   1. Manda una FOTO ENTERA de la planilla al tablero
 *      (POST /api/marketing/planilla). El Tablero de Marca lee siempre la
 *      última: presupuesto por marca, inversión en influencers (honorarios,
 *      canje, envío), otros gastos y estado de pagos.
 *   2. Trae del tablero la VENTA POR CUPÓN de Tienda Nube y la escribe en
 *      "Colaboraciones" (Pedidos con cupón, Venta con cupón), así el ROI de
 *      cada influencer se calcula solo en la planilla.
 *   3. Pone el ID a cada colaboración e influencer nuevo (COL-0001, INF-001).
 *
 * Lee las hojas POR NOMBRE DE COLUMNA, no por posición: se pueden agregar
 * columnas o moverlas, mientras los encabezados de la fila 3 sigan iguales.
 *
 * ===========================================================================
 *  CÓMO SE INSTALA (una sola vez)
 * ===========================================================================
 *
 *   1. Subir el Excel a Google Drive y abrirlo con Hojas de cálculo de Google
 *      (Archivo → Guardar como Hojas de cálculo de Google).
 *   2. Extensiones → Apps Script. Pegar este archivo entero y guardar.
 *   3. Configuración del proyecto (el engranaje) → Propiedades del script:
 *        TABLERO_URL         https://brandmark-business.vercel.app
 *        MKT_PLANILLA_TOKEN  el mismo valor que MKT_PLANILLA_TOKEN en Vercel
 *   4. Recargar la planilla. Aparece el menú "Marketing". La primera vez pide
 *      autorización (Google avisa que la app no está verificada: es el script
 *      de la propia planilla; Avanzado → Ir a ... → Permitir).
 *   5. Marketing → Activar envío automático (cada hora).
 *
 * El token va en las propiedades y NO escrito acá: este archivo vive en el
 * repositorio y cualquiera que lo lea vería la llave.
 */

var FILA_ENCABEZADOS = 3;

/** Hoja de la planilla → clave con la que viaja al tablero. */
var HOJAS = {
  colaboraciones: "Colaboraciones",
  productos: "Productos canje",
  envios: "Envíos",
  gastos: "Otros gastos",
  presupuesto: "Presupuesto",
  influencers: "Influencers",
};

var CELDA_ULTIMO_ENVIO = "H1"; // en la hoja Resumen

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Marketing")
    .addItem("Nueva colaboración", "nuevaColaboracion")
    .addSeparator()
    .addItem("Enviar al tablero ahora", "enviarAlTablero")
    .addItem("Traer ventas por cupón", "traerVentasPorCupon")
    .addSeparator()
    .addItem("Activar envío automático (cada hora)", "activarEnvioAutomatico")
    .addItem("Desactivar envío automático", "desactivarEnvioAutomatico")
    .addToUi();
}

// ---------------------------------------------------------------------------
// IDs automáticos
// ---------------------------------------------------------------------------

/**
 * Al escribir la Marca de una colaboración nueva (o el Nombre de un
 * influencer nuevo) se completa el ID si está vacío. Los IDs no se reusan:
 * se toma el número más alto que haya y se le suma uno.
 */
function onEdit(e) {
  var hoja = e.range.getSheet();
  var nombre = hoja.getName();
  if (e.range.getRow() <= FILA_ENCABEZADOS) return;
  if (nombre === HOJAS.colaboraciones) completarIds_(hoja, "COL-", 4);
  if (nombre === HOJAS.influencers) completarIds_(hoja, "INF-", 3);
}

function completarIds_(hoja, prefijo, digitos) {
  var datos = hoja.getRange(FILA_ENCABEZADOS + 1, 1, Math.max(hoja.getLastRow() - FILA_ENCABEZADOS, 1), 3).getValues();
  var max = 0;
  datos.forEach(function (f) {
    var m = String(f[0]).match(/(\d+)$/);
    if (String(f[0]).indexOf(prefijo) === 0 && m) max = Math.max(max, Number(m[1]));
  });
  datos.forEach(function (f, i) {
    var tieneDatos = String(f[1]).trim() !== "" || String(f[2]).trim() !== "";
    if (!String(f[0]).trim() && tieneDatos) {
      max += 1;
      hoja.getRange(FILA_ENCABEZADOS + 1 + i, 1).setValue(prefijo + ("0000" + max).slice(-digitos));
    }
  });
}

function nuevaColaboracion() {
  var hoja = SpreadsheetApp.getActive().getSheetByName(HOJAS.colaboraciones);
  var ids = hoja.getRange(FILA_ENCABEZADOS + 1, 1, Math.max(hoja.getLastRow() - FILA_ENCABEZADOS, 1), 1).getValues();
  var fila = FILA_ENCABEZADOS + 1;
  var max = 0;
  ids.forEach(function (f, i) {
    if (String(f[0]).trim()) fila = FILA_ENCABEZADOS + 2 + i;
    var m = String(f[0]).match(/(\d+)$/);
    if (m) max = Math.max(max, Number(m[1]));
  });
  hoja.getRange(fila, 1).setValue("COL-" + ("0000" + (max + 1)).slice(-4));
  hoja.getRange(fila, 3).setValue(new Date());
  hoja.setActiveRange(hoja.getRange(fila, 2));
  SpreadsheetApp.getActive().toast("Elegí la marca y completá la fila. El costo del canje y del envío se suman solos desde sus hojas.", "Nueva colaboración", 8);
}

// ---------------------------------------------------------------------------
// Envío al tablero
// ---------------------------------------------------------------------------

function leerHoja_(nombre) {
  var hoja = SpreadsheetApp.getActive().getSheetByName(nombre);
  if (!hoja) return [];
  var ultima = hoja.getLastRow();
  var columnas = hoja.getLastColumn();
  if (ultima <= FILA_ENCABEZADOS || columnas === 0) return [];
  var enc = hoja.getRange(FILA_ENCABEZADOS, 1, 1, columnas).getValues()[0].map(function (h) {
    return String(h).trim();
  });
  var valores = hoja.getRange(FILA_ENCABEZADOS + 1, 1, ultima - FILA_ENCABEZADOS, columnas).getValues();
  var zona = Session.getScriptTimeZone();
  var filas = [];
  valores.forEach(function (fila) {
    var obj = {};
    var vacia = true;
    enc.forEach(function (h, i) {
      if (!h) return;
      var v = fila[i];
      if (v instanceof Date) v = Utilities.formatDate(v, zona, "yyyy-MM-dd");
      if (v !== "" && v !== null) vacia = false;
      obj[h] = v;
    });
    if (!vacia) filas.push(obj);
  });
  return filas;
}

function config_() {
  var props = PropertiesService.getScriptProperties();
  var url = (props.getProperty("TABLERO_URL") || "").replace(/\/+$/, "");
  var token = props.getProperty("MKT_PLANILLA_TOKEN");
  if (!url || !token) {
    throw new Error(
      "Faltan las propiedades del script TABLERO_URL y MKT_PLANILLA_TOKEN " +
        "(Extensiones → Apps Script → Configuración del proyecto).",
    );
  }
  return { url: url, token: token };
}

function enviar_() {
  var c = config_();
  var hojas = {};
  Object.keys(HOJAS).forEach(function (k) {
    hojas[k] = leerHoja_(HOJAS[k]);
  });
  var cuerpo = JSON.stringify({ version: 1, enviado: new Date().toISOString(), hojas: hojas });
  var r = UrlFetchApp.fetch(c.url + "/api/marketing/planilla", {
    method: "post",
    contentType: "application/json",
    payload: cuerpo,
    headers: { Authorization: "Bearer " + c.token, "X-Planilla": SpreadsheetApp.getActive().getName() },
    muteHttpExceptions: true,
  });
  var j = {};
  try {
    j = JSON.parse(r.getContentText());
  } catch (e) {
    throw new Error("El tablero contestó algo que no es JSON (HTTP " + r.getResponseCode() + "). ¿Está bien TABLERO_URL?");
  }
  if (!j.ok) throw new Error(j.mensaje || j.error || "HTTP " + r.getResponseCode());
  var resumen = SpreadsheetApp.getActive().getSheetByName("Resumen");
  if (resumen) {
    resumen
      .getRange(CELDA_ULTIMO_ENVIO)
      .setValue("Último envío al tablero: " + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "dd/MM/yyyy HH:mm"));
  }
  return j;
}

function enviarAlTablero() {
  try {
    var j = enviar_();
    SpreadsheetApp.getUi().alert(
      "Enviado al tablero",
      j.colaboraciones + " colaboraciones, " + j.gastos + " gastos, " + j.presupuesto +
        " filas de presupuesto y " + j.envios + " envíos.",
      SpreadsheetApp.getUi().ButtonSet.OK,
    );
  } catch (e) {
    SpreadsheetApp.getUi().alert("No se pudo enviar", String(e.message || e), SpreadsheetApp.getUi().ButtonSet.OK);
  }
}

/** Lo corre el disparador horario: sin ventanas, sólo deja el error en el registro. */
function envioAutomatico() {
  enviar_();
}

function activarEnvioAutomatico() {
  desactivarEnvioAutomatico(true);
  ScriptApp.newTrigger("envioAutomatico").timeBased().everyHours(1).create();
  SpreadsheetApp.getActive().toast("La planilla se va a mandar sola al tablero cada hora.", "Envío automático", 6);
}

function desactivarEnvioAutomatico(silencioso) {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "envioAutomatico") ScriptApp.deleteTrigger(t);
  });
  if (silencioso !== true) SpreadsheetApp.getActive().toast("Envío automático desactivado.", "Envío automático", 5);
}

// ---------------------------------------------------------------------------
// Venta por cupón (tablero → planilla)
// ---------------------------------------------------------------------------

var MARCA_CLAVE = {
  "Diaper Genie": "diaper_genie",
  "Hola Toys": "hola_toys",
  Unibrandco: "unibrandco",
  "Litter Genie": "litter_genie",
};

/**
 * Escribe Pedidos con cupón y Venta con cupón ($) en cada colaboración que
 * tenga cupón. SÓLO esas dos columnas: no toca nada más de la fila.
 */
function traerVentasPorCupon() {
  var ui = SpreadsheetApp.getUi();
  try {
    var c = config_();
    var r = UrlFetchApp.fetch(c.url + "/api/marketing/planilla", {
      method: "get",
      headers: { Authorization: "Bearer " + c.token },
      muteHttpExceptions: true,
    });
    var j = JSON.parse(r.getContentText());
    if (!j.ok) throw new Error(j.mensaje || j.error);
    var porCupon = {};
    j.cupones.forEach(function (x) {
      porCupon[x.marca + "|" + String(x.cupon).toUpperCase()] = x;
    });

    var hoja = SpreadsheetApp.getActive().getSheetByName(HOJAS.colaboraciones);
    var enc = hoja.getRange(FILA_ENCABEZADOS, 1, 1, hoja.getLastColumn()).getValues()[0].map(String);
    var col = function (h) {
      var i = enc.indexOf(h);
      if (i < 0) throw new Error("Falta la columna '" + h + "' en Colaboraciones");
      return i;
    };
    var cMarca = col("Marca"), cCupon = col("Cupón"), cPed = col("Pedidos con cupón"), cVenta = col("Venta con cupón ($)");
    var n = hoja.getLastRow() - FILA_ENCABEZADOS;
    if (n <= 0) return;
    var datos = hoja.getRange(FILA_ENCABEZADOS + 1, 1, n, enc.length).getValues();
    var pedidos = [], ventas = [], actualizadas = 0;
    datos.forEach(function (f) {
      var cupon = String(f[cCupon]).trim().toUpperCase();
      var x = cupon ? porCupon[(MARCA_CLAVE[f[cMarca]] || "") + "|" + cupon] : null;
      pedidos.push([x ? x.pedidos : cupon ? 0 : f[cPed]]);
      ventas.push([x ? x.venta : cupon ? 0 : f[cVenta]]);
      if (x) actualizadas++;
    });
    hoja.getRange(FILA_ENCABEZADOS + 1, cPed + 1, n, 1).setValues(pedidos);
    hoja.getRange(FILA_ENCABEZADOS + 1, cVenta + 1, n, 1).setValues(ventas);
    ui.alert("Ventas por cupón", actualizadas + " colaboraciones con ventas encontradas en Tienda Nube.", ui.ButtonSet.OK);
  } catch (e) {
    ui.alert("No se pudieron traer las ventas", String(e.message || e), ui.ButtonSet.OK);
  }
}
