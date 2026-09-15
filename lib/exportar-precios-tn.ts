import { NOMBRE_FUENTE } from "@/lib/precios-tn";
import type { CeldaXlsx, ColumnaXlsx, LibroXlsx } from "@/lib/xlsx";
import type { FilaPrecioTn } from "@/lib/types";

/**
 * Bajar la cola de precios como Excel o como PDF.
 *
 * ---------------------------------------------------------------------------
 * UNA SOLA DEFINICIÓN DE COLUMNAS PARA LOS DOS FORMATOS.
 *
 * La tentación era armar cada archivo por su lado —el Excel necesita números
 * crudos, el PDF necesita texto ya formateado— y eso termina en dos listas de
 * columnas que se van separando. El día que se agrega una, alguien la agrega en
 * una sola y nadie se entera hasta que compara los dos archivos.
 *
 * Así que las columnas se declaran una vez, cada una sabe sacar su valor crudo
 * y su texto, y los dos exportadores leen de ahí.
 *
 * QUÉ NO VA: los motivos que el motor escribe debajo de cada artículo. Es una
 * lista de frases por fila, y en una grilla se convierten en una celda enorme
 * que rompe el alto de todas las demás. Quien necesita el motivo lo tiene en la
 * pantalla, que es donde se decide.
 * ---------------------------------------------------------------------------
 */

const fmtPesos = (n: number | null): string =>
  n === null ? "" : n.toLocaleString("es-AR", { style: "currency", currency: "ARS" });

const fmtPorciento = (n: number | null): string =>
  n === null ? "" : `${(n * 100).toLocaleString("es-AR", { maximumFractionDigits: 1 })} %`;

/** Cómo se llama cada grupo en el archivo. El código interno no le sirve a nadie. */
const NOMBRE_GRUPO: Record<string, string> = {
  no_competible: "No se puede competir sin perder",
  bajo_piso: "Vendiendo por debajo del piso",
  caros: "Por encima de nuestro objetivo",
  baratos: "Por debajo de nuestro objetivo",
  sin_competencia: "Sin competencia detectada",
  sin_stock: "Sin stock",
  no_evaluable: "No se pueden evaluar",
  corregidos_sin_competir: "Corregidos pero sin competir",
  en_precio: "En precio",
};

type ColumnaExport = {
  titulo: string;
  formato: ColumnaXlsx["formato"];
  ancho: number;
  /** Para el Excel: el número o el texto crudo, sin formatear. */
  valor: (f: FilaPrecioTn) => CeldaXlsx;
  /** Para el PDF: ya formateado, porque ahí no hay quien lo formatee después. */
  texto: (f: FilaPrecioTn) => string;
  /** Alineación en el PDF. Los números a la derecha, como en la pantalla. */
  derecha?: boolean;
};

