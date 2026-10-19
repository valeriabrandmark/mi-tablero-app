import { redirect } from "next/navigation";
import { destinoObjetivos, permisoDelUsuario } from "@/lib/permisos";
import { authConfigurada } from "@/lib/supabase/env";
import { getUsuario } from "@/lib/supabase/server";

/**
 * `/objetivos` no tiene contenido propio: manda a la página de un vendedor.
 *
 * A LA DE QUIEN DEPENDE DE QUIEN MIRA, y eso dejó de ser un detalle cuando la
 * barra lateral pasó a tener una sola entrada de Objetivos en vez de cuatro:
 * antes nadie entraba por acá --cada link del menú iba derecho a su vendedor--
 * y ahora entran todos.
 *
 * Mandar a todos al primero de la lista le daría a Pablo la página de Silvio,
 * que `puedeVer` le niega: el proxy lo rebotaría a su página inicial y el click
 * en "Objetivos" se vería como que no hace nada. Un vendedor va a la suya;
 * cualquier otro, al primero.
 *
 * Va dinámica porque el destino depende de la sesión. Prerenderizada, el primer
 * visitante le fijaría el destino a todos los demás.
 */
export const dynamic = "force-dynamic";

export default async function ObjetivosPage() {
  const permiso = authConfigurada ? permisoDelUsuario(await getUsuario()) : null;

  // La decisión vive en permisos.ts, al lado de la regla de acceso y con sus
  // propias pruebas. Ver `destinoObjetivos`.
  redirect(destinoObjetivos(permiso));
}
