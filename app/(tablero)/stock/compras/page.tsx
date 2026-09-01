import DashboardCompras from "@/components/DashboardCompras";
import EnProduccion from "@/components/EnProduccion";
import { permisoDelUsuario, puedeVerBorradores } from "@/lib/permisos";
import { authConfigurada } from "@/lib/supabase/env";
import { getUsuario } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata = { title: "Compras — Tablero Brandmark" };

/**
 * El panel de Compras, todavía en construcción — igual que /stock, del que
 * cuelga. Ver la nota en app/(tablero)/stock/page.tsx.
 */
export default async function ComprasPage() {
  const usuario = authConfigurada ? await getUsuario() : null;
  const permiso = permisoDelUsuario(usuario);

  if (authConfigurada && !puedeVerBorradores(permiso)) {
    return <EnProduccion titulo="Compras" />;
  }

  return <DashboardCompras />;
}