export const COLUMNAS_EXPORT: ColumnaExport[] = [
  { titulo: "SKU", formato: "texto", ancho: 12, valor: (f) => f.sku, texto: (f) => f.sku },
  {
    titulo: "Producto",
    formato: "texto",
    ancho: 42,
    valor: (f) => f.descripcion,
    texto: (f) => f.descripcion,
  },
  {
    titulo: "Marca",
    formato: "texto",
    ancho: 16,
    valor: (f) => f.marca,
    texto: (f) => f.marca ?? "",
  },
  {
    titulo: "Proveedor",
    formato: "texto",
    ancho: 18,
    valor: (f) => f.proveedor,
    texto: (f) => f.proveedor ?? "",
  },
  {
    titulo: "Grupo",
    formato: "texto",
    ancho: 28,
    valor: (f) => NOMBRE_GRUPO[f.grupo] ?? f.grupo,
    texto: (f) => NOMBRE_GRUPO[f.grupo] ?? f.grupo,
  },
  {
    titulo: "Acción",
    formato: "texto",
    ancho: 10,
    valor: (f) => f.accion,
    texto: (f) => f.accion,
  },
  {
    titulo: "Estado",
    formato: "texto",
    ancho: 11,
    valor: (f) => f.estado,
    texto: (f) => f.estado,
  },
  {
    titulo: "Stock",
    formato: "entero",
    ancho: 8,
    valor: (f) => f.stock,
    texto: (f) => (f.stock === null ? "" : String(f.stock)),
    derecha: true,
  },
  // LOS PRECIOS COMO NÚMERO EN EL EXCEL, no como texto con signo de pesos.
  // Quien recibe el archivo tiene que poder sumar y ordenar sin limpiar nada.
  {
    titulo: "Precio hoy",
    formato: "moneda",
    ancho: 13,
    valor: (f) => f.precioActual,
    texto: (f) => fmtPesos(f.precioActual),
    derecha: true,
  },
  {
    titulo: "Precio propuesto",
    formato: "moneda",
    ancho: 15,
    valor: (f) => f.precioPropuesto,
    texto: (f) => fmtPesos(f.precioPropuesto),
    derecha: true,
  },
  {
    titulo: "Costo neto",
    formato: "moneda",
    ancho: 13,
    valor: (f) => f.costo,
    texto: (f) => fmtPesos(f.costo),
    derecha: true,
  },
  {
    titulo: "Piso",
    formato: "moneda",
    ancho: 13,
    valor: (f) => f.piso,
    texto: (f) => fmtPesos(f.piso),
    derecha: true,
  },
  // EL PORCENTAJE COMO FRACCIÓN: en el .xlsx el 15 % se guarda 0,15 y se
  // muestra "15,0 %". Guardar el 15 pelado obligaría a quien recibe el archivo
  // a acordarse de que ese número son puntos y no una cantidad.
  {
    titulo: "Margen actual",
    formato: "porcentaje",
    ancho: 13,
    valor: (f) => f.margenActual,
    texto: (f) => fmtPorciento(f.margenActual),
    derecha: true,
  },
  {
    titulo: "Margen propuesto",
    formato: "porcentaje",
    ancho: 15,
    valor: (f) => f.margenPropuesto,
    texto: (f) => fmtPorciento(f.margenPropuesto),
    derecha: true,
  },
  {
    titulo: "Mejor competencia",
    formato: "moneda",
    ancho: 15,
    valor: (f) => f.mejorCompetencia,
    texto: (f) => fmtPesos(f.mejorCompetencia),
    derecha: true,
  },
  {
    titulo: "vs mercado",
    formato: "porcentaje",
    ancho: 11,
    valor: (f) => f.difMercado,
    texto: (f) => fmtPorciento(f.difMercado),
    derecha: true,
  },
  {
    // UNA COLUMNA Y NO UNA POR COMPETIDOR. Cuáles contestan cambia de corrida
    // en corrida, así que una columna por fuente dejaría la mitad vacías y el
    // archivo de ayer no se podría comparar con el de hoy.
    titulo: "Competencia",
    formato: "texto",
    ancho: 46,
    valor: (f) => competenciaEnTexto(f),
    texto: (f) => competenciaEnTexto(f),
  },
  {
    titulo: "Ficha en nuestra tienda",
    formato: "texto",
    ancho: 40,
    valor: (f) => f.url,
    texto: (f) => f.url ?? "",
  },
];

function competenciaEnTexto(f: FilaPrecioTn): string {
  if (!f.competidores?.length) return "";
  return [...f.competidores]
    .sort((a, b) => a.precio - b.precio)
    .map((c) => {
      const nombre = NOMBRE_FUENTE[c.fuente] ?? c.fuente;
      const stock = c.disponible ? "" : " (sin stock)";
      return `${nombre} ${fmtPesos(c.precio)} ${c.dia}${stock}`;
    })
    .join(" · ");
}

/** Las líneas de arriba del archivo: qué es esto y de cuándo habla. */
function caratula(filas: FilaPrecioTn[], comparadoEn: string | null, filtro: string): string[] {
  const lineas = [`Precios TN — Comparador (${filas.length} artículos)`];
  if (filtro) lineas.push(`Filtro: ${filtro}`);
  // CUÁNDO SE MIRÓ A LA COMPETENCIA, que no es cuándo se bajó el archivo. Un
  // Excel sin esa fecha se reenvía por mail y tres días después nadie sabe si
  // los precios de la competencia que trae son de hoy o de la semana pasada.
  lineas.push(
    comparadoEn
      ? `Competencia mirada el ${new Date(comparadoEn).toLocaleString("es-AR")}`
      : "Sin bajada de competencia terminada",
  );
  lineas.push(`Bajado el ${new Date().toLocaleString("es-AR")}`);
  return lineas;
}

