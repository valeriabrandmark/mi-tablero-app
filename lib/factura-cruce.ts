/**
 * El cruce de una factura de compra contra su orden de compra.
 *
 * ---------------------------------------------------------------------------
 * EL PROBLEMA QUE RESUELVE
 *
 * El proveedor no factura en el orden de la OC. Cargar una factura era tener
 * las dos hojas al lado e ir renglón por renglón buscando cada artículo de una
 * en la otra, comparando cantidad y precio a ojo, y al final sumar para ver si
 * el total cerraba. Con 200 renglones eso es una mañana.
 *
 * Acá la factura se PEGA (Ctrl+V desde el Excel o el PDF del proveedor), cada
 * renglón se identifica solo contra el maestro de Sigma, y lo que vuelve es la
 * OC con la factura al lado y sólo las diferencias marcadas.
 *
 * ---------------------------------------------------------------------------
 * CÓMO SE IDENTIFICA CADA RENGLÓN, EN ORDEN DE CONFIANZA
 *
 *   1. CÓDIGO. El de la factura contra el SKU de Sigma o contra `codigoCompra`
 *      (el código del proveedor, que está cargado en el 95% del maestro).
 *   2. EAN. Contra el de la unidad, el del display o el del bulto. El del bulto
 *      dice además que el renglón viene en bultos.
 *   3. DESCRIPCIÓN. Sólo contra los renglones de la OC, nunca contra el maestro
 *      entero: entre 8.000 artículos siempre hay uno "parecido", entre los 40
 *      de una orden el parecido casi siempre es el correcto. Y aun así queda
 *      marcado para revisar.
 *
 * Todo es puro --sin base, sin red, sin React-- para poder probarlo en
 * `pruebas/factura-cruce.mts` con los casos de verdad.
 */

import { factorNeto } from "@/lib/compras";

/* -------------------------------------------------------------------------
   NÚMEROS
   ------------------------------------------------------------------------- */

/**
 * Un número tal como lo escribe una factura argentina.
 *
 *   "1.234,56"   -> 1234.56     (formato local)
 *   "1,234.56"   -> 1234.56     (Excel en inglés)
 *   "$ 3.699,68" -> 3699.68
 *   "12,5 %"     -> 12.5
 *   "(1.500,00)" -> -1500       (negativo contable)
 *   "1.234"      -> 1234        (ver abajo)
 *
 * EL CASO AMBIGUO ES UN SOLO PUNTO CON TRES DÍGITOS DETRÁS. "1.234" es mil
 * doscientos en una factura de acá y uno coma dos en una planilla en inglés.
 * Gana el formato local, porque es de donde vienen las facturas. La vista
 * previa muestra cada número ya leído, así que si alguna vez sale al revés se
 * ve antes de cruzar.
 *
 * Devuelve `null` si no hay un número: una celda vacía NO es un cero, y
 * tratarla como cero haría pasar un renglón sin precio por uno gratis.
 */
export function leerNumero(texto: string | null | undefined): number | null {
  if (texto == null) return null;
  let s = String(texto).trim();
  if (!s) return null;

  let negativo = false;
  if (/^\(.*\)$/.test(s)) {
    negativo = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/[$%\s]|ARS|USD|U\$S/gi, "");
  if (s.startsWith("-")) {
    negativo = !negativo;
    s = s.slice(1);
  } else if (s.endsWith("-")) {
    // Algunos sistemas viejos ponen el signo al final: "1.500,00-".
    negativo = !negativo;
    s = s.slice(0, -1);
  }
  if (!/^[0-9.,]+$/.test(s) || !/[0-9]/.test(s)) return null;

  const puntos = (s.match(/\./g) ?? []).length;
  const comas = (s.match(/,/g) ?? []).length;

  if (puntos > 0 && comas > 0) {
    // El ÚLTIMO separador es el decimal.
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) {
      s = s.replace(/\./g, "").replace(",", ".");
    } else {
      s = s.replace(/,/g, "");
    }
  } else if (comas > 0) {
    s = comas === 1 ? s.replace(",", ".") : s.replace(/,/g, "");
  } else if (puntos > 1) {
    s = s.replace(/\./g, "");
  } else if (puntos === 1 && /^\d{1,3}\.\d{3}$/.test(s)) {
    s = s.replace(".", "");
  }

  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return negativo ? -n : n;
}

/** Redondeo a centavos, que es lo que es un importe. */
export function centavos(n: number): number {
  return Math.round(n * 100) / 100;
}

/* -------------------------------------------------------------------------
   LA TABLA PEGADA
   ------------------------------------------------------------------------- */

export type TablaPegada = {
  /** `null` cuando la primera fila ya son datos. */
  encabezados: string[] | null;
  filas: string[][];
  separador: "tab" | "punto y coma" | "espacios";
};

/**
 * Lo que llega al pegar, partido en filas y celdas.
 *
 * DESDE EXCEL O GOOGLE SHEETS las celdas vienen separadas por TABULACIÓN, y es
 * el caso bueno. DESDE UN PDF no hay tabulaciones: el texto viene con espacios,
 * y lo único que separa una columna de otra es que entre columnas hay DOS o más
 * espacios y adentro de una descripción, uno. No es perfecto, pero es lo que
 * hace cualquier lector de PDF, y la vista previa deja ver si salió bien.
 */
