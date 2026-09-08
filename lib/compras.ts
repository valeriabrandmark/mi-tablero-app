/**
 * Reglas del panel de Compras.
 *
 * ---------------------------------------------------------------------------
 * QUÉ ES ESTA PANTALLA Y QUÉ LA HACE DISTINTA DEL TABLERO DE STOCK
 *
 * El tablero de Stock contesta "cómo estamos". Éste arma UNA ORDEN DE COMPRA y
 * la deja lista para importar en la grilla de Sigma. Por eso acá el usuario
 * EDITA —cambia cantidades, elige bultos o unidades, corrige el descuento— y lo
 * que se lleva es un archivo, no una conclusión.
 *
 * LAS ÓRDENES SON POR PROVEEDOR, siempre. No es una preferencia de la pantalla:
 * es cómo funciona la compra. Por eso el archivo no se puede bajar hasta que
 * haya un proveedor elegido, y no hay forma de mezclar dos en el mismo archivo.
 */

import {
  COBERTURA_OBJETIVO_DIAS,
  GRUPO_PROVEEDOR_POR_DEFECTO,
  PLAZO_REPOSICION_DIAS,
} from "@/lib/stock";
import type { CeldaXlsx, ColumnaXlsx, LibroXlsx } from "@/lib/xlsx";
import type { FilaCompra } from "@/lib/types";

/** Sobre cuántos meses se mide la rentabilidad de venta del artículo. */
export const MESES_RENTABILIDAD = 3;

/** Cuántos meses de descuento se muestran para atrás. */
export const MESES_HISTORIA_SELL_IN = 6;

/* -------------------------------------------------------------------------
   EL SUGERIDO Y LA OFERTA

   El sugerido base es el mismo del tablero de Stock: lo que falta para cubrir
   el objetivo contando lo que se vende mientras la reposición viaja. Eso
   responde "cuánto necesito", que es sólo la mitad de la pregunta del que
   compra: la otra mitad es "y conviene comprarlo AHORA".

   Un descuento muy por encima del habitual es una razón para adelantar compra
   --se paga menos por la misma unidad-- y uno igual al de siempre no lo es. De
   ahí sale el factor: no inventa demanda, mueve en el tiempo la que ya existe.
   ------------------------------------------------------------------------- */

/**
 * Cuántos puntos de descuento POR ENCIMA DE LO HABITUAL duplican la compra.
 *
 * Sale del ejemplo que dio el negocio: "si los últimos 4 meses tuve un 10 % y
 * este mes tengo 40, sugerir el doble". 40 − 10 = 30 puntos.
 */
export const PUNTOS_OFERTA_PARA_DUPLICAR = 30;

/**
 * Tope del multiplicador. Con 60 puntos de ventaja el factor daría 3, y no hay
 * descuento que justifique comprar el triple: la plata se inmoviliza igual y
 * el artículo puede dejar de venderse.
 */
export const FACTOR_OFERTA_MAX = 2;

/**
 * El techo duro, en días de venta. Por más grande que sea la oferta, no se
 * sugiere pasar de acá.
 *
 * Es lo que separa "aprovechar una oferta" de "comprar un año de mercadería":
 * un artículo con ritmo bajo y 50 % de descuento daría, sin este tope, un
 * sugerido que tarda meses en venderse y que hay que pagar y almacenar hoy.
 */
export const COBERTURA_MAXIMA_COMPRA_DIAS = 90;

/**
 * A partir de qué cobertura ya no se infla nada, por buena que esté la oferta.
 * Es el borde del tramo "Excedido" de Stock: si ya sobra, la oferta no es una
 * oportunidad, es más plata quieta.
 */
export const COBERTURA_SIN_INFLAR_DIAS = 120;

/**
 * Las dos formas de comprar.
 *
 * `Bultos` y `Unidad` son los textos que espera la columna UNICOM de Sigma,
 * escritos tal cual. NO son etiquetas de pantalla: viajan al archivo. Si Sigma
 * cambia lo que acepta, se cambia acá y en ningún otro lado.
 */
export const UNIDADES_COMPRA = [
  { clave: "bulto", label: "Bultos", unicom: "Bultos" },
  { clave: "unidad", label: "Unidades", unicom: "Unidad" },
] as const;

