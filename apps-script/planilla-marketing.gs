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
 *   4. Un FORMULARIO LATERAL (menú Marketing → Cargar datos) para cargar sin
 *      escribir en las hojas: valida los campos obligatorios, usa las mismas
 *      listas que la hoja Listas y escribe en la primera fila libre sin tocar
 *      las fórmulas. Una colaboración se carga entera, con sus productos de
 *      canje y su envío, en un solo paso.
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
    .addItem("Cargar datos (formulario)", "abrirFormulario")
    .addSubMenu(
      SpreadsheetApp.getUi()
        .createMenu("Cargar…")
        .addItem("Nueva colaboración", "formColaboracion")
        .addItem("Actualizar colaboración (estado, pago, link)", "formActualizar")
        .addItem("Nuevo influencer", "formInfluencer")
        .addItem("Envío", "formEnvio")
        .addItem("Producto de canje", "formProducto")
        .addItem("Otro gasto", "formGasto")
        .addItem("Presupuesto del mes", "formPresupuesto")
        .addItem("Pieza de contenido", "formContenido"),
    )
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

/** Se deja por compatibilidad con botones viejos: ahora abre el formulario. */
function nuevaColaboracion() {
  formColaboracion();
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

// ===========================================================================
//  FORMULARIO LATERAL
// ===========================================================================
//
// Todo lo que se carga pasa por acá y no a mano en las hojas: así no quedan
// campos vacíos ni textos que no están en las listas. Las reglas de qué es
// obligatorio viven en el SERVIDOR (estas funciones), no sólo en el
// formulario: el formulario avisa antes, pero el que decide es esto.
//
// ESCRIBE EN LA PRIMERA FILA LIBRE y respeta las fórmulas: las columnas grises
// ya tienen su fórmula puesta en las filas de abajo, y se dejan como están.

var TITULOS_FORM = {
  colaboracion: "Nueva colaboración",
  actualizar: "Actualizar colaboración",
  influencer: "Nuevo influencer",
  envio: "Envío",
  producto: "Producto de canje",
  gasto: "Otro gasto",
  presupuesto: "Presupuesto del mes",
  contenido: "Pieza de contenido",
};

function abrirFormulario(tipo) {
  var t = HtmlService.createTemplate(htmlFormulario_());
  t.tipoInicial = tipo || "colaboracion";
  var salida = t.evaluate().setTitle("Marketing · Cargar datos");
  SpreadsheetApp.getUi().showSidebar(salida);
}
function formColaboracion() { abrirFormulario("colaboracion"); }
function formActualizar() { abrirFormulario("actualizar"); }
function formInfluencer() { abrirFormulario("influencer"); }
function formEnvio() { abrirFormulario("envio"); }
function formProducto() { abrirFormulario("producto"); }
function formGasto() { abrirFormulario("gasto"); }
function formPresupuesto() { abrirFormulario("presupuesto"); }
function formContenido() { abrirFormulario("contenido"); }

// ---------------------------------------------------------------------------
// Lectura de hojas para el formulario
// ---------------------------------------------------------------------------

function hoja_(nombre) {
  var h = SpreadsheetApp.getActive().getSheetByName(nombre);
  if (!h) throw new Error("No existe la hoja '" + nombre + "'");
  var enc = h.getRange(FILA_ENCABEZADOS, 1, 1, h.getLastColumn()).getValues()[0].map(function (x) {
    return String(x).trim();
  });
  var idx = {};
  enc.forEach(function (e, i) {
    if (e) idx[e] = i;
  });
  return { hoja: h, enc: enc, idx: idx };
}

/** Las listas de la hoja Listas: { "Marcas": [...], "Modalidad": [...], ... } */
function listas_() {
  var h = SpreadsheetApp.getActive().getSheetByName("Listas");
  var v = h.getDataRange().getValues();
  var out = {};
  for (var c = 0; c < v[0].length; c++) {
    var nombre = String(v[0][c]).trim();
    if (!nombre) continue;
    out[nombre] = [];
    for (var r = 1; r < v.length; r++) if (String(v[r][c]).trim()) out[nombre].push(String(v[r][c]).trim());
  }
  return out;
}

function filasCon_(nombre, columnas) {
  var t = hoja_(nombre);
  var n = t.hoja.getLastRow() - FILA_ENCABEZADOS;
  if (n <= 0) return [];
  var v = t.hoja.getRange(FILA_ENCABEZADOS + 1, 1, n, t.enc.length).getValues();
  var zona = Session.getScriptTimeZone();
  return v
    .map(function (f) {
      var o = {};
      columnas.forEach(function (c) {
        var x = t.idx[c] === undefined ? "" : f[t.idx[c]];
        o[c] = x instanceof Date ? Utilities.formatDate(x, zona, "yyyy-MM-dd") : x;
      });
      return o;
    })
    .filter(function (o) {
      return String(o[columnas[0]]).trim() !== "";
    });
}

/** Lo que el formulario necesita para armar sus listas. */
function datosFormulario() {
  return {
    listas: listas_(),
    influencers: filasCon_("Influencers", ["Nombre", "Instagram"]).map(function (x) {
      return { nombre: String(x.Nombre), instagram: String(x.Instagram || "") };
    }),
    colaboraciones: filasCon_("Colaboraciones", ["ID", "Marca", "Influencer", "Fecha", "Estado", "Estado de pago"]).map(function (x) {
      return { id: x.ID, marca: x.Marca, influencer: x.Influencer, fecha: x.Fecha, estado: x.Estado, pago: x["Estado de pago"] };
    }),
    catalogo: filasCon_("Catálogo de costos", ["SKU", "Producto", "Costo unitario ($)", "Marca"]).map(function (x) {
      return { sku: String(x.SKU), producto: x.Producto, costo: Number(x["Costo unitario ($)"]) || 0, marca: x.Marca };
    }),
    proveedores: filasCon_("Proveedores", ["Proveedor"]).map(function (x) {
      return String(x.Proveedor);
    }),
    hoy: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd"),
  };
}

/** Una colaboración entera, para el formulario de actualizar. */
function leerColaboracion(id) {
  var t = hoja_("Colaboraciones");
  var fila = filaDe_(t, "ID", id);
  if (!fila) throw new Error("No existe la colaboración " + id);
  var v = t.hoja.getRange(fila, 1, 1, t.enc.length).getValues()[0];
  var zona = Session.getScriptTimeZone();
  var o = {};
  t.enc.forEach(function (e, i) {
    if (!e) return;
    o[e] = v[i] instanceof Date ? Utilities.formatDate(v[i], zona, "yyyy-MM-dd") : v[i];
  });
  return o;
}

// ---------------------------------------------------------------------------
// Escritura
// ---------------------------------------------------------------------------

function filaDe_(t, columna, valor) {
  var c = t.idx[columna];
  var n = t.hoja.getLastRow() - FILA_ENCABEZADOS;
  if (n <= 0) return 0;
  var v = t.hoja.getRange(FILA_ENCABEZADOS + 1, c + 1, n, 1).getValues();
  for (var i = 0; i < v.length; i++) if (String(v[i][0]).trim() === String(valor).trim()) return FILA_ENCABEZADOS + 1 + i;
  return 0;
}

/**
 * La primera fila donde la columna CLAVE está vacía. No se usa appendRow: las
 * fórmulas ya están puestas varios cientos de filas para abajo, y appendRow
 * escribiría después de todas ellas.
 */
function primeraLibre_(t, columnaClave) {
  var c = t.idx[columnaClave];
  var n = Math.max(t.hoja.getLastRow() - FILA_ENCABEZADOS, 1);
  var v = t.hoja.getRange(FILA_ENCABEZADOS + 1, c + 1, n, 1).getValues();
  for (var i = 0; i < v.length; i++) if (String(v[i][0]).trim() === "") return FILA_ENCABEZADOS + 1 + i;
  return FILA_ENCABEZADOS + 1 + v.length;
}

/** Escribe los campos de `obj` en la fila, sin pisar ninguna celda con fórmula. */
function escribirFila_(t, fila, obj) {
  var rango = t.hoja.getRange(fila, 1, 1, t.enc.length);
  var valores = rango.getValues()[0];
  var formulas = rango.getFormulas()[0];
  var salida = valores.map(function (v, i) {
    if (formulas[i]) return formulas[i];
    var e = t.enc[i];
    return e && obj.hasOwnProperty(e) ? obj[e] : v;
  });
  rango.setValues([salida]);
}

function proximoId_(t, prefijo, digitos) {
  var n = Math.max(t.hoja.getLastRow() - FILA_ENCABEZADOS, 1);
  var v = t.hoja.getRange(FILA_ENCABEZADOS + 1, t.idx["ID"] + 1, n, 1).getValues();
  var max = 0;
  v.forEach(function (f) {
    var m = String(f[0]).match(/(\d+)$/);
    if (String(f[0]).indexOf(prefijo) === 0 && m) max = Math.max(max, Number(m[1]));
  });
  return prefijo + ("0000" + (max + 1)).slice(-digitos);
}

// Conversión y validación ----------------------------------------------------

function fecha_(s) {
  if (!s) return "";
  var p = String(s).split("-");
  return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
}
function num_(s) {
  if (s === "" || s === null || s === undefined) return "";
  var n = Number(String(s).replace(",", "."));
  if (!isFinite(n) || n < 0) throw new Error("'" + s + "' no es un monto válido");
  return n;
}
function texto_(s) {
  return s === null || s === undefined ? "" : String(s).trim();
}
function requerir_(o, campos) {
  var faltan = campos.filter(function (c) {
    return texto_(o[c]) === "";
  });
  if (faltan.length) throw new Error("Falta completar: " + faltan.join(", "));
}
function enLista_(valor, lista, campo) {
  if (valor && lista.indexOf(valor) < 0) throw new Error(campo + ": '" + valor + "' no está en la lista");
}

function despues_(mensaje) {
  // Se intenta mandar al tablero en el momento; si falla (sin token, sin
  // red) no importa: el envío automático lo manda en la próxima hora.
  try {
    enviar_();
    return mensaje + " · enviado al tablero";
  } catch (e) {
    return mensaje;
  }
}

// Guardados ------------------------------------------------------------------

function guardarInfluencer(d) {
  var L = listas_();
  requerir_(d, ["Nombre", "Instagram", "Seguidores", "Estado del contacto"]);
  enLista_(d["Estado del contacto"], L["Estado del contacto"], "Estado del contacto");
  var t = hoja_("Influencers");
  var ig = "@" + texto_(d.Instagram).replace(/^@+/, "");
  if (filaDe_(t, "Instagram", ig)) throw new Error("Ya existe un influencer con " + ig);
  if (filaDe_(t, "Nombre", texto_(d.Nombre))) throw new Error("Ya existe un influencer llamado " + texto_(d.Nombre));
  var fila = primeraLibre_(t, "Nombre");
  var id = proximoId_(t, "INF-", 3);
  escribirFila_(t, fila, {
    ID: id,
    Nombre: texto_(d.Nombre),
    Instagram: ig,
    Red: texto_(d.Red) || "Instagram",
    "Provincia / ciudad": texto_(d["Provincia / ciudad"]),
    Nicho: texto_(d.Nicho),
    Seguidores: num_(d.Seguidores),
    Marcas: (d.Marcas || []).join(", "),
    "Tarifa historia ($)": num_(d["Tarifa historia ($)"]),
    "Tarifa reel ($)": num_(d["Tarifa reel ($)"]),
    "Tarifa pack ($)": num_(d["Tarifa pack ($)"]),
    "Acepta canje": texto_(d["Acepta canje"]),
    Email: texto_(d.Email),
    WhatsApp: texto_(d.WhatsApp),
    "Estado del contacto": d["Estado del contacto"],
    "Último contacto": fecha_(d["Último contacto"]),
    Observaciones: texto_(d.Observaciones),
  });
  return { id: id, mensaje: despues_("Influencer " + id + " cargado") };
}

/**
 * Una colaboración ENTERA: la fila de Colaboraciones, sus productos de canje
 * y, si se cargó, su envío. Las tres hojas quedan atadas por el mismo ID.
 */
function guardarColaboracion(d) {
  var L = listas_();
  requerir_(d, ["Marca", "Fecha", "Influencer", "Modalidad", "Formato", "Estado"]);
  enLista_(d.Marca, L["Marcas"], "Marca");
  enLista_(d.Modalidad, L["Modalidad"], "Modalidad");
  enLista_(d.Formato, L["Formato"], "Formato");
  enLista_(d.Estado, L["Estado colaboración"], "Estado");
  var conPago = d.Modalidad === "Pago" || d.Modalidad === "Pago + canje";
  var conCanje = d.Modalidad === "Canje" || d.Modalidad === "Pago + canje";
  if (conPago && !(num_(d["Honorarios ($)"]) > 0)) throw new Error("Una colaboración paga necesita los honorarios");
  var productos = (d.productos || []).filter(function (p) {
    return texto_(p.Producto) || texto_(p.SKU);
  });
  if (conCanje && !productos.length) throw new Error("Un canje necesita al menos un producto");
  productos.forEach(function (p, i) {
    if (!texto_(p.Producto)) throw new Error("Producto " + (i + 1) + ": falta el nombre");
    if (!(num_(p.Cantidad) > 0)) throw new Error("Producto " + (i + 1) + ": falta la cantidad");
  });
  var env = d.envio;
  if (env && env.cargar) requerir_(env, ["Fecha", "Transporte", "Costo envío ($)", "Estado"]);

  // Si el influencer no existe todavía, se crea con lo mínimo.
  var ti = hoja_("Influencers");
  if (!filaDe_(ti, "Nombre", texto_(d.Influencer))) {
    if (!texto_(d.nuevoInstagram)) throw new Error("Influencer nuevo: falta su @ de Instagram");
    guardarInfluencerMinimo_(ti, d);
  }

  var tc = hoja_("Colaboraciones");
  var id = proximoId_(tc, "COL-", 4);
  var fila = primeraLibre_(tc, "ID");
  escribirFila_(tc, fila, {
    ID: id,
    Marca: d.Marca,
    Fecha: fecha_(d.Fecha),
    Influencer: texto_(d.Influencer),
    Modalidad: d.Modalidad,
    Formato: d.Formato,
    Piezas: num_(d.Piezas),
    "Campaña / fecha comercial": texto_(d["Campaña / fecha comercial"]),
    "Producto / marca promocionada": texto_(d["Producto / marca promocionada"]),
    Objetivo: texto_(d.Objetivo),
    "Honorarios ($)": conPago ? num_(d["Honorarios ($)"]) : "",
    "IVA honorarios ($)": conPago ? num_(d["IVA honorarios ($)"]) : "",
    "Otros costos ($)": num_(d["Otros costos ($)"]),
    Estado: d.Estado,
    "Estado de pago": conPago ? texto_(d["Estado de pago"]) || "Pendiente" : "No aplica",
    "Medio de pago": conPago ? texto_(d["Medio de pago"]) : "",
    "Publicación prevista": fecha_(d["Publicación prevista"]),
    Cupón: texto_(d["Cupón"]).toUpperCase(),
    Observaciones: texto_(d.Observaciones),
  });

  var tp = hoja_("Productos canje");
  productos.forEach(function (p) {
    escribirFila_(tp, primeraLibre_(tp, "ID colaboración"), {
      "ID colaboración": id,
      "Fecha de entrega": env && env.cargar ? fecha_(env.Fecha) : "",
      SKU: texto_(p.SKU),
      Producto: texto_(p.Producto),
      Cantidad: num_(p.Cantidad),
      "Costo unitario ($)": num_(p["Costo unitario ($)"]),
      "PVP unitario ($)": num_(p["PVP unitario ($)"]),
    });
  });

  if (env && env.cargar) {
    var te = hoja_("Envíos");
    escribirFila_(te, primeraLibre_(te, "Destinatario"), {
      "ID colaboración": id,
      Fecha: fecha_(env.Fecha),
      Destinatario: texto_(d.Influencer),
      Marca: d.Marca,
      Tipo: "Influencer",
      Transporte: env.Transporte,
      Seguimiento: texto_(env.Seguimiento),
      "Costo envío ($)": num_(env["Costo envío ($)"]),
      Estado: env.Estado,
    });
  }
  return {
    id: id,
    mensaje: despues_(
      "Colaboración " + id + " cargada" + (productos.length ? " con " + productos.length + " producto(s)" : "") + (env && env.cargar ? " y envío" : ""),
    ),
  };
}

function guardarInfluencerMinimo_(ti, d) {
  var ig = "@" + texto_(d.nuevoInstagram).replace(/^@+/, "");
  if (filaDe_(ti, "Instagram", ig)) throw new Error("El @ " + ig + " ya está cargado con otro nombre");
  escribirFila_(ti, primeraLibre_(ti, "Nombre"), {
    ID: proximoId_(ti, "INF-", 3),
    Nombre: texto_(d.Influencer),
    Instagram: ig,
    Red: "Instagram",
    Seguidores: num_(d.nuevoSeguidores),
    Marcas: d.Marca,
    "Estado del contacto": "Aceptó",
    "Último contacto": fecha_(d.Fecha),
  });
}

/** Lo que cambia después de cargada: estado, pago, publicación y resultados. */
function actualizarColaboracion(d) {
  var L = listas_();
  requerir_(d, ["ID", "Estado"]);
  enLista_(d.Estado, L["Estado colaboración"], "Estado");
  enLista_(d["Estado de pago"], L["Estado de pago"], "Estado de pago");
  if (d["Estado de pago"] === "Pagado" && !d["Fecha de pago"]) throw new Error("Si está pagado, falta la fecha de pago");
  if (d.Estado === "Publicada" && !d["Publicación real"]) throw new Error("Si está publicada, falta la fecha de publicación");
  var t = hoja_("Colaboraciones");
  var fila = filaDe_(t, "ID", d.ID);
  if (!fila) throw new Error("No existe la colaboración " + d.ID);
  escribirFila_(t, fila, {
    Estado: d.Estado,
    "Estado de pago": d["Estado de pago"],
    "Fecha de pago": fecha_(d["Fecha de pago"]),
    "Medio de pago": texto_(d["Medio de pago"]),
    Factura: texto_(d.Factura),
    "Publicación real": fecha_(d["Publicación real"]),
    Link: texto_(d.Link),
    Cupón: texto_(d["Cupón"]).toUpperCase(),
    Alcance: num_(d.Alcance),
    Interacciones: num_(d.Interacciones),
    Observaciones: texto_(d.Observaciones),
  });
  return { id: d.ID, mensaje: despues_("Colaboración " + d.ID + " actualizada") };
}

function guardarEnvio(d) {
  var L = listas_();
  requerir_(d, ["Fecha", "Destinatario", "Marca", "Tipo", "Transporte", "Costo envío ($)", "Estado"]);
  enLista_(d.Marca, L["Marcas"], "Marca");
  enLista_(d.Tipo, L["Tipo de envío"], "Tipo");
  enLista_(d.Transporte, L["Transporte"], "Transporte");
  enLista_(d.Estado, L["Estado del envío"], "Estado");
  if (d.Tipo === "Influencer" && !d["ID colaboración"]) throw new Error("Un envío a influencer va con su colaboración");
  var t = hoja_("Envíos");
  escribirFila_(t, primeraLibre_(t, "Destinatario"), {
    "ID colaboración": texto_(d["ID colaboración"]),
    Fecha: fecha_(d.Fecha),
    Destinatario: texto_(d.Destinatario),
    Marca: d.Marca,
    Tipo: d.Tipo,
    Transporte: d.Transporte,
    Seguimiento: texto_(d.Seguimiento),
    "Costo envío ($)": num_(d["Costo envío ($)"]),
    Estado: d.Estado,
    Observaciones: texto_(d.Observaciones),
  });
  return { mensaje: despues_("Envío cargado") };
}

function guardarProducto(d) {
  requerir_(d, ["ID colaboración", "Producto", "Cantidad"]);
  var tc = hoja_("Colaboraciones");
  if (!filaDe_(tc, "ID", d["ID colaboración"])) throw new Error("No existe la colaboración " + d["ID colaboración"]);
  if (!(num_(d.Cantidad) > 0)) throw new Error("Falta la cantidad");
  var t = hoja_("Productos canje");
  escribirFila_(t, primeraLibre_(t, "ID colaboración"), {
    "ID colaboración": d["ID colaboración"],
    "Fecha de entrega": fecha_(d["Fecha de entrega"]),
    SKU: texto_(d.SKU),
    Producto: texto_(d.Producto),
    Cantidad: num_(d.Cantidad),
    "Costo unitario ($)": num_(d["Costo unitario ($)"]),
    "PVP unitario ($)": num_(d["PVP unitario ($)"]),
    Observaciones: texto_(d.Observaciones),
  });
  return { mensaje: despues_("Producto cargado en " + d["ID colaboración"]) };
}

function guardarGasto(d) {
  var L = listas_();
  requerir_(d, ["Fecha", "Marca", "Concepto", "Detalle", "Monto ($)", "Estado de pago"]);
  enLista_(d.Marca, L["Marcas"], "Marca");
  enLista_(d.Concepto, L["Concepto de gasto"], "Concepto");
  enLista_(d["Estado de pago"], L["Estado de pago"], "Estado de pago");
  if (d["Estado de pago"] === "Pagado" && !d["Fecha de pago"]) throw new Error("Si está pagado, falta la fecha de pago");
  var t = hoja_("Otros gastos");
  escribirFila_(t, primeraLibre_(t, "Fecha"), {
    Fecha: fecha_(d.Fecha),
    Marca: d.Marca,
    Concepto: d.Concepto,
    Proveedor: texto_(d.Proveedor),
    Detalle: texto_(d.Detalle),
    "Monto ($)": num_(d["Monto ($)"]),
    "IVA ($)": num_(d["IVA ($)"]),
    "Estado de pago": d["Estado de pago"],
    "Fecha de pago": fecha_(d["Fecha de pago"]),
    Factura: texto_(d.Factura),
    Observaciones: texto_(d.Observaciones),
  });
  return { mensaje: despues_("Gasto cargado") };
}

/** Presupuesto: si ya hay una fila para ese mes y marca, se actualiza (no se duplica). */
function guardarPresupuesto(d) {
  var L = listas_();
  requerir_(d, ["Mes", "Marca", "Presupuesto ($)"]);
  enLista_(d.Marca, L["Marcas"], "Marca");
  if (!/^\d{4}-\d{2}$/.test(d.Mes)) throw new Error("El mes va como aaaa-mm");
  var t = hoja_("Presupuesto");
  var n = Math.max(t.hoja.getLastRow() - FILA_ENCABEZADOS, 1);
  var v = t.hoja.getRange(FILA_ENCABEZADOS + 1, 1, n, 2).getDisplayValues();
  var fila = 0;
  for (var i = 0; i < v.length; i++) if (v[i][0] === d.Mes && v[i][1] === d.Marca) fila = FILA_ENCABEZADOS + 1 + i;
  var nueva = !fila;
  if (nueva) fila = primeraLibre_(t, "Mes");
  t.hoja.getRange(fila, t.idx["Mes"] + 1).setNumberFormat("@");
  escribirFila_(t, fila, { Mes: d.Mes, Marca: d.Marca, "Presupuesto ($)": num_(d["Presupuesto ($)"]), Nota: texto_(d.Nota) });
  return { mensaje: despues_("Presupuesto " + (nueva ? "cargado" : "actualizado") + ": " + d.Marca + " " + d.Mes) };
}

function guardarContenido(d) {
  var L = listas_();
  requerir_(d, ["ID colaboración", "Formato", "Título", "Estado"]);
  enLista_(d.Formato, L["Formato"], "Formato");
  var tc = hoja_("Colaboraciones");
  if (!filaDe_(tc, "ID", d["ID colaboración"])) throw new Error("No existe la colaboración " + d["ID colaboración"]);
  var t = hoja_("Contenido");
  escribirFila_(t, primeraLibre_(t, "ID colaboración"), {
    "ID colaboración": d["ID colaboración"],
    Formato: d.Formato,
    Título: texto_(d["Título"]),
    Concepto: texto_(d.Concepto),
    Guion: texto_(d.Guion),
    Copy: texto_(d.Copy),
    Fecha: fecha_(d.Fecha),
    Link: texto_(d.Link),
    Estado: texto_(d.Estado),
    Observaciones: texto_(d.Observaciones),
  });
  return { mensaje: despues_("Pieza cargada en " + d["ID colaboración"]) };
}

// ---------------------------------------------------------------------------
// El HTML del formulario. Va acá adentro, y no en un archivo .html aparte,
// para que instalar el script siga siendo pegar UN archivo.
// (Sin comillas invertidas ni "$" + "{" adentro: rompen esta plantilla.)
// ---------------------------------------------------------------------------
function htmlFormulario_() {
  return `<!DOCTYPE html>
<html><head><base target="_top">
<style>
  body{font-family:Arial,sans-serif;font-size:13px;color:#1f2937;margin:0;padding:12px}
  h2{font-size:15px;margin:0 0 8px;color:#1F3A5F}
  h3{font-size:12px;margin:14px 0 6px;color:#1F3A5F;text-transform:uppercase;letter-spacing:.03em}
  label{display:block;font-size:11px;color:#4b5563;margin:8px 0 2px}
  label .req{color:#b91c1c}
  input,select,textarea{width:100%;box-sizing:border-box;padding:6px;border:1px solid #cbd5e1;border-radius:6px;font-size:13px}
  textarea{min-height:52px}
  input.err,select.err,textarea.err{border-color:#dc2626;background:#fef2f2}
  .fila{display:flex;gap:6px}.fila>div{flex:1}
  .caja{border:1px solid #e5e7eb;border-radius:8px;padding:8px;margin-top:6px;background:#f9fafb}
  .prod{border-bottom:1px dashed #d1d5db;padding-bottom:6px;margin-bottom:6px}
  button{cursor:pointer;border:0;border-radius:6px;padding:8px 12px;font-size:13px}
  .prim{background:#1F3A5F;color:#fff;width:100%;margin-top:14px}
  .prim:disabled{opacity:.5}
  .sec{background:#e5e7eb;color:#111827;padding:5px 8px;font-size:12px}
  .quitar{background:none;color:#b91c1c;padding:2px 0;font-size:11px}
  .msg{margin-top:10px;padding:8px;border-radius:6px;font-size:12px;display:none}
  .ok{background:#dcfce7;color:#166534;display:block}.mal{background:#fee2e2;color:#991b1b;display:block}
  .nota{font-size:11px;color:#6b7280;margin-top:4px}
  .oculto{display:none}
</style></head>
<body>
<label>¿Qué querés cargar?</label>
<select id="tipo">
  <option value="colaboracion">Nueva colaboración</option>
  <option value="actualizar">Actualizar colaboración (estado, pago, link)</option>
  <option value="influencer">Nuevo influencer</option>
  <option value="envio">Envío</option>
  <option value="producto">Producto de canje</option>
  <option value="gasto">Otro gasto</option>
  <option value="presupuesto">Presupuesto del mes</option>
  <option value="contenido">Pieza de contenido</option>
</select>
<div id="form"><p class="nota">Cargando listas…</p></div>
<div id="msg" class="msg"></div>

<script>
var D = null;
var TIPO = "<?= tipoInicial ?>";
var FUNCION = {colaboracion:"guardarColaboracion", actualizar:"actualizarColaboracion", influencer:"guardarInfluencer",
  envio:"guardarEnvio", producto:"guardarProducto", gasto:"guardarGasto", presupuesto:"guardarPresupuesto", contenido:"guardarContenido"};

function esc(s){return String(s==null?"":s).replace(/[&<>"]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c];});}
function opts(lista, vacio){var h=vacio?'<option value="">'+esc(vacio)+'</option>':'';(lista||[]).forEach(function(o){var v=typeof o==="object"?o.v:o,t=typeof o==="object"?o.t:o;h+='<option value="'+esc(v)+'">'+esc(t)+'</option>';});return h;}
function campo(etq, nombre, html, req){return '<label>'+esc(etq)+(req?' <span class="req">*</span>':'')+'</label>'+html.replace('NAME','name="'+nombre+'"'+(req?' data-req="1"':''));}
function inp(etq,nombre,tipo,req,extra){return campo(etq,nombre,'<input NAME type="'+(tipo||"text")+'" '+(extra||"")+'>',req);}
function sel(etq,nombre,lista,req,vacio){return campo(etq,nombre,'<select NAME>'+opts(lista,vacio||"Elegir…")+'</select>',req);}
function area(etq,nombre,req){return campo(etq,nombre,'<textarea NAME></textarea>',req);}
function dos(a,b){return '<div class="fila"><div>'+a+'</div><div>'+b+'</div></div>';}
function L(n){return (D&&D.listas[n])||[];}
function colabOpts(){return D.colaboraciones.slice().reverse().map(function(c){return {v:c.id,t:c.id+" · "+c.marca+" · "+c.influencer};});}

function render(){
  var f=document.getElementById("form"), h="";
  if(TIPO==="colaboracion"){
    h+='<h2>Nueva colaboración</h2>';
    h+=dos(sel("Marca","Marca",L("Marcas"),1), inp("Fecha del acuerdo","Fecha","date",1,'value="'+D.hoy+'"'));
    h+=inp("Influencer","Influencer","text",1,'list="infls" placeholder="Escribí o elegí de la lista"');
    h+='<datalist id="infls">'+D.influencers.map(function(i){return '<option value="'+esc(i.nombre)+'">'+esc(i.instagram)+'</option>';}).join("")+'</datalist>';
    h+='<div id="nuevoInf" class="caja oculto"><div class="nota">No está en la base: se crea con estos datos.</div>'+dos(inp("@ Instagram","nuevoInstagram","text",0,'placeholder="@usuario"'),inp("Seguidores","nuevoSeguidores","number",0))+'</div>';
    h+=dos(sel("Modalidad","Modalidad",L("Modalidad"),1), sel("Formato","Formato",L("Formato"),1));
    h+=dos(inp("Piezas","Piezas","number",0,'min="1" value="1"'), sel("Estado","Estado",L("Estado colaboración"),1));
    h+=inp("Campaña / fecha comercial","Campaña / fecha comercial","text",0,'placeholder="Ej.: Día del Niño"');
    h+=inp("Producto / marca promocionada","Producto / marca promocionada","text",0);
    h+=area("Objetivo","Objetivo",0);
    h+='<div id="bloquePago" class="oculto"><h3>Pago</h3>'+dos(inp("Honorarios ($)","Honorarios ($)","number",0,'min="0"'),inp("IVA honorarios ($)","IVA honorarios ($)","number",0,'min="0"'))
      +dos(sel("Estado de pago","Estado de pago",["Pendiente","Pagado"],0,"Pendiente"), sel("Medio de pago","Medio de pago",L("Medio de pago"),0))+'</div>';
    h+='<div id="bloqueCanje" class="oculto"><h3>Productos del canje</h3><div class="nota">Costo = lo que nos cuesta. Si el SKU está en el catálogo, se completa solo.</div><div id="prods"></div><button type="button" class="sec" onclick="agregarProd()">+ Producto</button>';
    h+='<datalist id="skus">'+D.catalogo.map(function(c){return '<option value="'+esc(c.sku)+'">'+esc(c.producto)+'</option>';}).join("")+'</datalist></div>';
    h+='<h3>Envío</h3><label style="display:flex;gap:6px;align-items:center;font-size:12px;color:#111"><input type="checkbox" id="cargarEnvio" style="width:auto"> Cargar el envío ahora</label>';
    h+='<div id="bloqueEnvio" class="caja oculto">'+dos(inp("Fecha","env_Fecha","date",0,'value="'+D.hoy+'"'), sel("Transporte","env_Transporte",L("Transporte"),0))
      +dos(inp("Costo envío ($)","env_Costo envío ($)","number",0,'min="0"'), sel("Estado","env_Estado",L("Estado del envío"),0))+inp("Seguimiento","env_Seguimiento","text",0)+'</div>';
    h+='<h3>Resultado</h3>'+dos(inp("Publicación prevista","Publicación prevista","date",0), inp("Cupón","Cupón","text",0,'placeholder="HOLA-ANA10"'));
    h+='<div class="nota">Sin cupón no se puede medir la venta que trae.</div>';
    h+=inp("Otros costos ($)","Otros costos ($)","number",0,'min="0"')+area("Observaciones","Observaciones",0);
  } else if(TIPO==="actualizar"){
    h+='<h2>Actualizar colaboración</h2>'+sel("Colaboración","ID",colabOpts(),1);
    h+='<div id="campos" class="oculto">'+dos(sel("Estado","Estado",L("Estado colaboración"),1), sel("Estado de pago","Estado de pago",L("Estado de pago"),0));
    h+=dos(inp("Fecha de pago","Fecha de pago","date",0), sel("Medio de pago","Medio de pago",L("Medio de pago"),0))+inp("Factura","Factura","text",0);
    h+=dos(inp("Publicación real","Publicación real","date",0), inp("Cupón","Cupón","text",0))+inp("Link","Link","url",0);
    h+=dos(inp("Alcance","Alcance","number",0,'min="0"'), inp("Interacciones","Interacciones","number",0,'min="0"'))+area("Observaciones","Observaciones",0)+'</div>';
  } else if(TIPO==="influencer"){
    h+='<h2>Nuevo influencer</h2>'+inp("Nombre","Nombre","text",1)+dos(inp("@ Instagram","Instagram","text",1,'placeholder="@usuario"'), inp("Seguidores","Seguidores","number",1,'min="0"'));
    h+=dos(sel("Red","Red",L("Red"),0,"Instagram"), inp("Provincia / ciudad","Provincia / ciudad","text",0))+inp("Nicho","Nicho","text",0,'placeholder="Maternidad, juguetes, beauty…"');
    h+='<label>Marcas</label>'+L("Marcas").map(function(m){return '<label style="display:inline-flex;gap:4px;margin-right:8px;font-size:12px;color:#111"><input type="checkbox" class="marca" value="'+esc(m)+'" style="width:auto">'+esc(m)+'</label>';}).join("");
    h+='<h3>Tarifas</h3>'+dos(inp("Historia ($)","Tarifa historia ($)","number",0,'min="0"'), inp("Reel ($)","Tarifa reel ($)","number",0,'min="0"'))+dos(inp("Pack ($)","Tarifa pack ($)","number",0,'min="0"'), sel("Acepta canje","Acepta canje",["Sí","No"],0));
    h+='<h3>Contacto</h3>'+dos(inp("Email","Email","email",0), inp("WhatsApp","WhatsApp","text",0))+dos(sel("Estado del contacto","Estado del contacto",L("Estado del contacto"),1), inp("Último contacto","Último contacto","date",0,'value="'+D.hoy+'"'))+area("Observaciones","Observaciones",0);
  } else if(TIPO==="envio"){
    h+='<h2>Envío</h2>'+dos(sel("Tipo","Tipo",L("Tipo de envío"),1), sel("Marca","Marca",L("Marcas"),1));
    h+=sel("Colaboración (si es a un influencer)","ID colaboración",colabOpts(),0,"— Sin colaboración —")+inp("Destinatario","Destinatario","text",1);
    h+=dos(inp("Fecha","Fecha","date",1,'value="'+D.hoy+'"'), sel("Transporte","Transporte",L("Transporte"),1))+dos(inp("Costo envío ($)","Costo envío ($)","number",1,'min="0"'), sel("Estado","Estado",L("Estado del envío"),1));
    h+=inp("Seguimiento","Seguimiento","text",0)+area("Observaciones","Observaciones",0);
  } else if(TIPO==="producto"){
    h+='<h2>Producto de canje</h2>'+sel("Colaboración","ID colaboración",colabOpts(),1)+inp("SKU","SKU","text",0,'list="skus"');
    h+='<datalist id="skus">'+D.catalogo.map(function(c){return '<option value="'+esc(c.sku)+'">'+esc(c.producto)+'</option>';}).join("")+'</datalist>';
    h+=inp("Producto","Producto","text",1)+dos(inp("Cantidad","Cantidad","number",1,'min="1" value="1"'), inp("Fecha de entrega","Fecha de entrega","date",0))+dos(inp("Costo unitario ($)","Costo unitario ($)","number",0,'min="0"'), inp("PVP unitario ($)","PVP unitario ($)","number",0,'min="0"'));
    h+='<div class="nota">Si dejás el costo vacío, se usa el del Catálogo de costos.</div>'+area("Observaciones","Observaciones",0);
  } else if(TIPO==="gasto"){
    h+='<h2>Otro gasto</h2>'+dos(inp("Fecha","Fecha","date",1,'value="'+D.hoy+'"'), sel("Marca","Marca",L("Marcas"),1))+sel("Concepto","Concepto",L("Concepto de gasto"),1);
    h+=inp("Proveedor","Proveedor","text",0,'list="provs"')+'<datalist id="provs">'+opts(D.proveedores)+'</datalist>'+inp("Detalle","Detalle","text",1);
    h+=dos(inp("Monto ($)","Monto ($)","number",1,'min="0"'), inp("IVA ($)","IVA ($)","number",0,'min="0"'))+dos(sel("Estado de pago","Estado de pago",["Pendiente","Pagado"],1), inp("Fecha de pago","Fecha de pago","date",0));
    h+=inp("Factura","Factura","text",0)+area("Observaciones","Observaciones",0)+'<div class="nota">La pauta de Meta no hace falta: el tablero la lee de Meta Ads.</div>';
  } else if(TIPO==="presupuesto"){
    h+='<h2>Presupuesto del mes</h2>'+dos(inp("Mes","Mes","month",1,'value="'+D.hoy.slice(0,7)+'"'), sel("Marca","Marca",L("Marcas"),1))+inp("Presupuesto ($)","Presupuesto ($)","number",1,'min="0"')+inp("Nota","Nota","text",0);
    h+='<div class="nota">Si ya hay presupuesto para ese mes y marca, se reemplaza.</div>';
  } else if(TIPO==="contenido"){
    h+='<h2>Pieza de contenido</h2>'+sel("Colaboración","ID colaboración",colabOpts(),1)+dos(sel("Formato","Formato",L("Formato"),1), sel("Estado","Estado",["Planificado","En producción","Aprobado","Publicado"],1));
    h+=inp("Título","Título","text",1)+area("Concepto","Concepto",0)+area("Guion","Guion",0)+area("Copy","Copy",0)+dos(inp("Fecha","Fecha","date",0), inp("Link","Link","url",0))+area("Observaciones","Observaciones",0);
  }
  h+='<button class="prim" id="guardar" type="button" onclick="guardar()">Guardar</button>';
  f.innerHTML=h;
  enganchar();
}

function enganchar(){
  var q=function(n){return document.querySelector('[name="'+n+'"]');};
  // El rojo se va apenas se completa el campo, sin esperar al próximo Guardar.
  document.getElementById("form").addEventListener("input",function(e){if(String(e.target.value).trim())e.target.classList.remove("err");});
  document.getElementById("form").addEventListener("change",function(e){if(String(e.target.value).trim())e.target.classList.remove("err");});
  if(TIPO==="colaboracion"){
    var mod=q("Modalidad"), inf=q("Influencer");
    var ver=function(){var m=mod.value;document.getElementById("bloquePago").classList.toggle("oculto",!(m==="Pago"||m==="Pago + canje"));
      document.getElementById("bloqueCanje").classList.toggle("oculto",!(m==="Canje"||m==="Pago + canje"));
      if((m==="Canje"||m==="Pago + canje")&&!document.querySelectorAll(".prod").length)agregarProd();};
    mod.addEventListener("change",ver);
    inf.addEventListener("input",function(){var existe=D.influencers.some(function(i){return i.nombre===inf.value.trim();});
      document.getElementById("nuevoInf").classList.toggle("oculto",existe||!inf.value.trim());});
    document.getElementById("cargarEnvio").addEventListener("change",function(e){document.getElementById("bloqueEnvio").classList.toggle("oculto",!e.target.checked);});
  }
  if(TIPO==="actualizar"){
    q("ID").addEventListener("change",function(e){if(!e.target.value)return;mensaje("Cargando…","");
      google.script.run.withSuccessHandler(function(c){document.getElementById("campos").classList.remove("oculto");
        ["Estado","Estado de pago","Fecha de pago","Medio de pago","Factura","Publicación real","Cupón","Link","Alcance","Interacciones","Observaciones"].forEach(function(k){var el=q(k);if(el)el.value=c[k]==null?"":c[k];});
        mensaje("","");}).withFailureHandler(function(err){mensaje(err.message,"mal");}).leerColaboracion(e.target.value);});
  }
  if(TIPO==="producto"){q("SKU").addEventListener("change",function(e){completarSku(e.target,q("Producto"),q("Costo unitario ($)"));});}
  if(TIPO==="envio"){q("ID colaboración").addEventListener("change",function(e){var c=D.colaboraciones.filter(function(x){return x.id===e.target.value;})[0];
    if(c){q("Destinatario").value=c.influencer;q("Marca").value=c.marca;q("Tipo").value="Influencer";}});}
}

function completarSku(skuEl, prodEl, costoEl){var c=D.catalogo.filter(function(x){return x.sku===skuEl.value.trim();})[0];
  if(c){if(!prodEl.value)prodEl.value=c.producto;if(!costoEl.value&&c.costo)costoEl.placeholder="Catálogo: $"+c.costo;}}

function agregarProd(){var d=document.createElement("div");d.className="prod";
  d.innerHTML='<div class="fila"><div><label>SKU</label><input class="p_SKU" list="skus"></div><div><label>Cantidad <span class="req">*</span></label><input class="p_Cantidad" type="number" min="1" value="1"></div></div>'
   +'<label>Producto <span class="req">*</span></label><input class="p_Producto">'
   +'<div class="fila"><div><label>Costo unit. ($)</label><input class="p_Costo" type="number" min="0"></div><div><label>PVP unit. ($)</label><input class="p_PVP" type="number" min="0"></div></div>'
   +'<button type="button" class="quitar" onclick="this.parentNode.remove()">Quitar producto</button>';
  document.getElementById("prods").appendChild(d);
  d.querySelector(".p_SKU").addEventListener("change",function(e){completarSku(e.target,d.querySelector(".p_Producto"),d.querySelector(".p_Costo"));});}

function recolectar(){
  var o={}, faltan=[];
  document.querySelectorAll("#form [name]").forEach(function(el){
    var visible=!el.closest(".oculto");
    el.classList.remove("err");
    if(el.dataset.req&&visible&&!String(el.value).trim()){el.classList.add("err");faltan.push(el.name);}
    if(visible)o[el.name]=el.value;
  });
  if(TIPO==="influencer")o.Marcas=Array.prototype.map.call(document.querySelectorAll(".marca:checked"),function(x){return x.value;});
  if(TIPO==="colaboracion"){
    o.productos=Array.prototype.map.call(document.querySelectorAll("#bloqueCanje:not(.oculto) .prod"),function(p){
      return {SKU:p.querySelector(".p_SKU").value,Producto:p.querySelector(".p_Producto").value,Cantidad:p.querySelector(".p_Cantidad").value,
        "Costo unitario ($)":p.querySelector(".p_Costo").value,"PVP unitario ($)":p.querySelector(".p_PVP").value};});
    var env=document.getElementById("cargarEnvio").checked;
    o.envio={cargar:env};
    Object.keys(o).forEach(function(k){if(k.indexOf("env_")===0){o.envio[k.slice(4)]=o[k];delete o[k];}});
    if(env)["Fecha","Transporte","Costo envío ($)","Estado"].forEach(function(k){if(!String(o.envio[k]||"").trim()){faltan.push("Envío: "+k);var el=document.querySelector('[name="env_'+k+'"]');if(el)el.classList.add("err");}});
    var m=o.Modalidad;
    if((m==="Pago"||m==="Pago + canje")&&!(Number(o["Honorarios ($)"])>0)){faltan.push("Honorarios");var h=document.querySelector('[name="Honorarios ($)"]');if(h)h.classList.add("err");}
    if((m==="Canje"||m==="Pago + canje")&&!o.productos.some(function(p){return p.Producto.trim();}))faltan.push("al menos un producto del canje");
    var nuevo=!D.influencers.some(function(i){return i.nombre===String(o.Influencer||"").trim();});
    if(nuevo&&o.Influencer&&!String(o.nuevoInstagram||"").trim()){faltan.push("@ del influencer nuevo");var ig=document.querySelector('[name="nuevoInstagram"]');if(ig)ig.classList.add("err");}
  }
  return {datos:o,faltan:faltan};
}

function guardar(){
  var r=recolectar();
  if(r.faltan.length){mensaje("Falta completar: "+r.faltan.join(", "),"mal");return;}
  var b=document.getElementById("guardar");b.disabled=true;b.textContent="Guardando…";
  google.script.run.withSuccessHandler(function(res){mensaje(res.mensaje,"ok");cargar(true);})
    .withFailureHandler(function(err){b.disabled=false;b.textContent="Guardar";mensaje(err.message,"mal");})[FUNCION[TIPO]](r.datos);
}

function mensaje(t,clase){var m=document.getElementById("msg");m.textContent=t;m.className="msg "+(t?clase:"");}

function cargar(conservarMensaje){google.script.run.withSuccessHandler(function(d){D=d;render();if(!conservarMensaje)mensaje("","");})
  .withFailureHandler(function(err){mensaje("No se pudieron leer las listas: "+err.message,"mal");}).datosFormulario();}

document.getElementById("tipo").value=TIPO;
document.getElementById("tipo").addEventListener("change",function(e){TIPO=e.target.value;mensaje("","");if(D)render();});
cargar(false);
</script>
</body></html>`;
}