export function leerTablaPegada(texto: string): TablaPegada {
  const lineas = texto
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .filter((l) => l.trim() !== "");

  let separador: TablaPegada["separador"] = "espacios";
  if (lineas.some((l) => l.includes("\t"))) separador = "tab";
  else if (
    lineas.length > 0 &&
    lineas.filter((l) => l.includes(";")).length >= lineas.length / 2
  ) {
    separador = "punto y coma";
  }

  const partir = (l: string): string[] =>
    separador === "tab"
      ? l.split("\t")
      : separador === "punto y coma"
        ? l.split(";")
        : l.trim().split(/\s{2,}/);

  let filas = lineas.map((l) => partir(l).map((c) => c.trim()));

  // Todas las filas con el mismo ancho, para que una columna sea una columna.
  const ancho = Math.max(0, ...filas.map((f) => f.length));
  filas = filas.map((f) => [...f, ...Array(ancho - f.length).fill("")]);

  // Columnas vacías en TODAS las filas (un tab de más al final de cada línea,
  // una columna oculta del Excel): se sacan.
  const llenas = Array.from({ length: ancho }, (_, i) =>
    filas.some((f) => f[i] !== ""),
  );
  filas = filas.map((f) => f.filter((_, i) => llenas[i]));

  let encabezados: string[] | null = null;
  if (filas.length > 1 && pareceEncabezado(filas[0], filas[1])) {
    encabezados = filas[0];
    filas = filas.slice(1);
  }
  return { encabezados, filas, separador };
}

/**
 * Si la primera fila son títulos. Lo es cuando tiene casi todo texto y la
 * siguiente tiene números donde ella tiene letras.
 */
function pareceEncabezado(primera: string[], segunda: string[]): boolean {
  let textoArriba = 0;
  let numeroAbajo = 0;
  primera.forEach((c, i) => {
    const esTexto = c !== "" && leerNumero(c) == null;
    if (esTexto) textoArriba++;
    if (esTexto && leerNumero(segunda[i]) != null) numeroAbajo++;
  });
  return textoArriba >= Math.ceil(primera.length * 0.6) && numeroAbajo >= 1;
}

/* -------------------------------------------------------------------------
   QUÉ ES CADA COLUMNA
   ------------------------------------------------------------------------- */

export const ROLES_COLUMNA = [
  { clave: "codigo", label: "Código" },
  { clave: "ean", label: "EAN" },
  { clave: "descripcion", label: "Descripción" },
  { clave: "cantidad", label: "Cantidad" },
  { clave: "precio", label: "Precio unitario" },
  { clave: "descuento1", label: "Bonif. 1 %" },
  { clave: "descuento2", label: "Bonif. 2 %" },
  { clave: "importe", label: "Importe neto" },
  { clave: "ignorar", label: "(no usar)" },
] as const;

export type RolColumna = (typeof ROLES_COLUMNA)[number]["clave"];

const sinAcentos = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

/**
 * El rol de cada columna, adivinado. Es una PROPUESTA: la pantalla la muestra
 * en un desplegable arriba de cada columna y se corrige con un click.
 *
 * Primero por el título, si hay. Después, para lo que quedó sin rol, por el
 * contenido: los EAN son números de 8 a 14 dígitos, la descripción es el texto
 * más largo, la cantidad es entera, el importe es el número más grande.
 */
export function adivinarColumnas(tabla: TablaPegada): RolColumna[] {
  const ancho = tabla.filas[0]?.length ?? tabla.encabezados?.length ?? 0;
  const roles: (RolColumna | null)[] = Array(ancho).fill(null);
  const usados = new Set<RolColumna>();
  const asignar = (i: number, rol: RolColumna) => {
    if (roles[i] == null && !usados.has(rol)) {
      roles[i] = rol;
      usados.add(rol);
    }
  };

  const muestra = tabla.filas.slice(0, 50);
  const columna = (i: number) => muestra.map((f) => f[i] ?? "").filter(Boolean);
  const numeros = (i: number) =>
    columna(i)
      .map(leerNumero)
      .filter((n): n is number => n != null);
  const esNumerica = (i: number) =>
    columna(i).length > 0 && numeros(i).length >= columna(i).length * 0.8;

  if (tabla.encabezados) {
    tabla.encabezados.forEach((h, i) => {
      const t = sinAcentos(h);
      if (/ean|barra|gtin/.test(t)) asignar(i, "ean");
      else if (/^(cod|art|sku|ref|item cod|codigo)|codigo|cod\.?$/.test(t))
        asignar(i, "codigo");
      else if (/cant|unid|qty|cajas|bultos/.test(t)) asignar(i, "cantidad");
      else if (/bonif|dto|dcto|desc.*%|% *desc|descuento/.test(t))
        asignar(i, usados.has("descuento1") ? "descuento2" : "descuento1");
      else if (/unit|precio|p\.? ?u|lista/.test(t)) asignar(i, "precio");
      else if (/importe|subtotal|total|neto|monto/.test(t))
        asignar(i, "importe");
      else if (/desc|detalle|producto|articulo|nombre/.test(t)) {
        // "Desc." puede ser descripción o descuento: decide el contenido.
        if (esNumerica(i)) asignar(i, "descuento1");
        else asignar(i, "descripcion");
      }
    });
  }

  // Por contenido, para lo que no tiene título o no se reconoció.
  const libres = () => roles.map((r, i) => (r == null ? i : -1)).filter((i) => i >= 0);

  for (const i of libres()) {
    const vals = columna(i);
    if (vals.length && vals.every((v) => /^\d{8,14}$/.test(v.replace(/\s/g, "")))) {
      asignar(i, "ean");
    }
  }
  // Descripción: la columna de texto con más letras.
  const textos = libres()
    .filter((i) => !esNumerica(i))
    .map((i) => ({
      i,
      largo: columna(i).reduce((s, v) => s + v.length, 0) / Math.max(columna(i).length, 1),
    }))
    .sort((a, b) => b.largo - a.largo);
  if (textos[0] && textos[0].largo >= 12) asignar(textos[0].i, "descripcion");
  // Código: la primera columna de texto corta que queda.
  for (const { i } of textos) asignar(i, "codigo");

  // Números: cantidad = enteros chicos; importe = el más grande; precio = el
  // otro; un porcentaje entre 0 y 100 que no es entero grande, descuento.
  const numericas = libres().filter(esNumerica);
  const promedio = (i: number) => {
    const ns = numeros(i);
    return ns.reduce((s, n) => s + Math.abs(n), 0) / Math.max(ns.length, 1);
  };
  const enteras = numericas.filter((i) => numeros(i).every((n) => Number.isInteger(n)));
  const cantidad = enteras.sort((a, b) => promedio(a) - promedio(b))[0];
  if (cantidad != null) asignar(cantidad, "cantidad");
  const resto = libres()
    .filter(esNumerica)
    .sort((a, b) => promedio(b) - promedio(a));
  if (resto.length >= 2) {
    asignar(resto[0], "importe");
    asignar(resto[1], "precio");
  } else if (resto.length === 1) {
    asignar(resto[0], "precio");
  }
  for (const i of libres().filter(esNumerica)) {
    if (numeros(i).every((n) => n >= 0 && n <= 100)) {
      asignar(i, usados.has("descuento1") ? "descuento2" : "descuento1");
    }
  }

  return roles.map((r) => r ?? "ignorar");
}

