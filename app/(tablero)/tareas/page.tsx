import { redirect } from "next/navigation";
import { destinoTareas, permisoDelUsuario } from "@/lib/permisos";
import { authConfigurada } from "@/lib/supabase/env";
import { getUsuario } from "@/lib/supabase/server";

/**
 * `/tareas` no tiene contenido propio: manda a la página de tareas del rol de
 * quien mira, por lo mismo que `/objetivos` manda a la del vendedor.
 *
 * Va dinámica porque el destino depende de la sesión.
 */
export const dynamic = "force-dynamic";

export default async function TareasPage() {
  const permiso = authConfigurada ? permisoDelUsuario(await getUsuario()) : null;
  redirect(destinoTareas(permiso));
}
