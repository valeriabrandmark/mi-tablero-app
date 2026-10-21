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

/** Las cuentas completas: las de fábrica más las que se configuran a mano. */
const CUENTAS: Record<string, Imputacion> = {
  ...imputacionDeFabrica(),
  "Neto gravado 21 %": { cuenta: "36004", tipoImpuesto: "I21" },
  "Neto gravado 10,5 %": { cuenta: "36005", tipoImpuesto: "I105" },
  "IVA 21 %": { cuenta: "1126001", tipoImpuesto: "I21" },
  "IVA 10,5 %": { cuenta: "1126002", tipoImpuesto: "I105" },
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

  revisar(
    "el contable lleva el neto y el IVA",
    cuerpo.contable,
    [
      { monto: 1000, cuenta: "36004", tipoImpuesto: "I21" },
      { monto: 210, cuenta: "1126001", tipoImpuesto: "I21" },
    ],
  );
  revisar("el total es el impreso", cuerpo.total, 1210);
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
  revisar("y el neto imputado también", cuerpo.contable[0]!.monto, 900);
}

// --- EL CENTAVO QUE SE PIERDE AL PARTIR POR ALICUOTA ----------------------
//
// Partir el neto en dos pedazos y redondear cada uno deja un centavo suelto, y
// ese centavo hace que el total no cuadre con el impreso -- que es justo lo
// que frena el envío. Tiene que ir a la base más grande.

{
  const cruce = cruceDe([
    linea({ sku: "A", unidades: 1, precioNeto: 33.335, neto: 33.335, iva: 21 }),
    linea({ sku: "B", unidades: 1, precioNeto: 33.335, neto: 33.335, iva: 10.5 }),
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
    .filter((c) => c.cuenta === "36004" || c.cuenta === "36005")
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
    linea({ sku: "A", unidades: 1, precioNeto: 100, neto: 100, iva: 10.5 }),
    linea({ sku: "B", unidades: 1, precioNeto: 200, neto: 200, iva: 21 }),
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

// --- Las percepciones -----------------------------------------------------

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
  // y subcuenta, es lo único que hace que Sigma las registre por separado en
  // vez de sumarlas.
  revisar(
    "cada percepción lleva su observación",
    cuerpo.contable.filter((c) => c.observacion).length,
    2,
  );
}

// Un monto de otros impuestos sin detallar no se puede imputar: mandarlo a una
// cuenta cualquiera es peor que no mandarlo.
{
  const cruce = cruceDe([linea({ sku: "A", unidades: 1, precioNeto: 100, neto: 100, iva: 21 })]);
  const { problemas } = armarImportCompras(
    cruce,
    totalesDe({ netoGravado: 100, iva: [{ alicuota: 21, importe: 21 }], otrosImpuestos: 50 }),
    { ...DATOS, otrosImpuestos: 50, totalImpreso: 171 },
    CUENTAS,
  );
  revisar(
    "otros impuestos sin detallar frena el envío",
    problemas.some((p) => p.includes("Detallá las percepciones")),
    true,
  );
}

// Y si el detalle no suma lo cargado, tampoco: la diferencia terminaría en el
// total y el comprobante entraría descuadrado.
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
  revisar(
    "un detalle que no suma frena el envío",
    problemas.some((p) => p.includes("no suma")),
    true,
  );
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

{
  const cruce = cruceDe([linea({ sku: "A", unidades: 1, precioNeto: 100, neto: 100, iva: 21 })]);
  const { problemas } = armarImportCompras(
    cruce,
    totalesDe({ netoGravado: 100, iva: [{ alicuota: 21, importe: 21 }], cuadra: null }),
    { ...DATOS, totalImpreso: null },
    CUENTAS,
  );
  revisar("sin total impreso no se manda", problemas.some((p) => p.includes("total impreso")), true);
}

{
  const cruce = cruceDe([linea({ sku: "A", unidades: 1, precioNeto: 100, neto: 100, iva: 21 })]);
  const { problemas } = armarImportCompras(
    cruce,
    totalesDe({ netoGravado: 100, iva: [{ alicuota: 21, importe: 21 }], cuadra: false }),
    DATOS,
    CUENTAS,
  );
  revisar("un total que no cuadra tampoco", problemas.some((p) => p.includes("no cuadra")), true);
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
    "sin la cuenta del neto no se manda",
    problemas.some((p) => p.includes('"Neto gravado 21 %"')),
    true,
  );
  revisar(
    "ni sin la del IVA",
    problemas.some((p) => p.includes('"IVA 21 %"')),
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
revisar("10.5 se escribe 10,5", alicuotaTexto(10.5), "10,5");
revisar("21 se escribe 21", alicuotaTexto(21), "21");

console.log(FALLOS.length ? `\n${FALLOS.length} FALLARON: ${FALLOS.join(", ")}` : "\nTODO OK");
process.exit(FALLOS.length ? 1 : 0);
