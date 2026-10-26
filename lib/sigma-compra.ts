import { centavos } from "@/lib/factura-cruce";
import type { ResultadoCruce, TotalesComprobante } from "@/lib/factura-cruce";

/**
 * La factura de compra tal como la espera `ImportCompras` de Sigma.
 *
 * ---------------------------------------------------------------------------
 * DE DONDE SALE ESTO
 *
 * De la planilla de Google que ya carga facturas en Sigma y que ANA viene
 * usando. No es un diseño nuevo: es el mismo cuerpo, las mismas cuentas y las
 * mismas validaciones, traídas al tablero. Lo que se aprendió mandando
 * facturas de verdad está marcado abajo, caso por caso.
 *
 *   POST .../sigma/api/v10/ImportCompras
 *
 * ---------------------------------------------------------------------------
 * ESTE ENDPOINT SE PORTA MEJOR QUE EL DE LAS ORDENES
 *
 * `ImportOrdenDeCompra` contesta 500 también cuando la orden entró, y eso nos
 * dejó ocho órdenes duplicadas. `ImportCompras` no:
 *
 *   200  {"message": "registro insertado correctamente"}
 *   400  {"message": "<la causa exacta>"}
 *
 * Y sobre todo ES IDEMPOTENTE. El campo `id` identifica la operación: si se
 * manda dos veces la misma factura, Sigma contesta "registro procesado
 * anteriormente" en vez de cargarla de nuevo. Sumado a que
 * `numeroComprobante` no puede repetirse para el mismo proveedor, duplicar
 * una factura por apretar el botón dos veces no es posible.
 *
 * ---------------------------------------------------------------------------
 * LO QUE VIAJA ES EL CRUCE, NO LO QUE SE TIPEO
 *
 * Los renglones salen ya identificados por SKU, en UNIDADES --si la factura
 * vino en bultos ya está multiplicado-- y al precio neto que de verdad se
 * paga, con las bonificaciones del renglón y la del pie aplicadas. Por eso
 * cada mercadería viaja con `descuento: 0`: el precio ya es el neto.
 */

/* -------------------------------------------------------------------------
   LAS CUENTAS
   ------------------------------------------------------------------------- */

/**
 * PERCEPCIONES DE IIBB: todas a la cuenta 8013, con tipo de impuesto PIB y la
 * subcuenta de la provincia.
 *
 * Son las únicas imputaciones que vienen en el código. El resto --el neto
 * gravado, el IVA, la percepción de IVA-- depende del plan de cuentas de la
 * empresa y se configura una vez: inventar una cuenta mandaría plata al lugar
 * equivocado en la contabilidad, y eso no se nota en ninguna pantalla.
 */
export const CUENTA_PERCEPCION_IIBB = "8013";
export const TIPO_PERCEPCION_IIBB = "PIB";

export const SUBCUENTAS_IIBB: readonly (readonly [string, string])[] = [
  ["901", "Capital Federal"], ["902", "Buenos Aires"], ["903", "Catamarca"],
  ["904", "Córdoba"], ["905", "Corrientes"], ["906", "Chaco"],
  ["907", "Chubut"], ["908", "Entre Ríos"], ["909", "Formosa"],
  ["910", "Jujuy"], ["911", "La Pampa"], ["912", "La Rioja"],
  ["913", "Mendoza"], ["914", "Misiones"], ["915", "Neuquén"],
  ["916", "Río Negro"], ["917", "Salta"], ["918", "San Juan"],
  ["919", "San Luis"], ["920", "Santa Cruz"], ["921", "Santa Fe"],
  ["922", "Santiago del Estero"], ["923", "Tierra del Fuego"],
  ["924", "Tucumán"],
] as const;

/**
 * Un importe como se lee en la pantalla, para los avisos de esta pantalla.
 *
 * Va acá y no en un helper compartido porque este archivo lo importa el
 * servidor, el navegador y las pruebas: tiene que seguir sin dependencias.
 */
