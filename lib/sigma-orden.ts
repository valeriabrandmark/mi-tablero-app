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

import {
  descuentoValido,
  UNIDADES_COMPRA,
  type RenglonOrden,
} from "@/lib/compras";
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

/** El otro campo de usuario del ejemplo. Va en 0, como ahí. */
export const FUSUARI_SIGMA = 0;

/**
 * LAS EMPRESAS QUE COMPRAN.
 *
 * Son dos. Las otras dos del maestro --'0003' y '0004'-- son de presupuesto y
 * no emiten órdenes de compra, así que no se ofrecen: un desplegable que
 * muestra cuatro opciones de las cuales dos están mal es un error esperando a
 * que alguien tenga apuro.
 *
 * ---------------------------------------------------------------------------
 * NO HAY VALOR POR DEFECTO, Y ESO ES LO QUE CAMBIO
 *
 * Antes la empresa salía del grupo del proveedor (`bronze.proveedores_grupo`,
 * una lista corta y a mano) y no se podía cambiar. Eso cargó una orden de
 * DEPIMIEL en NOA cuando el proveedor ya había pasado a Quo: la lista se
 * entera cuando alguien se acuerda de avisarle, y mientras tanto la orden sale
 * a nombre de la sociedad equivocada sin que nadie lo decida.
 *
 * Ahora se elige SIEMPRE, sea quien sea el proveedor. Un default que acierta
 * casi siempre es peor que ninguno: el que acierta casi siempre no se mira.
 */
export const EMPRESAS_QUE_COMPRAN: readonly { codigo: string; nombre: string }[] = [
  { codigo: "0001", nombre: "0001 · Quo MKT" },
  { codigo: "0002", nombre: "0002 · Noa Comercial" },
];

export function esEmpresaQueCompra(codigo: unknown): codigo is string {
  return EMPRESAS_QUE_COMPRAN.some((e) => e.codigo === codigo);
}

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

/**
 * La cabecera, EN EL ORDEN EXACTO DEL EJEMPLO DE LA DOCUMENTACIÓN.
 *
 * En JSON el orden de las claves no significa nada: `{"a":1,"b":2}` y
 * `{"b":2,"a":1}` son el mismo objeto para cualquier parser que cumpla la
 * especificación. Así que esto NO debería cambiar nada.
 *
 * Va igual porque lo pidió soporte y porque no cuesta nada -- y porque este
 * endpoint ya contradijo su propia documentación tres veces (`frecdia`
 * declarado numérico que resulta fecha, "opcional" que resulta "no lo valido",
 * un ejemplo con códigos de otro sistema). Con ese antecedente, "el parser
 * lee el cuerpo en orden" dejó de ser descartable sin probarlo.
 *
 * Si alguna vez se agrega un campo, va en la posición que tenga en el ejemplo
 * oficial y no al final.
 */
