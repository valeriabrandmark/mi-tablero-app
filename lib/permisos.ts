import { slugVendedor, VENDEDORES_OBJETIVOS, type VendedorObjetivos } from "@/lib/constantes";

/**
 * Permisos del tablero.
 *
 * Un usuario de Supabase Auth lleva su rol en `app_metadata`:
 *
 *     { "rol": "supervisor" }
 *     { "rol": "vendedor", "vendedor": "SILVIO" }
 *
 * Va en `app_metadata` y NO en `user_metadata` porque esta última la puede
 * editar el propio usuario desde el navegador: si el permiso viviera ahí, un
 * vendedor podría cambiarse el rol y ver el tablero entero.
 *
 * `app_metadata` no se puede editar desde el dashboard de Supabase; se carga
 * con un `update` sobre `auth.users` (ver README).
 *
 * | Rol                | Qué ve                                            |
 * |--------------------|---------------------------------------------------|
 * | `superadmin`       | Todo                                              |
 * | `admin`            | Todo, sin editar                                  |
 * | `supervisor`       | Las páginas de objetivos de los cuatro vendedores |
 * | `vendedor`         | Únicamente su propia página de objetivos          |
 * | `responsable_meli` | Únicamente la sección Venta minorista             |
 *
 * OJO con `admin`: hoy el tablero **no tiene nada editable**, así que en la
 * práctica ve lo mismo que `superadmin`. El rol existe para que la diferencia
 * esté modelada desde ahora, pero no promete una restricción que todavía no
 * hace falta: el día que se pueda cargar un objetivo desde la pantalla, ahí sí
 * hay que distinguirlos.
 *
 * UN USUARIO SIN CLAIM NO VE NADA. Es a propósito: si alguien crea un usuario
 * y se olvida de asignarle el rol, que se quede afuera y llame, en vez de
 * entrar y ver la facturación de la empresa entera. Por eso hay que cargar el
 * claim ANTES de desplegar esto, si no el usuario que ya existe se queda sin
 * acceso a su propio tablero.
 */

export const ROLES = [
  "superadmin",
  "admin",
  "supervisor",
  "vendedor",
  "responsable_meli",
] as const;
export type Rol = (typeof ROLES)[number];

/**
 * Cómo se escribe el rol en el claim. Se normaliza porque el rol se carga a
 * mano con un `update` sobre `auth.users`, y "responsable meli" con espacio es
 * lo que uno escribe naturalmente: si solo aceptáramos el guión bajo, el
 * usuario quedaría sin acceso y el motivo no se vería por ningún lado.
 */
