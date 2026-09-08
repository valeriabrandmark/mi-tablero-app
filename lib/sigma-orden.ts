/**
 * La orden de compra tal como la espera `ImportOrdenDeCompra` de Sigma.
 *
 * ---------------------------------------------------------------------------
 * QUÉ ES ESTO Y EN QUÉ SE DIFERENCIA DEL ARCHIVO
 *
 * El TXT y el Excel son ARCHIVOS: alguien los baja, los mira y los importa o
 * los manda. Esto NO: es una orden que entra sola al ERP y queda cargada.
 * Entre las dos cosas hay una diferencia de responsabilidad, no de formato —
 * un archivo mal armado se descarta, una orden mal mandada hay que ir a
 * anularla.
 *
 * Por eso acá el trabajo no es sólo armar el JSON: es NO DEJAR SALIR una orden
 * que Sigma vaya a rechazar a mitad de camino, o peor, a aceptar mal.
 *
 * ---------------------------------------------------------------------------
 * EL CONTRATO, TAL COMO LO DOCUMENTA SIGMA
 *
 *   POST .../sigma/api/v10/ImportOrdenDeCompra
 *   Content-Type: application/json
 *
 * El JSON de la orden va DIRECTO EN EL BODY: no hay envoltorio. Vale la pena
 * decirlo porque el servidor contesta "Parámetro content requerido" cuando el
 * cuerpo viene vacío, y eso hace pensar que existe un campo `content`. No
 * existe.
 *
 * DEVUELVE 500 TANTO PARA ERRORES DE VALIDACIÓN COMO PARA JSON roto, y 200
 * para el éxito — a diferencia del resto de los Import*, que usan 400. Así que
 * un 500 de acá casi nunca es "se rompió el servidor": es "te falta un campo",
 * y el cuerpo lo dice en castellano.
 *
 * ---------------------------------------------------------------------------
 * LA TRAMPA QUE HAY QUE CONOCER
 *
 * La documentación avisa que si `items` falta o viene vacío NO HAY ERROR: la
 * orden se registra igual, sin ítems. O sea que el modo más fácil de ensuciar
 * el ERP no es mandar algo mal, es mandar algo incompleto y que entre en
 * silencio. Por eso `problemasDeLaOrden` trata la orden sin renglones como un
 * error propio en vez de confiar en que Sigma la rechace.
 */

import { descuentoValido, UNIDADES_COMPRA, type RenglonOrden } from "@/lib/compras";
import { PLAZO_REPOSICION_DIAS } from "@/lib/stock";

/* -------------------------------------------------------------------------
   LOS CÓDIGOS DE LA CABECERA

   Salen de una orden de compra real de Sigma (la 00000371, a ALGABO). NO son
   configurables desde la pantalla a propósito: son los mismos en todas las
   órdenes que hace la empresa, y un desplegable con cinco códigos internos
   sería una forma elegante de que un día salga uno equivocado.

   Si alguno cambia, se cambia acá y la pantalla lo muestra igual antes de
   mandar, así que se nota.
   ------------------------------------------------------------------------- */

/** Depósito donde entra la mercadería. 13 = RECEPCIÓN. */
export const DEPOSITO_RECEPCION = "13";

/** Tipo de orden. 01 = Regular. */
export const TIPO_ORDEN = "01";

/** Condición de pago. 04 = 30 DÍAS. */
export const CONDICION_PAGO = "04";

/** Sucursal. 0002 = BRANDMARK. */
export const CODIGO_SUCURSAL = "0002";

/** Moneda. 1 = PESO. Es el CÓDIGO: `sigma_compras` guarda el nombre ("PESO"). */
export const MONEDA = "1";

/** Cotización del peso contra sí mismo. */
export const COTIZACION = 1;