function pesos(n: number): string {
  const abs = Math.abs(n).toLocaleString("es-AR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${n < 0 ? "-" : ""}$ ${abs}`;
}

/** Cómo se escribe una alícuota en el nombre del concepto: 10.5 -> "10,5". */
export function alicuotaTexto(a: number): string {
  return String(a).replace(".", ",");
}

/** Los conceptos de percepción que se pueden elegir en una factura. */
export const CONCEPTOS_PERCEPCION: readonly string[] = [
  "Percepción IVA",
  ...SUBCUENTAS_IIBB.map(([, provincia]) => `Percepción IIBB ${provincia}`),
  "Otros impuestos",
];

/** Todos los conceptos que pueden necesitar una cuenta. */
export const CONCEPTOS_CONTABLES: readonly string[] = [
  "Neto gravado 21 %",
  "Neto gravado 10,5 %",
  "Neto gravado 27 %",
  "Neto exento / no gravado",
  "IVA 21 %",
  "IVA 10,5 %",
  "IVA 27 %",
  ...CONCEPTOS_PERCEPCION,
];

/** La imputación de un concepto. `cuenta` y `tipoImpuesto` son obligatorios. */
export type Imputacion = {
  cuenta: string;
  subcuenta?: string | null;
  centroCosto?: string | null;
  tipoImpuesto: string;
};

/** Lo que ya se sabe sin que nadie lo cargue: las 24 percepciones de IIBB. */
export function imputacionDeFabrica(): Record<string, Imputacion> {
  const m: Record<string, Imputacion> = {};
  for (const [subcuenta, provincia] of SUBCUENTAS_IIBB) {
    m[`Percepción IIBB ${provincia}`] = {
      cuenta: CUENTA_PERCEPCION_IIBB,
      subcuenta,
      centroCosto: null,
      tipoImpuesto: TIPO_PERCEPCION_IIBB,
    };
  }
  return m;
}

/* -------------------------------------------------------------------------
   A QUE EMPRESA Y A QUE SUCURSAL
   ------------------------------------------------------------------------- */

/**
 * LAS EMPRESAS Y SUCURSALES QUE SE USAN DE VERDAD.
 *
 * Salen de las facturas de compra que ya están en la base
 * (`bronze.sigma_compras`, 2.718 comprobantes de 2026): cuatro empresas, tres
 * sucursales, siete combinaciones.
 *
 * NO SON UNA CONSTANTE DEL PROGRAMA sino la elección de quien carga. La
 * planilla de Google las tenía fijas en su configuración y eso alcanzaba para
 * un caso; acá se eligen por factura, porque cargarla en la empresa
 * equivocada es un asiento en los libros de otra sociedad.
 *
 * Los nombres los confirmó ANA. Dos de ellos --0003 y 0004-- aparecen también
 * en `fact_ventas.empresa` como "Presupuesto QUO" y "Presupuesto Noa", que es
 * de dónde salen los comprobantes de presupuesto de un mismo envío.
 */
export const EMPRESAS_SIGMA: readonly { codigo: string; nombre: string }[] = [
  { codigo: "0001", nombre: "0001 · Quo MKT" },
  { codigo: "0002", nombre: "0002 · Noa Comercial" },
  { codigo: "0003", nombre: "0003 · Presupuesto Quo" },
  { codigo: "0004", nombre: "0004 · Presupuesto Noa" },
];

/**
 * Las sucursales. 0002 es Brandmark y 0003 es Noa, confirmado por ANA.
 *
 * Es la misma lista que ofrece la orden de compra: la sucursal se elige en
 * las dos pantallas, y Brandmark es donde se recibe casi siempre.
 *
 * La 0001 queda con su código a secas porque no sabemos cómo se llama, y es
 * la que más facturas tiene cargadas (1.069 de 2026). Inventarle un nombre
 * sería peor que no ponerle ninguno: en este desplegable se elige dónde queda
 * asentada una factura.
 */
export const SUCURSALES_SIGMA: readonly { codigo: string; nombre: string }[] = [
  { codigo: "0001", nombre: "0001" },
  { codigo: "0002", nombre: "0002 · Brandmark" },
  { codigo: "0003", nombre: "0003 · Noa" },
];

/* -------------------------------------------------------------------------
   EL CUERPO
   ------------------------------------------------------------------------- */

/** Una imputación contable tal como viaja. */
export type LineaContable = {
  monto: number;
  cuenta: string;
  tipoImpuesto: string;
  subcuenta?: string;
  centroCosto?: string;
  observacion?: string;
};

/** Una mercadería tal como viaja. */
export type MercaderiaSigma = {
  articuloId: string;
  cantidad: number;
  precio: number;
  descuento: number;
  /**
   * SIGMA LO EXIGE AUNQUE SU DOCUMENTACION NO LO NOMBRE.
   *
   * Se aprendió mandando una factura de verdad: el comprobante entró, y al
   * PROCESARLO Sigma falló con "unidadCompra not found". Sin ese dato tomó
   * U=B --bultos--, cantidad 0 y el precio por bulto.
   *
   * Va con los dos nombres porque no sabemos cuál lee: el que sobre lo
   * ignora, y mandar uno solo ya falló una vez.
   */
  unidadCompra: "U";
  unidadDeCompra: "U";
};

export type CuerpoImportCompras = {
  id: string;
  empresa: string;
  proveedorId: string;
  fechaFactura: string;
  total: number;
  tipoComprobante: "F" | "C" | "D";
  codigoComprobante: string;
  numeroComprobante: string;
  contable: LineaContable[];
  mercaderias: MercaderiaSigma[];
  sucursal?: string;
  categoria?: string;
};

/** Una percepción de la factura: el concepto elegido y su monto. */
export type Percepcion = { concepto: string; monto: number };

export type DatosFactura = {
  /** 'F' factura, 'C' nota de crédito, 'D' nota de débito. */
  tipo: "F" | "C" | "D";
  /** El código del comprobante EN SIGMA. Factura A es "FA". */
  codigoComprobante: string;
  numeroComprobante: string;
  /** yyyy-mm-dd. */
  fechaFactura: string;
  proveedorId: string;
  empresa: string;
  sucursal: string;
  categoria?: string | null;
  descuentoPie: number;
  otrosImpuestos: number;
  totalImpreso: number | null;
  percepciones: Percepcion[];
  /**
   * QUE NUMERO DE ENVIO ES. 1 (o sin cargar) la primera vez. Ver
   * `idDeLaFactura`: sube sólo cuando alguien pide reenviar una factura que
   * anuló en Sigma.
   */
  intento?: number;
};

/** El número máximo de caracteres que Sigma acepta en `numeroComprobante`. */
export const MAX_NUMERO_COMPROBANTE = 20;

/**
 * Arma el cuerpo de `ImportCompras` y, sobre todo, la lista de lo que falta.
 *
 * DEVUELVE LOS TRES SIEMPRE. El cuerpo sirve para mostrarlo antes de mandar
 * --en una operación que escribe en la contabilidad, ver qué se va a mandar
 * vale más que el mensaje de éxito--, los PROBLEMAS son los que impiden
 * mandarlo, y las ADVERTENCIAS son las que no.
 *
 * ---------------------------------------------------------------------------
 * POR QUE HAY DOS LISTAS Y NO UNA
 *
 * Un problema es algo que Sigma va a rechazar o que va a dejar un asiento
 * equivocado: una factura sin cuenta contable, sin empresa, con renglones sin
 * identificar. Frenar ahí evita el daño.
 *
 * Que el total calculado no dé igual al impreso NO es eso. La factura entra
 * igual y en Sigma se edita hasta que procesa, así que frenarla de este lado
 * no protege nada: sólo obliga a encontrar el centavo antes de poder cargar
 * algo que después se corrige del otro lado. Se avisa y se deja mandar.
 *
 * ---------------------------------------------------------------------------
 * VIAJA COMPLETA
 *
 * Las mercaderías, el IVA y las percepciones, y un `total` que es la suma de
 * todo eso. Sigma no recalcula el total al editar el comprobante, así que lo
 * que no se manda desde acá no se suma después.
 */
export function armarImportCompras(
  cruce: ResultadoCruce,
  totales: TotalesComprobante,
  datos: DatosFactura,
  imputacion: Record<string, Imputacion>,
): { cuerpo: CuerpoImportCompras; problemas: string[]; advertencias: string[] } {
  const problemas: string[] = [];
  const advertencias: string[] = [];

  // --- Lo que impide mandar, antes que nada ------------------------------
  if (cruce.resumen.sinIdentificar > 0) {
    problemas.push(
      `Hay ${cruce.resumen.sinIdentificar} renglones sin identificar: asignales un SKU antes de mandar.`,
    );
  }

  // EL TOTAL CONTRA EL PAPEL AVISA, NO FRENA. Lo que viaja en `total` es la
  // suma de lo que se manda (ver abajo); si no da el impreso, lo más probable
  // es que falte un renglón, un precio o una percepción, y conviene mirarlo
  // antes de mandar: Sigma deja el total tal como llega.
  if (totales.cuadra === null) {
    advertencias.push(
      `Falta el total impreso: no hay contra qué corroborar los ${pesos(totales.total)} que se mandan.`,
    );
  } else if (totales.cuadra === false) {
    const dif = totales.diferencia ?? 0;
    advertencias.push(
      `El total calculado no cuadra con el impreso: da ${pesos(Math.abs(dif))}` +
        ` ${dif > 0 ? "más" : "menos"} (calculado ${pesos(totales.total)},` +
        ` impreso ${pesos(datos.totalImpreso ?? 0)}). Revisá los renglones y` +
        " las percepciones: Sigma deja el total tal como se manda.",
    );
  }
  if (!datos.codigoComprobante) {
    problemas.push(
      "Falta el código del comprobante en Sigma (Factura A es FA). Se configura una vez.",
    );
  }
  if (!datos.numeroComprobante) {
    problemas.push("Falta el número de comprobante.");
  } else if (datos.numeroComprobante.length > MAX_NUMERO_COMPROBANTE) {
    problemas.push(
      `El número de comprobante tiene más de ${MAX_NUMERO_COMPROBANTE} caracteres.`,
    );
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datos.fechaFactura)) {
    problemas.push("Falta la fecha de la factura, o no tiene el formato yyyy-mm-dd.");
  }
  if (!datos.empresa) problemas.push("Elegí la empresa a la que se carga la factura.");
  if (!datos.sucursal) problemas.push("Elegí la sucursal a la que se carga la factura.");
  if (!datos.proveedorId) problemas.push("Falta el código de proveedor de Sigma.");

  // --- Mercaderías: lo facturado e identificado --------------------------
  //
  // EL FACTOR DEL PIE SE APLICA ACA. La bonificación al pie baja el precio de
  // todos los renglones, y el precio que viaja tiene que ser el que de verdad
  // se paga -- si no, la suma de las mercaderías no da el neto gravado.
  const factorPie = 1 - Math.min(Math.max(datos.descuentoPie, 0), 100) / 100;
  const mercaderias: MercaderiaSigma[] = [];
  for (const l of cruce.lineas) {
    if (!l.sku || !l.factura || !l.factura.unidades) continue;
    if (l.factura.precioNeto == null) {
      problemas.push(`El SKU ${l.sku} vino sin precio ni importe en la factura.`);
      continue;
    }
    mercaderias.push({
      articuloId: l.sku,
      cantidad: l.factura.unidades,
      // Cuatro decimales: es lo que usa la planilla, y el precio unitario de
      // un artículo barato en un bulto grande necesita más de dos.
      precio: Math.round(l.factura.precioNeto * factorPie * 10000) / 10000,
      descuento: 0,
      unidadCompra: "U",
      unidadDeCompra: "U",
    });
  }
  if (mercaderias.length === 0) {
    problemas.push("No hay renglones de la factura para mandar.");
  }

  // --- Contable: el neto por alícuota, sólo si no hay mercaderías --------
  const contable: LineaContable[] = [];
  const imputar = (
    concepto: string,
    monto: number,
    observacion?: string,
    // EN CERO A PROPOSITO: el renglón de IVA de una factura exenta (ver
    // abajo). Sin esto, un monto en cero no viaja.
    enCero = false,
  ) => {
    if (!monto && !enCero) return;
    const cta = imputacion[concepto];
    if (!cta || !cta.cuenta || !cta.tipoImpuesto) {
      problemas.push(
        `Falta la cuenta o el tipo de impuesto de "${concepto}". Se configura una vez.`,
      );
      return;
    }
    const linea: LineaContable = {
      monto: centavos(monto),
      cuenta: cta.cuenta,
      tipoImpuesto: cta.tipoImpuesto,
    };
    if (cta.subcuenta) linea.subcuenta = cta.subcuenta;
    if (cta.centroCosto) linea.centroCosto = cta.centroCosto;
    if (observacion) linea.observacion = observacion.slice(0, 100);
    contable.push(linea);
  };

  // --- EL NETO LO IMPUTA SIGMA, NO NOSOTROS -----------------------------
  //
  // Esto se aprendió mirando una factura ya cargada: el registro contable
  // tenía MERCADERIAS DE REVENTA (20000) DOS VECES por el mismo importe, y el
  // subtotal daba el doble del neto facturado.
  //
  // El motivo es que cada artículo del maestro de Sigma trae su propia cuenta
  // contable --en la ficha del artículo se lee "Cta.Contable 20000"-- y Sigma
  // genera el asiento del neto a partir de las MERCADERIAS que le mandamos.
  // Mandarle además una línea contable con el neto es contarlo dos veces.
  //
  // Así que con mercaderías `contable` lleva sólo el IVA y las percepciones
  // (ver abajo). El neto se manda únicamente cuando no hay
  // mercaderías --una factura que no mueve stock-- porque ahí no hay de dónde
  // más sacarlo.
  //
  // Las cuentas de "Neto gravado %" quedan configuradas igual: son las de ese
  // caso, y borrarlas sería perder el dato para cuando haga falta.
  if (mercaderias.length === 0) {
    // El neto facturado, partido por alícuota de IVA.
    const bases: Record<number, number> = {};
    for (const l of cruce.lineas) {
      if (l.factura?.neto) bases[l.iva] = (bases[l.iva] ?? 0) + l.factura.neto;
    }
    const alicuotas = Object.keys(bases).map(Number).sort((a, b) => b - a);
    const netos = alicuotas.map((a) => centavos((bases[a] ?? 0) * factorPie));

    // EL REDONDEO POR ALICUOTA NO PUEDE MOVER EL NETO GRAVADO. Partir el neto
    // en dos o tres pedazos y redondear cada uno deja un centavo suelto, y ese
    // centavo descuadra el comprobante. Va a la base más grande, donde pesa
    // menos.
    if (netos.length > 0) {
      const suma = netos.reduce((s, n) => s + n, 0);
      const ajuste = centavos(totales.netoGravado - suma);
      const mayor = netos.indexOf(Math.max(...netos));
      netos[mayor] = centavos((netos[mayor] ?? 0) + ajuste);
    }

    alicuotas.forEach((a, i) => {
      imputar(
        a === 0 ? "Neto exento / no gravado" : `Neto gravado ${alicuotaTexto(a)} %`,
        netos[i] ?? 0,
      );
    });
  }

  // --- EL IVA Y LAS PERCEPCIONES VIAJAN COMPLETOS ----------------------
  //
  // SIGMA NO RECALCULA EL TOTAL. Se probó con una factura de verdad: mandada
  // sólo con el subtotal y el IVA en $0, se le cargaron el IVA y las
  // percepciones a mano y el total quedó en el subtotal. Lo que se manda en
  // `total` es lo que queda, y lo que no viaja desde acá no se suma después.
  //
  // Así que todo sale de la app: el IVA por alícuota con su importe y cada
  // percepción imputada a su cuenta. Y por eso lo que antes avisaba ahora
  // frena: una percepción sin cuenta o un detalle que no suma lo cargado
  // dejaría un total incompleto que del otro lado no se arregla.
  for (const i of totales.iva) {
    if (i.alicuota) imputar(`IVA ${alicuotaTexto(i.alicuota)} %`, i.importe);
  }

  const sumaPercepciones = centavos(
    datos.percepciones.reduce((s, p) => s + p.monto, 0),
  );
  if (Math.abs(sumaPercepciones - datos.otrosImpuestos) > 0.01) {
    problemas.push(
      datos.percepciones.length === 0
        ? `Hay ${pesos(datos.otrosImpuestos)} de percepciones y otros impuestos sin detallar:` +
            " elegí el concepto de cada una en el paso 2."
        : `El detalle de percepciones (${pesos(sumaPercepciones)}) no suma lo cargado` +
            ` como percepciones y otros (${pesos(datos.otrosImpuestos)}): faltan` +
            ` ${pesos(datos.otrosImpuestos - sumaPercepciones)}.`,
    );
  }
  // La observación las distingue cuando dos caen en la misma cuenta y
  // subcuenta: Sigma las registra por separado en vez de sumarlas.
  for (const p of datos.percepciones) imputar(p.concepto, p.monto, p.concepto);

  // SIGMA NO ACEPTA EL CONTABLE VACIO ("array contable no puede estar
  // vacio"), también con mercaderías. Una factura toda exenta y sin
  // percepciones no tiene nada que imputar: va un IVA 21 en $0.
  if (mercaderias.length > 0 && contable.length === 0 && totales.ivaTotal === 0) {
    imputar("IVA 21 %", 0, undefined, true);
  }

  // SIN IMPUTACION NO HAY COMPROBANTE. Sigma lo rechaza, también con
  // mercaderías (ver arriba).
  if (contable.length === 0 && !problemas.some((p) => p.startsWith("Falta la cuenta"))) {
    problemas.push("No hay ninguna imputación contable: Sigma no acepta el comprobante sin al menos una.");
  }

  const cuerpo: CuerpoImportCompras = {
    // EL ID ES LO QUE EVITA LA FACTURA DUPLICADA. Sigma lo usa para saber si
    // ya la procesó: apretar el botón de nuevo contesta "procesado
    // anteriormente" en vez de cargarla otra vez.
    id: idDeLaFactura(datos),
    empresa: datos.empresa,
    proveedorId: datos.proveedorId,
    fechaFactura: datos.fechaFactura,
    // LA SUMA DE LO QUE VIAJA: el neto gravado --lo que suman las
    // mercaderías, ya con el pie--, el IVA y las percepciones detalladas.
    // Sigma deja este número tal cual (ver arriba), así que tiene que estar
    // completo.
    total: centavos(totales.netoGravado + totales.ivaTotal + sumaPercepciones),
    tipoComprobante: datos.tipo,
    codigoComprobante: datos.codigoComprobante,
    numeroComprobante: datos.numeroComprobante,
    contable,
    mercaderias,
  };
  if (datos.sucursal) cuerpo.sucursal = datos.sucursal;
  if (datos.categoria) cuerpo.categoria = datos.categoria;

  return { cuerpo, problemas, advertencias };
}

