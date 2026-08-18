import { VENDEDORES_OBJETIVOS, type VendedorObjetivos } from "@/lib/constantes";

/**
 * Permisos por vendedor.
 *
 * Un usuario de Supabase Auth puede tener un vendedor asignado en su
 * `app_metadata`:
 *
 *     { "vendedor": "SILVIO" }
 *
 * Se carga a mano desde Supabase → Authentication → el usuario → App Metadata.
 * Va en `app_metadata` y NO en `user_metadata` porque esta última la puede
 * editar el propio usuario desde el cliente: si el permiso viviera ahí, un
 * vendedor podría cambiarse el nombre y ver el tablero de otro.
 *
 * Un usuario SIN el claim es administrador y ve todo el tablero. Es el caso de
 * los usuarios que ya existen, así que sumar esto no le saca acceso a nadie:
 * solo se lo limita a quien se le asigne un vendedor explícitamente.
 */

/** Forma mínima del usuario de Supabase que hace falta acá. */
type UsuarioConClaim = { app_metadata?: Record<string, unknown> | null } | null | undefined;

/** Vendedor asignado al usuario, o `null` si es administrador. */
export function vendedorDelUsuario(usuario: UsuarioConClaim): VendedorObjetivos | null {
  const valor = usuario?.app_metadata?.vendedor;
  if (typeof valor !== "string") return null;
  const normalizado = valor.trim().toUpperCase();
  // Un claim que no está en la lista NO da acceso de admin por descuido: se
  // trata como vendedor desconocido y no matchea con ninguna página.
  return VENDEDORES_OBJETIVOS.find((v) => v === normalizado) ?? null;
}

/** `true` si el claim del usuario es un valor que no reconocemos. */
export function tieneClaimInvalido(usuario: UsuarioConClaim): boolean {
  const valor = usuario?.app_metadata?.vendedor;
  return typeof valor === "string" && vendedorDelUsuario(usuario) === null;
}