export type ClaveUnidadCompra = (typeof UNIDADES_COMPRA)[number]["clave"];

/**
 * Con qué unidad arranca cada artículo.
 *
 * LA MAYORÍA SE COMPRA POR BULTO, pero hay excepciones, así que el default sale
 * del dato y no de una regla fija: un artículo cuyo bulto es de UNA unidad no
 * tiene bulto —comprarlo "por bulto" sería lo mismo y sólo confundiría—.
 * De los 8.237 del maestro, 3.061 están así.
 *
 * Es un DEFAULT, no una imposición: el que compra lo cambia fila por fila.
 */
export function unidadPorDefecto(unidadesPorBulto: number): ClaveUnidadCompra {
  return unidadesPorBulto > 1 ? "bulto" : "unidad";
}

/**
 * Cuánto pedir, en la unidad elegida.
 *
 * REDONDEA PARA ARRIBA, y es una decisión de negocio: no se puede pedir medio
 * bulto, y quedarse corto es peor que pasarse. Un sugerido de 13 unidades con
 * bultos de 6 pide 3 bultos (18), no 2 (12) — con 2 el artículo se quiebra
 * antes de la próxima compra, que es justo lo que la pantalla intenta evitar.
 */
export function cantidadSugerida(
  sugeridoUnidades: number,
  unidad: ClaveUnidadCompra,
  unidadesPorBulto: number,
): number {
  if (sugeridoUnidades <= 0) return 0;
  if (unidad === "unidad") return Math.ceil(sugeridoUnidades);
  const porBulto = unidadesPorBulto > 0 ? unidadesPorBulto : 1;
  return Math.ceil(sugeridoUnidades / porBulto);
}

/** Cuántas unidades físicas son, para valorizar y para comparar con el stock. */
export function aUnidades(
  cantidad: number,
  unidad: ClaveUnidadCompra,
  unidadesPorBulto: number,
): number {
  if (unidad === "unidad") return cantidad;
  return cantidad * (unidadesPorBulto > 0 ? unidadesPorBulto : 1);
}

/**
 * Un renglón de la orden, tal como lo dejó el que compra.
 *
 * Vive aparte de `FilaCompra` —que es lo que calculó el servidor— porque son
 * dos cosas distintas: una es lo que los datos dicen, la otra es lo que la
 * persona decidió. Mezclarlas haría imposible mostrar "pediste 3 y el sugerido
 * era 2".
 */
export type RenglonOrden = {
  unidad: ClaveUnidadCompra;
  cantidad: number;
  /**
   * DESC 1: el sell in vigente del proveedor, en PUNTOS (15 = 15 %), como lo
   * espera FDESCU1. Arranca del dato y se puede corregir a mano.
   */
  descuento: number;
  /**
   * DESC 2: el segundo descuento, en PUNTOS. ARRANCA SIEMPRE EN CERO y no sale
   * de ningún dato: es el que se negocia por fuera del sell in de lista —una
   * bonificación por volumen, un acuerdo puntual— y por eso lo pone la persona
   * o no está.
   */
  descuento2: number;
};

/**
 * Los dos descuentos, aplicados EN CASCADA y no sumados.
 *
 * 15 % y 10 % NO son 25 %: el segundo se calcula sobre lo que quedó después del
 * primero, así que el neto es 0,85 × 0,90 = 76,5 % del costo, o sea 23,5 % de
 * descuento y no 25. Es como los liquidan los proveedores y como los aplica
 * Sigma con FDESCU1 y FDESCU2, y la diferencia en una orden grande es plata de
 * verdad.
 */
export function factorNeto(descuento1: number, descuento2: number): number {
  return (1 - descuentoValido(descuento1) / 100) * (1 - descuentoValido(descuento2) / 100);
}

/**
 * El renglón con el que arranca cada artículo: el sugerido y el sell in del mes.
 *
 * EL DESCUENTO SALE DEL SELL IN DEL PROVEEDOR Y DE NINGÚN OTRO LADO. Sin sell in
 * cargado arranca en CERO, y la pantalla dice por qué. La tentación es usar el
 * `oferta_pct` de `costos_historicos`, que está a mano y casi siempre tiene un
 * número — pero ése es un sell in CALCULADO con nuestras compras para
 * trasladarlo a las ofertas del mes, no el que el proveedor tiene vigente.
 * Mandarlo en una orden sería pedirle al proveedor con un descuento inventado,
 * y el error viajaría en un archivo que alguien importa sin volver a mirarlo.
 */
