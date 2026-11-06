/**
 * La planilla de PVP: cómo se escribe y cómo se vuelve a leer.
 *
 * ---------------------------------------------------------------------------
 * PARA QUÉ. Las marcas que importamos —HOLA, DIAPER GENIE, SUAVINEX— tienen
 * `repreciar = false` en su política: el motor no les calcula el precio
 * porque el PVP lo ponemos nosotros. Esto es el camino por el que ese precio
 * entra: se baja un CSV con lo que hay hoy, se edita, se vuelve a subir, y
 * cada fila se convierte en una propuesta que pasa por la pantalla de
 * aprobación como cualquier otra.
 *
 * ESTE ARCHIVO NO TOCA LA BASE NI LA RED a propósito. Todo lo que puede
 * salir mal acá es de parseo —un número con coma, un separador distinto, una
 * columna corrida— y eso se prueba sin levantar nada. Ver `pruebas/pvp.mts`.
 * ---------------------------------------------------------------------------
 */

/** Una fila ya entendida, lista para guardar. */
export type FilaPvp = {
  sku: string;
  /**
   * El PVP CON IVA: el precio de LISTA, el que va tachado.
   *
   * No es lo que paga el cliente cuando hay descuento. El motor cobra
   * `pvp * (1 - oferta)` y publica este numero tachado. Si no hay oferta,
   * los dos son el mismo.
   */
  precio: number;
  /** Descuento a publicar, en FRACCIÓN (0,20 = 20 %). `null` = sin tachado. */
  oferta: number | null;
  /** Fila del archivo, para poder señalar dónde estaba el problema. */
  fila: number;
};

export type ErrorPvp = { fila: number; sku: string; motivo: string };

export type LecturaPvp = {
  filas: FilaPvp[];
  errores: ErrorPvp[];
  /** Con qué separador se leyó, para poder decirlo en el resumen. */
  separador: string;
};

export const CABECERAS_PVP = ["sku", "nombre", "pvp_lista", "oferta_%"] as const;

/**
 * El separador del CSV.
 *
 * SE EXPORTA CON `;` PORQUE EL EXCEL DE ACÁ LO ESPERA ASÍ: con configuración
 * regional es-AR, un CSV separado por comas entra todo en la columna A. Es el
 * mismo motivo por el que las fórmulas de la planilla de markup usan `;`.
 */
export const SEPARADOR_SALIDA = ";";

/**
 * Un BOM al principio, que no es decorativo.
 *
 * Sin él, Excel abre el archivo como Latin-1 y "Suavinex Pezoneras Nº2"
 * aparece como "NÂº2". Google Sheets lo detecta solo, pero Excel no.
 */
const BOM = "﻿";

