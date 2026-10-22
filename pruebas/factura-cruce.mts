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
  CLASES_DIFERENCIA,
  cruzar,
  bloquesDelCuadro,
  plataQueCuenta,
  entraEnLaTabla,
  resumirDiferencias,
  indexarMaestro,
  leerNumero,
  leerRenglones,
  leerTablaPegada,
  parecido,
  totalesComprobante,
  type ArticuloMaestro,
  type ClaseDiferencia,
  type LineaCruce,
  type ResultadoCruce,
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

/* -------------------------------------------------------------------------
   QUE DIFERENCIAS ENTRAN EN LA TABLA DEL PROVEEDOR

   Las cuatro clases no se reclaman igual: lo facturado de más es plata que se
   pide de vuelta, lo de menos muchas veces es mercadería que falta y se
   reclama por otro lado. Si el filtro se equivoca de signo, la tabla que sale
   para reclamar plata termina pidiendo lo contrario de lo que corresponde.

   EL SIGNO ES LO QUE SE PRUEBA ACA, y no es obvio de memoria:
     difUnidades = facturadas - pedidas   (positivo: facturó de más)
     difPrecio   = (precio facturado - precio OC) x unidades facturadas
   ------------------------------------------------------------------------- */

function lineaDif(p: { difUnidades?: number; difPrecio?: number }): LineaCruce {
  return {
    estado: "ok",
    sku: "A",
    descripcion: "A",
    renglones: [],
    como: null,
    factor: 1,
    oc: null,
    factura: null,
    difUnidades: p.difUnidades ?? 0,
    difPrecio: p.difPrecio ?? 0,
    iva: 21,
  } as LineaCruce;
}

const TODAS = new Set<ClaseDiferencia>(CLASES_DIFERENCIA.map((c) => c.clave));
const soloCon = (...claves: ClaseDiferencia[]) => new Set<ClaseDiferencia>(claves);

revisar("son las cuatro clases", CLASES_DIFERENCIA.length, 4);

// Cobró de más: difPrecio positivo. Es el caso que se reclama.
revisar(
  "precio de más entra en precio_mas",
  entraEnLaTabla(lineaDif({ difPrecio: 500 }), soloCon("precio_mas")),
  true,
);
revisar(
  "y NO en precio_menos",
  entraEnLaTabla(lineaDif({ difPrecio: 500 }), soloCon("precio_menos")),
  false,
);
revisar(
  "precio de menos entra en precio_menos",
  entraEnLaTabla(lineaDif({ difPrecio: -500 }), soloCon("precio_menos")),
  true,
);

// Facturó más unidades de las pedidas.
revisar(
  "cantidad de más entra en cantidad_mas",
  entraEnLaTabla(lineaDif({ difUnidades: 6 }), soloCon("cantidad_mas")),
  true,
);
revisar(
  "cantidad de menos entra en cantidad_menos",
  entraEnLaTabla(lineaDif({ difUnidades: -6 }), soloCon("cantidad_menos")),
  true,
);
revisar(
  "y no se cruzan",
  entraEnLaTabla(lineaDif({ difUnidades: -6 }), soloCon("cantidad_mas")),
  false,
);

// UNA LINEA PUEDE ENTRAR POR MAS DE UNA, y alcanza con que una esté tildada:
// sacarla porque la otra no lo está escondería una diferencia que sí se
// quiere reclamar.
{
  const mixta = lineaDif({ difUnidades: -6, difPrecio: 500 });
  revisar("con las dos tildadas entra", entraEnLaTabla(mixta, TODAS), true);
  revisar(
    "con una sola de las dos, también",
    entraEnLaTabla(mixta, soloCon("precio_mas")),
    true,
  );
  revisar(
    "con ninguna de las dos, no",
    entraEnLaTabla(mixta, soloCon("cantidad_mas", "precio_menos")),
    false,
  );
}