/* -------------------------------------------------------------------------
   LOS RENGLONES
   ------------------------------------------------------------------------- */

/** Un renglón de la factura, ya leído. */
export type RenglonFactura = {
  /** Posición en lo pegado (1, 2, 3...), para poder señalarlo. */
  fila: number;
  codigo: string;
  ean: string;
  descripcion: string;
  cantidad: number | null;
  precio: number | null;
  descuento1: number;
  descuento2: number;
  /** El importe de la línea si la factura lo trae. Manda sobre precio × cantidad. */
  importe: number | null;
  /**
   * La persona dijo si eran bultos o unidades (y `cantidad` ya viene en
   * unidades): el cruce no intenta adivinarlo.
   */
  unidadFija?: boolean;
};

/**
 * Las filas pegadas como renglones de factura.
 *
 * SE DESCARTAN LAS FILAS SIN CANTIDAD NI IMPORTE: son subtítulos, la línea de
 * "Transporte...", el pie con el total. Un renglón de verdad tiene al menos
 * uno de los dos.
 */
export function leerRenglones(
  tabla: TablaPegada,
  roles: RolColumna[],
): RenglonFactura[] {
  const col = (rol: RolColumna) => roles.indexOf(rol);
  const celda = (f: string[], rol: RolColumna) =>
    col(rol) >= 0 ? (f[col(rol)] ?? "").trim() : "";

  const renglones: RenglonFactura[] = [];
  tabla.filas.forEach((f, i) => {
    const cantidad = leerNumero(celda(f, "cantidad"));
    const importe = leerNumero(celda(f, "importe"));
    if (cantidad == null && importe == null) return;
    // Una fila de totales del pie trae importe sin código, descripción ni
    // cantidad. No es un renglón.
    if (
      cantidad == null &&
      !celda(f, "codigo") &&
      !celda(f, "ean") &&
      !celda(f, "descripcion")
    ) {
      return;
    }
    renglones.push({
      fila: i + 1,
      codigo: celda(f, "codigo"),
      ean: celda(f, "ean").replace(/\s/g, ""),
      descripcion: celda(f, "descripcion"),
      cantidad,
      precio: leerNumero(celda(f, "precio")),
      descuento1: Math.max(0, leerNumero(celda(f, "descuento1")) ?? 0),
      descuento2: Math.max(0, leerNumero(celda(f, "descuento2")) ?? 0),
      importe,
    });
  });
  return renglones;
}

/** El neto del renglón: el importe si vino, si no precio × cantidad con bonificaciones. */
export function netoRenglon(r: RenglonFactura): number | null {
  if (r.importe != null) return r.importe;
  if (r.precio == null || r.cantidad == null) return null;
  return centavos(r.precio * r.cantidad * factorNeto(r.descuento1, r.descuento2));
}

/* -------------------------------------------------------------------------
   EL MAESTRO Y LA OC
   ------------------------------------------------------------------------- */

/** Lo que se necesita de un artículo de Sigma para reconocerlo en una factura. */
export type ArticuloMaestro = {
  sku: string;
  descripcion: string;
  codigoCompra: string | null;
  eanUnidad: string | null;
  eanDisplay: string | null;
  eanBulto: string | null;
  unidadesPorBulto: number;
  unidadesPorDisplay: number;
  /** 21, 10.5, 0... */
  iva: number;
};

/** Un renglón de la OC, siempre en UNIDADES y a precio de lista por unidad. */
export type RenglonOC = {
  sku: string;
  cantidad: number;
  precio: number;
  descuento1: number;
  descuento2: number;
};

/**
 * Un código para comparar: mayúsculas y sin nada que no sea letra o número.
 *
 * `codigoCompra` está cargado a mano y se nota: "P03,033,07" al lado de
 * "P04.033.26". El proveedor seguramente factura "P03.033.07". Sacando la
 * puntuación los dos son el mismo código.
 */