/**
 * Estado con el que nace la orden. Sigma acepta S, P, C y N; `P` es
 * "Pendiente", que es como queda una orden recién cargada y todavía sin
 * aprobar.
 *
 * NO SE MANDA NADA MÁS AVANZADO A PROPÓSITO: que el tablero pueda cargar una
 * orden no quiere decir que pueda darla por aprobada. Ese paso lo sigue dando
 * una persona en Sigma.
 */
export const ESTADO_PENDIENTE = "P";

/**
 * Qué empresa compra, según el grupo del proveedor.
 *
 * Son los mismos códigos que `lib/constantes.ts` usa para mostrar nombres, y
 * los que trae `sigma_compras.empresa`. Las otras dos empresas del maestro
 * ('0003' y '0004') son de presupuesto y no compran.
 */
export const EMPRESA_POR_GRUPO: Record<string, string> = {
  "QUO MKT": "0001",
  "NOA COMERCIAL": "0002",
};

/* -------------------------------------------------------------------------
   EL CUERPO
   ------------------------------------------------------------------------- */

export type ItemSigma = {
  articuloId: string;
  cantidad: number;
  precio: number;
  descuento1: number;
  descuento2: number;
  descuento3: number;
  descuento4: number;
  descuento5: number;
  descuento6: number;
  unidadDeCompra: string;
};

export type OrdenSigma = {
  empresa: string;
  proveedorId: string;
  fechaCarga: string;
  fechaPedido: string;
  depositoRecepcion: string;
  tipoOrden: string;
  estado: string;
  condicionPago: string;
  codigoSucursal: string;
  moneda: string;
  cotizacion: number;
  frecdia: string;
  vencimiento: string | null;
  observaciones: string;
  observacionInterna: string;
  items: ItemSigma[];
};

/**
 * Lo que el servidor necesita de cada artículo, y que NO viene del navegador.
 *
 * EL PRECIO SE VUELVE A LEER DE LA BASE, no se acepta el que manda la pantalla.
 * Las cantidades y los descuentos sí los decide la persona —para eso están las
 * celdas editables— pero el costo no lo edita nadie: mandarlo desde el
 * navegador sería dejar que cualquiera con la consola abierta cargue una orden
 * a cualquier precio.
 */
export type ArticuloParaOrden = {
  sku: string;
  proveedorCodigo: string | null;
  proveedorNombre: string | null;
  grupo: string | null;
  unidadesPorBulto: number;
  costoLista: number;
};