export function renglonInicial(f: FilaCompra): RenglonOrden {
  const unidad = unidadPorDefecto(f.unidadesPorBulto);
  return {
    unidad,
    cantidad: cantidadSugerida(f.sugerido, unidad, f.unidadesPorBulto),
    descuento: f.sellInPct ?? 0,
    // Vacío a propósito: ver RenglonOrden.
    descuento2: 0,
  };
}

/* -------------------------------------------------------------------------
   EL ARCHIVO PARA SIGMA
   ------------------------------------------------------------------------- */

/**
 * Las columnas de la grilla de compra de Sigma, en su orden y con sus nombres
 * exactos. El orden importa: la grilla las lee por posición.
 *
 * FDESCU2 ES EL SEGUNDO DESCUENTO, y va siempre aunque esté en cero: una grilla
 * de cinco columnas con la última vacía se importa; una de cuatro cuando el
 * importador espera cinco, no. Sigma los aplica en cascada, igual que
 * `factorNeto`.
 */
export const COLUMNAS_SIGMA = [
  "FCODREF",
  "UNICOM",
  "CANTIDAD",
  "FDESCU1",
  "FDESCU2",
] as const;

/**
 * El descuento como lo escribe Sigma: dos decimales y coma.
 *
 * COMA Y NO PUNTO porque así está en la grilla ("15,00", "0,00"). Es también el
 * motivo por el que el CSV va con punto y coma: con coma decimal Y coma
 * separadora, Excel parte el número al medio y el archivo entra corrido.
 */
export function fmtDescuento(pct: number): string {
  return (Number.isFinite(pct) ? pct : 0).toFixed(2).replace(".", ",");
}

/**
 * Descuentos imposibles, recortados antes de que salgan por la puerta.
 *
 * `bronze.costos_historicos` tiene hoy un SKU con oferta de 973,08 % —el
 * GL04016, que por eso figura con costo NEGATIVO de -18.900—. Un dato así en la
 * orden de compra no es un número raro en una pantalla: es un pedido mal hecho.
 * Se recorta a 100 y la pantalla avisa cuáles tocó.
 */
export const DESCUENTO_MAXIMO = 100;

export function descuentoValido(pct: number | null | undefined): number {
  if (pct == null || !Number.isFinite(pct) || pct < 0) return 0;
  return Math.min(pct, DESCUENTO_MAXIMO);
}

export type LineaExportada = {
  sku: string;
  unicom: string;
  cantidad: number;
  descuento: number;
  descuento2: number;
};

/**
 * Los renglones que van al archivo: los que tienen cantidad.
 *
 * Un renglón en cero NO es una compra de cero, es un artículo que el que compra
 * decidió no pedir. Mandarlo igual dejaría a Sigma con líneas vacías que
 * después hay que borrar a mano.
 */
export function lineasParaExportar(
  filas: FilaCompra[],
  orden: Map<string, RenglonOrden>,
): LineaExportada[] {
  const lineas: LineaExportada[] = [];
  for (const f of filas) {
    const r = orden.get(f.sku);
    if (!r || !(r.cantidad > 0)) continue;
    lineas.push({
      sku: f.sku,
      unicom: UNIDADES_COMPRA.find((u) => u.clave === r.unidad)!.unicom,
      cantidad: Math.round(r.cantidad),
      descuento: descuentoValido(r.descuento),
      descuento2: descuentoValido(r.descuento2),
    });
  }
  return lineas;
}

/**
 * El archivo de texto: columnas separadas por TABULACIÓN.
 *
 * Tabulación y no coma ni punto y coma porque el descuento lleva coma decimal y
 * los códigos no tienen tabs adentro: es el único separador que no puede
 * chocar con el contenido.
 */
export function aTxt(lineas: LineaExportada[]): string {
  const filas = [COLUMNAS_SIGMA.join("\t")];
  for (const l of lineas) {
    filas.push(
      [
        l.sku,
        l.unicom,
        String(l.cantidad),
        fmtDescuento(l.descuento),
        fmtDescuento(l.descuento2),
      ].join("\t"),
    );
  }
  // Termina en salto de línea: hay importadores que se comen el último renglón
  // si el archivo no cierra con uno.
  return filas.join("\r\n") + "\r\n";
}

