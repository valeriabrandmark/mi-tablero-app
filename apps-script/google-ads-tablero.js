/**
 * GOOGLE ADS → TABLERO DE MARCA
 *
 * Script de Google Ads (no de Sheets): se pega en la cuenta de Google Ads y
 * manda al tablero la inversión, los clics, las impresiones y las conversiones
 * de cada campaña, día por día, de los últimos DIAS días. El tablero los suma
 * por marca en la tarjeta "Google Ads".
 *
 * POR QUÉ UN SCRIPT Y NO LA API: la API de Google Ads pide un token de
 * desarrollador que Google aprueba a mano. El script corre adentro de la
 * cuenta con los permisos de quien lo pega, y no hay nada que aprobar.
 *
 * CÓMO SE INSTALA (una sola vez)
 *   1. En Google Ads: Herramientas → Acciones masivas → Secuencias de comandos
 *      (Scripts) → botón "+" → Nueva secuencia de comandos.
 *   2. Borrar lo que trae y pegar ESTE archivo entero.
 *   3. Completar TOKEN abajo con el mismo valor de MKT_PLANILLA_TOKEN de Vercel
 *      (o de MKT_GOOGLE_ADS_TOKEN si se cargó uno propio).
 *   4. "Autorizar" y después "Vista previa": en Registros tiene que decir
 *      "Tablero: OK".
 *   5. Guardar y en Frecuencia elegir "Cada hora".
 *
 * Si se pega en una cuenta ADMINISTRADORA (MCC), recorre todas las cuentas que
 * administra y manda cada una por separado.
 *
 * A QUÉ MARCA VA CADA CAMPAÑA lo decide el tablero (lib/queries-marketing.ts):
 * por la variable GOOGLE_ADS_CUENTA_<MARCA> de Vercel, o por el nombre de la
 * campaña o de la cuenta ("Hola Toys", "Diaper Genie"...).
 */

var TABLERO_URL = "https://brandmark-business.vercel.app";
var TOKEN = "PEGAR_ACA_EL_TOKEN";
// Las conversiones se atribuyen días después del clic: se reenvía la ventana
// entera y el tablero reemplaza esos días.
var DIAS = 30;

function main() {
  if (!TOKEN || TOKEN === "PEGAR_ACA_EL_TOKEN") {
    throw new Error("Falta completar TOKEN al principio del script.");
  }
  var cuentas = cuentasAdministradas();
  if (cuentas) {
    while (cuentas.hasNext()) {
      AdsManagerApp.select(cuentas.next());
      enviarCuentaActual();
    }
  } else {
    enviarCuentaActual();
  }
}

/** Las cuentas de una MCC, o null si el script corre en una cuenta común. */
function cuentasAdministradas() {
  try {
    return AdsManagerApp.accounts().get();
  } catch (e) {
    return null;
  }
}

function enviarCuentaActual() {
  var cuenta = AdsApp.currentAccount();
  var zona = cuenta.getTimeZone();
  var hoy = new Date();
  var desde = new Date(hoy.getTime() - (DIAS - 1) * 24 * 3600 * 1000);
  var f = function (d) {
    return Utilities.formatDate(d, zona, "yyyy-MM-dd");
  };

  var consulta =
    "SELECT segments.date, campaign.id, campaign.name, metrics.cost_micros, metrics.clicks, " +
    "metrics.impressions, metrics.conversions, metrics.conversions_value " +
    "FROM campaign " +
    "WHERE segments.date BETWEEN '" + f(desde) + "' AND '" + f(hoy) + "' AND metrics.impressions > 0";

  var filas = [];
  var it = AdsApp.search(consulta);
  while (it.hasNext()) {
    var r = it.next();
    filas.push({
      fecha: r.segments.date,
      campana_id: String(r.campaign.id),
      campana: r.campaign.name,
      costo: Number(r.metrics.costMicros || 0) / 1000000,
      clics: Number(r.metrics.clicks || 0),
      impresiones: Number(r.metrics.impressions || 0),
      conversiones: Number(r.metrics.conversions || 0),
      valor: Number(r.metrics.conversionsValue || 0),
    });
  }

  var cuerpo = {
    cuenta: { id: cuenta.getCustomerId(), nombre: cuenta.getName(), moneda: cuenta.getCurrencyCode() },
    desde: f(desde),
    hasta: f(hoy),
    filas: filas,
  };
  var resp = UrlFetchApp.fetch(TABLERO_URL.replace(/\/+$/, "") + "/api/marketing/google-ads", {
    method: "post",
    contentType: "application/json",
    headers: { Authorization: "Bearer " + TOKEN },
    payload: JSON.stringify(cuerpo),
    muteHttpExceptions: true,
  });
  var codigo = resp.getResponseCode();
  var texto = resp.getContentText();
  if (codigo !== 200) {
    throw new Error("Tablero: HTTP " + codigo + " · " + texto.slice(0, 300));
  }
  var j = JSON.parse(texto);
  Logger.log(
    "Tablero: OK · cuenta " + cuenta.getName() + " (" + cuenta.getCustomerId() + ") · " +
      j.filas + " filas del " + j.desde + " al " + j.hasta + " · inversión " + j.costo + " " + cuenta.getCurrencyCode()
  );
}
