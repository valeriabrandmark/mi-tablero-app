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
  | "meli"
  | "tienda_nube"
  | "precios_tn";

export type Modulo = {
  clave: ClaveModulo;
  nombre: string;
  /** Qué hace alguien que además tiene permiso de editar. `null` = no se edita. */
  queEdita: string | null;
  /** Prefijos de página y de API. Una ruta es de este módulo si empieza con alguno. */
  rutas: string[];
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
    rutas: ["/stock/compras", "/api/compras"],
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
  return duenio != null && modulos.includes(duenio);
}

/** El nombre lindo de un módulo, para mostrarlo. */
export function nombreModulo(clave: ClaveModulo): string {
  return MODULOS.find((m) => m.clave === clave)?.nombre ?? clave;
}

/** `true` si la clave es uno de los módulos que existen. */
export function esModulo(valor: unknown): valor is ClaveModulo {
  return typeof valor === "string" && MODULOS.some((m) => m.clave === valor);
}