function escapar(valor: string | number | null): string {
  const texto = valor === null || valor === undefined ? "" : String(valor);
  // Se entrecomilla si hay separador, comillas o salto de línea adentro. Una
  // descripción con punto y coma rompería la fila entera sin esto.
  if (/[;,"\n\r]/.test(texto)) return '"' + texto.replace(/"/g, '""') + '"';
  return texto;
}

/** El número como lo espera una planilla en es-AR: coma decimal, sin miles. */
function numeroArg(n: number | null, decimales: number): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "";
  return n.toFixed(decimales).replace(".", ",");
}

/**
 * El CSV que se baja: lo que hay hoy, para editar encima.
 *
 * VA EL PRECIO ACTUAL ADENTRO y no una columna vacía. Una planilla en blanco
 * obliga a ir a buscar cada precio a otro lado, y lo que se quiere cambiar
 * casi nunca son los 140: son cinco. Con el precio puesto, las filas que no
 * se tocan vuelven iguales y no generan propuesta.
 */
export function aCsvPvp(
  filas: { sku: string; nombre?: string | null; precio: number | null; oferta?: number | null }[],
): string {
  const lineas = [CABECERAS_PVP.join(SEPARADOR_SALIDA)];
  for (const f of filas) {
    lineas.push(
      [
        escapar(f.sku),
        escapar(f.nombre ?? ""),
        numeroArg(f.precio ?? null, 2),
        // LA OFERTA SE EXPORTA EN PUNTOS (20 = 20 %), no en fracción. Es lo
        // que una persona escribe cuando le preguntan "qué descuento". Se
        // convierte a fracción al leerla, y la base la guarda así.
        f.oferta === null || f.oferta === undefined ? "" : numeroArg(f.oferta * 100, 2),
      ].join(SEPARADOR_SALIDA),
    );
  }
  return BOM + lineas.join("\r\n") + "\r\n";
}

/** Parte una línea de CSV respetando las comillas. */
function partir(linea: string, sep: string): string[] {
  const celdas: string[] = [];
  let actual = "";
  let entreComillas = false;
  for (let i = 0; i < linea.length; i++) {
    const c = linea[i];
    if (entreComillas) {
      if (c === '"') {
        if (linea[i + 1] === '"') { actual += '"'; i++; }
        else entreComillas = false;
      } else actual += c;
    } else if (c === '"') entreComillas = true;
    else if (c === sep) { celdas.push(actual); actual = ""; }
    else actual += c;
  }
  celdas.push(actual);
  return celdas.map((c) => c.trim());
}

/**
 * Un número escrito por una persona, en cualquiera de las formas de acá.
 *
 * LAS TRES QUE APARECEN DE VERDAD: `184917,48`, `184.917,48` y `184917.48`.
 * La regla que las cubre a las tres: si están los dos separadores, el ÚLTIMO
 * es el decimal. Si está sólo la coma, es decimal. Si está sólo el punto, es
 * decimal cuando lo siguen una o dos cifras y de miles cuando lo siguen tres
 * exactas —`184.917` son ciento ochenta y cuatro mil, no 184 con 917—.
 *
 * El caso `1.234` queda decidido por esa última regla y podría estar mal si
 * alguien quiso decir 1,234. Para precios en pesos no pasa, y la pantalla
 * muestra lo que entendió de las primeras filas para que se vea antes de
 * guardar.
 */
export function parsearNumero(texto: string): number | null {
  const limpio = texto.replace(/[^\d,.\-]/g, "").trim();
  if (!limpio) return null;

  const ultimaComa = limpio.lastIndexOf(",");
  const ultimoPunto = limpio.lastIndexOf(".");
  let normalizado: string;

  if (ultimaComa >= 0 && ultimoPunto >= 0) {
    const decimal = ultimaComa > ultimoPunto ? "," : ".";
    const miles = decimal === "," ? "." : ",";
    normalizado = limpio.split(miles).join("").replace(decimal, ".");
  } else if (ultimaComa >= 0) {
    // Sólo coma: es el decimal. Los puntos que haya son de miles.
    normalizado = limpio.replace(/\./g, "").replace(",", ".");
  } else if (ultimoPunto >= 0) {
    const decimales = limpio.length - ultimoPunto - 1;
    const unSoloPunto = limpio.indexOf(".") === ultimoPunto;
    normalizado = unSoloPunto && decimales === 3 ? limpio.replace(".", "") : limpio.replace(/\.(?=.*\.)/g, "");
  } else {
    normalizado = limpio;
  }

  const n = Number(normalizado);
  return Number.isFinite(n) ? n : null;
}

/** Dónde está cada columna, por título y no por posición. */
function indices(cabecera: string[]): Record<string, number> {
  const norm = (s: string) =>
    s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z%_]/g, "");
  const mapa: Record<string, number> = {};
  cabecera.forEach((titulo, i) => {
    const t = norm(titulo);
    if (t.startsWith("sku")) mapa.sku ??= i;
    // Se acepta `pvp_lista` y tambien `precio`, que es como se llamaba la
    // columna antes: una planilla bajada ayer tiene que seguir subiendo.
    else if (t.startsWith("pvp") || t.startsWith("precio")) mapa.precio ??= i;
    else if (t.startsWith("oferta") || t.startsWith("descuento")) mapa.oferta ??= i;
  });
  return mapa;
}