/**
 * El mismo contenido para abrir en Excel.
 *
 * PUNTO Y COMA como separador, por lo dicho arriba: el descuento va con coma
 * decimal. Y va con BOM porque si no, Excel abre el archivo como ASCII y
 * cualquier acento aparece roto.
 */
export function aCsv(lineas: LineaExportada[]): string {
  const filas = [COLUMNAS_SIGMA.join(";")];
  for (const l of lineas) {
    filas.push(
      [
        l.sku,
        l.unicom,
        String(l.cantidad),
        fmtDescuento(l.descuento),
        fmtDescuento(l.descuento2),
      ].join(";"),
    );
  }
  return "\ufeff" + filas.join("\r\n") + "\r\n";
}

/* -------------------------------------------------------------------------
   EL EXCEL PARA EL PROVEEDOR

   Es OTRO archivo y no otro formato del mismo. El de Sigma tiene cuatro
   columnas y habla en nuestro idioma: nuestro SKU, nuestra grilla, nuestro
   importador. Éste se manda por mail a una persona del otro lado que no tiene
   nuestro maestro y necesita entender, sin preguntar nada, qué se le está
   pidiendo y por cuánta plata.

   POR ESO LLEVA EL CÓDIGO DE COMPRA Y EL EAN: son los dos identificadores que
   el proveedor sí reconoce. Y por eso lleva el costo y el subtotal, que al
   archivo de Sigma no van: acá el número es parte del pedido —"esto te compro
   y a este precio"— y es lo primero que el proveedor va a mirar.
   ------------------------------------------------------------------------- */

/**
 * Las columnas del Excel, en el orden en que se leen.
 *
 * LA COLUMNA "Unidad" NO ESTABA EN EL PEDIDO Y ESTÁ IGUAL. Sin ella "Cantidad:
 * 12" es ambiguo del peor modo posible: son 12 bultos o 12 unidades, y con
 * bultos de 6 la diferencia es pedir 72 o pedir 12. El costo de al lado tiene
 * el mismo problema, y por eso su título dice de qué es.
 */
export const COLUMNAS_EXCEL_PROVEEDOR: ColumnaXlsx[] = [
  { titulo: "SKU", formato: "texto", ancho: 12 },
  { titulo: "Cód. compra proveedor", formato: "texto", ancho: 22 },
  // EL EAN VA COMO TEXTO Y NO COMO NÚMERO, a propósito. Son 13 dígitos: como
  // número, Excel lo muestra en notación científica ("7,79E+12") y le come el
  // cero de adelante a los que lo tienen. Un EAN no se suma, se lee.
  { titulo: "EAN", formato: "texto", ancho: 16 },
  { titulo: "U x bulto", formato: "entero", ancho: 10 },
  { titulo: "Cantidad", formato: "entero", ancho: 10 },
  { titulo: "Unidad", formato: "texto", ancho: 10 },
  { titulo: "Artículo", formato: "texto", ancho: 46 },
  { titulo: "Desc 1 (Sell in)", formato: "porcentaje", ancho: 14 },
  { titulo: "Desc 2", formato: "porcentaje", ancho: 10 },
  { titulo: "Costo de lista", formato: "moneda", ancho: 14 },
  { titulo: "Costo con desc.", formato: "moneda", ancho: 15 },
  { titulo: "Total", formato: "moneda", ancho: 15 },
];

/**
 * QUIÉN EMITE LA ORDEN, según el grupo del proveedor.
 *
 * No es decorado del encabezado: es la empresa que le compra y a la que el
 * proveedor le va a facturar. Una OC de un proveedor de NOA no la firma Quo.
 *
 * Si mañana aparece un grupo nuevo, cae en su propio nombre en vez de mentir
 * una razón social — que es feo pero honesto.
 */
export const RAZON_SOCIAL_POR_GRUPO: Record<string, string> = {
  "QUO MKT": "Quo Marketing SRL",
};

export function razonSocial(grupo: string | null | undefined): string {
  if (!grupo) return RAZON_SOCIAL_POR_GRUPO[GRUPO_PROVEEDOR_POR_DEFECTO] ?? GRUPO_PROVEEDOR_POR_DEFECTO;
  return RAZON_SOCIAL_POR_GRUPO[grupo] ?? grupo;
}

