/**
 * El cuerpo de `ImportCompras`: la factura de compra como la espera Sigma.
 * Sin red.
 *
 * ---------------------------------------------------------------------------
 * POR QUE EXISTE
 *
 * Esto escribe en la CONTABILIDAD de la empresa. Una cuenta equivocada manda
 * plata al lugar equivocado y no se nota en ninguna pantalla; un centavo mal
 * repartido entre alícuotas hace que el total no cuadre y frena el envío.
 *
 * Y la mitad de lo que hay acá se aprendió mandando facturas de verdad desde
 * la planilla de Google: que Sigma exige `unidadCompra` aunque su
 * documentación no lo nombre, que el código de comprobante tiene que existir
 * del otro lado, que el `id` es lo único que evita cargar la misma factura
 * dos veces. Perder cualquiera de esas tres cuesta un comprobante mal cargado
 * en el ERP, que se arregla a mano y con un asiento.
 *
 *     node --experimental-strip-types --import ./pruebas/registrar.mjs pruebas/sigma-compra.mts
 */

import {
  alicuotaTexto,
  armarImportCompras,
  idDeLaFactura,
  imputacionDeFabrica,
  SUBCUENTAS_IIBB,
  type DatosFactura,
  type Imputacion,
} from "@/lib/sigma-compra";
import type { LineaCruce, ResultadoCruce, TotalesComprobante } from "@/lib/factura-cruce";

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

/* --- Andamios -------------------------------------------------------------
   Lo mínimo para que el motor tenga de dónde agarrarse. Se arma a mano y no
   corriendo el cruce: lo que se prueba acá es el cuerpo que sale, no el cruce
   que ya tiene sus propias pruebas. */

function linea(p: {
  sku: string | null;
  unidades: number;
  precioNeto: number | null;
  neto: number | null;
  iva: number;
}): LineaCruce {
  return {
    estado: "ok",
    sku: p.sku,
    descripcion: p.sku ?? "",
    renglones: [],
    como: null,
    factor: 1,
    oc: null,
    factura:
      p.unidades || p.neto != null
        ? { unidades: p.unidades, precioNeto: p.precioNeto, neto: p.neto }
        : null,
    difUnidades: 0,
    difPrecio: 0,
    iva: p.iva,
  };
}

function cruceDe(lineas: LineaCruce[], sinIdentificar = 0): ResultadoCruce {
  const iva: Record<string, number> = {};
  for (const l of lineas) {
    if (l.factura?.neto) iva[l.iva] = (iva[l.iva] ?? 0) + (l.factura.neto * l.iva) / 100;
  }
  return {
    lineas,
    resumen: {
      renglonesOC: 0,
      renglonesFactura: lineas.length,
      ok: lineas.length,
      conDiferencia: 0,
      faltan: 0,
      sobran: 0,
      sinIdentificar,
      netoOC: 0,
      netoFactura: lineas.reduce((s, l) => s + (l.factura?.neto ?? 0), 0),
      netoFacturaAPrecioOC: 0,
      difPrecio: 0,
      iva,
    },
  };
}

function totalesDe(p: {
  netoGravado: number;
  iva: { alicuota: number; importe: number }[];
  otrosImpuestos?: number;
  cuadra?: boolean | null;
}): TotalesComprobante {
  const ivaTotal = p.iva.reduce((s, i) => s + i.importe, 0);
  return {
    neto: p.netoGravado,
    descuentoPie: 0,
    netoGravado: p.netoGravado,
    iva: p.iva,
    ivaTotal,
    otrosImpuestos: p.otrosImpuestos ?? 0,
    total: p.netoGravado + ivaTotal + (p.otrosImpuestos ?? 0),
    diferencia: 0,
    cuadra: p.cuadra === undefined ? true : p.cuadra,
  };
}