function normalizarRol(valor: string): string {
  return valor.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

// Un miembro por rol y no `{ rol: "superadmin" | "admin" | "supervisor" }`:
// con el discriminante múltiple, TypeScript no termina de descartar el miembro
// y no reconoce `permiso.vendedor` en la rama del vendedor.
export type Permiso =
  | { rol: "superadmin" }
  | { rol: "admin" }
  | { rol: "supervisor" }
  | { rol: "responsable_meli" }
  | { rol: "vendedor"; vendedor: VendedorObjetivos };

/** Forma mínima del usuario de Supabase que hace falta acá. */
type UsuarioConClaim = { app_metadata?: Record<string, unknown> | null } | null | undefined;

function texto(valor: unknown): string | null {
  return typeof valor === "string" && valor.trim() !== "" ? valor.trim() : null;
}

/**
 * Permiso del usuario, o `null` si no tiene uno válido — sea porque no tiene
 * claim, porque el rol no existe, o porque es `vendedor` sin un vendedor que
 * reconozcamos. Los tres casos se tratan igual: sin acceso.
 */
export function permisoDelUsuario(usuario: UsuarioConClaim): Permiso | null {
  const meta = usuario?.app_metadata ?? null;
  if (!meta) return null;

  const vendedorCrudo = texto(meta.vendedor);
  const vendedor = vendedorCrudo
    ? (VENDEDORES_OBJETIVOS.find((v) => v === vendedorCrudo.toUpperCase()) ?? null)
    : null;

  // Sin `rol` pero con `vendedor` se asume vendedor: es la forma vieja del
  // claim y sigue funcionando sin tener que reescribir los que ya estén puestos.
  const rolCrudo = texto(meta.rol) ?? (vendedorCrudo ? "vendedor" : null);
  if (!rolCrudo) return null;

  const rol = ROLES.find((r) => r === normalizarRol(rolCrudo));
  if (!rol) return null;

  if (rol === "vendedor") {
    return vendedor ? { rol, vendedor } : null;
  }
  return { rol };   // superadmin | admin | supervisor | responsable_meli
}

const PAGINAS_OBJETIVOS = VENDEDORES_OBJETIVOS.map((v) => `/objetivos/${slugVendedor(v)}`);

/**
 * Rutas que ve cualquiera con permiso válido, sin importar el rol: son de la
 * propia cuenta, no del negocio. Sin esto, un vendedor no podría ni cambiar su
 * contraseña.
 */
const PAGINAS_DE_CUENTA = ["/cuenta", "/nueva-contrasena"];

/** Raíz de la sección Venta minorista: la ven los admins y el responsable de Meli. */
const RAIZ_MINORISTA = "/venta-minorista";

export const INICIO_MINORISTA = `${RAIZ_MINORISTA}/mercado-libre`;

/**
 * `startsWith` acá SÍ es lo que corresponde (al revés que en objetivos): la
 * sección es un árbol entero —Mercado Libre, sus pestañas, Tienda Nube— y quien
 * la ve, la ve completa. Si mañana una subpágina necesita otro permiso, va a
 * tener que salir de este prefijo y tener su propia regla.
 */
function esDeMinorista(pathname: string): boolean {
  return pathname === RAIZ_MINORISTA || pathname.startsWith(`${RAIZ_MINORISTA}/`);
}

/**
 * Las rutas de API que alimentan la sección. Se listan una por una y NO con un
 * prefijo común: las tres barreras usan esta misma función, así que una ruta
 * nueva tiene que entrar acá a mano. Es más trabajo y es a propósito — con un
 * `startsWith("/api/")` genérico, cualquier API que se agregue mañana quedaría
 * abierta al responsable de Meli sin que nadie lo haya decidido.
 */
const APIS_MINORISTA = ["/api/meli", "/api/tienda-nube"];

function esApiMinorista(pathname: string): boolean {
  return APIS_MINORISTA.some((r) => pathname === r || pathname.startsWith(`${r}/`));
}

/**
 * Única regla de acceso del tablero. La usan las TRES barreras —el proxy, la
 * ruta de API y la página— para que no puedan discrepar entre sí.
 *
 * `/api/objetivos` deja pasar a un vendedor porque la ruta vuelve a chequear
 * que el `?vendedor=` pedido sea el suyo: acá no se ve la query string.
 */
export function puedeVer(permiso: Permiso | null, pathname: string): boolean {
  if (!permiso) return false;
  if (PAGINAS_DE_CUENTA.includes(pathname)) return true;
  if (permiso.rol === "superadmin" || permiso.rol === "admin") return true;

  const esDeObjetivos = pathname === "/objetivos" || PAGINAS_OBJETIVOS.includes(pathname);

  if (permiso.rol === "responsable_meli") {
    return esDeMinorista(pathname) || esApiMinorista(pathname);
  }

  if (permiso.rol === "supervisor") {
    return esDeObjetivos || pathname === "/api/objetivos";
  }

  // Vendedor: solo lo suyo.
  const suya = `/objetivos/${slugVendedor(permiso.vendedor)}`;
  return pathname === suya || pathname === "/objetivos" || pathname === "/api/objetivos";
}

/** Adónde mandar al usuario cuando entra, o cuando pide algo que no puede ver. */
export function paginaInicial(permiso: Permiso | null): string {
  if (!permiso) return "/login";
  if (permiso.rol === "vendedor") return `/objetivos/${slugVendedor(permiso.vendedor)}`;
  if (permiso.rol === "supervisor") return PAGINAS_OBJETIVOS[0];
  if (permiso.rol === "responsable_meli") return INICIO_MINORISTA;
  return "/ventas-mayoristas";
}

/** `true` si el usuario puede ver la página de objetivos de ese vendedor. */
export function puedeVerVendedor(permiso: Permiso | null, vendedor: string): boolean {
  if (!permiso) return false;
  if (permiso.rol === "vendedor") return permiso.vendedor === vendedor;
  // Se lista explícitamente en vez de `return true`: con el `true` de antes,
  // cada rol nuevo pasaba a ver los objetivos de los cuatro vendedores sin que
  // nadie lo decidiera — que es justo lo que NO tiene que ver el de Meli.
  return (
    permiso.rol === "superadmin" || permiso.rol === "admin" || permiso.rol === "supervisor"
  );
}