export function libroDePrecios(
  filas: FilaPrecioTn[],
  comparadoEn: string | null,
  filtro: string,
): LibroXlsx {
  return {
    hoja: "Precios TN",
    titulos: caratula(filas, comparadoEn, filtro),
    columnas: COLUMNAS_EXPORT.map((c) => ({
      titulo: c.titulo,
      formato: c.formato,
      ancho: c.ancho,
    })),
    filas: filas.map((f) => COLUMNAS_EXPORT.map((c) => c.valor(f))),
  };
}

const escapar = (t: string) =>
  t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * El PDF sale por la impresión del navegador, y es a propósito.
 *
 * La alternativa era sumar una librería de PDF al bundle para armar a mano algo
 * que el navegador ya hace bien: paginar una tabla, repetir el encabezado en
 * cada hoja, numerar. Son cientos de kilobytes que pagan TODOS los que abren el
 * tablero, para una función que se usa de vez en cuando.
 *
 * Se abre una ventana con la tabla ya paginada y se dispara el diálogo de
 * impresión, donde "Guardar como PDF" es la opción por defecto en Chrome, Edge
 * y Safari. Sale un PDF de verdad, con el texto seleccionable.
 *
 * APAISADO Y CHICO A PROPÓSITO: son diecisiete columnas. En vertical no entran
 * y el navegador las parte en dos hojas que no se pueden leer juntas.
 */
export function imprimirPdf(
  filas: FilaPrecioTn[],
  comparadoEn: string | null,
  filtro: string,
): void {
  const encabezado = COLUMNAS_EXPORT.map(
    (c) => `<th class="${c.derecha ? "der" : ""}">${escapar(c.titulo)}</th>`,
  ).join("");

  const cuerpo = filas
    .map(
      (f) =>
        "<tr>" +
        COLUMNAS_EXPORT.map(
          (c) => `<td class="${c.derecha ? "der" : ""}">${escapar(c.texto(f))}</td>`,
        ).join("") +
        "</tr>",
    )
    .join("");

  const titulos = caratula(filas, comparadoEn, filtro)
    .map((t, i) => `<p class="${i === 0 ? "t1" : "t2"}">${escapar(t)}</p>`)
    .join("");

  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8">
<title>Precios TN — Comparador</title>
<style>
  @page { size: A4 landscape; margin: 10mm; }
  body { font: 7.5pt/1.3 system-ui, sans-serif; color: #111; margin: 0; }
  .t1 { font-size: 12pt; font-weight: 600; margin: 0 0 2mm; }
  .t2 { color: #555; margin: 0 0 1mm; }
  table { border-collapse: collapse; width: 100%; margin-top: 3mm; }
  /* El encabezado se repite en cada hoja: una tabla de cuarenta páginas sin
     títulos arriba es ilegible desde la segunda. */
  thead { display: table-header-group; }
  th, td { border: 0.4pt solid #bbb; padding: 1mm 1.2mm; text-align: left;
           vertical-align: top; word-break: break-word; }
  th { background: #eee; font-weight: 600; }
  .der { text-align: right; white-space: nowrap; }
  tr { break-inside: avoid; }
</style></head><body>
${titulos}
<table><thead><tr>${encabezado}</tr></thead><tbody>${cuerpo}</tbody></table>
</body></html>`;

  const ventana = window.open("", "_blank");
  if (!ventana) {
    // El bloqueador de popups. Decirlo es la única salida: sin esto el botón
    // parece roto y no hay forma de adivinar por qué.
    alert(
      "El navegador bloqueó la ventana de impresión. Permití las ventanas " +
        "emergentes para este sitio y probá de nuevo.",
    );
    return;
  }
  ventana.document.write(html);
  ventana.document.close();
  // `onload` y no un llamado directo: sin esperar, Safari imprime una hoja en
  // blanco porque el diálogo se abre antes de que el documento esté armado.
  ventana.onload = () => {
    ventana.focus();
    ventana.print();
  };
}