const DATOS: DatosFactura = {
  tipo: "F",
  codigoComprobante: "FA",
  numeroComprobante: "0001-00000123",
  fechaFactura: "2026-10-21",
  proveedorId: "00007",
  empresa: "0001",
  sucursal: "0002",
  categoria: null,
  descuentoPie: 0,
  otrosImpuestos: 0,
  totalImpreso: 1210,
  percepciones: [],
};

/**
 * Las cuentas completas, con LOS VALORES DE VERDAD.
 *
 * Salen de la pestaña SIGMA de la planilla que ya carga facturas. Están acá y
 * no inventados para que esta prueba sirva también de documentación de qué se
 * manda: el neto gravado va todo a 20000 y lo que cambia es el tipo de
 * impuesto; el IVA, todo a 8008.
 */
const CUENTAS: Record<string, Imputacion> = {
  ...imputacionDeFabrica(),
  "Neto gravado 21 %": { cuenta: "20000", tipoImpuesto: "G21" },
  "Neto gravado 10,5 %": { cuenta: "20000", tipoImpuesto: "G10" },
  "Neto gravado 27 %": { cuenta: "20000", tipoImpuesto: "G27" },
  "Neto exento / no gravado": { cuenta: "20000", tipoImpuesto: "Exe" },
  "IVA 21 %": { cuenta: "8008", tipoImpuesto: "I21" },
  "IVA 10,5 %": { cuenta: "8008", tipoImpuesto: "I10" },
  "IVA 27 %": { cuenta: "8008", tipoImpuesto: "I27" },
  "Percepción IVA": { cuenta: "8007", tipoImpuesto: "PIV" },
  "Otros impuestos": { cuenta: "8099", tipoImpuesto: "OTR" },
};

// --- El caso simple: una factura de un renglón ----------------------------

{
  const cruce = cruceDe([
    linea({ sku: "IM07005", unidades: 10, precioNeto: 100, neto: 1000, iva: 21 }),
  ]);
  const { cuerpo, problemas } = armarImportCompras(
    cruce,
    totalesDe({ netoGravado: 1000, iva: [{ alicuota: 21, importe: 210 }] }),
    DATOS,
    CUENTAS,
  );

  revisar("una factura limpia no tiene problemas", problemas, []);
  revisar("la mercadería va en unidades", cuerpo.mercaderias[0]!.cantidad, 10);
  revisar("y a precio neto", cuerpo.mercaderias[0]!.precio, 100);
  // El precio ya es el neto: las bonificaciones están aplicadas, así que el
  // descuento que viaja es cero. Mandarlo de nuevo lo aplicaría dos veces.
  revisar("el descuento viaja en cero", cuerpo.mercaderias[0]!.descuento, 0);

  // SIGMA LO EXIGE AUNQUE SU DOCUMENTACION NO LO NOMBRE. Se aprendió mandando
  // una factura de verdad: sin esto el comprobante entra y falla al
  // procesarse, tomando bultos en vez de unidades y el precio por bulto.
  revisar(
    "viajan los dos nombres de unidadCompra",
    [cuerpo.mercaderias[0]!.unidadCompra, cuerpo.mercaderias[0]!.unidadDeCompra],
    ["U", "U"],
  );

  // EL NETO NO VA EN EL CONTABLE CUANDO HAY MERCADERIAS. Sigma lo arma solo,
  // con la cuenta contable de cada artículo. Mandarlo además es contarlo dos
  // veces, y así entró una factura de verdad: MERCADERIAS DE REVENTA dos
  // veces por el mismo importe, con el subtotal al doble.
  //
  // EL IVA SI VIAJA, Y CON SU IMPORTE. Sigma no recalcula el total al editar el
  // comprobante: se probó mandando el IVA en $0 y completándolo allá, y el
  // total quedó en el subtotal.
  revisar(
    "con mercaderías el contable lleva el IVA con su importe",
    cuerpo.contable,
    [{ monto: 210, cuenta: "8008", tipoImpuesto: "I21" }],
  );
  revisar(
    "no hay ninguna línea a la cuenta de mercaderías",
    cuerpo.contable.filter((c) => c.cuenta === "20000").length,
    0,
  );
  // LA SUMA DE LO QUE VIAJA: neto más IVA.
  revisar("el total es neto más IVA", cuerpo.total, 1210);
  revisar("y la cabecera", [cuerpo.empresa, cuerpo.sucursal, cuerpo.proveedorId], ["0001", "0002", "00007"]);
}