/**
 * Lee el CSV que se subió.
 *
 * LAS COLUMNAS SE BUSCAN POR TÍTULO, no por posición. Alguien va a abrir esto
 * en Excel y meter una columna en el medio para hacer una cuenta, y que eso
 * desplace los precios una celda a la derecha sin que nadie se entere es
 * justo el error que arruina 140 artículos de una.
 */
export function leerCsvPvp(texto: string): LecturaPvp {
  const sinBom = texto.replace(/^﻿/, "");
  const lineas = sinBom.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (!lineas.length) {
    return { filas: [], errores: [{ fila: 0, sku: "", motivo: "el archivo está vacío" }], separador: SEPARADOR_SALIDA };
  }

  // SE OLFATEA EL SEPARADOR en vez de imponerlo: el archivo puede volver de
  // Excel, de Google Sheets o de un editor de texto, y cada uno decide por su
  // cuenta. Gana el que más veces aparece en la cabecera.
  const cabeceraCruda = lineas[0];
  const separador = [";", ",", "\t"]
    .map((s) => ({ s, n: cabeceraCruda.split(s).length }))
    .sort((a, b) => b.n - a.n)[0].s;

  const col = indices(partir(cabeceraCruda, separador));
  if (col.sku === undefined || col.precio === undefined) {
    return {
      filas: [],
      errores: [{
        fila: 1, sku: "",
        motivo: "no se encontraron las columnas 'sku' y 'pvp_lista' en la primera fila",
      }],
      separador,
    };
  }

  const filas: FilaPvp[] = [];
  const errores: ErrorPvp[] = [];
  const vistos = new Map<string, number>();

  for (let i = 1; i < lineas.length; i++) {
    const nroFila = i + 1;
    const celdas = partir(lineas[i], separador);
    const sku = (celdas[col.sku] ?? "").trim();
    if (!sku) continue;

    const anterior = vistos.get(sku);
    if (anterior !== undefined) {
      // DOS FILAS PARA EL MISMO SKU ES UNA PREGUNTA SIN RESPUESTA. Tomar la
      // última sería elegir por el orden del archivo, que no significa nada.
      errores.push({ fila: nroFila, sku, motivo: "el SKU está repetido (fila " + anterior + ")" });
      continue;
    }
    vistos.set(sku, nroFila);

    const precio = parsearNumero(celdas[col.precio] ?? "");
    if (precio === null || precio <= 0) {
      errores.push({ fila: nroFila, sku, motivo: "precio vacío o no válido: '" + (celdas[col.precio] ?? "") + "'" });
      continue;
    }

    let oferta: number | null = null;
    const textoOferta = col.oferta === undefined ? "" : (celdas[col.oferta] ?? "").trim();
    if (textoOferta) {
      const n = parsearNumero(textoOferta);
      if (n === null) {
        errores.push({ fila: nroFila, sku, motivo: "oferta no válida: '" + textoOferta + "'" });
        continue;
      }
      if (n < 0 || n >= 100) {
        errores.push({ fila: nroFila, sku, motivo: "la oferta tiene que estar entre 0 y 100: " + n });
        continue;
      }
      // UN VALOR MENOR A 1 NO SE ADIVINA. La columna va en puntos, así que
      // 0,2 es dos décimas de por ciento; pero quien lo escribió casi seguro
      // quiso decir 20 %. Adivinar cualquiera de las dos pone un precio
      // tachado mal, así que se devuelve la fila y que lo diga el que sabe.
      if (n > 0 && n < 1) {
        errores.push({
          fila: nroFila, sku,
          motivo: "la oferta '" + textoOferta + "' es ambigua: la columna va en puntos (20 = 20 %). "
            + "Si querés 20 % escribí 20; si de verdad querés " + n + " %, escribí " + n.toFixed(2),
        });
        continue;
      }
      oferta = n === 0 ? null : n / 100;
    }

    filas.push({ sku, precio, oferta, fila: nroFila });
  }

  return { filas, errores, separador };
}
