/**
 * Botón "Precios TN → Actualizar precios y competencia" en la planilla
 * "Markup Tienda nube".
 *
 * ===========================================================================
 *  EL BOTON ESCRIBE EN SU PROPIA HOJA, Y PRODUCTOS LA BUSCA POR SKU
 * ===========================================================================
 *
 * La primera version escribia los precios DIRECTO en las filas de PRODUCTOS,
 * por posicion. Andaba, y era una bomba de tiempo: PRODUCTOS sale de FUENTES,
 * que se actualiza sola. El dia que FUENTES cambie de orden o le entre una
 * fila, las filas de PRODUCTOS se corren y los precios escritos se quedan
 * donde estaban -- pegados al producto equivocado, sin que nada avise. Un
 * precio en la fila de otro articulo no se ve como un error: se ve como un
 * precio.
 *
 * Ademas, escribir solo encima tampoco borraba lo viejo: un SKU que salia de
 * la comparacion conservaba para siempre su ultimo precio.
 *
 * Asi que ahora:
 *
 *   1. El script BORRA Y REESCRIBE la hoja `PRECIOS TN`, que es suya. Lo que
 *      no vino en esta corrida desaparece, que es la unica forma de que la
 *      hoja diga lo que hay y no lo que hubo.
 *   2. PRODUCTOS trae los dos precios con un BUSCARV por SKU. Si las filas se
 *      corren, la formula sigue al SKU y el numero viaja con el.
 *
 * NO TOCA PRODUCTOS. Ni una celda. Por eso tampoco puede volver a pisar una
 * formula, que es lo que paso dos veces cuando se movieron las columnas.
 *
 * ===========================================================================
 *  LAS DOS FORMULAS QUE VAN EN PRODUCTOS (una vez, y se arrastran)
 * ===========================================================================
 *
 *   J7   Precio de venta actual (con IVA)
 *        =IF(OR($A7="";$A7=0);"";IFERROR(VLOOKUP(TO_TEXT($A7);'PRECIOS TN'!$A:$C;2;FALSE);""))
 *
 *   O7   Precio de la competencia (con IVA)
 *        =IF(OR($A7="";$A7=0);"";IFERROR(VLOOKUP(TO_TEXT($A7);'PRECIOS TN'!$A:$C;3;FALSE);""))
 *
 * El `TO_TEXT` es por el tipo del SKU: la hoja no cruza el texto "7795001"
 * con el numero 7795001. Del lado de aca se fuerza texto con el formato "@",
 * y `TO_TEXT` hace lo mismo del lado de PRODUCTOS. Con las dos puntas en
 * texto el cruce es exacto, venga el SKU como venga.
 *
 * El `IFERROR` deja la celda VACIA cuando el SKU no esta en la comparacion,
 * y vacio es lo que las demas formulas ya esperan: `IF(J7="";"";...)`. Un
 * cero diria "vale cero", que es otra cosa.
 *
 * ===========================================================================
 *  COMO SE INSTALA (una sola vez)
 * ===========================================================================
 *
 *   1. En la planilla: Extensiones -> Apps Script.
 *   2. Pegar este archivo entero y guardar.
 *   3. Configuracion del proyecto -> Propiedades del script -> dos:
 *        TABLERO_URL    https://<el dominio del tablero>
 *        PLANILLA_TOKEN el mismo valor que PLANILLA_PRECIOS_TOKEN en Vercel
 *   4. Recargar la planilla. Aparece el menu "Precios TN".
 *
 * El token va en las propiedades y NO escrito aca: este archivo vive en el
 * repositorio y cualquiera que lo lea veria la llave.
 */

var HOJA_DATOS = "PRECIOS TN";