// --- La bonificación al pie baja TODOS los precios ------------------------
//
// El precio que viaja tiene que ser el que de verdad se paga: si no, la suma
// de las mercaderías no da el neto gravado y el comprobante queda descuadrado
// del lado de Sigma.

{
  const cruce = cruceDe([
    linea({ sku: "A", unidades: 10, precioNeto: 100, neto: 1000, iva: 21 }),
  ]);
  const { cuerpo } = armarImportCompras(
    cruce,
    totalesDe({ netoGravado: 900, iva: [{ alicuota: 21, importe: 189 }] }),
    { ...DATOS, descuentoPie: 10, totalImpreso: 1089 },
    CUENTAS,
  );
  revisar("con 10% al pie el precio baja a 90", cuerpo.mercaderias[0]!.precio, 90);
  revisar("y el total que viaja ya lleva el pie", cuerpo.total, 1089);
}

// Y cuando el neto SI se imputa --una factura que no mueve stock-- el pie
// también lo baja.
{
  const cruce = cruceDe([
    linea({ sku: null, unidades: 10, precioNeto: 100, neto: 1000, iva: 21 }),
  ]);
  const { cuerpo } = armarImportCompras(
    cruce,
    totalesDe({ netoGravado: 900, iva: [{ alicuota: 21, importe: 189 }] }),
    { ...DATOS, descuentoPie: 10, totalImpreso: 1089 },
    CUENTAS,
  );
  revisar("sin mercaderías el neto va al contable, ya con el pie", cuerpo.contable[0]!.monto, 900);
}

// --- EL CENTAVO QUE SE PIERDE AL PARTIR POR ALICUOTA ----------------------
//
// Partir el neto en dos pedazos y redondear cada uno deja un centavo suelto, y
// ese centavo hace que el total no cuadre con el impreso -- que es justo lo
// que frena el envío. Tiene que ir a la base más grande.

{
  // Sin SKU: es el caso en el que el neto viaja en el contable, que es donde
  // el centavo se puede perder.
  const cruce = cruceDe([
    linea({ sku: null, unidades: 1, precioNeto: 33.335, neto: 33.335, iva: 21 }),
    linea({ sku: null, unidades: 1, precioNeto: 33.335, neto: 33.335, iva: 10.5 }),
  ]);
  const { cuerpo } = armarImportCompras(
    cruce,
    totalesDe({
      netoGravado: 66.67,
      iva: [
        { alicuota: 21, importe: 7 },
        { alicuota: 10.5, importe: 3.5 },
      ],
    }),
    DATOS,
    CUENTAS,
  );
  const netos = cuerpo.contable
    .filter((c) => c.cuenta === "20000")
    .map((c) => c.monto);
  revisar(
    "los netos por alícuota suman exactamente el neto gravado",
    Math.round(netos.reduce((s, n) => s + n, 0) * 100) / 100,
    66.67,
  );
}

// Las alícuotas salen de mayor a menor: es el orden en que se leen en una
// factura, y el que usa la planilla.
{
  const cruce = cruceDe([
    linea({ sku: null, unidades: 1, precioNeto: 100, neto: 100, iva: 10.5 }),
    linea({ sku: null, unidades: 1, precioNeto: 200, neto: 200, iva: 21 }),
  ]);
  const { cuerpo } = armarImportCompras(
    cruce,
    totalesDe({
      netoGravado: 300,
      iva: [
        { alicuota: 21, importe: 42 },
        { alicuota: 10.5, importe: 10.5 },
      ],
    }),
    DATOS,
    CUENTAS,
  );
  revisar(
    "primero el 21 y después el 10,5",
    cuerpo.contable.slice(0, 2).map((c) => c.monto),
    [200, 100],
  );
}

