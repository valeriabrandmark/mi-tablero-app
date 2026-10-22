/**
 * Los módulos del tablero: qué páginas y qué APIs son de cada uno.
 *
 * ---------------------------------------------------------------------------
 * PARA QUÉ EXISTE
 *
 * Hasta ahora los permisos eran seis roles fijos, y cada persona nueva que no
 * encajaba en ninguno obligaba a tocar `permisos.ts`, desplegar y recién ahí
 * darle acceso. Con el catálogo, el panel de Usuarios arma el permiso marcando
 * casillas y no hace falta pasar por acá.
 *
 * Los roles viejos siguen funcionando exactamente igual: este archivo es lo que
 * usa el permiso NUEVO, el `personalizado`, y no toca a los demás.
 *
 * ---------------------------------------------------------------------------
 * LA REGLA DE ORO: SI NO ESTÁ ACÁ, NO SE VE
 *
 * Una ruta que no pertenezca a ningún módulo queda fuera del alcance de
 * cualquier usuario personalizado. Es a propósito y es la parte que hace que
 * esto sea seguro de mantener: el día que alguien agregue una pantalla nueva y
 * se olvide de este archivo, la pantalla queda cerrada — no abierta.
 *
 * ---------------------------------------------------------------------------
 * POR QUÉ SE RESUELVE POR EL PREFIJO MÁS LARGO
 *
 * `/stock/compras` empieza con `/stock`. Si se preguntara "¿alguno de mis
 * módulos es prefijo de esta ruta?", alcanzar con ver Stock abriría Compras de
 * regalo — y Compras es el módulo que manda órdenes al ERP.
 *
 * Por eso primero se resuelve DE QUIÉN ES la ruta (el prefijo más largo que
 * coincide, o sea el más específico) y recién después se pregunta si la persona
 * tiene ese módulo.
 */

export type ClaveModulo =
  | "mayorista"
  | "cuentas"
  | "objetivos"
  | "logistica"
  | "stock"
  | "compras"
  | "facturas_compra"
  | "meli"
  | "tienda_nube"
  | "precios_tn";

export type Modulo = {
  clave: ClaveModulo;
  nombre: string;
  /** Qué hace alguien que además tiene permiso de editar. `null` = no se edita. */
  queEdita: string | null;
  /**
   * SI LO QUE EDITA SE FIRMA CON UN USUARIO DE SIGMA.
   *
   * Lo que sale de estos módulos queda cargado en el ERP a nombre de alguien,
   * así que además del permiso hace falta el número. Es lo que hace que el
   * panel de Usuarios pida el número: marcar la casilla sin cargarlo deja a la
   * persona con la pantalla abierta y el botón muerto.
   *
   * Vive acá y no en una lista suelta del panel porque ya pasó al revés: la
   * carga de facturas se separó de Compras y el campo quedó atado a Compras,
   * así que al primer usuario que se le dio sólo facturas no hubo dónde
   * cargarle el número. Declarado en el módulo, un módulo nuevo que escriba en
   * el ERP trae el campo puesto.
   */
  firmaEnSigma?: true;
  /** Prefijos de página y de API. Una ruta es de este módulo si empieza con alguno. */
  rutas: string[];
  /**
   * RUTAS DE OTRO MODULO QUE ESTE TAMBIEN PUEDE LEER.
   *
   * No las posee --siguen siendo del módulo que las tiene en `rutas`, y por
   * eso no entran en `moduloDeRuta`-- pero tenerlas acá alcanza para abrirlas.
   *
   * Existe por un caso concreto: la carga de facturas necesita el historial
   * de órdenes para cruzar contra él, y ese historial es de Compras. Sin esto
   * las opciones eran malas las dos: darle Compras entero a quien sólo carga
   * facturas, o mover la ruta a facturas y que la perdiera quien tiene
   * Compras.
   */
  tambienLee?: string[];
};