/** Una fecha en el formato que pide Sigma: yyyy-mm-dd. */
export function fechaISO(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** La fecha de hoy más N días, sin tocar la original. */
export function masDias(d: Date, dias: number): Date {
  const otra = new Date(d);
  otra.setDate(otra.getDate() + dias);
  return otra;
}

/**
 * El precio de UN renglón, en la unidad con la que se pide.
 *
 * Es el costo de LISTA, sin descuentos: Sigma aplica `descuento1` y
 * `descuento2` por su cuenta, en cascada, igual que la pantalla. Mandar el
 * costo ya descontado y ADEMÁS los descuentos los aplicaría dos veces.
 *
 * Y va en la unidad pedida: si el renglón es por bulto, el precio es el del
 * bulto. `unidadDeCompra: "B"` con un precio unitario sería una orden por la
 * sexta parte de lo que corresponde.
 */
export function precioDelRenglon(a: ArticuloParaOrden, r: RenglonOrden): number {
  const porBulto = a.unidadesPorBulto > 0 ? a.unidadesPorBulto : 1;
  const bruto = r.unidad === "bulto" ? a.costoLista * porBulto : a.costoLista;
  // A DOS DECIMALES, que es lo que es un precio. El costo de la base tiene
  // cuatro (15.698,5776) y por bulto se van a seis; mandarlos así es pedirle al
  // ERP que redondee por su cuenta y que su total no cierre con el que la
  // pantalla mostró antes de confirmar.
  return Math.round(bruto * 100) / 100;
}

/**
 * Todo lo que impide mandar esta orden, junto.
 *
 * DEVUELVE LA LISTA ENTERA Y NO EL PRIMER PROBLEMA. Corrigiendo de a uno, cada
 * arreglo cuesta un viaje al ERP para descubrir el siguiente; así se ve todo
 * de una y se arregla de una. Sigma valida ítem por ítem y corta en el
 * primero, que es justo lo que no queremos replicar.
 *
 * Vacío quiere decir que se puede mandar.
 */
export function problemasDeLaOrden(
  articulos: Map<string, ArticuloParaOrden>,
  orden: Map<string, RenglonOrden>,
): string[] {
  const problemas: string[] = [];
  const pedidos = [...orden.entries()].filter(([, r]) => r.cantidad > 0);

  // Una orden sin renglones ENTRA IGUAL y queda cargada vacía: la
  // documentación de Sigma lo dice explícitamente. Es el único error de esta
  // lista que el ERP no nos iba a avisar.
  if (pedidos.length === 0) {
    problemas.push("La orden no tiene ningún renglón con cantidad.");
    return problemas;
  }

  const proveedores = new Set<string>();
  const grupos = new Set<string>();

  for (const [sku, r] of pedidos) {
    const a = articulos.get(sku);
    if (!a) {
      problemas.push(`${sku}: no está en el maestro de artículos de Sigma.`);
      continue;
    }
    if (!a.proveedorCodigo) {
      problemas.push(`${sku}: el artículo no tiene proveedor cargado en Sigma.`);
    } else {
      proveedores.add(a.proveedorCodigo);
    }
    if (a.grupo) grupos.add(a.grupo);

    // Sigma rechaza el precio en cero ("precio mayor que cero") y se cae la
    // orden ENTERA, no ese renglón. Hoy hay artículos así: los ACUERDO
    // COMERCIAL y los que nunca tuvieron costo cargado.
    if (!(precioDelRenglon(a, r) > 0)) {
      problemas.push(`${sku}: sin costo cargado, y Sigma exige precio mayor que cero.`);
    }
    if (!Number.isInteger(r.cantidad) || r.cantidad <= 0) {
      problemas.push(`${sku}: la cantidad tiene que ser un entero positivo.`);
    }
  }

  // UNA ORDEN, UN PROVEEDOR — lo mismo que ya pide la descarga, pero acá no es
  // una convención: el proveedor va en la CABECERA, así que una orden con dos
  // proveedores le cargaría a uno los artículos del otro.
  if (proveedores.size > 1) {
    problemas.push(
      `Hay ${proveedores.size} proveedores distintos entre los renglones, y una orden es de uno solo.`,
    );
  }
  if (grupos.size > 1) {
    problemas.push(
      `Hay artículos de ${grupos.size} empresas distintas (${[...grupos].join(", ")}), y la orden la emite una sola.`,
    );
  }
  return problemas;
}

/**
 * El cuerpo del POST.
 *
 * Sólo se llama después de que `problemasDeLaOrden` haya devuelto vacío: acá
 * no se vuelve a validar nada, se arma.
 */
export function armarOrdenSigma(
  articulos: Map<string, ArticuloParaOrden>,
  orden: Map<string, RenglonOrden>,
  observaciones: string,
  ahora: Date = new Date(),
): OrdenSigma {
  const items: ItemSigma[] = [];
  let proveedorId = "";
  let grupo: string | null = null;

  for (const [sku, r] of orden) {
    if (!(r.cantidad > 0)) continue;
    const a = articulos.get(sku);
    if (!a) continue;
    proveedorId = a.proveedorCodigo ?? proveedorId;
    grupo = grupo ?? a.grupo;
    items.push({
      articuloId: sku,
      cantidad: r.cantidad,
      precio: precioDelRenglon(a, r),
      descuento1: descuentoValido(r.descuento),
      descuento2: descuentoValido(r.descuento2),
      // Del 3 al 5 son OBLIGATORIOS aunque no se usen: sin ellos Sigma corta
      // con "item: n descuentoN obligatorio". Van en cero explícito y no
      // omitidos, que para el ERP no es lo mismo.
      descuento3: 0,
      descuento4: 0,
      descuento5: 0,
      // El 6 la documentación lo da por opcional, pero SE MANDA IGUAL. Ver la
      // nota de `frecdia` de más abajo: acá "opcional" quiere decir "no lo
      // valido", no "sé qué hacer si no está".
      descuento6: 0,
      unidadDeCompra: UNIDADES_COMPRA.find((u) => u.clave === r.unidad)!.api,
    });
  }

  const fecha = fechaISO(ahora);
  return {
    empresa: EMPRESA_POR_GRUPO[grupo ?? ""] ?? EMPRESA_POR_GRUPO["QUO MKT"],
    proveedorId,
    fechaCarga: fecha,
    fechaPedido: fecha,
    depositoRecepcion: DEPOSITO_RECEPCION,
    tipoOrden: TIPO_ORDEN,
    estado: ESTADO_PENDIENTE,
    condicionPago: CONDICION_PAGO,
    codigoSucursal: CODIGO_SUCURSAL,
    moneda: MONEDA,
    cotizacion: COTIZACION,
    /*
     * NO SE OMITE NINGÚN CAMPO, Y ESO ES LO QUE ARREGLÓ EL SEGUNDO ERROR.
     *
     * La historia, porque es la parte que hay que entender antes de tocar esto:
     *
     *   frecdia: 10          -> invalid input syntax for type date: "10"
     *   frecdia omitido      -> Query with RESPONSE_CODE returned no rows
     *
     * El primer error dice que ese valor termina en una columna de FECHA -- la
     * documentación lo declara `numeric` y su ejemplo manda 21, pero el
     * servidor manda más que la documentación. El segundo aparece recién al
     * sacarlo, así que la columna además no admite nulos: sin el campo, el
     * insert falla adentro del procedimiento y no devuelve la fila de estado
     * que el ERP espera. De ahí el mensaje, que no es de validación sino de
     * plomería rota.
     *
     * Los dos errores se explican con la misma causa, y la conclusión es que
     * acá "opcional" significa "no lo valido", NO "sé qué hacer si no está".
     * Por eso ahora va todo lo documentado, con el mismo esqueleto que el
     * ejemplo oficial: sólo cambian los valores.
     */
    frecdia: fechaISO(masDias(ahora, PLAZO_REPOSICION_DIAS)),
    // Sin fecha de vencimiento propia: la condición de pago (30 días) es la que
    // la determina. Va `null` explícito y no omitido, por lo de arriba.
    vencimiento: null,
    observacionInterna: "",
    observaciones: observaciones.trim().slice(0, 200),
    items,
  };
}

/**
 * La cabecera como se lee, para mostrarla antes de mandar.
 *
 * Existe porque una confirmación que dice "¿mandar la orden?" no es una
 * confirmación: no deja verificar nada. Estos son los seis valores que la
 * persona NO eligió y que igual van a quedar cargados en el ERP, así que
 * tienen que estar a la vista antes de apretar, con el código Y el nombre —
 * "13" no se puede comparar contra nada, "13 · RECEPCIÓN" sí.
 */
export const RESUMEN_CABECERA: { campo: string; valor: string }[] = [
  { campo: "Depósito de recepción", valor: `${DEPOSITO_RECEPCION} · RECEPCIÓN` },
  { campo: "Tipo de orden", valor: `${TIPO_ORDEN} · Regular` },
  { campo: "Condición de pago", valor: `${CONDICION_PAGO} · 30 días` },
  { campo: "Sucursal", valor: `${CODIGO_SUCURSAL} · BRANDMARK` },
  { campo: "Moneda", valor: `${MONEDA} · PESO` },
  { campo: "Estado", valor: `${ESTADO_PENDIENTE} · Pendiente` },
];
