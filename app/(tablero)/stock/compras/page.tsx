import DashboardCompras from "@/components/DashboardCompras";
import { permisoDelUsuario, puedeEscribirEnElERP } from "@/lib/permisos";
import { authConfigurada } from "@/lib/supabase/env";
import { getUsuario } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata = { title: "Compras — Tablero Brandmark" };

/**
 * El panel de Compras, publicado junto con el resto de Operaciones.
 *
 * LA PÁGINA LA VEN LOS DOS ROLES, EL BOTÓN DE MANDAR AL ERP NO. El `admin`
 * arma la orden y se lleva el TXT, el CSV o el Excel; cargarla en Sigma es
 * escribir en un sistema que no tiene deshacer, y eso queda en `superadmin`.
 *
 * EL PERMISO VIAJA COMO PROP Y ADEMÁS LO VUELVE A CHEQUEAR LA RUTA DE API. No
 * es redundancia: esconder un botón no es un permiso, es una cortesía --evita
 * ofrecer algo que va a fallar-- y quien decide de verdad es el servidor.
 */
export default async function ComprasPage() {
  const usuario = authConfigurada ? await getUsuario() : null;
  const permiso = permisoDelUsuario(usuario);

  // Sin auth configurada (desarrollo local) se puede todo: si no, no habría
  // forma de probar el envío.
  return <DashboardCompras puedeEnviar={!authConfigurada || puedeEscribirEnElERP(permiso)} />;
}