export type OrdenSigma = {
  proveedorId: string;
  fechaCarga: string;
  fechaPedido: string;
  fusuari: number;
  usuario: number;
  observaciones: string;
  estado: string;
  tipoOrden: string;
  depositoRecepcion: string;
  condicionPago: string;
  vencimiento: string | null;
  observacionInterna: string;
  codigoSucursal: string;
  moneda: string;
  empresa: string;
  cotizacion: number;
  frecdia: string;
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
 * `cantidad` Y `precio` VIAJAN SIEMPRE POR UNIDAD, NUNCA POR BULTO.
 *
 * Esto NO es lo que parecía, y la orden 00000373 de ALGABO lo demuestra. Se
 * pidieron 2 bultos de AL10032 --6 unidades por bulto, costo unitario
 * 3.699,675-- y en el ERP quedó:
 *
 *     Unid.  Cant.  $Unit         Pres.  Total
 *     Bultos  0,33  133.188,3000    6    35.849,85
 *
 * Los dos números están 6 veces corridos, cada uno para su lado. Se mandó
 * `cantidad: 2` con `unidadDeCompra: "B"` y Sigma lo leyó como 2 UNIDADES, que
 * son 0,33 bultos. Se mandó `precio: 22.198,05` --el del bulto-- y Sigma lo
 * leyó como precio POR UNIDAD, que por bulto son 133.188,30.
 *
 * `unidadDeCompra` NO cambia lo que se manda: cambia cómo se muestra. Sigma
 * divide la cantidad por `Pres.` y multiplica el precio por `Pres.`, y nada
 * más.
 *
 * POR QUÉ NO SALTÓ ANTES: los dos errores se cancelan en el total. Seis veces
 * menos cantidad por seis veces más precio da exactamente la misma plata, y el
 * total era lo único que mirábamos. Lo que no se cancela es lo que llega: el
 * proveedor manda 2 unidades donde se pidieron 12.
 *
 * OJO, EL TXT NO SE TOCA. El importador de la grilla sí toma la cantidad en la
 * unidad declarada, y viene funcionando así. Son dos caminos distintos hacia el
 * mismo ERP y no se comportan igual.
 */
export function unidadesDelRenglon(
  a: ArticuloParaOrden,
  r: RenglonOrden,
): number {
  const porBulto = a.unidadesPorBulto > 0 ? a.unidadesPorBulto : 1;
  return r.unidad === "bulto" ? r.cantidad * porBulto : r.cantidad;
}

/**
 * El precio de UNA unidad.
 *
 * Es el costo de LISTA, sin descuentos: Sigma aplica `descuento1` y
 * `descuento2` por su cuenta, en cascada, igual que la pantalla. Mandar el
 * costo ya descontado y ADEMÁS los descuentos los aplicaría dos veces.
 */
export function precioUnitario(a: ArticuloParaOrden): number {
  // A DOS DECIMALES, que es lo que es un precio. El costo de la base tiene
  // cuatro (15.698,5776); mandarlos así es pedirle al ERP que redondee por su
  // cuenta y que su total no cierre con el que la pantalla mostró antes de
  // confirmar.
  return Math.round(a.costoLista * 100) / 100;
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
      problemas.push(
        `${sku}: el artículo no tiene proveedor cargado en Sigma.`,
      );
    } else {
      proveedores.add(a.proveedorCodigo);
    }
    if (a.grupo) grupos.add(a.grupo);

    // Sigma rechaza el precio en cero ("precio mayor que cero") y se cae la
    // orden ENTERA, no ese renglón. Hoy hay artículos así: los ACUERDO
    // COMERCIAL y los que nunca tuvieron costo cargado.
    if (!(precioUnitario(a) > 0)) {
      problemas.push(
        `${sku}: sin costo cargado, y Sigma exige precio mayor que cero.`,
      );
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
  /**
   * El usuario de Sigma con el que queda FIRMADA la orden. Sale de
   * `USUARIOS_ERP` (lib/permisos.ts).
   *
   * NO TIENE VALOR POR DEFECTO, Y ESO ES EL PUNTO. Antes era `USUARIO_SIGMA = 3`
   * y esta función lo usaba cuando no le pasaban uno: una llamada que se
   * olvidara del usuario no fallaba, firmaba la orden como ANA.M. En un ERP la
   * firma es lo que dice quién autorizó la compra, así que ahora el compilador
   * no deja olvidarlo.
   */
  usuarioSigma: number,
  /**
   * A QUE EMPRESA Y SUCURSAL VA LA ORDEN.
   *
   * NO TIENE VALOR POR DEFECTO, igual que `usuarioSigma` y por el mismo
   * motivo: cargar una orden en la empresa equivocada es pedirle mercadería a
   * nombre de otra sociedad, y un default lo hace sin que nadie lo decida.
   * Antes salía del grupo del proveedor y así salió mal una de DEPIMIEL.
   *
   * El compilador no deja olvidarlo.
   */
  destino: { empresa: string; sucursal: string },
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
      // En UNIDADES aunque el renglón se haya pedido por bulto: ver la nota de
      // `unidadesDelRenglon`. `unidadDeCompra` de abajo es sólo presentación.
      cantidad: unidadesDelRenglon(a, r),
      precio: precioUnitario(a),
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

  /*
   * EL ORDEN DE ESTAS CLAVES ES EL DEL EJEMPLO DE LA DOCUMENTACIÓN, y está
   * puesto a mano. Ver el comentario de `OrdenSigma`: en JSON el orden no
   * significa nada, pero lo pidió soporte, no cuesta nada, y este endpoint ya
   * contradijo su propia documentación tres veces.
   *
   * Los dos comentarios largos de abajo son de campos que costaron un error
   * cada uno. No los borres sin leerlos.
   */
  return {
    proveedorId,
    fechaCarga: fecha,
    fechaPedido: fecha,
    fusuari: FUSUARI_SIGMA,
    usuario: usuarioSigma,
    // Es el campo "Obs. p/Proveedor" de la pantalla de Sigma, el mismo lugar
    // donde hoy se escribe a mano "OFERTAS DE SELL IN ENVIADAS". Por eso lleva
    // la nota de la pantalla y no una leyenda automática.
    observaciones: observaciones.trim().slice(0, 200),
    estado: ESTADO_PENDIENTE,
    tipoOrden: TIPO_ORDEN,
    depositoRecepcion: DEPOSITO_RECEPCION,
    condicionPago: CONDICION_PAGO,
    /*
     * VENCIMIENTO IGUAL A LA FECHA DE PEDIDO, y no `null`.
     *
     * Iba en null --el ejemplo de la documentación lo manda así y el campo
     * figura como opcional-- y el ERP siguió contestando "Query with
     * RESPONSE_CODE returned no rows" incluso con todos los demás campos
     * puestos.
     *
     * Lo que decide es la orden REAL: en la 00000371, Pedido y Vencimiento
     * dicen los dos 31/08/2026. O sea que en una orden de verdad el campo NO
     * está vacío, aunque la condición de pago sea a 30 días. Contra la
     * documentación y contra su ejemplo, gana lo que el sistema tiene cargado.
     */
    vencimiento: fecha,
    observacionInterna: "",
    codigoSucursal: destino.sucursal,
    moneda: MONEDA,
    empresa: destino.empresa,
    cotizacion: COTIZACION,
    /*
     * `frecdia` VA COMO FECHA, contra lo que dice la documentación.
     *
     *   frecdia: 10          -> invalid input syntax for type date: "10"
     *   frecdia omitido      -> Query with RESPONSE_CODE returned no rows
     *
     * El primer error dice que ese valor termina en una columna de FECHA -- la
     * documentación lo declara `numeric` y su ejemplo manda 21. El segundo
     * aparece recién al sacarlo, así que la columna además no admite nulos.
     *
     * De ahí sale la regla de todo este archivo: acá "opcional" significa "no
     * lo valido", NO "sé qué hacer si no está". Por eso va todo lo documentado.
     */
    frecdia: fechaISO(masDias(ahora, PLAZO_REPOSICION_DIAS)),
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
/**
 * EL NUMERO DE ORDEN QUE DEVUELVE SIGMA, si es que viene.
 *
 * ---------------------------------------------------------------------------
 * POR QUE EXISTE
 *
 * Hasta ahora la orden vivía con dos identidades que no se conocían entre sí:
 * un número en Sigma que nosotros no veíamos, y un id en el tablero que Sigma
 * no veía. Con esto se puede nombrar la misma orden de los dos lados.
 *
 * ---------------------------------------------------------------------------
 * BUSCA EN EL CUERPO Y TAMBIEN EN LOS HEADERS, y no es por las dudas
 *
 * El changelog de Sigma del 09/09/2026 dice que `ImportOrdenDeCompra` pasó a
 * devolver 200 con "Orden de compra importada correctamente. OC Nro: <n>", y
 * la doc del endpoint lo repite. Pero las órdenes que mandamos después de esa
 * fecha --incluidas las del 19 y 20 de octubre-- vuelven con el cuerpo VACIO.
 *
 * O no está desplegado en la instancia de Quo, o el número viaja en un header:
 * la doc lo llama `RESPONSE_TEXT`, que es el nombre de una variable de su
 * procedimiento y no necesariamente el cuerpo HTTP. Mirar en los dos lados
 * cuesta nada y evita tener que mandar una orden de prueba al ERP para
 * averiguarlo.
 *
 * ---------------------------------------------------------------------------
 * EL CUERPO PUEDE SER TEXTO PLANO O JSON
 *
 * La API convive con dos formatos --los endpoints viejos contestan texto, los
 * nuevos `{"message": "..."}`-- y este endpoint ya cambió de forma una vez. Se
 * busca el patrón en el texto crudo, que funciona con los dos: un JSON también
 * es texto, y el número está adentro igual.
 */
export function numeroDeOrdenSigma(
  cuerpo: string,
  headers: Record<string, string> = {},
): string | null {
  const encontrar = (texto: string): string | null => {
    // "OC Nro: 1234", "OC Nro 1234", "OC Nro.: 1234".
    const m = /OC\s*Nro\.?\s*:?\s*([0-9]+)/i.exec(texto);
    return m ? m[1]! : null;
  };

  const delCuerpo = encontrar(cuerpo ?? "");
  if (delCuerpo) return delCuerpo;

  for (const valor of Object.values(headers)) {
    const h = encontrar(String(valor ?? ""));
    if (h) return h;
  }
  return null;
}

/**
 * LO QUE VA FIJO EN LA CABECERA, para mostrarlo al confirmar.
 *
 * Son los campos que NO se eligen. La sucursal salió de esta lista el día que
 * pasó a elegirse: tenerla acá con un valor fijo al lado de un desplegable que
 * dice otra cosa es la forma más rápida de que nadie crea ninguno de los dos.
 */
export const RESUMEN_CABECERA: { campo: string; valor: string }[] = [
  {
    campo: "Depósito de recepción",
    valor: `${DEPOSITO_RECEPCION} · RECEPCIÓN`,
  },
  { campo: "Tipo de orden", valor: `${TIPO_ORDEN} · Regular` },
  { campo: "Condición de pago", valor: `${CONDICION_PAGO} · 30 días` },
  { campo: "Moneda", valor: `${MONEDA} · PESO` },
  { campo: "Estado", valor: `${ESTADO_PENDIENTE} · Pendiente` },
];