var ENCABEZADOS = [
  "SKU",
  "Precio de venta actual (con IVA)",
  "Precio de la competencia (con IVA)",
];

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

  var respuesta;
  try {
    respuesta = UrlFetchApp.fetch(
      url.replace(/\/+$/, "") + "/api/precios-tn/planilla",
      { headers: { Authorization: "Bearer " + token }, muteHttpExceptions: true }
    );
  } catch (e) {
    ui.alert("No se pudo hablar con el tablero", String(e), ui.ButtonSet.OK);
    return;
  }

  if (respuesta.getResponseCode() !== 200) {
    mostrarError(ui, respuesta);
    return;
  }

  var datos = JSON.parse(respuesta.getContentText());

  // SE ARMA TODO EN MEMORIA Y SE ESCRIBE DE UNA. Apps Script cobra cada
  // llamada a la hoja: fila por fila, miles de filas se van de los 6 minutos
  // que dura un script y queda a medio escribir.
  var filas = [];
  var conCompetencia = 0;
  for (var i = 0; i < datos.precios.length; i++) {
    var p = datos.precios[i];
    var sku = String(p.sku == null ? "" : p.sku).trim();

    // SE SALTEA EL SKU VACIO Y EL "0". El vacio es obvio; el cero no.
    // En PRODUCTOS la columna A es `=FUENTES!D2`, y una formula sobre una
    // celda vacia no da vacio: da 0. Asi que TODAS las filas de PRODUCTOS que
    // sobran tienen A = 0. Si en esta hoja existiera una fila con SKU 0, el
    // BUSCARV de cada una de esas filas vacias la encontraria y se llenarian
    // de precios de la nada. Por eso tambien la formula pregunta por el 0:
    // alcanza con que falle uno de los dos lados.
    if (!sku || sku === "0") continue;
    var comp = p.competencia == null ? "" : p.competencia;
    if (comp !== "") conCompetencia++;
    filas.push([sku, p.nuestro == null ? "" : p.nuestro, comp]);
  }

  if (!filas.length) {
    ui.alert(
      "El tablero no devolvio ningun precio",
      "La ultima comparacion no dejo propuestas. No se toco la hoja " +
      HOJA_DATOS + ".",
      ui.ButtonSet.OK
    );
    return;
  }

  var libro = SpreadsheetApp.getActive();
  var hoja = libro.getSheetByName(HOJA_DATOS);
  if (!hoja) hoja = libro.insertSheet(HOJA_DATOS);

  // BORRAR ANTES DE ESCRIBIR, Y LA HOJA ENTERA. Si solo se escribiera encima,
  // una corrida con menos SKU que la anterior dejaria los viejos abajo: la
  // hoja mostraria precios de articulos que ya no se comparan, mezclados con
  // los de ahora, y el BUSCARV de PRODUCTOS los encontraria igual.
  hoja.clearContents();

  hoja.getRange(1, 1, 1, ENCABEZADOS.length).setValues([ENCABEZADOS]);

  // LA COLUMNA DEL SKU VA FORMATEADA COMO TEXTO, Y ESTO NO ES COSMETICO.
  //
  // `setValues` con el string "7795001" no deja texto: la hoja lo interpreta
  // igual que si alguien lo tipeara, y queda el NUMERO 7795001. En PRODUCTOS
  // el SKU es texto (viene de FUENTES, que lo trae como texto). Y BUSCARV no
  // cruza el texto "7795001" con el numero 7795001: no los considera iguales.
  // Serian 8.291 filas de #N/A, o sea la columna vacia de nuevo -- el mismo
  // sintoma de las dos veces anteriores, por una causa distinta.
  //
  // Con el formato "@" puesto ANTES de escribir, el string entra como string.
  hoja.getRange(2, 1, filas.length, 1).setNumberFormat("@");
  hoja.getRange(2, 1, filas.length, ENCABEZADOS.length).setValues(filas);
  hoja.setFrozenRows(1);
  hoja.getRange(1, 1, 1, ENCABEZADOS.length).setFontWeight("bold");

  // CUANDO CORRIO LA COMPARACION, al lado y no en una columna: es un dato de
  // la hoja entera, no de cada fila.
  var cuando = datos.comparadoEn ? new Date(datos.comparadoEn) : null;
  hoja.getRange(1, ENCABEZADOS.length + 2).setValue(
    cuando
      ? "Comparacion del " + cuando.toLocaleString("es-AR") +
        " · actualizado el " + new Date().toLocaleString("es-AR")
      : "Sin fecha de comparacion"
  );

  SpreadsheetApp.flush();
  ui.alert("Listo", resumen(filas.length, conCompetencia, cuando), ui.ButtonSet.OK);
}

/** El texto del cartel final. */
function resumen(cuantas, conCompetencia, cuando) {
  var texto =
    cuantas + " articulos escritos en la hoja " + HOJA_DATOS + ".\n" +
    conCompetencia + " con precio de la competencia.\n\n" +
    "PRODUCTOS los toma de ahi por SKU, asi que ya deberia verse actualizada.\n\n";

  if (!cuando) return texto + "No se sabe de cuando es la comparacion.";

  var dias = Math.floor((new Date() - cuando) / 86400000);
  if (dias >= 1) {
    // SE AVISA CUANDO EL DATO NO ES DE HOY. Una comparacion vieja se pega
    // igual de prolija que una de hoy.
    return texto +
      "OJO: la competencia es de la comparacion del " + cuando.toLocaleString("es-AR") +
      " (" + dias + (dias === 1 ? " dia" : " dias") + " atras). " +
      "Para traer la de hoy hay que correr la comparacion primero.";
  }
  return texto + "Comparacion del " + cuando.toLocaleString("es-AR") + ".";
}

/** Por que no contesto el tablero, en castellano y sin afirmar de mas. */
function mostrarError(ui, respuesta) {
  var cuerpo = respuesta.getContentText();
  var motivo = "";
  var detalle = "";
  try {
    var json = JSON.parse(cuerpo);
    motivo = json.motivo || "";
    detalle = json.detalle || "";
  } catch (e) {
    // No contesto JSON: lo mas probable es que ni siquiera se haya llegado a
    // la ruta. Se muestra crudo, que es lo unico honesto.
  }

  var titulo = "El tablero contesto " + respuesta.getResponseCode();
  var texto;
  if (motivo === "sin_configurar") {
    titulo = "Al tablero le falta el token";
    texto = detalle;
  } else if (motivo === "token_invalido") {
    titulo = "El token no coincide";
    texto =
      "El PLANILLA_TOKEN de este script no es igual al PLANILLA_PRECIOS_TOKEN " +
      "del tablero. Ojo con los espacios o el salto de linea al copiar.";
  } else if (respuesta.getResponseCode() === 404) {
    texto =
      "La direccion existe pero no esa ruta. Revisa TABLERO_URL, y que el " +
      "tablero ya se haya desplegado con /api/precios-tn/planilla.";
  } else {
    texto = cuerpo.slice(0, 300);
  }
  ui.alert(titulo, texto, ui.ButtonSet.OK);
}
