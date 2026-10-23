import type { CeldaXlsx, ColumnaXlsx, LibroXlsx } from "@/lib/xlsx";

/**
 * Bajar una foto de costos como Excel.
 *
 * ---------------------------------------------------------------------------
 * POR QUE EXISTE ESTE ARCHIVO SI LA BASE YA GUARDA TODO
 *
 * `bronze.costos_historicos` guarda cada tramo entero y no se borra nunca
 * --desde que existe la columna `origen`, costos.py sólo limpia lo suyo--, así
 * que el respaldo de verdad ya está ahí: hay catorce tramos desde mayo y
 * cualquiera se puede volver a leer.
 *
 * Lo que la base no da es un archivo. Y un archivo sirve para tres cosas que
 * la base no cubre:
 *
 *   1. MIRARLO ANTES DE APLICAR. Ocho mil filas se revisan en Excel, no en una
 *      pantalla: ordenar por diferencia, filtrar un proveedor, buscar un SKU.
 *   2. TENERLO FUERA DEL SISTEMA. Un respaldo que vive en la misma base que el
 *      dato respaldado no es un respaldo. Bajado al Drive, sí.
 *   3. VOLVER POR EL CAMINO VIEJO. Si un día el botón falla, el archivo tiene
 *      las mismas columnas que la hoja Costos del Excel del orquestador.
 *
 * ---------------------------------------------------------------------------
 * LAS DOS COLUMNAS QUE NO ESTAN EN LA BASE
 *
 * "Costo anterior" y "Diferencia" se calculan al bajar: son el costo que regía
 * ANTES de este tramo. Sin ellas el archivo dice en qué quedó cada artículo
 * pero no qué cambió, que es lo único que se mira cuando algo salió raro.
 */

/** Una fila del archivo. Los números van crudos: los formatea Excel. */
export type FilaDeArchivo = {
  sku: string;
  proveedor: string | null;
  descripcion: string | null;
  costoTeorico: number;
  ofertaPct: number;
  descPropioPct: number;
  costoReal: number;
  /** El costo que regía antes de este tramo. `null` si no tenía. */
  antes: number | null;
};

/** Lo que va arriba de la tabla, para que el archivo se explique solo. */
export type CaratulaCostos = {
  mes: string;
  vigenteDesde: string;
  origen: string;
  nota: string | null;
  aplicadoPor: string | null;
  aplicadoEn: string | null;
  /** La línea de contadores, ya armada. `null` si el tramo vino del Excel. */
  contadores: string | null;
};

const COLUMNAS: ColumnaXlsx[] = [
  { titulo: "SKU", formato: "texto", ancho: 14 },
  { titulo: "Proveedor", formato: "texto", ancho: 26 },
  { titulo: "Descripción", formato: "texto", ancho: 42 },
  { titulo: "Costo teórico", formato: "moneda", ancho: 15 },
  { titulo: "Oferta", formato: "porcentaje", ancho: 10 },
  { titulo: "Desc. propio", formato: "porcentaje", ancho: 12 },
  { titulo: "Costo real", formato: "moneda", ancho: 15 },
  { titulo: "Costo anterior", formato: "moneda", ancho: 15 },
  { titulo: "Diferencia", formato: "moneda", ancho: 14 },
];

/**
 * El nombre del archivo. Lleva la fecha del tramo y no la de hoy: dos tramos
 * bajados el mismo día tienen que poder convivir en la misma carpeta.
 */
export function nombreDelArchivo(mes: string, vigenteDesde: string): string {
  return `costos-${mes}-desde-${vigenteDesde}.xlsx`;
}

export function libroDeCostos(
  caratula: CaratulaCostos,
  filas: FilaDeArchivo[],
): LibroXlsx {
  const titulos = [
    `Costos · mes comercial ${caratula.mes} · vigentes desde ${caratula.vigenteDesde}`,
  ];

  // DE DONDE SALIO EL TRAMO, siempre. Un archivo bajado dentro de seis meses
  // tiene que poder decir si lo hizo el botón o si vino del Excel viejo, que
  // es la diferencia entre tener la nota y no tenerla.
  titulos.push(
    caratula.origen === "tablero"
      ? "Aplicado desde el tablero."
      : "Vino del Excel del orquestador, de antes del botón: no tiene nota ni quién lo aplicó.",
  );

  if (caratula.nota) titulos.push(`Qué cambió: ${caratula.nota}`);
  if (caratula.aplicadoPor || caratula.aplicadoEn) {
    const quien = caratula.aplicadoPor ?? "alguien";
    titulos.push(
      caratula.aplicadoEn
        ? `Lo aplicó ${quien} el ${caratula.aplicadoEn}.`
        : `Lo aplicó ${quien}.`,
    );
  }
  if (caratula.contadores) titulos.push(caratula.contadores);

  // EL COSTO REAL ES EL TEORICO CON LA OFERTA APLICADA, y el descuento propio
  // no entra: es lo que resignamos nosotros, no lo que nos cuesta. Dicho acá
  // porque el archivo se abre lejos de la pantalla que lo explica.
  titulos.push(
    "Costo real = costo teórico × (1 − oferta). El descuento propio no baja el costo: se informa aparte.",
  );

  return {
    hoja: "Costos",
    titulos,
    columnas: COLUMNAS,
    filas: filas.map((f): CeldaXlsx[] => [
      f.sku,
      f.proveedor,
      f.descripcion,
      f.costoTeorico,
      // EXCEL GUARDA LOS PORCENTAJES COMO FRACCION: el formato `0.0%` los
      // multiplica por cien al mostrarlos. Un 18 acá se vería como 1.800 %.
      f.ofertaPct / 100,
      f.descPropioPct / 100,
      f.costoReal,
      // NULL Y NO CERO cuando no había costo antes: son cosas distintas, y un
      // cero haría leer "bajó a cero" donde dice "no tenía".
      f.antes,
      f.antes == null ? null : f.costoReal - f.antes,
    ]),
  };
}