// --- EL IVA Y LAS PERCEPCIONES VIAJAN COMPLETOS -------------------------
//
// Sigma deja el total tal como llega, así que todo sale de acá: el IVA, cada
// percepción a su cuenta, y un total que es la suma de lo que viaja.
{
  const cruce = cruceDe([
    linea({ sku: "A", unidades: 1, precioNeto: 1000, neto: 1000, iva: 21 }),
  ]);
  const { cuerpo, problemas } = armarImportCompras(
    cruce,
    totalesDe({ netoGravado: 1000, iva: [{ alicuota: 21, importe: 210 }], otrosImpuestos: 80 }),
    {
      ...DATOS,
      otrosImpuestos: 80,
      totalImpreso: 1290,
      percepciones: [
        { concepto: "Percepción IIBB Tucumán", monto: 50 },
        { concepto: "Percepción IVA", monto: 30 },
      ],
    },
    CUENTAS,
  );
  revisar("con las percepciones detalladas no hay problemas", problemas, []);
  revisar(
    "viajan el IVA y las dos percepciones",
    cuerpo.contable.map((c) => [c.cuenta, c.monto]),
    [["8008", 210], ["8013", 50], ["8007", 30]],
  );
  revisar("el total es neto + IVA + percepciones", cuerpo.total, 1290);

  // LAS DE IIBB VAN TODAS A 8013 CON LA SUBCUENTA DE LA PROVINCIA. Es la única
  // imputación que viene en el código, y Tucumán es 924.
  revisar(
    "IIBB Tucumán: cuenta 8013, subcuenta 924, tipo PIB",
    cuerpo.contable.find((c) => c.subcuenta === "924"),
    {
      monto: 50,
      cuenta: "8013",
      tipoImpuesto: "PIB",
      subcuenta: "924",
      observacion: "Percepción IIBB Tucumán",
    },
  );
  // LA OBSERVACION NO ES DECORADO: si dos percepciones caen en la misma cuenta
  // y subcuenta, es lo único que hace que Sigma las registre por separado.
  revisar(
    "cada percepción lleva su observación",
    cuerpo.contable.filter((c) => c.observacion).length,
    2,
  );
}

// SIN DETALLAR, FRENA. Antes se dejaban para cargar en Sigma; ahora quedarían
// afuera del total, y del otro lado no se suman.
{
  const cruce = cruceDe([linea({ sku: "A", unidades: 1, precioNeto: 100, neto: 100, iva: 21 })]);
  const { problemas } = armarImportCompras(
    cruce,
    totalesDe({ netoGravado: 100, iva: [{ alicuota: 21, importe: 21 }], otrosImpuestos: 50 }),
    { ...DATOS, otrosImpuestos: 50, totalImpreso: 171 },
    CUENTAS,
  );
  revisar(
    "percepciones sin detallar frenan",
    problemas.some((p) => p.includes("sin detallar")),
    true,
  );
}

// Un detalle que no suma lo cargado también frena, y dice cuánto falta.
{
  const cruce = cruceDe([linea({ sku: "A", unidades: 1, precioNeto: 100, neto: 100, iva: 21 })]);
  const { problemas } = armarImportCompras(
    cruce,
    totalesDe({ netoGravado: 100, iva: [{ alicuota: 21, importe: 21 }], otrosImpuestos: 50 }),
    {
      ...DATOS,
      otrosImpuestos: 50,
      totalImpreso: 171,
      percepciones: [{ concepto: "Percepción IVA", monto: 30 }],
    },
    CUENTAS,
  );
  revisar("un detalle que no suma frena", problemas.some((p) => p.includes("20,00")), true);
}