export const MODULOS: Modulo[] = [
  {
    clave: "mayorista",
    nombre: "Ventas mayoristas",
    queEdita: null,
    rutas: ["/ventas-mayoristas", "/api/ventas-mayoristas"],
  },
  {
    clave: "cuentas",
    nombre: "Cuentas corrientes",
    queEdita: null,
    rutas: ["/cuentas-corrientes", "/api/cuentas-corrientes"],
  },
  {
    clave: "objetivos",
    nombre: "Objetivos",
    queEdita: null,
    rutas: ["/objetivos", "/api/objetivos"],
  },
  {
    clave: "logistica",
    nombre: "Logística",
    queEdita: null,
    rutas: ["/logistica", "/api/logistica"],
  },
  {
    clave: "stock",
    nombre: "Stock",
    queEdita: null,
    rutas: [
      "/stock",
      "/api/stock",
      "/api/stock-antiguedad",
      "/api/trazabilidad-full",
    ],
  },
  {
    clave: "compras",
    nombre: "Compras",
    // El permiso de editar acá NO es un detalle: es mandar una orden a Sigma,
    // que no tiene deshacer. Ver `numeroDeSigma` en permisos.ts.
    queEdita: "mandar órdenes de compra al ERP",
    firmaEnSigma: true,
    rutas: ["/stock/compras", "/api/compras"],
  },
  {
    clave: "facturas_compra",
    nombre: "Carga de facturas de compra",
    // Mismo peso que mandar una orden, y más: una orden mal cargada se anula,
    // una factura toca cuenta corriente, stock e IVA.
    queEdita: "cargar facturas de compra en el ERP",
    firmaEnSigma: true,
    /**
     * MODULO APARTE Y NO PARTE DE COMPRAS, aunque cruce contra las órdenes que
     * salen de ahí. Son dos trabajos distintos y los puede hacer gente
     * distinta: uno le pide al proveedor, el otro asienta lo que llegó. Tenerlo
     * adentro de Compras obligaba a elegir entre dar los dos o ninguno.
     *
     * OJO CON EL ORDEN DE LOS PREFIJOS: `/api/compras/facturas` es más largo
     * que el `/api/compras` de Compras, así que gana éste (ver
     * `moduloDeRuta`). Por eso también `/facturas-compra` salió de la lista de
     * Compras: estando en los dos, con el mismo largo, decidía el orden del
     * array -- que es lo último de lo que tiene que depender un permiso.
     */
    rutas: ["/facturas-compra", "/api/compras/facturas"],
    /**
     * EL HISTORIAL DE ORDENES ES CONTRA LO QUE SE CRUZA UNA FACTURA. Sin él la
     * pantalla carga igual, pero no tiene contra qué comparar -- y lo que ve
     * quien entra es un cartel rojo en el primer panel.
     *
     * No abre nada nuevo: son los mismos SKU, cantidades y costos que esa
     * persona va a ver en el cruce de la factura que está cargando.
     */
    tambienLee: ["/api/compras/ordenes"],
  },
  {
    clave: "meli",
    nombre: "Mercado Libre",
    queEdita: null,
    rutas: [
      "/venta-minorista/mercado-libre",
      "/api/meli",
      "/api/stock-full",
      "/api/elasticidad",
      "/api/resultados-elasticidad",
      "/api/competencia-meli",
    ],
  },
  {
    clave: "tienda_nube",
    nombre: "Tienda Nube",
    queEdita: null,
    rutas: ["/venta-minorista/tienda-nube", "/api/tienda-nube"],
  },
  {
    clave: "precios_tn",
    nombre: "Precios TN",
    queEdita: "aprobar y rechazar cambios de precio",
    rutas: ["/precios-tn", "/api/precios-tn"],
  },
];

/** Los módulos que tienen algo para editar, para las casillas del panel. */
export const MODULOS_EDITABLES = MODULOS.filter((m) => m.queEdita !== null);

/**
 * `true` si con estos módulos marcados para editar hace falta un número de
 * usuario de Sigma. Es lo que decide si el panel de Usuarios pide el campo.
 */
export function necesitaUsuarioSigma(
  editar: readonly ClaveModulo[],
): boolean {
  return MODULOS.some((m) => m.firmaEnSigma && editar.includes(m.clave));
}

/**
 * La portada de Venta minorista no es de nadie: es el índice de las dos
 * secciones. La ve quien tenga cualquiera de las dos, porque mandarlo al índice
 * y que ahí reciba un 403 sería peor que no mostrarlo.
 */
const PORTADA_MINORISTA = "/venta-minorista";
const MODULOS_MINORISTA: ClaveModulo[] = ["meli", "tienda_nube"];

/**
 * Rutas que alimentan a todas las pantallas por igual. `/api/filtros` llena los
 * desplegables de cualquier tablero: negársela a un usuario con módulos le
 * dejaría los filtros vacíos sin ningún motivo.
 */
const RUTAS_COMUNES = ["/api/filtros"];

function empieza(pathname: string, prefijo: string): boolean {
  return pathname === prefijo || pathname.startsWith(`${prefijo}/`);
}

/**
 * De qué módulo es una ruta, o `null` si de ninguno.
 *
 * Gana el prefijo MÁS LARGO: `/stock/compras` es de Compras y no de Stock.
 */
export function moduloDeRuta(pathname: string): ClaveModulo | null {
  let mejor: { clave: ClaveModulo; largo: number } | null = null;

  for (const modulo of MODULOS) {
    for (const ruta of modulo.rutas) {
      if (empieza(pathname, ruta) && (!mejor || ruta.length > mejor.largo)) {
        mejor = { clave: modulo.clave, largo: ruta.length };
      }
    }
  }
  return mejor?.clave ?? null;
}

/** `true` si alguien con estos módulos puede abrir esa ruta. */
export function moduloPermiteRuta(
  modulos: readonly ClaveModulo[],
  pathname: string,
): boolean {
  if (modulos.length === 0) return false;
  if (RUTAS_COMUNES.some((r) => empieza(pathname, r))) return true;
  if (pathname === PORTADA_MINORISTA) {
    return MODULOS_MINORISTA.some((m) => modulos.includes(m));
  }

  const duenio = moduloDeRuta(pathname);
  if (duenio != null && modulos.includes(duenio)) return true;

  // Y si no es suya, puede ser una que alguno de sus módulos igual lee. Va
  // DESPUES del dueño: lo prestado no le saca la ruta a nadie.
  return MODULOS.some(
    (m) =>
      modulos.includes(m.clave) &&
      (m.tambienLee ?? []).some((r) => empieza(pathname, r)),
  );
}

/** El nombre lindo de un módulo, para mostrarlo. */
export function nombreModulo(clave: ClaveModulo): string {
  return MODULOS.find((m) => m.clave === clave)?.nombre ?? clave;
}

/** `true` si la clave es uno de los módulos que existen. */
export function esModulo(valor: unknown): valor is ClaveModulo {
  return typeof valor === "string" && MODULOS.some((m) => m.clave === valor);
}