// Sin nada tildado no sale ninguna: la pantalla lo avisa en vez de armar una
// tabla vacía y dejar que alguien la pegue en un mail.
revisar(
  "sin nada tildado no entra ninguna",
  entraEnLaTabla(lineaDif({ difPrecio: 500 }), new Set<ClaseDiferencia>()),
  false,
);

// Una línea sin ninguna diferencia no entra aunque esté todo tildado.
revisar("una línea sin diferencia nunca entra", entraEnLaTabla(lineaDif({}), TODAS), false);

/* -------------------------------------------------------------------------
   LAS DIFERENCIAS QUE SE CONGELAN AL MANDAR LA FACTURA

   Se guardan con la factura y NO se recalculan nunca más: el cruce sale de la
   OC y del maestro, y los dos cambian --una OC se anula, el maestro se
   reescribe entero en cada corrida-- así que recalcular el cruce de una
   factura de hace dos meses daría otro número. El reclamo se hace sobre el
   que se vio el día que se mandó.
   ------------------------------------------------------------------------- */

function lineaCompleta(p: {
  estado: LineaCruce["estado"];
  sku?: string | null;
  ocUnidades?: number;
  ocPrecio?: number;
  factUnidades?: number;
  factPrecio?: number;
  difUnidades?: number;
  difPrecio?: number;
}): LineaCruce {
  return {
    estado: p.estado,
    sku: p.sku === undefined ? "A" : p.sku,
    descripcion: "ARTICULO",
    renglones: [],
    como: null,
    factor: 1,
    oc:
      p.ocUnidades == null
        ? null
        : { unidades: p.ocUnidades, precioNeto: p.ocPrecio ?? 0, neto: 0 },
    factura:
      p.factUnidades == null
        ? null
        : { unidades: p.factUnidades, precioNeto: p.factPrecio ?? 0, neto: 0 },
    difUnidades: p.difUnidades ?? 0,
    difPrecio: p.difPrecio ?? 0,
    iva: 21,
  } as LineaCruce;
}

const cruceCon = (lineas: LineaCruce[]) =>
  ({ lineas, resumen: {} }) as unknown as ResultadoCruce;

// LAS QUE COINCIDEN NO ENTRAN. Un renglón OK no se reclama, así que guardarlo
// haría que la lista de "lo que falta reclamar" fuera la factura entera.
{
  const r = resumirDiferencias(
    cruceCon([
      lineaCompleta({ estado: "ok", ocUnidades: 10, factUnidades: 10 }),
      lineaCompleta({
        estado: "precio",
        ocUnidades: 10,
        ocPrecio: 100,
        factUnidades: 10,
        factPrecio: 110,
        difPrecio: 100,
      }),
    ]),
  );
  revisar("sólo entran las que no están ok", r.renglones, 1);
  revisar("y suma lo que cuesta", r.difCosto, 100);
}

// LO QUE CUESTA UNA DIFERENCIA DE CANTIDAD: las unidades que faltan o sobran,
// AL COSTO DE LA OC. Es la misma cuenta que hace la pantalla.
{
  const r = resumirDiferencias(
    cruceCon([
      lineaCompleta({
        estado: "falta en factura",
        ocUnidades: 6,
        ocPrecio: 37666.73,
        difUnidades: -6,
      }),
    ]),
  );
  revisar("una no facturada cuesta sus unidades al costo de la OC", r.difCantidad, -226000.38);
  revisar("y no mueve la de costo", r.difCosto, 0);
}

// SIN LINEA DE OC NO HAY COSTO DE OC: algo facturado que no estaba pedido se
// valúa a lo que el proveedor cobró, que es lo único que se sabe.
{
  const r = resumirDiferencias(
    cruceCon([
      lineaCompleta({
        estado: "no está en la OC",
        factUnidades: 4,
        factPrecio: 1000,
        difUnidades: 4,
      }),
    ]),
  );
  revisar("lo que no estaba en la OC se valúa a lo facturado", r.difCantidad, 4000);
}