/**
 * El renglón valorizado: lo que se pide, en la unidad elegida, con su costo.
 *
 * EL COSTO DE LISTA ES EL DE LA UNIDAD ELEGIDA. Si el renglón va por bulto, el
 * costo que se muestra es el del BULTO —el de la unidad multiplicado por
 * cuántas trae—, porque un precio unitario al lado de una cantidad en bultos
 * es una cuenta a medio hacer que el que recibe el mail va a tener que
 * terminar, y va a terminar mal.
 */
function renglonValorizado(f: FilaCompra, r: RenglonOrden) {
  const porBulto = f.unidadesPorBulto > 0 ? f.unidadesPorBulto : 1;
  // El mismo respaldo que usa el resumen de la pantalla: sin costo de lista
  // cargado se valoriza con el costo real, que es lo único que hay.
  const unitario = f.costoLista > 0 ? f.costoLista : f.costo;
  const lista = r.unidad === "bulto" ? unitario * porBulto : unitario;
  const descuento = descuentoValido(r.descuento);
  const descuento2 = descuentoValido(r.descuento2);
  // En cascada, no sumados: ver factorNeto.
  const conDescuento = lista * factorNeto(descuento, descuento2);
  return {
    porBulto,
    lista,
    descuento,
    descuento2,
    conDescuento,
    total: conDescuento * r.cantidad,
  };
}

/**
 * El libro entero, listo para bajar.
 *
 * Toma las MISMAS filas y la MISMA orden que el archivo de Sigma, así que los
 * dos archivos no pueden discrepar: si un renglón está en cero no está en
 * ninguno de los dos.
 */
export function excelParaProveedor(
  filas: FilaCompra[],
  orden: Map<string, RenglonOrden>,
  proveedor: string,
  comentario?: string,
): LibroXlsx {
  const renglones: CeldaXlsx[][] = [];
  let total = 0;
  let unidades = 0;
  // El grupo sale de las filas y no de un parámetro porque la orden es de UN
  // proveedor: todas sus filas traen el mismo. La primera alcanza.
  const grupo = filas.find((f) => f.grupo)?.grupo ?? null;

  for (const f of filas) {
    const r = orden.get(f.sku);
    if (!r || !(r.cantidad > 0)) continue;
    const v = renglonValorizado(f, r);
    total += v.total;
    unidades += aUnidades(r.cantidad, r.unidad, f.unidadesPorBulto);
    renglones.push([
      f.sku,
      f.codigoCompra,
      f.ean,
      v.porBulto,
      r.cantidad,
      UNIDADES_COMPRA.find((u) => u.clave === r.unidad)!.label,
      f.producto,
      // Como fracción: en el .xlsx el 15 % se guarda 0,15 y se muestra "15,0 %".
      // Guardar el 15 pelado obligaría al que recibe el archivo a acordarse de
      // que ese número son puntos y no una cantidad.
      v.descuento / 100,
      // El Desc 2 en cero se escribe igual y no se deja vacío: "0,0 %" dice que
      // no hay segundo descuento, y una celda en blanco dice que no se sabe.
      v.descuento2 / 100,
      v.lista,
      v.conDescuento,
      v.total,
    ]);
  }

  // LA CARÁTULA. Va arriba y no abajo porque es lo primero que el que abre el
  // archivo necesita saber: quién le compra, cuándo y a quién. Abajo quedaba
  // como una nota al pie de algo que ya terminó de leer.
  const titulos = [
    `OC ${razonSocial(grupo)} · ${fmtFechaDeHoy()} · ${proveedor}`,
    `${renglones.length} renglones · ${unidades.toLocaleString("es-AR")} unidades`,
  ];
  // El comentario es opcional: si no hay, esa línea no existe en vez de quedar
  // una fila vacía en el medio de la carátula.
  const nota = (comentario ?? "").trim();
  if (nota) titulos.push(nota);

  return {
    hoja: "Orden de compra",
    titulos,
    columnas: COLUMNAS_EXCEL_PROVEEDOR,
    filas: renglones,
    // LA FILA DE CIERRE NO SUMA "Cantidad", y no es un olvido: sumar bultos con
    // unidades da un número que no significa nada. Las unidades físicas —que sí
    // se pueden sumar— están arriba, en la carátula.
    total: ["TOTAL", null, null, null, null, null, null, null, null, null, null, total],
  };
}

