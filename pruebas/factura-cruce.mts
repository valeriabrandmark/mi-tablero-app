/**
 * Pruebas del cruce factura contra OC. Sin base, sin red, sin navegador.
 *
 * Los artículos son de IMPROM tal como están en el maestro de Sigma, con sus
 * mañas: un `codigoCompra` con comas en vez de puntos, uno que es el EAN, y
 * bultos de 4 y 6.
 *
 *     node --experimental-strip-types --import ./pruebas/registrar.mjs pruebas/factura-cruce.mts
 */

import {
  adivinarColumnas,
  buscarArticulo,
  cruzar,
  indexarMaestro,
  leerNumero,
  leerRenglones,
  leerTablaPegada,
  parecido,
  totalesComprobante,
  type ArticuloMaestro,
  type RenglonOC,
} from "@/lib/factura-cruce";

const FALLOS: string[] = [];

function revisar(nombre: string, obtenido: unknown, esperado: unknown) {
  const ok = JSON.stringify(obtenido) === JSON.stringify(esperado);
  console.log(
    ok
      ? `OK  ${nombre}`
      : `MAL ${nombre}\n     esperado: ${JSON.stringify(esperado)}\n     obtenido: ${JSON.stringify(obtenido)}`,
  );
  if (!ok) FALLOS.push(nombre);
}

// --- Números ----------------------------------------------------------------

revisar("formato local", leerNumero("1.234,56"), 1234.56);
revisar("formato inglés", leerNumero("1,234.56"), 1234.56);
revisar("con signo pesos", leerNumero("$ 3.699,68"), 3699.68);
revisar("porcentaje", leerNumero("12,5 %"), 12.5);
revisar("negativo contable", leerNumero("(1.500,00)"), -1500);
revisar("signo al final", leerNumero("1.500,00-"), -1500);
revisar("punto de miles solo", leerNumero("1.234"), 1234);
revisar("punto decimal con dos", leerNumero("12.50"), 12.5);
revisar("varios puntos de miles", leerNumero("1.234.567"), 1234567);
revisar("celda vacía no es cero", leerNumero(""), null);
revisar("texto no es número", leerNumero("VASO"), null);

// --- El maestro y la OC -----------------------------------------------------

const art = (
  sku: string,
  descripcion: string,
  codigoCompra: string | null,
  eanUnidad: string | null,
  unidadesPorBulto: number,
  eanBulto: string | null = null,
): ArticuloMaestro => ({
  sku,
  descripcion,
  codigoCompra,
  eanUnidad,
  eanDisplay: null,
  eanBulto,
  unidadesPorBulto,
  unidadesPorDisplay: 1,
  iva: 21,
});

const MAESTRO: ArticuloMaestro[] = [
  art("IM04075", "CONTIGO HURON 2.0 VASO TÉRMICO 473ML ROSA CLARO", "P04.033.26", "607869299486", 4),
  art("IM04116", "CONTIGO JACKSON CHILL 2.0 BOTELLA ALLY LOVE 710ML LICORICE - NEGRO", "P01.037.12", "607869321040", 4),
  art("IM04077", "CONTIGO BYRON 2.0 VASO TÉRMICO 473ML VIOLETA", "P04.035.16", "607869299967", 6),
  art("IM07022", "COLEMAN 3SIXTY TERMO 1200ML CARIBBEAN SEA- AZUL OSCURO", "P03,033,07", null, 6),
  art("IM01034", "DF - NUK EVOLUTION VASO ACTION CUP PEZ VIOLETA", "4008600398370", "4008600398370", 4, "14008600398377"),
  art("IM04078", "CONTIGO BYRON 2.0 VASO TÉRMICO 473ML NEGRO", "P04.035.17", "607869299968", 6),
];

const OC: RenglonOC[] = [
  { sku: "IM04075", cantidad: 8, precio: 10000, descuento1: 10, descuento2: 0 },
  { sku: "IM04116", cantidad: 4, precio: 20000, descuento1: 0, descuento2: 0 },
  { sku: "IM04077", cantidad: 12, precio: 9000, descuento1: 0, descuento2: 0 },
  { sku: "IM07022", cantidad: 6, precio: 15000, descuento1: 0, descuento2: 0 },
  { sku: "IM01034", cantidad: 8, precio: 5000, descuento1: 0, descuento2: 0 },
  { sku: "IM04078", cantidad: 6, precio: 9000, descuento1: 0, descuento2: 0 },
];