// Lo que se guarda tiene que alcanzar para reclamar SIN volver a abrir la
// factura: qué artículo, cuánto se pidió y cuánto se facturó.
{
  const r = resumirDiferencias(
    cruceCon([
      lineaCompleta({
        estado: "cantidad",
        sku: "IM07005",
        ocUnidades: 6,
        ocPrecio: 100,
        factUnidades: 4,
        factPrecio: 100,
        difUnidades: -2,
      }),
    ]),
  );
  const l = r.lineas[0]!;
  revisar("guarda el sku", l.sku, "IM07005");
  revisar("lo pedido", l.unidadesOC, 6);
  revisar("lo facturado", l.unidadesFactura, 4);
  revisar("y el motivo", l.motivo, "cantidad");
}

// Una factura que coincide en todo no deja nada para reclamar.
{
  const r = resumirDiferencias(
    cruceCon([lineaCompleta({ estado: "ok", ocUnidades: 10, factUnidades: 10 })]),
  );
  revisar("sin diferencias no hay nada que reclamar", r.renglones, 0);
  revisar("ni plata", [r.difCosto, r.difCantidad], [0, 0]);
}

/* -------------------------------------------------------------------------
   EL CUADRO DEL RECLAMO DE PRECIO

   La cuenta que importa: el proveedor factura al costo de LISTA cuando
   correspondía una bonificación, y lo que se le reclama es la diferencia
   entre lo que cobró y lo que tendría que haber cobrado.

   Los números de abajo salen de un reclamo de verdad (factura
   A-00010-000243382 de 2/9/2026, la fila de CICATRICURE SERUM GOLD LIFT):
   costo teórico 15.725,83, oferta aplicable 18 %, facturado 15.684,56 por
   6 unidades. El proveedor aplicó 0,26 % donde correspondía 18 %, así que
   se le reclaman 2.789,38 por unidad y 16.736,28 en total.

   Está acá y no en la pantalla porque es LA cuenta del reclamo: si se
   invierte un signo o se suman los descuentos en vez de componerlos, el
   cuadro sale pidiendo otra cosa y nadie lo nota hasta que el proveedor
   contesta.
   ------------------------------------------------------------------------- */

{
  const MAESTRO_C: ArticuloMaestro[] = [
    {
      sku: "C0001",
      descripcion: "CICATRICURE SERUM GOLD LIFT 30 ML",
      codigoCompra: "7798140256120",
      eanUnidad: null,
      eanBulto: null,
      unidadesPorBulto: 1,
      iva: 21,
    } as ArticuloMaestro,
  ];

  // La OC: costo de lista 15.725,83 con 18 % de bonificación.
  const ocC: RenglonOC[] = [
    { sku: "C0001", cantidad: 6, precio: 15725.83, descuento1: 18, descuento2: 0 },
  ];

  // La factura: 6 unidades a 15.684,56 netas, o sea casi sin descuento.
  const facturaC = leerRenglones(
    leerTablaPegada(
      [
        "Código\tDescripción\tCant.\tP. Unit.\tBonif %\tImporte",
        "7798140256120\tCICATRICURE SERUM GOLD LIFT 30 ML\t6\t15.684,56\t0\t94.107,36",
      ].join("\n"),
    ),
    ["codigo", "descripcion", "cantidad", "precio", "descuento1", "importe"],
  );

  const cruceC = cruzar(ocC, facturaC, MAESTRO_C);
  const l = cruceC.lineas.find((x) => x.sku === "C0001")!;

  revisar("el costo teórico es el de lista, sin bonificar", l.oc!.precioLista, 15725.83);
  revisar("la oferta aplicable sale de los dos descuentos", l.oc!.ofertaPct, 18);
  revisar(
    "el neto que correspondía es la lista bonificada",
    Math.round(l.oc!.precioNeto * 100) / 100,
    12895.18,
  );
  revisar(
    "la diferencia por unidad es lo que cobró de más",
    Math.round((l.factura!.precioNeto! - l.oc!.precioNeto) * 100) / 100,
    2789.38,
  );
  revisar("y la total, eso por las unidades", Math.round(l.difPrecio * 100) / 100, 16736.28);
}