/** La fecha de hoy como se escribe acá: 08/09/2026. */
function fmtFechaDeHoy(): string {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()}`;
}

/**
 * Cómo se llama el archivo.
 *
 * Lleva el proveedor y la fecha porque termina en la carpeta de Descargas al
 * lado de otros diez: "compra.txt" no se puede distinguir de nada.
 */
export function nombreArchivo(proveedor: string, extension: string): string {
  const limpio = proveedor
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toUpperCase()
    .slice(0, 40);
  const hoy = new Date().toISOString().slice(0, 10);
  return `OC-${limpio || "PROVEEDOR"}-${hoy}.${extension}`;
}

/* -------------------------------------------------------------------------
   POR QUÉ ESA CANTIDAD
   ------------------------------------------------------------------------- */

/**
 * El renglón por renglón de cómo se llegó al sugerido, para el tooltip.
 *
 * Devuelve LÍNEAS y no una frase armada: el `title` de una celda las separa con
 * saltos, y así cada paso de la cuenta se lee solo. Un párrafo obligaría a
 * seguir la aritmética de memoria, que es justo lo que el tooltip viene a
 * evitar.
 *
 * Vive acá y no en el componente porque es una explicación de la cuenta, y la
 * cuenta vive en este archivo. Si mañana cambia el factor, las dos cosas se
 * tocan juntas.
 */
export function porQueSugerido(f: FilaCompra): string[] {
  if (f.cobertura == null) {
    return [
      "Sin ventas en la ventana: no hay ritmo con el que calcular nada.",
      `Stock hoy: ${Math.round(f.total)} u.`,
    ];
  }

  const l: string[] = [
    `Se vende ${f.ritmoDiario.toFixed(2)} u. por día y hay ${Math.round(f.total)} u.`,
    `Alcanza para ${Math.round(f.cobertura)} días.`,
    `Para cubrir ${COBERTURA_OBJETIVO_DIAS} días de objetivo + ${PLAZO_REPOSICION_DIAS}` +
      ` de reposición faltan ${Math.ceil(f.sugeridoBase)} u.`,
  ];

  if (f.cobertura > COBERTURA_SIN_INFLAR_DIAS) {
    l.push(
      "",
      `Ya hay más de ${COBERTURA_SIN_INFLAR_DIAS} días de cobertura, así que la` +
        " oferta no infla la compra: comprar más sería plata quieta.",
    );
    return l;
  }

  const vigente = f.sellInPct;
  const mediana = f.medianaSellIn;

  if (vigente == null || mediana == null) {
    l.push(
      "",
      "Sin sell in del proveedor con qué comparar: se sugiere lo que hace falta" +
        " y nada más.",
    );
  } else if (f.factorOferta <= 1) {
    l.push(
      "",
      `El descuento de este mes (${vigente.toFixed(1)} %) no supera al habitual` +
        ` (${mediana.toFixed(1)} %), así que no hay motivo para adelantar compra.`,
    );
  } else {
    l.push(
      "",
      `El descuento de este mes es ${vigente.toFixed(1)} % contra ${mediana.toFixed(1)} %` +
        ` habitual: ${(vigente - mediana).toFixed(1)} puntos de ventaja.`,
      `Por eso se multiplica por ${f.factorOferta.toFixed(2)}` +
        ` (${PUNTOS_OFERTA_PARA_DUPLICAR} puntos = el doble, tope ${FACTOR_OFERTA_MAX}x).`,
    );
  }

  // El tope sólo se nombra cuando efectivamente mordió. Decir "no llegó al
  // techo" en cada artículo sería ruido en el 95 % de las filas.
  const sinTope = Math.ceil(f.sugeridoBase * f.factorOferta);
  if (f.sugerido < sinTope) {
    l.push(
      `Daría ${sinTope} u., pero el techo de ${COBERTURA_MAXIMA_COMPRA_DIAS} días` +
        ` de cobertura lo baja a ${f.sugerido}.`,
    );
  }

  l.push("", `Sugerido: ${f.sugerido} u.`);
  return l;
}