// Y la cuenta de una percepción que falta, también.
{
  const cruce = cruceDe([linea({ sku: "A", unidades: 1, precioNeto: 100, neto: 100, iva: 21 })]);
  const { problemas } = armarImportCompras(
    cruce,
    totalesDe({ netoGravado: 100, iva: [{ alicuota: 21, importe: 21 }], otrosImpuestos: 50 }),
    {
      ...DATOS,
      otrosImpuestos: 50,
      totalImpreso: 171,
      percepciones: [{ concepto: "Percepción IVA", monto: 50 }],
    },
    { ...imputacionDeFabrica(), "IVA 21 %": { cuenta: "8008", tipoImpuesto: "I21" } },
  );
  revisar(
    "sin la cuenta de la percepción no se manda",
    problemas.some((p) => p.includes('"Percepción IVA"')),
    true,
  );
}

// Un renglón de IVA por cada alícuota, de mayor a menor. Y una factura toda
// exenta igual lleva uno, al 21 y en $0: Sigma no acepta el contable vacío.
{
  const { cuerpo } = armarImportCompras(
    cruceDe([
      linea({ sku: "A", unidades: 1, precioNeto: 100, neto: 100, iva: 10.5 }),
      linea({ sku: "B", unidades: 1, precioNeto: 100, neto: 100, iva: 21 }),
      linea({ sku: "C", unidades: 1, precioNeto: 100, neto: 100, iva: 10.5 }),
    ]),
    totalesDe({ netoGravado: 300, iva: [{ alicuota: 21, importe: 21 }, { alicuota: 10.5, importe: 21 }] }),
    DATOS,
    CUENTAS,
  );
  revisar(
    "un IVA por alícuota",
    cuerpo.contable.map((c) => [c.tipoImpuesto, c.monto]),
    [["I21", 21], ["I10", 21]],
  );
}
{
  const { cuerpo, problemas } = armarImportCompras(
    cruceDe([linea({ sku: "A", unidades: 1, precioNeto: 100, neto: 100, iva: 0 })]),
    totalesDe({ netoGravado: 100, iva: [] }),
    DATOS,
    CUENTAS,
  );
  revisar("una factura exenta se manda igual", problemas, []);
  revisar(
    "con un IVA 21 en $0",
    cuerpo.contable.map((c) => [c.tipoImpuesto, c.monto]),
    [["I21", 0]],
  );
  revisar("y el total es el neto", cuerpo.total, 100);
}

// --- Lo que falta -------------------------------------------------------

{
  const cruce = cruceDe(
    [linea({ sku: "A", unidades: 1, precioNeto: 100, neto: 100, iva: 21 })],
    3,
  );
  const { problemas } = armarImportCompras(
    cruce,
    totalesDe({ netoGravado: 100, iva: [{ alicuota: 21, importe: 21 }] }),
    DATOS,
    CUENTAS,
  );
  revisar(
    "renglones sin identificar frenan el envío",
    problemas.some((p) => p.includes("sin identificar")),
    true,
  );
}

// --- EL TOTAL AVISA, NO FRENA --------------------------------------------
//
// Que el calculado no dé igual al impreso no rompe nada del otro lado: la
// factura entra pendiente y en Sigma se edita hasta que procesa. Frenarla acá
// obligaba a cazar el centavo antes de poder cargar algo que después se
// corrige igual.

{
  const cruce = cruceDe([linea({ sku: "A", unidades: 1, precioNeto: 100, neto: 100, iva: 21 })]);
  const { problemas, advertencias } = armarImportCompras(
    cruce,
    totalesDe({ netoGravado: 100, iva: [{ alicuota: 21, importe: 21 }], cuadra: null }),
    { ...DATOS, totalImpreso: null },
    CUENTAS,
  );
  revisar("sin total impreso se manda igual", problemas, []);
  // Sin el impreso no hay contra qué corroborar, y Sigma deja el total tal
  // como llega.
  revisar(
    "pero se avisa",
    advertencias.some((a) => a.includes("total impreso")),
    true,
  );
}