// --- La factura, pegada desde Excel, en OTRO orden ---------------------------
//
// - IM07022 viene con su código con puntos: tiene que reconocerlo igual.
// - IM04077 viene en BULTOS (2 de 6 = 12 u., que es lo pedido): no es diferencia.
// - IM01034 viene por EAN del bulto: 2 bultos de 4 = 8 u.
// - IM04116 viene sin código, sólo descripción y con otro orden de palabras.
// - IM04075 viene con precio más caro.
// - IM04078 no vino: falta.
// - Un artículo que no está en la OC ni en el maestro: sin identificar.

const PEGADO = [
  "Código\tDescripción\tCant.\tP. Unit.\tBonif %\tImporte",
  "P03.033.07\tTERMO COLEMAN 3SIXTY 1200 ML AZUL\t6\t15.000,00\t0\t90.000,00",
  "P04.035.16\tVASO BYRON 473 ML VIOLETA x6\t2\t54.000,00\t0\t108.000,00",
  "14008600398377\tNUK ACTION CUP\t2\t20.000,00\t0\t40.000,00",
  "\tBOTELLA CONTIGO JACKSON CHILL ALLY LOVE 710ML NEGRO\t4\t20.000,00\t0\t80.000,00",
  "P04.033.26\tVASO HURON 473ML ROSA\t8\t10.500,00\t10\t75.600,00",
  "ZZ999\tPRODUCTO RARO\t1\t1.000,00\t0\t1.000,00",
  "\t\t\t\tSubtotal\t394.600,00",
].join("\n");

const tabla = leerTablaPegada(PEGADO);
revisar("separador tab", tabla.separador, "tab");
revisar("detecta encabezado", tabla.encabezados?.[0], "Código");
const roles = adivinarColumnas(tabla);
revisar("roles por título", roles, [
  "codigo",
  "descripcion",
  "cantidad",
  "precio",
  "descuento1",
  "importe",
]);

const renglones = leerRenglones(tabla, roles);
revisar("descarta la fila del subtotal", renglones.length, 6);

const r = cruzar(OC, renglones, MAESTRO);
const de = (sku: string) => r.lineas.find((l) => l.sku === sku)!;

revisar("código del proveedor con comas", de("IM07022").estado, "ok");
revisar("cómo lo reconoció", de("IM07022").como, "codigo proveedor");
revisar("factura en bultos no es diferencia", de("IM04077").estado, "ok");
revisar("factor bulto deducido", de("IM04077").factor, 6);
revisar("EAN del bulto", [de("IM01034").como, de("IM01034").factor, de("IM01034").estado], ["ean bulto", 4, "ok"]);
revisar("por descripción", [de("IM04116").como, de("IM04116").estado], ["descripcion", "ok"]);
revisar("precio distinto", de("IM04075").estado, "precio");
revisar("lo que cuesta la diferencia de precio", de("IM04075").difPrecio, 3600);
revisar("falta en factura", de("IM04078").estado, "falta en factura");
revisar("sin identificar", r.lineas.filter((l) => l.estado === "sin identificar").length, 1);
revisar("neto de la factura", r.resumen.netoFactura, 394600);
revisar("neto de la OC", r.resumen.netoOC, 72000 + 80000 + 108000 + 90000 + 40000 + 54000);

// --- La descripción no se queda con el hermano equivocado -----------------
//
// VIOLETA y NEGRO son el mismo vaso: sólo el color los separa.
revisar(
  "parecido prefiere el color correcto",
  parecido("VASO BYRON 473 ML NEGRO", "CONTIGO BYRON 2.0 VASO TÉRMICO 473ML NEGRO") >
    parecido("VASO BYRON 473 ML NEGRO", "CONTIGO BYRON 2.0 VASO TÉRMICO 473ML VIOLETA"),
  true,
);

// --- Asignación manual -----------------------------------------------------

