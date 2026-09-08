/**
 * Un escritor de archivos .xlsx, sin dependencias.
 *
 * ---------------------------------------------------------------------------
 * POR QUÉ ESTÁ ESCRITO A MANO Y NO ES UNA LIBRERÍA
 *
 * Lo único que hace falta es UNA hoja con encabezado, filas y una fila de
 * total. Las librerías del rubro (exceljs, sheetjs) traen fórmulas, gráficos,
 * tablas dinámicas y lectura de archivos ajenos: entre 400 KB y 1 MB de
 * JavaScript que el navegador descarga para escribir doce columnas. Este
 * archivo son ~200 líneas y no agrega nada al package.json, que en este
 * proyecto tiene siete dependencias y conviene que las siga teniendo.
 *
 * ---------------------------------------------------------------------------
 * QUÉ ES UN .xlsx
 *
 * Un ZIP con XML adentro. Las partes mínimas que Excel exige son cinco:
 *
 *   [Content_Types].xml        qué es cada archivo del paquete
 *   _rels/.rels                dónde empieza todo
 *   xl/workbook.xml            el libro y sus hojas
 *   xl/_rels/workbook.xml.rels dónde está cada hoja
 *   xl/worksheets/sheet1.xml   las celdas
 *
 * y una sexta, `xl/styles.xml`, que es opcional para Excel pero no para
 * nosotros: sin ella no hay negrita ni formato de moneda.
 *
 * EL ZIP VA SIN COMPRIMIR (método `stored`). Comprimir obligaría a implementar
 * deflate, que es el 90 % del trabajo y el 100 % de los bugs posibles. Una
 * orden de 500 renglones da unos 200 KB en vez de 20: es un archivo que se
 * manda por mail una vez, no algo que se sirva mil veces por día.
 *
 * LAS CADENAS VAN EN LA CELDA (`inlineStr`) y no en la tabla compartida de
 * textos. Es una parte menos que puede quedar desincronizada, y el ahorro de
 * la tabla compartida sólo aparece cuando el mismo texto se repite miles de
 * veces — acá cada renglón es un artículo distinto.
 */

/* -------------------------------------------------------------------------
   EL ZIP
   ------------------------------------------------------------------------- */

/** Tabla de CRC-32, la que pide el formato ZIP. Se arma una sola vez. */
let TABLA_CRC: Uint32Array | null = null;

function tablaCrc(): Uint32Array {
  if (TABLA_CRC) return TABLA_CRC;
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  TABLA_CRC = t;
  return t;
}