/**
 * El identificador de la operación: proveedor, código de comprobante y número.
 *
 * ES LA MISMA FACTURA SIEMPRE, y eso es todo el punto: dos envíos de la misma
 * factura llevan el mismo id, así que el segundo no la carga de nuevo.
 *
 * ---------------------------------------------------------------------------
 * SALVO QUE SEA UN REENVIO, Y ESO ES DELIBERADO
 *
 * Esa misma protección es la que impide corregir una factura: anulada en
 * Sigma y vuelta a mandar, con el mismo id no entra --Sigma la reconoce y
 * contesta "registro procesado anteriormente"--.
 *
 * Por eso el `intento` entra en el id a partir del segundo: `...-1-001-R2`. El
 * primero queda EXACTAMENTE como estaba, así que las facturas ya mandadas
 * conservan su id y se las sigue encontrando.
 *
 * LA PROTECCION NO SE PIERDE porque el intento no sube solo: sube cuando
 * alguien pide reenviar y confirma que la anuló del otro lado. Apretar dos
 * veces el botón de mandar sigue dando el mismo id, y sigue sin duplicar.
 */
export function idDeLaFactura(datos: {
  proveedorId: string;
  codigoComprobante: string;
  numeroComprobante: string;
  intento?: number;
}): string {
  const base = ["FC", datos.proveedorId, datos.codigoComprobante, datos.numeroComprobante];
  const intento = Math.trunc(datos.intento ?? 1);
  return (intento > 1 ? [...base, `R${intento}`] : base).join("-");
}
