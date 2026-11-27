/**
 * GOOGLE ANALYTICS 4 → TABLERO DE MARCA
 *
 * Apps Script independiente (script.google.com, no adentro de una planilla).
 * Corre con TU usuario de Google, que ya tiene acceso a las propiedades de
 * Analytics: no hace falta cuenta de servicio ni pedirle permiso a nadie.
 *
 * Una vez por día manda al tablero, de cada tienda, las sesiones, usuarios,
 * compras e ingresos por día y por canal de origen (Orgánico, Pago, Redes,
 * Directo...) de los últimos DIAS días. El tablero los muestra en "Visitas
 * tienda", "Origen del tráfico" y el embudo.
 *
 * CÓMO SE INSTALA (una sola vez)
 *   1. Entrar a script.google.com → "Nuevo proyecto". Ponerle de nombre
 *      "Analytics → Tablero".
 *   2. Borrar lo que trae y pegar ESTE archivo entero.
 *   3. Completar TOKEN abajo con el mismo valor que en el script de Google Ads.
 *   4. A la izquierda, en "Servicios", tocar "+" → elegir
 *      "Google Analytics Data API" → Agregar (el identificador tiene que
 *      quedar "AnalyticsData").
 *   5. Arriba, elegir la función "enviarTodo" y tocar "Ejecutar". La primera
 *      vez pide permisos: aceptar. En el registro de ejecución tiene que
 *      decir "Tablero: OK" por cada tienda.
 *   6. Para que corra solo: elegir la función "instalarDisparador" y tocar
 *      "Ejecutar" una vez. Queda programado todos los días a las 6.
 *
 * Para traer más historia la primera vez: cambiar DIAS a 400, ejecutar
 * "enviarTodo", y volver a poner 30.
 */

var TABLERO_URL = "https://brandmark-business.vercel.app";
var TOKEN = "PEGAR_ACA_EL_TOKEN";
// GA4 termina de procesar un día hasta 48 h después: se reenvía la ventana y
// el tablero reemplaza esos días.
var DIAS = 30;

// ID de PROPIEDAD de cada tienda (Administrar → Detalles de la propiedad).
var PROPIEDADES = [
  { marca: "diaper_genie", propiedad: "533748500" },
  { marca: "hola_toys", propiedad: "555275269" },
  { marca: "unibrandco", propiedad: "532486830" },
];

function enviarTodo() {
  if (!TOKEN || TOKEN === "PEGAR_ACA_EL_TOKEN") {
    throw new Error("Falta completar TOKEN al principio del script.");
  }
  var errores = [];
  PROPIEDADES.forEach(function (p) {
    try {
      enviarPropiedad(p.marca, p.propiedad);
    } catch (e) {
      errores.push(p.marca + ": " + e.message);
      Logger.log("ERROR " + p.marca + ": " + e.message);
    }
  });
  if (errores.length) throw new Error(errores.join(" | "));
}

function enviarPropiedad(marca, propiedad) {
  var zona = Session.getScriptTimeZone();
  var hoy = new Date();
  var desde = new Date(hoy.getTime() - (DIAS - 1) * 24 * 3600 * 1000);
  var f = function (d) {
    return Utilities.formatDate(d, zona, "yyyy-MM-dd");
  };

  var filas = [];
  var offset = 0;
  while (true) {
    var r = AnalyticsData.Properties.runReport(
      {
        dateRanges: [{ startDate: f(desde), endDate: f(hoy) }],
        dimensions: [{ name: "date" }, { name: "sessionDefaultChannelGroup" }],
        metrics: [
          { name: "sessions" },
          { name: "totalUsers" },
          { name: "newUsers" },
          { name: "engagedSessions" },
          { name: "ecommercePurchases" },
          { name: "purchaseRevenue" },
        ],
        limit: 10000,
        offset: offset,
      },
      "properties/" + propiedad
    );
    var rows = r.rows || [];
    rows.forEach(function (row) {
      var m = row.metricValues;
      filas.push({
        fecha: row.dimensionValues[0].value,
        canal: row.dimensionValues[1].value,
        sesiones: Number(m[0].value),
        usuarios: Number(m[1].value),
        usuarios_nuevos: Number(m[2].value),
        sesiones_comprometidas: Number(m[3].value),
        compras: Number(m[4].value),
        ingresos: Number(m[5].value),
      });
    });
    offset += rows.length;
    if (!rows.length || offset >= (r.rowCount || 0)) break;
  }

  var resp = UrlFetchApp.fetch(TABLERO_URL.replace(/\/+$/, "") + "/api/marketing/google-analytics", {
    method: "post",
    contentType: "application/json",
    headers: { Authorization: "Bearer " + TOKEN },
    payload: JSON.stringify({ propiedad: propiedad, marca: marca, desde: f(desde), hasta: f(hoy), filas: filas }),
    muteHttpExceptions: true,
  });
  var codigo = resp.getResponseCode();
  var texto = resp.getContentText();
  if (codigo !== 200) throw new Error("Tablero: HTTP " + codigo + " · " + texto.slice(0, 300));
  var j = JSON.parse(texto);
  Logger.log("Tablero: OK · " + marca + " · " + j.filas + " filas del " + j.desde + " al " + j.hasta + " · " + j.sesiones + " sesiones");
}

/** Deja programado enviarTodo todos los días a las 6 (una sola vez). */
function instalarDisparador() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "enviarTodo") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("enviarTodo").timeBased().everyDays(1).atHour(6).create();
  Logger.log("Listo: enviarTodo corre todos los días a las 6.");
}
