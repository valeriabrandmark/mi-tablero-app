import DashboardAntiguedad from "@/components/DashboardAntiguedad";
import EnProduccion from "@/components/EnProduccion";
import { permisoDelUsuario, puedeVerBorradores } from "@/lib/permisos";
import { authConfigurada } from "@/lib/supabase/env";
import { getUsuario } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata = { title: "Antigüedad de stock — Tablero Brandmark" };

/**
 * Antigüedad de stock, todavía en construcción — igual que /stock, del que
 * cuelga. Quién ve qué se decide acá y no en el proxy: ver la nota en
 * app/(tablero)/stock/page.tsx.
 */
export default async function AntiguedadPage() {
  const usuario = authConfigurada ? await getUsuario() : null;
  const permiso = permisoDelUsuario(usuario);

  if (authConfigurada && !puedeVerBorradores(permiso)) {
    return <EnProduccion titulo="Antigüedad de stock" />;
  }

  return <DashboardAntiguedad />;
}