{
  const cruce = cruceDe([linea({ sku: "A", unidades: 1, precioNeto: 100, neto: 100, iva: 21 })]);
  const { cuerpo, problemas, advertencias } = armarImportCompras(
    cruce,
    totalesDe({ netoGravado: 100, iva: [{ alicuota: 21, importe: 21 }], cuadra: false }),
    { ...DATOS, totalImpreso: 1000 },
    CUENTAS,
  );
  revisar("un total que no cuadra tampoco frena", problemas, []);
  revisar("pero también se avisa", advertencias.some((a) => a.includes("no cuadra")), true);
  // LO QUE VIAJA ES LA SUMA DE LO QUE SE MANDA, no el impreso: que el
  // asiento y el total digan lo mismo.
  revisar("y lo que viaja es la suma de lo que se manda", cuerpo.total, 121);
}

// SIN LA CUENTA NO SE MANDA. Es la regla que protege la contabilidad: antes
// que imputar a una cuenta inventada, no se manda nada.
{
  const cruce = cruceDe([linea({ sku: "A", unidades: 1, precioNeto: 100, neto: 100, iva: 21 })]);
  const { problemas } = armarImportCompras(
    cruce,
    totalesDe({ netoGravado: 100, iva: [{ alicuota: 21, importe: 21 }] }),
    DATOS,
    imputacionDeFabrica(), // sólo las de IIBB: falta el neto y el IVA
  );
  revisar(
    "sin la cuenta del IVA no se manda",
    problemas.some((p) => p.includes('"IVA 21 %"')),
    true,
  );
  // LA DEL NETO YA NO HACE FALTA CUANDO HAY MERCADERIAS: esa línea no se
  // manda, la arma Sigma con la cuenta del artículo. Pedirla sería pedir una
  // cuenta para algo que no viaja.
  revisar(
    "la del neto no se pide si hay mercaderías",
    problemas.some((p) => p.includes('"Neto gravado 21 %"')),
    false,
  );
}

// Pero sin mercaderías sí: ahí el neto es lo único que se imputa.
{
  const cruce = cruceDe([linea({ sku: null, unidades: 1, precioNeto: 100, neto: 100, iva: 21 })]);
  const { problemas } = armarImportCompras(
    cruce,
    totalesDe({ netoGravado: 100, iva: [{ alicuota: 21, importe: 21 }] }),
    DATOS,
    imputacionDeFabrica(),
  );
  revisar(
    "sin mercaderías, sin la cuenta del neto no se manda",
    problemas.some((p) => p.includes('"Neto gravado 21 %"')),
    true,
  );
}

// El número de comprobante tiene tope del lado de Sigma: 20 caracteres.
{
  const cruce = cruceDe([linea({ sku: "A", unidades: 1, precioNeto: 100, neto: 100, iva: 21 })]);
  const { problemas } = armarImportCompras(
    cruce,
    totalesDe({ netoGravado: 100, iva: [{ alicuota: 21, importe: 21 }] }),
    { ...DATOS, numeroComprobante: "0001-000000000000000000123" },
    CUENTAS,
  );
  revisar("un número largo frena el envío", problemas.some((p) => p.includes("20 caracteres")), true);
}

// Empresa y sucursal son elección de quien carga: una factura en la empresa
// equivocada es un asiento en los libros de otra sociedad.
{
  const cruce = cruceDe([linea({ sku: "A", unidades: 1, precioNeto: 100, neto: 100, iva: 21 })]);
  const { problemas } = armarImportCompras(
    cruce,
    totalesDe({ netoGravado: 100, iva: [{ alicuota: 21, importe: 21 }] }),
    { ...DATOS, empresa: "", sucursal: "" },
    CUENTAS,
  );
  revisar("sin empresa no se manda", problemas.some((p) => p.includes("empresa")), true);
  revisar("sin sucursal tampoco", problemas.some((p) => p.includes("sucursal")), true);
}