function crc32(datos: Uint8Array): number {
  const t = tablaCrc();
  let c = 0xffffffff;
  for (let i = 0; i < datos.length; i++) c = t[(c ^ datos[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

type Entrada = { nombre: string; datos: Uint8Array; crc: number };

/**
 * La fecha y hora que lleva cada archivo adentro del ZIP, en el formato de
 * MS-DOS: dos enteros de 16 bits, con los segundos de a dos y el año contado
 * desde 1980. Es un campo informativo —ningún lector lo usa para abrir el
 * archivo— pero puesto en cero Excel muestra "1980" en las propiedades.
 */
function fechaHoraDos(d: Date): { fecha: number; hora: number } {
  const anio = Math.max(1980, d.getFullYear());
  return {
    fecha: ((anio - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
    hora: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
  };
}

function armarZip(entradas: Entrada[]): Uint8Array<ArrayBuffer> {
  const { fecha, hora } = fechaHoraDos(new Date());
  const nombres = entradas.map((e) => new TextEncoder().encode(e.nombre));

  let total = 0;
  for (let i = 0; i < entradas.length; i++) {
    total += 30 + nombres[i].length + entradas[i].datos.length; // cabecera local
    total += 46 + nombres[i].length; // entrada del directorio central
  }
  total += 22; // el cierre

  const salida = new Uint8Array(total);
  const vista = new DataView(salida.buffer);
  let pos = 0;
  const u16 = (v: number) => {
    vista.setUint16(pos, v, true);
    pos += 2;
  };
  const u32 = (v: number) => {
    vista.setUint32(pos, v, true);
    pos += 4;
  };
  const bytes = (b: Uint8Array) => {
    salida.set(b, pos);
    pos += b.length;
  };

  // --- Los archivos, uno atrás del otro ---
  const desplazamientos: number[] = [];
  for (let i = 0; i < entradas.length; i++) {
    const e = entradas[i];
    desplazamientos.push(pos);
    u32(0x04034b50); // firma de cabecera local
    u16(20); // versión necesaria para extraer (2.0)
    u16(0); // sin banderas
    u16(0); // método 0 = guardado sin comprimir
    u16(hora);
    u16(fecha);
    u32(e.crc);
    u32(e.datos.length); // comprimido
    u32(e.datos.length); // sin comprimir: es el mismo, no hay compresión
    u16(nombres[i].length);
    u16(0); // sin campos extra
    bytes(nombres[i]);
    bytes(e.datos);
  }

  // --- El índice: qué hay y en qué byte empieza ---
  const inicioDirectorio = pos;
  for (let i = 0; i < entradas.length; i++) {
    const e = entradas[i];
    u32(0x02014b50); // firma de entrada del directorio
    u16(20); // versión con la que se creó
    u16(20); // versión necesaria para extraer
    u16(0);
    u16(0);
    u16(hora);
    u16(fecha);
    u32(e.crc);
    u32(e.datos.length);
    u32(e.datos.length);
    u16(nombres[i].length);
    u16(0); // extra
    u16(0); // comentario
    u16(0); // número de disco
    u16(0); // atributos internos
    u32(0); // atributos externos
    u32(desplazamientos[i]);
    bytes(nombres[i]);
  }

  // --- El cierre, que es lo que el lector busca primero ---
  //
  // El tamaño del directorio se mide ANTES de empezar a escribir este bloque:
  // `pos` avanza con cada campo, y usarlo más abajo daría 12 bytes de más --
  // los que van del inicio del cierre hasta ese punto. El archivo se abre
  // igual en algunos lectores y falla en otros, que es la peor forma de
  // romperse.
  const finDirectorio = pos;
  u32(0x06054b50);
  u16(0); // disco actual
  u16(0); // disco donde arranca el directorio
  u16(entradas.length);
  u16(entradas.length);
  u32(finDirectorio - inicioDirectorio);
  u32(inicioDirectorio);
  u16(0); // sin comentario
  return salida;
}

/* -------------------------------------------------------------------------
   EL XML
   ------------------------------------------------------------------------- */

const CABECERA_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

/**
 * Escapa lo que no puede ir crudo en XML.
 *
 * Y ADEMÁS SACA LOS CARACTERES DE CONTROL, que es la parte que se olvida: XML
 * 1.0 no admite bytes por debajo del espacio salvo tab y salto de línea, y una
 * descripción de artículo con basura del maestro alcanza para que Excel diga
 * que el archivo está dañado y no lo abra.
 */
function esc(t: string): string {
  return t
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** El nombre de la columna en Excel: 1 -> A, 27 -> AA. */
function letraColumna(n: number): string {
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - r) / 26);
  }
  return s;
}

/* -------------------------------------------------------------------------
   LA HOJA
   ------------------------------------------------------------------------- */

/**
 * Cómo se muestra una columna. Es formato de PRESENTACIÓN: el número que se
 * guarda es siempre el número, así que el que recibe el archivo puede sumar,
 * ordenar y filtrar sin tener que limpiar nada.
 */
export type FormatoXlsx = "texto" | "entero" | "moneda" | "porcentaje";

export type ColumnaXlsx = {
  titulo: string;
  formato: FormatoXlsx;
  /** Ancho en caracteres. Sin esto todo sale en el ancho por defecto y los
   *  nombres de artículo quedan cortados. */
  ancho: number;
};

/**
 * Una celda. `null` es una celda VACÍA y no un cero: un artículo sin EAN
 * cargado no tiene EAN, y un 0 ahí sería un dato inventado.
 */
export type CeldaXlsx = string | number | null;

/**
 * Los estilos, en el orden en que Excel los numera (`s="..."` en cada celda).
 * Se arman en `styles.xml` de más abajo y este objeto es el índice: tenerlo
 * como constante evita que un número suelto en el código apunte al estilo
 * equivocado.
 */
const ESTILO = {
  normal: 0,
  encabezado: 1,
  texto: 2,
  entero: 3,
  moneda: 4,
  porcentaje: 5,
  textoTotal: 6,
  enteroTotal: 7,
  monedaTotal: 8,
  porcentajeTotal: 9,
} as const;

const ESTILO_POR_FORMATO: Record<FormatoXlsx, number> = {
  texto: ESTILO.texto,
  entero: ESTILO.entero,
  moneda: ESTILO.moneda,
  porcentaje: ESTILO.porcentaje,
};

const ESTILO_TOTAL_POR_FORMATO: Record<FormatoXlsx, number> = {
  texto: ESTILO.textoTotal,
  entero: ESTILO.enteroTotal,
  moneda: ESTILO.monedaTotal,
  porcentaje: ESTILO.porcentajeTotal,
};

function celdaXml(ref: string, valor: CeldaXlsx, estilo: number): string {
  if (valor == null || valor === "") return "";
  if (typeof valor === "number") {
    // Un NaN o un infinito rompen el archivo entero: Excel no los sabe leer y
    // avisa que está dañado. Se cae a celda vacía, que es la verdad.
    if (!Number.isFinite(valor)) return "";
    return `<c r="${ref}" s="${estilo}"><v>${valor}</v></c>`;
  }
  return `<c r="${ref}" s="${estilo}" t="inlineStr"><is><t xml:space="preserve">${esc(valor)}</t></is></c>`;
}

function filaXml(numero: number, celdas: CeldaXlsx[], estilos: number[]): string {
  let s = `<row r="${numero}">`;
  for (let i = 0; i < celdas.length; i++) {
    s += celdaXml(`${letraColumna(i + 1)}${numero}`, celdas[i], estilos[i]);
  }
  return s + "</row>";
}

const ESTILOS_XML =
  CABECERA_XML +
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  // Los formatos propios arrancan en 164: del 0 al 163 son los que Excel trae
  // de fábrica y pisarlos es un archivo corrupto.
  '<numFmts count="3">' +
  '<numFmt numFmtId="164" formatCode="#,##0"/>' +
  '<numFmt numFmtId="165" formatCode="&quot;$&quot;\\ #,##0.00"/>' +
  '<numFmt numFmtId="166" formatCode="0.0%"/>' +
  "</numFmts>" +
  '<fonts count="2">' +
  '<font><sz val="11"/><name val="Calibri"/></font>' +
  '<font><b/><sz val="11"/><name val="Calibri"/></font>' +
  "</fonts>" +
  // El relleno 0 y el 1 son obligatorios y en ese orden: Excel los da por
  // sentados y numera los propios a partir del 2.
  '<fills count="3">' +
  '<fill><patternFill patternType="none"/></fill>' +
  '<fill><patternFill patternType="gray125"/></fill>' +
  '<fill><patternFill patternType="solid"><fgColor rgb="FFE9EDF5"/><bgColor indexed="64"/></patternFill></fill>' +
  "</fills>" +
  '<borders count="2">' +
  "<border><left/><right/><top/><bottom/><diagonal/></border>" +
  '<border><left/><right/><top/><bottom style="thin"><color rgb="FF9AA5B8"/></bottom><diagonal/></border>' +
  "</borders>" +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  // El orden de acá abajo ES el objeto ESTILO de arriba. Se tocan juntos.
  '<cellXfs count="10">' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1"/>' +
  '<xf numFmtId="164" fontId="1" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>' +
  '<xf numFmtId="165" fontId="1" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>' +
  '<xf numFmtId="166" fontId="1" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>' +
  "</cellXfs>" +
  // El estilo "Normal" es formalmente opcional y en la práctica no: sin él,
  // los lectores estrictos avisan que el libro no tiene estilo por defecto.
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  "</styleSheet>";

/** Lo que Excel no acepta en el nombre de una hoja, más el tope de 31. */
function nombreDeHoja(n: string): string {
  const limpio = n.replace(/[\\/*?:[\]]/g, " ").trim();
  return (limpio || "Hoja1").slice(0, 31);
}

export type LibroXlsx = {
  hoja: string;
  columnas: ColumnaXlsx[];
  filas: CeldaXlsx[][];
  /** La fila de cierre, en negrita y con una línea arriba. Opcional. */
  total?: CeldaXlsx[];
};

/**
 * Arma el archivo. Devuelve los bytes: quien lo llama decide si los baja, los
 * manda por mail o los guarda.
 */
export function aXlsx(libro: LibroXlsx): Uint8Array<ArrayBuffer> {
  const { columnas, filas } = libro;
  const estilos = columnas.map((c) => ESTILO_POR_FORMATO[c.formato]);
  const estilosTotal = columnas.map((c) => ESTILO_TOTAL_POR_FORMATO[c.formato]);
  const encabezados = columnas.map(() => ESTILO.encabezado);

  const cols = columnas
    .map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.ancho}" customWidth="1"/>`)
    .join("");

  let cuerpo = filaXml(
    1,
    columnas.map((c) => c.titulo),
    encabezados,
  );
  for (let i = 0; i < filas.length; i++) cuerpo += filaXml(i + 2, filas[i], estilos);
  if (libro.total) cuerpo += filaXml(filas.length + 2, libro.total, estilosTotal);

  const ultima = letraColumna(columnas.length);
  const alto = filas.length + (libro.total ? 2 : 1);

  const hoja =
    CABECERA_XML +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    `<dimension ref="A1:${ultima}${alto}"/>` +
    // El encabezado queda fijo al scrollear. En una orden de 300 renglones es
    // la diferencia entre saber qué columna se está mirando y no saberlo.
    '<sheetViews><sheetView workbookViewId="0">' +
    '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' +
    "</sheetView></sheetViews>" +
    '<sheetFormatPr defaultRowHeight="15"/>' +
    `<cols>${cols}</cols>` +
    `<sheetData>${cuerpo}</sheetData>` +
    // El filtro de Excel sobre el encabezado. No incluye la fila de total: si
    // la incluyera, filtrar por proveedor la escondería.
    `<autoFilter ref="A1:${ultima}${filas.length + 1}"/>` +
    "</worksheet>";

  const contentTypes =
    CABECERA_XML +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    "</Types>";

  const rels =
    CABECERA_XML +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    "</Relationships>";

  const workbook =
    CABECERA_XML +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"' +
    ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    `<sheets><sheet name="${esc(nombreDeHoja(libro.hoja))}" sheetId="1" r:id="rId1"/></sheets>` +
    "</workbook>";

  const workbookRels =
    CABECERA_XML +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
    "</Relationships>";

  const codificador = new TextEncoder();
  const entrada = (nombre: string, texto: string): Entrada => {
    const datos = codificador.encode(texto);
    return { nombre, datos, crc: crc32(datos) };
  };

  return armarZip([
    entrada("[Content_Types].xml", contentTypes),
    entrada("_rels/.rels", rels),
    entrada("xl/workbook.xml", workbook),
    entrada("xl/_rels/workbook.xml.rels", workbookRels),
    entrada("xl/styles.xml", ESTILOS_XML),
    entrada("xl/worksheets/sheet1.xml", hoja),
  ]);
}