// LOS DOS DESCUENTOS SE COMPONEN, NO SE SUMAN. 15 % y 10 % dan 23,5 %, que es
// como los liquida el proveedor y como los aplica Sigma con FDESCU1 y FDESCU2.
{
  const ocDos: RenglonOC[] = [
    { sku: "A", cantidad: 1, precio: 1000, descuento1: 15, descuento2: 10 },
  ];
  const cruceDos = cruzar(ocDos, [], []);
  const l = cruceDos.lineas[0]!;
  revisar("la oferta aplicable es compuesta", l.oc!.ofertaPct, 23.5);
  revisar("y no la suma de las dos", l.oc!.ofertaPct === 25, false);
}

/* --- QUE COLUMNAS SALEN, SEGUN LO QUE SE RECLAMA ------------------------- */

revisar(
  "reclamando sólo precios salen las columnas de precio",
  bloquesDelCuadro(new Set<ClaseDiferencia>(["precio_mas"])),
  { precio: true, cantidad: false },
);
revisar(
  "reclamando sólo cantidades, las de cantidad",
  bloquesDelCuadro(new Set<ClaseDiferencia>(["cantidad_menos"])),
  { precio: false, cantidad: true },
);
revisar(
  "con las cuatro tildadas salen las dos",
  bloquesDelCuadro(new Set<ClaseDiferencia>(CLASES_DIFERENCIA.map((c) => c.clave))),
  { precio: true, cantidad: true },
);
revisar(
  "sin nada tildado no sale ninguna",
  bloquesDelCuadro(new Set<ClaseDiferencia>()),
  { precio: false, cantidad: false },
);

/* --- EL TOTAL ES LA SUMA DE LO QUE SE VE --------------------------------

   Una línea entra al cuadro si cumple ALGUNA de las clases tildadas, y puede
   cumplir dos. El caso que rompe la cuenta: se tilda "precios de más" y
   "cantidades de menos", y entra un renglón que facturó de menos en unidades
   TRAYENDOSE PUESTA una diferencia de precio negativa que nadie pidió
   reclamar. Sumando la fila entera, ese importe baja el total y el cuadro
   termina pidiendo menos plata de la que corresponde.
   ------------------------------------------------------------------------ */

{
  // Facturó 2 unidades de menos Y cobró 500 de menos por unidad.
  const mixta = lineaDif({ difUnidades: -2, difPrecio: -500 });

  revisar(
    "reclamando precios de más, su precio de menos NO suma",
    plataQueCuenta(mixta, soloCon("precio_mas", "cantidad_menos")),
    { precio: false, cantidad: true },
  );
  revisar(
    "y si se tilda precios de menos, sí",
    plataQueCuenta(mixta, soloCon("precio_menos")),
    { precio: true, cantidad: false },
  );
}

{
  // El caso normal: cobró de más y facturó de más.
  const dos = lineaDif({ difUnidades: 3, difPrecio: 800 });
  revisar(
    "con las cuatro tildadas suman las dos mitades",
    plataQueCuenta(dos, TODAS),
    { precio: true, cantidad: true },
  );
  revisar(
    "sin nada tildado no suma ninguna",
    plataQueCuenta(dos, new Set<ClaseDiferencia>()),
    { precio: false, cantidad: false },
  );
}

// Una línea sin diferencia no suma aunque esté todo tildado: cero no es ni de
// más ni de menos.
revisar(
  "una línea sin diferencia no suma",
  plataQueCuenta(lineaDif({}), TODAS),
  { precio: false, cantidad: false },
);

if (FALLOS.length > 0) {
  console.error(`\n${FALLOS.length} prueba(s) fallaron.`);
  process.exit(1);
}
console.log("\nTodo bien.");
