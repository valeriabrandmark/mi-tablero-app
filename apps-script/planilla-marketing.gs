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
 *   4. Un FORMULARIO LATERAL (menú Marketing → Cargar…) para cargar sin
 *      escribir en las hojas: valida los campos obligatorios, usa las mismas
 *      listas que la hoja Listas y escribe en la primera fila libre sin tocar
 *      las fórmulas. Una colaboración se carga entera, con sus productos de
 *      canje y su envío, en un solo paso. El HTML del formulario va en el
 *      archivo "Formulario" del mismo proyecto.
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
 *   2. Extensiones → Apps Script. Pegar este archivo entero en Código.gs.
 *      Después, "+" → HTML, llamarlo exactamente "Formulario" y pegar ahí
 *      apps-script/planilla-marketing-formulario.html. Guardar.
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
  // El HTML vive en su propio archivo del proyecto: "Formulario" (copia de
  // apps-script/planilla-marketing-formulario.html).
  var t = HtmlService.createTemplateFromFile("Formulario");
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
