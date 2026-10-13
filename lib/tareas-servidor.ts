import { NextResponse } from "next/server";
import { permisoDelUsuario, puedeVer } from "@/lib/permisos";
import { authConfigurada } from "@/lib/supabase/env";
import { getUsuario } from "@/lib/supabase/server";

/**
 * De quién son las tareas de este pedido, o la respuesta de rechazo.
 *
 * El dueño es el EMAIL de la sesión, nunca algo que mande la pantalla: el
 * organizador es personal y cada consulta filtra por esto.
 *
 * Sin auth configurada (desarrollo local) todo queda a nombre de "local", para
 * poder probar la pantalla sin login.
 */
export async function duenioDeTareas(): Promise<
  { usuario: string; rechazo: null } | { usuario: null; rechazo: NextResponse }
> {
  if (!authConfigurada) return { usuario: "local", rechazo: null };

  const usuario = await getUsuario();
  const permiso = permisoDelUsuario(usuario);
  if (!puedeVer(permiso, "/api/tareas") || !usuario?.email) {
    return {
      usuario: null,
      rechazo: NextResponse.json({ error: "Sin permiso" }, { status: 403 }),
    };
  }
  return { usuario: usuario.email.trim().toLowerCase(), rechazo: null };
}

/** Un error de base, contado sin detalles internos a la pantalla. */
export function errorInterno(donde: string, error: unknown) {
  console.error(`[api/tareas] ${donde}`, error);
  const mensaje = error instanceof Error ? error.message : "Error desconocido";
  return NextResponse.json({ error: mensaje }, { status: 500 });
}