export function normalizarCodigo(c: string | null | undefined): string {
  return (c ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Además sin ceros adelante: "00123" y "123" son el mismo código de proveedor. */
function sinCeros(c: string): string {
  return c.replace(/^0+(?=.)/, "");
}

/** Lo que encontró `buscarArticulo` para un renglón cargado a mano. */
export type ArticuloEncontrado =
  | { a: ArticuloMaestro; porBulto: boolean }
  | { error: string };

/**
 * El artículo de un renglón cargado a mano, con uno o más códigos tipeados.
 *
 * CADA CÓDIGO PUEDE SER CUALQUIER COSA: SKU, EAN (de unidad, display o bulto)
 * o código de compra del proveedor, en mayúscula o minúscula. Se prueba en ese
 * orden. Así la persona tipea lo que tiene a mano --lo que dice la factura,
 * lo que lee la pistola-- y el cruce lo lleva al SKU de Sigma, que es lo que
 * tiene la OC.
 *
 * Si se cargó más de uno y apuntan a artículos distintos, no se elige: es
 * un error de carga y se avisa. `null` si no se cargó ningún código.
 */
export function buscarArticulo(
  indice: IndiceMaestro,
  codigos: string[],
): ArticuloEncontrado | null {
  const cargados = codigos.map((c) => (c ?? "").trim()).filter(Boolean);
  if (cargados.length === 0) return null;

  const hits = cargados.map((t) => {
    const s = normalizarCodigo(t);
    const porSku = indice.porCodigo.get(s);
    if (porSku) return { a: porSku, porBulto: false };
    const ean = indice.porEan.get(t.replace(/\D/g, ""));
    if (ean && /^\d{8,14}$/.test(t.replace(/\s/g, ""))) {
      return { a: ean.a, porBulto: ean.tipo === "bulto" };
    }
    const prov = indice.porCodigoProveedor.get(sinCeros(s)) ?? [];
    if (prov.length === 1) return { a: prov[0], porBulto: false };
    return { falla: prov.length > 1 ? `${t} (repetido en el maestro)` : t };
  });

  const buenos = hits.filter((h): h is { a: ArticuloMaestro; porBulto: boolean } => "a" in h);
  if (buenos.length === 0) {
    return {
      error: `No está en el maestro: ${hits.map((h) => ("falla" in h ? h.falla : "")).join(", ")}`,
    };
  }
  const skus = [...new Set(buenos.map((h) => h.a.sku))];
  if (skus.length > 1) return { error: `Los códigos no coinciden: ${skus.join(" / ")}` };
  // El EAN del bulto, si se cargó, dice que viene en bultos.
  return { a: buenos[0].a, porBulto: buenos.some((h) => h.porBulto) };
}

/** Cómo se reconoció un renglón. Va a la pantalla tal cual. */
export type ComoSeIdentifico =
  | "codigo"
  | "codigo proveedor"
  | "ean"
  | "ean display"
  | "ean bulto"
  | "descripcion"
  | "manual";

export type Identificacion = {
  sku: string;
  como: ComoSeIdentifico;
  /**
   * Cuántas unidades trae cada "1" de la factura: 1 si viene por unidad, el
   * tamaño del bulto si viene por bulto. Lo dice el EAN del bulto, o lo deduce
   * el cruce cuando sólo así cierra con la OC.
   */
  factor: number;
};

/** Índice para buscar rápido por código y EAN. */
export type IndiceMaestro = {
  porSku: Map<string, ArticuloMaestro>;
  porCodigo: Map<string, ArticuloMaestro>;
  porCodigoProveedor: Map<string, ArticuloMaestro[]>;
  porEan: Map<string, { a: ArticuloMaestro; tipo: "unidad" | "display" | "bulto" }>;
};

export function indexarMaestro(articulos: ArticuloMaestro[]): IndiceMaestro {
  const porSku = new Map<string, ArticuloMaestro>();
  const porCodigo = new Map<string, ArticuloMaestro>();
  const porCodigoProveedor = new Map<string, ArticuloMaestro[]>();
  const porEan: IndiceMaestro["porEan"] = new Map();

  for (const a of articulos) {
    porSku.set(a.sku, a);
    porCodigo.set(normalizarCodigo(a.sku), a);
    const cp = normalizarCodigo(a.codigoCompra);
    if (cp) {
      for (const k of new Set([cp, sinCeros(cp)])) {
        porCodigoProveedor.set(k, [...(porCodigoProveedor.get(k) ?? []), a]);
      }
    }
    const ean = (v: string | null) => (v ?? "").replace(/\D/g, "");
    if (ean(a.eanUnidad)) porEan.set(ean(a.eanUnidad), { a, tipo: "unidad" });
    if (ean(a.eanDisplay) && !porEan.has(ean(a.eanDisplay)))
      porEan.set(ean(a.eanDisplay), { a, tipo: "display" });
    if (ean(a.eanBulto) && !porEan.has(ean(a.eanBulto)))
      porEan.set(ean(a.eanBulto), { a, tipo: "bulto" });
  }
  return { porSku, porCodigo, porCodigoProveedor, porEan };
}

/**
 * Por código y EAN, contra el maestro del proveedor. Sin descripción: eso
 * se hace después y sólo contra la OC.
 *
 * Un código de proveedor que en el maestro tienen DOS artículos no identifica
 * nada, y se deja sin identificar antes que elegir uno: se prefiere el que
 * esté en la OC, y si están los dos o ninguno, queda para la descripción.
 */
export function identificarPorCodigo(
  r: RenglonFactura,
  indice: IndiceMaestro,
  skusDeLaOC: Set<string>,
): Identificacion | null {
  const porEan = (ean: string): Identificacion | null => {
    const hit = indice.porEan.get(ean);
    if (!hit) return null;
    const factor =
      hit.tipo === "bulto"
        ? Math.max(hit.a.unidadesPorBulto, 1)
        : hit.tipo === "display"
          ? Math.max(hit.a.unidadesPorDisplay, 1)
          : 1;
    return {
      sku: hit.a.sku,
      como: hit.tipo === "unidad" ? "ean" : hit.tipo === "display" ? "ean display" : "ean bulto",
      factor,
    };
  };

  const codigo = normalizarCodigo(r.codigo);
  if (codigo) {
    const a = indice.porCodigo.get(codigo);
    if (a) return { sku: a.sku, como: "codigo", factor: 1 };

    for (const k of [codigo, sinCeros(codigo)]) {
      const candidatos = indice.porCodigoProveedor.get(k) ?? [];
      const enOC = candidatos.filter((c) => skusDeLaOC.has(c.sku));
      const elegido = candidatos.length === 1 ? candidatos[0] : enOC.length === 1 ? enOC[0] : null;
      if (elegido) return { sku: elegido.sku, como: "codigo proveedor", factor: 1 };
    }
    // Hay proveedores que ponen el EAN en la columna del código.
    if (/^\d{8,14}$/.test(codigo)) {
      const e = porEan(codigo);
      if (e) return e;
    }
  }
  if (r.ean) {
    const e = porEan(r.ean.replace(/\D/g, ""));
    if (e) return e;
  }
  return null;
}

/* -------------------------------------------------------------------------
   POR DESCRIPCIÓN
   ------------------------------------------------------------------------- */

const PALABRAS_VACIAS = new Set([
  "de", "la", "el", "los", "las", "con", "sin", "para", "por", "y", "x", "en",
  "un", "una", "del", "al",
]);

/**
 * Las palabras que cuentan de una descripción.
 *
 * "473ML" y "473 ML" son lo mismo: los números se pegan a su unidad antes de
 * partir, porque el tamaño es justo lo que distingue un vaso de 473 de uno de
 * 710, y es lo primero que cada proveedor escribe distinto.
 */
export function palabras(texto: string): string[] {
  return sinAcentos(texto)
    .replace(/(\d)\s+(ml|cc|gr|g|kg|lt|l|cm|mm|u|un|unid|oz)\b/g, "$1$2")
    .split(/[^a-z0-9]+/)
    .filter((p) => p.length >= 2 && !PALABRAS_VACIAS.has(p));
}

/**
 * Qué tan parecidas son dos descripciones, de 0 a 1 (coeficiente de Dice sobre
 * las palabras). Los números pesan doble: dos vasos de la misma línea comparten
 * todas las palabras menos el tamaño o el color.
 */
export function parecido(a: string, b: string): number {
  const pa = palabras(a);
  const pb = new Set(palabras(b));
  if (pa.length === 0 || pb.size === 0) return 0;
  const peso = (p: string) => (/\d/.test(p) ? 2 : 1);
  const comun = [...new Set(pa)].filter((p) => pb.has(p)).reduce((s, p) => s + peso(p), 0);
  const total =
    [...new Set(pa)].reduce((s, p) => s + peso(p), 0) +
    [...pb].reduce((s, p) => s + peso(p), 0);
  return (2 * comun) / total;
}

/** Desde cuánto se acepta un parecido, y por cuánto tiene que ganarle al segundo. */
export const PARECIDO_MINIMO = 0.5;
export const VENTAJA_MINIMA = 0.08;

/* -------------------------------------------------------------------------
   EL CRUCE
   ------------------------------------------------------------------------- */

export type EstadoCruce =
  | "ok"
  | "cantidad"
  | "precio"
  | "cantidad y precio"
  | "falta en factura"
  | "no está en la OC"
  | "sin identificar";

export type LineaCruce = {
  estado: EstadoCruce;
  sku: string | null;
  descripcion: string;
  /** Los renglones de la factura que cayeron acá (puede ser más de uno: el bonificado aparte). */
  renglones: RenglonFactura[];
  como: ComoSeIdentifico | null;
  /** Unidades por cada "1" facturado. 1 salvo que la factura venga en bultos. */
  factor: number;
  oc: {
    unidades: number;
    precioNeto: number;
    neto: number;
  } | null;
  factura: {
    unidades: number;
    /** Neto ÷ unidades: el precio que de verdad se paga por unidad, bonificaciones incluidas. */
    precioNeto: number | null;
    neto: number | null;
  } | null;
  /** Unidades facturadas menos pedidas. */
  difUnidades: number;
  /** (precio facturado − precio OC) × unidades facturadas. Lo que cuesta la diferencia de precio. */
  difPrecio: number;
  iva: number;
};

/**
 * Cuánto puede diferir un precio sin que sea una diferencia: medio por ciento
 * o cincuenta centavos, lo que sea mayor. Por debajo de eso es redondeo del
 * sistema del proveedor, no un precio distinto.
 */
export function mismoPrecio(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(0.5, Math.abs(b) * 0.005);
}

export type ResultadoCruce = {
  lineas: LineaCruce[];
  resumen: {
    renglonesOC: number;
    renglonesFactura: number;
    ok: number;
    conDiferencia: number;
    faltan: number;
    sobran: number;
    sinIdentificar: number;
    netoOC: number;
    netoFactura: number;
    /** Neto de la factura valuado a los precios de la OC: lo que DEBERÍA haber facturado por lo que mandó. */
    netoFacturaAPrecioOC: number;
    difPrecio: number;
    iva: Record<string, number>;
  };
};

/**
 * La OC contra la factura.
 *
 * `manuales` son las asignaciones que hizo la persona a mano (fila pegada ->
 * SKU): pisan cualquier cosa que haya deducido el cruce.
 */
export function cruzar(
  oc: RenglonOC[],
  factura: RenglonFactura[],
  maestro: ArticuloMaestro[],
  manuales: Record<number, string> = {},
): ResultadoCruce {
  const indice = indexarMaestro(maestro);
  const skusOC = new Set(oc.map((r) => r.sku));
  const ivaDe = (sku: string | null) => (sku ? indice.porSku.get(sku)?.iva : undefined) ?? 21;

  // 1) Código y EAN, más lo manual.
  const ident = new Map<number, Identificacion | null>();
  for (const r of factura) {
    const manual = manuales[r.fila];
    if (manual) {
      ident.set(r.fila, { sku: manual, como: "manual", factor: 1 });
    } else {
      ident.set(r.fila, identificarPorCodigo(r, indice, skusOC));
    }
  }

  // 2) Descripción, sólo para lo que quedó suelto y sólo contra la OC que
  // todavía no tiene renglón. De a pares, el mejor primero: así un renglón no
  // se queda con el artículo que le correspondía mejor a otro.
  const tomados = new Set(
    [...ident.values()].filter((v): v is Identificacion => v != null).map((v) => v.sku),
  );
  const sueltos = factura.filter((r) => !ident.get(r.fila) && r.descripcion);
  const libresOC = oc.filter((o) => !tomados.has(o.sku));
  const pares: { fila: number; sku: string; p: number; segundo: number }[] = [];
  for (const r of sueltos) {
    const puntajes = libresOC
      .map((o) => ({
        sku: o.sku,
        p: parecido(r.descripcion, indice.porSku.get(o.sku)?.descripcion ?? ""),
      }))
      .sort((a, b) => b.p - a.p);
    if (puntajes[0]) {
      pares.push({ fila: r.fila, sku: puntajes[0].sku, p: puntajes[0].p, segundo: puntajes[1]?.p ?? 0 });
    }
  }
  pares.sort((a, b) => b.p - a.p);
  for (const par of pares) {
    if (par.p < PARECIDO_MINIMO || par.p - par.segundo < VENTAJA_MINIMA) continue;
    if (tomados.has(par.sku) || ident.get(par.fila)) continue;
    ident.set(par.fila, { sku: par.sku, como: "descripcion", factor: 1 });
    tomados.add(par.sku);
  }

  // 3) Agrupar por SKU.
  const porSku = new Map<string, { renglones: RenglonFactura[]; id: Identificacion }>();
  const sinIdentificar: RenglonFactura[] = [];
  for (const r of factura) {
    const id = ident.get(r.fila);
    if (!id) {
      sinIdentificar.push(r);
      continue;
    }
    const g = porSku.get(id.sku);
    if (g) g.renglones.push(r);
    else porSku.set(id.sku, { renglones: [r], id });
  }

  const lineas: LineaCruce[] = [];

  const ladoFactura = (renglones: RenglonFactura[], factor: number) => {
    const cant = renglones.reduce((s, r) => s + (r.cantidad ?? 0), 0);
    const netos = renglones.map(netoRenglon);
    const neto = netos.some((n) => n == null)
      ? null
      : centavos(netos.reduce<number>((s, n) => s + (n ?? 0), 0));
    const unidades = cant * factor;
    return {
      unidades,
      neto,
      precioNeto: neto != null && unidades !== 0 ? neto / unidades : null,
    };
  };

  // 4) Cada renglón de la OC con lo que le tocó.
  for (const o of oc) {
    const a = indice.porSku.get(o.sku);
    const precioNetoOC = o.precio * factorNeto(o.descuento1, o.descuento2);
    const ladoOC = {
      unidades: o.cantidad,
      precioNeto: precioNetoOC,
      neto: centavos(precioNetoOC * o.cantidad),
    };
    const g = porSku.get(o.sku);
    if (!g) {
      lineas.push({
        estado: "falta en factura",
        sku: o.sku,
        descripcion: a?.descripcion ?? o.sku,
        renglones: [],
        como: null,
        factor: 1,
        oc: ladoOC,
        factura: null,
        difUnidades: -o.cantidad,
        difPrecio: 0,
        iva: ivaDe(o.sku),
      });
      continue;
    }
    porSku.delete(o.sku);

    // ¿POR UNIDAD O POR BULTO? Si el EAN ya lo dijo, manda el EAN. Si no, se
    // prueba por unidad y por bulto, y gana el que hace cerrar la cantidad o,
    // si ninguno, el que deja el precio más cerca. Un proveedor que factura 2
    // bultos de 6 contra una OC de 12 unidades NO tiene diferencia.
    let factor = g.id.factor;
    const unidadFija = g.renglones.some((r) => r.unidadFija);
    if (factor === 1 && !unidadFija && a && a.unidadesPorBulto > 1) {
      const porUnidad = ladoFactura(g.renglones, 1);
      const porBulto = ladoFactura(g.renglones, a.unidadesPorBulto);
      const cierraUnidad = porUnidad.unidades === o.cantidad;
      const cierraBulto = porBulto.unidades === o.cantidad;
      if (!cierraUnidad && cierraBulto) factor = a.unidadesPorBulto;
      else if (!cierraUnidad && !cierraBulto && porUnidad.precioNeto != null && porBulto.precioNeto != null) {
        const dU = Math.abs(porUnidad.precioNeto - precioNetoOC);
        const dB = Math.abs(porBulto.precioNeto - precioNetoOC);
        if (dB < dU && mismoPrecio(porBulto.precioNeto, precioNetoOC)) factor = a.unidadesPorBulto;
      }
    }

    const lf = ladoFactura(g.renglones, factor);
    const difUnidades = lf.unidades - o.cantidad;
    const precioOk = lf.precioNeto == null ? true : mismoPrecio(lf.precioNeto, precioNetoOC);
    const difPrecio =
      lf.precioNeto == null ? 0 : centavos((lf.precioNeto - precioNetoOC) * lf.unidades);
    const estado: EstadoCruce =
      difUnidades !== 0 && !precioOk
        ? "cantidad y precio"
        : difUnidades !== 0
          ? "cantidad"
          : !precioOk
            ? "precio"
            : "ok";

    lineas.push({
      estado,
      sku: o.sku,
      descripcion: a?.descripcion ?? o.sku,
      renglones: g.renglones,
      como: g.id.como,
      factor,
      oc: ladoOC,
      factura: lf,
      difUnidades,
      difPrecio: precioOk ? 0 : difPrecio,
      iva: ivaDe(o.sku),
    });
  }

  // 5) Lo facturado que no estaba pedido.
  for (const [sku, g] of porSku) {
    const lf = ladoFactura(g.renglones, g.id.factor);
    lineas.push({
      estado: "no está en la OC",
      sku,
      descripcion: indice.porSku.get(sku)?.descripcion ?? g.renglones[0].descripcion,
      renglones: g.renglones,
      como: g.id.como,
      factor: g.id.factor,
      oc: null,
      factura: lf,
      difUnidades: lf.unidades,
      difPrecio: 0,
      iva: ivaDe(sku),
    });
  }
  for (const r of sinIdentificar) {
    const lf = ladoFactura([r], 1);
    lineas.push({
      estado: "sin identificar",
      sku: null,
      descripcion: r.descripcion || r.codigo || r.ean || `Fila ${r.fila}`,
      renglones: [r],
      como: null,
      factor: 1,
      oc: null,
      factura: lf,
      difUnidades: lf.unidades,
      difPrecio: 0,
      iva: 21,
    });
  }

  // Resumen.
  const netoOC = centavos(lineas.reduce((s, l) => s + (l.oc?.neto ?? 0), 0));
  const netoFactura = centavos(lineas.reduce((s, l) => s + (l.factura?.neto ?? 0), 0));
  const netoFacturaAPrecioOC = centavos(
    lineas.reduce(
      (s, l) =>
        s +
        (l.oc && l.factura
          ? l.oc.precioNeto * l.factura.unidades
          : (l.factura?.neto ?? 0)),
      0,
    ),
  );
  const iva: Record<string, number> = {};
  for (const l of lineas) {
    if (!l.factura?.neto) continue;
    const k = String(l.iva);
    iva[k] = centavos((iva[k] ?? 0) + (l.factura.neto * l.iva) / 100);
  }

  return {
    lineas,
    resumen: {
      renglonesOC: oc.length,
      renglonesFactura: factura.length,
      ok: lineas.filter((l) => l.estado === "ok").length,
      conDiferencia: lineas.filter((l) =>
        ["cantidad", "precio", "cantidad y precio"].includes(l.estado),
      ).length,
      faltan: lineas.filter((l) => l.estado === "falta en factura").length,
      sobran: lineas.filter((l) => l.estado === "no está en la OC").length,
      sinIdentificar: lineas.filter((l) => l.estado === "sin identificar").length,
      netoOC,
      netoFactura,
      netoFacturaAPrecioOC,
      difPrecio: centavos(lineas.reduce((s, l) => s + l.difPrecio, 0)),
      iva,
    },
  };
}

/* -------------------------------------------------------------------------
   LOS TOTALES DEL COMPROBANTE
   ------------------------------------------------------------------------- */

export type PieComprobante = {
  /** Bonificación general al pie, en %. */
  descuentoPie: number;
  /** Percepciones de IVA, IIBB, impuestos internos: lo que se suma sin ser neto ni IVA. */
  otrosImpuestos: number;
  /** El total que dice el papel. `null` mientras no se cargó. */
  totalImpreso: number | null;
};

export type TotalesComprobante = {
  neto: number;
  descuentoPie: number;
  netoGravado: number;
  iva: { alicuota: number; importe: number }[];
  ivaTotal: number;
  otrosImpuestos: number;
  total: number;
  /** Total calculado menos el impreso. `null` sin impreso. */
  diferencia: number | null;
  cuadra: boolean | null;
};

/**
 * El total del comprobante, recalculado, contra el que trae impreso.
 *
 * La tolerancia es de UN PESO: cada sistema redondea el IVA por renglón o por
 * alícuota y eso mueve centavos, nunca pesos.
 */
export function totalesComprobante(
  resultado: ResultadoCruce,
  pie: PieComprobante,
): TotalesComprobante {
  const neto = resultado.resumen.netoFactura;
  const factorPie = 1 - Math.min(Math.max(pie.descuentoPie, 0), 100) / 100;
  const descuentoPie = centavos(neto * (1 - factorPie));
  const netoGravado = centavos(neto - descuentoPie);
  const iva = Object.entries(resultado.resumen.iva)
    .map(([k, v]) => ({ alicuota: Number(k), importe: centavos(v * factorPie) }))
    .sort((a, b) => b.alicuota - a.alicuota);
  const ivaTotal = centavos(iva.reduce((s, i) => s + i.importe, 0));
  const total = centavos(netoGravado + ivaTotal + (pie.otrosImpuestos || 0));
  const diferencia = pie.totalImpreso == null ? null : centavos(total - pie.totalImpreso);
  return {
    neto,
    descuentoPie,
    netoGravado,
    iva,
    ivaTotal,
    otrosImpuestos: pie.otrosImpuestos || 0,
    total,
    diferencia,
    cuadra: diferencia == null ? null : Math.abs(diferencia) <= 1,
  };
}

/* -------------------------------------------------------------------------
   LA OC DESDE LO QUE SE GUARDÓ AL MANDARLA
   ------------------------------------------------------------------------- */

/**
 * Los renglones de una OC tal como quedaron en `app.ordenes_compra_enviadas`.
 *
 * El payload ya viaja en UNIDADES y a precio de LISTA por unidad (ver la nota
 * de `unidadesDelRenglon` en lib/sigma-orden.ts), que es exactamente lo que
 * necesita el cruce. `unidadDeCompra` es sólo presentación y no se usa.
 */
export function renglonesDeOrdenEnviada(payload: {
  items?: {
    articuloId: string;
    cantidad: number;
    precio: number;
    descuento1?: number;
    descuento2?: number;
  }[];
}): RenglonOC[] {
  return (payload.items ?? []).map((i) => ({
    sku: String(i.articuloId).trim(),
    cantidad: Number(i.cantidad) || 0,
    precio: Number(i.precio) || 0,
    descuento1: Number(i.descuento1) || 0,
    descuento2: Number(i.descuento2) || 0,
  }));
}

/**
 * Una OC pegada desde la pantalla de Sigma (para las que no se armaron en el
 * tablero). Columnas esperadas: código, cantidad, precio, y opcionalmente las
 * dos bonificaciones. Usa el mismo lector que la factura.
 */
export function renglonesDeOCPegada(
  tabla: TablaPegada,
  roles: RolColumna[],
): RenglonOC[] {
  return leerRenglones(tabla, roles)
    .filter((r) => r.codigo && r.cantidad != null)
    .map((r) => ({
      sku: r.codigo.trim(),
      cantidad: r.cantidad ?? 0,
      precio: r.precio ?? (r.importe != null && r.cantidad ? r.importe / r.cantidad : 0),
      descuento1: r.descuento1,
      descuento2: r.descuento2,
    }));
}

/* -------------------------------------------------------------------------
   QUE DIFERENCIAS ENTRAN EN LA TABLA QUE SE LE MANDA AL PROVEEDOR
   ------------------------------------------------------------------------- */

/**
 * QUE DIFERENCIAS ENTRAN EN LA TABLA QUE SE LE MANDA AL PROVEEDOR.
 *
 * Las cuatro no se reclaman igual. Lo que facturó de más --en precio o en
 * cantidad-- es plata que se pide de vuelta; lo que facturó de menos muchas
 * veces es mercadería que falta y se reclama por otro lado, o directamente no
 * se reclama. Mandarlas todas juntas mezcla dos conversaciones y la más chica
 * se come a la más cara.
 *
 * Arrancan las cuatro tildadas: es lo que la pantalla mostraba antes, así que
 * quien no toque nada ve lo mismo de siempre.
 */
export const CLASES_DIFERENCIA = [
  {
    clave: "precio_mas",
    label: "Dif. de precios de más",
    ayuda: "Facturado por encima del costo de la OC",
    entra: (l: LineaCruce) => l.difPrecio > 0,
  },
  {
    clave: "precio_menos",
    label: "Dif. de precios de menos",
    ayuda: "Facturado por debajo del costo de la OC",
    entra: (l: LineaCruce) => l.difPrecio < 0,
  },
  {
    clave: "cantidad_mas",
    label: "Dif. de cantidades de más",
    ayuda: "Facturó más unidades de las pedidas, o algo que no estaba en la OC",
    entra: (l: LineaCruce) => l.difUnidades > 0,
  },
  {
    clave: "cantidad_menos",
    label: "Dif. de cantidades de menos",
    ayuda: "Facturó menos unidades de las pedidas, o no facturó algo pedido",
    entra: (l: LineaCruce) => l.difUnidades < 0,
  },
] as const;

export type ClaseDiferencia = (typeof CLASES_DIFERENCIA)[number]["clave"];

/**
 * UNA LINEA PUEDE ENTRAR POR MAS DE UNA. Un renglón con "cantidad y precio"
 * cumple dos de las cuatro, y basta con que una esté tildada para que entre:
 * sacarla porque la otra no lo está escondería una diferencia que sí se
 * quiere reclamar.
 */
export function entraEnLaTabla(l: LineaCruce, elegidas: Set<ClaseDiferencia>): boolean {
  return CLASES_DIFERENCIA.some((c) => elegidas.has(c.clave) && c.entra(l));
}

/* -------------------------------------------------------------------------
   LO QUE QUEDA PARA RECLAMARLE AL PROVEEDOR, CONGELADO
   ------------------------------------------------------------------------- */

/**
 * Una diferencia tal como se vio el día que se mandó la factura.
 *
 * SE GUARDA Y NO SE RECALCULA NUNCA MAS. El cruce sale de la OC y del maestro,
 * y los dos cambian: una OC se anula, un artículo cambia de costo, el maestro
 * se reescribe entero en cada corrida del orquestador. Recalcular el cruce de
 * una factura de hace dos meses daría otro número, y el reclamo se hace sobre
 * el que se vio al mandarla.
 *
 * Va lo mínimo para poder reclamar SIN volver a abrir la factura: qué
 * artículo, cuánto se pidió, cuánto se facturó y cuánto cuesta la diferencia.
 */
export type DiferenciaGuardada = {
  sku: string | null;
  descripcion: string;
  motivo: EstadoCruce;
  unidadesOC: number | null;
  unidadesFactura: number | null;
  difUnidades: number;
  difCosto: number;
  difCantidad: number;
};

export type ResumenDiferencias = {
  renglones: number;
  difCosto: number;
  difCantidad: number;
  lineas: DiferenciaGuardada[];
};

/**
 * LO QUE CUESTA UNA DIFERENCIA DE CANTIDAD: las unidades que faltan o sobran,
 * valuadas al costo de la OC. Es la misma cuenta que hace la pantalla.
 *
 * Sin línea de OC no hay costo de OC --algo facturado que no estaba pedido--
 * así que se valúa a lo que el proveedor cobró, que es lo único que se sabe.
 */
function pesosPorCantidad(l: LineaCruce): number {
  const precio = l.oc?.precioNeto ?? l.factura?.precioNeto ?? 0;
  return centavos(l.difUnidades * precio);
}

/**
 * El resumen que se guarda con la factura.
 *
 * ENTRAN LAS LINEAS QUE NO ESTAN OK. Un renglón que coincide en cantidad y
 * costo no se reclama, así que guardarlo sería guardar la factura entera -- y
 * la lista de lo que falta reclamar se leería como la lista de todo lo que se
 * compró.
 */
export function resumirDiferencias(cruce: ResultadoCruce): ResumenDiferencias {
  const lineas: DiferenciaGuardada[] = cruce.lineas
    .filter((l) => l.estado !== "ok")
    .map((l) => ({
      sku: l.sku,
      descripcion: l.descripcion,
      motivo: l.estado,
      unidadesOC: l.oc?.unidades ?? null,
      unidadesFactura: l.factura?.unidades ?? null,
      difUnidades: l.difUnidades,
      difCosto: centavos(l.difPrecio),
      difCantidad: pesosPorCantidad(l),
    }));

  return {
    renglones: lineas.length,
    difCosto: centavos(lineas.reduce((s, l) => s + l.difCosto, 0)),
    difCantidad: centavos(lineas.reduce((s, l) => s + l.difCantidad, 0)),
    lineas,
  };
}