const fila = renglones.find((x) => x.codigo === "ZZ999")!.fila;
const m = cruzar(OC, renglones, MAESTRO, { [fila]: "IM04078" });
revisar("lo manual pisa al cruce", m.lineas.find((l) => l.sku === "IM04078")!.como, "manual");

// --- Cantidad de menos -----------------------------------------------------

const corta = leerRenglones(
  leerTablaPegada("P03.033.07\tTERMO\t4\t15.000,00\t0\t60.000,00"),
  ["codigo", "descripcion", "cantidad", "precio", "descuento1", "importe"],
);
const c = cruzar(OC, corta, MAESTRO);
revisar("vino de menos", [c.lineas[3].estado, c.lineas[3].difUnidades], ["cantidad", -2]);

// --- Totales ---------------------------------------------------------------

const t = totalesComprobante(r, { descuentoPie: 0, otrosImpuestos: 5000, totalImpreso: 482466 });
revisar("IVA 21", t.ivaTotal, 82866);
revisar("total cuadra", [t.total, t.cuadra], [482466, true]);
const t2 = totalesComprobante(r, { descuentoPie: 0, otrosImpuestos: 0, totalImpreso: 482466 });
revisar("no cuadra y dice por cuánto", [t2.cuadra, t2.diferencia], [false, -5000]);

// --- Pegado desde PDF ------------------------------------------------------

const pdf = leerTablaPegada(
  [
    "P04.033.26   VASO HURON 473ML ROSA   8   10.500,00   75.600,00",
    "P01.037.12   BOTELLA JACKSON 710ML   4   20.000,00   80.000,00",
  ].join("\n"),
);
revisar("PDF: separa por espacios dobles", [pdf.separador, pdf.filas[0].length], ["espacios", 5]);
revisar("PDF: adivina sin títulos", adivinarColumnas(pdf), [
  "codigo",
  "descripcion",
  "cantidad",
  "precio",
  "importe",
]);

// --- Carga a mano: cualquier código, y la unidad la dice la persona -----------

const IDX = indexarMaestro(MAESTRO);
const sku = (c: string[]) => {
  const h = buscarArticulo(IDX, c);
  return h == null ? null : "a" in h ? [h.a.sku, h.porBulto] : h.error;
};
revisar("a mano: SKU en minúscula", sku(["im04075"]), ["IM04075", false]);
revisar("a mano: EAN de unidad", sku(["607869299967"]), ["IM04077", false]);
revisar("a mano: EAN del bulto marca bultos", sku(["14008600398377"]), ["IM01034", true]);
revisar("a mano: código de compra con otra puntuación", sku(["P03.033.07"]), ["IM07022", false]);
revisar("a mano: dos códigos del mismo artículo", sku(["IM04075", "P04.033.26"]), ["IM04075", false]);
revisar(
  "a mano: códigos de artículos distintos",
  sku(["IM04075", "P04.035.16"]),
  "Los códigos no coinciden: IM04075 / IM04077",
);
revisar("a mano: código que no está", sku(["ZZ999"]), "No está en el maestro: ZZ999");
revisar("a mano: sin código", sku(["", " "]), null);

// 2 renglones del Byron (bulto de 6) facturados como 2 UNIDADES a mano: con
// `unidadFija` el cruce no los toma por 2 bultos = 12, que es lo pedido.
const fijo = cruzar(
  [{ sku: "IM04077", cantidad: 12, precio: 9000, descuento1: 0, descuento2: 0 }],
  [
    {
      fila: 1, codigo: "IM04077", ean: "", descripcion: "", cantidad: 2, precio: null,
      descuento1: 0, descuento2: 0, importe: 18000, unidadFija: true,
    },
  ],
  MAESTRO,
);
revisar(
  "a mano: unidad fija no se convierte a bultos",
  [fijo.lineas[0].estado, fijo.lineas[0].factura?.unidades, fijo.lineas[0].difUnidades],
  ["cantidad", 2, -10],
);

if (FALLOS.length > 0) {
  console.error(`\n${FALLOS.length} prueba(s) fallaron.`);
  process.exit(1);
}
console.log("\nTodo bien.");