// --- El id, que es lo que evita la factura duplicada ---------------------

revisar(
  "el id junta proveedor, código y número",
  idDeLaFactura({ proveedorId: "00007", codigoComprobante: "FA", numeroComprobante: "0001-00000123" }),
  "FC-00007-FA-0001-00000123",
);

// ES LA MISMA FACTURA SIEMPRE, y eso es todo el punto: dos envíos del mismo
// comprobante llevan el mismo id, así que Sigma contesta "procesado
// anteriormente" en vez de cargarla de nuevo.
revisar(
  "la misma factura da siempre el mismo id",
  idDeLaFactura({ proveedorId: "00007", codigoComprobante: "FA", numeroComprobante: "A" }) ===
    idDeLaFactura({ proveedorId: "00007", codigoComprobante: "FA", numeroComprobante: "A" }),
  true,
);
revisar(
  "y dos facturas distintas, ids distintos",
  idDeLaFactura({ proveedorId: "00007", codigoComprobante: "FA", numeroComprobante: "A" }) !==
    idDeLaFactura({ proveedorId: "00007", codigoComprobante: "FA", numeroComprobante: "B" }),
  true,
);

// --- Las cuentas de fábrica ----------------------------------------------

revisar("hay 24 provincias de IIBB", SUBCUENTAS_IIBB.length, 24);
revisar(
  "y las 24 vienen con cuenta",
  Object.keys(imputacionDeFabrica()).length,
  24,
);
revisar(
  "Capital Federal es la 901",
  imputacionDeFabrica()["Percepción IIBB Capital Federal"],
  { cuenta: "8013", subcuenta: "901", centroCosto: null, tipoImpuesto: "PIB" },
);

// La alícuota se escribe con coma, como en el nombre del concepto.
/* --- EL REENVIO: EL ID CAMBIA, Y SOLO CUANDO SE PIDE -------------------

   `ImportCompras` es idempotente por el campo `id`, y eso es lo que evita la
   factura duplicada. Esa misma protección es la que impide corregir una: con
   el mismo id, una factura anulada en Sigma y vuelta a mandar no entra.

   El `intento` resuelve las dos cosas a la vez, y por eso tiene prueba: si el
   primero dejara de dar el id de siempre, las facturas ya mandadas perderían
   su identidad; si el segundo diera el mismo, no habría forma de corregir una.
   ------------------------------------------------------------------------ */

{
  const factura = {
    proveedorId: "00011",
    codigoComprobante: "FA",
    numeroComprobante: "1-001",
  };

  revisar("sin intento, el id de siempre", idDeLaFactura(factura), "FC-00011-FA-1-001");
  revisar(
    "el primer intento da exactamente lo mismo",
    idDeLaFactura({ ...factura, intento: 1 }),
    "FC-00011-FA-1-001",
  );
  revisar(
    "el segundo entra como comprobante nuevo",
    idDeLaFactura({ ...factura, intento: 2 }),
    "FC-00011-FA-1-001-R2",
  );
  revisar(
    "y el tercero también",
    idDeLaFactura({ ...factura, intento: 3 }),
    "FC-00011-FA-1-001-R3",
  );
  // DOS ENVIOS DEL MISMO INTENTO SIGUEN SIENDO LA MISMA FACTURA: apretar dos
  // veces el botón de mandar no puede duplicar nada.
  revisar(
    "el mismo intento dos veces da el mismo id",
    idDeLaFactura({ ...factura, intento: 2 }) === idDeLaFactura({ ...factura, intento: 2 }),
    true,
  );
}

revisar("10.5 se escribe 10,5", alicuotaTexto(10.5), "10,5");
revisar("21 se escribe 21", alicuotaTexto(21), "21");

console.log(FALLOS.length ? `\n${FALLOS.length} FALLARON: ${FALLOS.join(", ")}` : "\nTODO OK");
process.exit(FALLOS.length ? 1 : 0);
