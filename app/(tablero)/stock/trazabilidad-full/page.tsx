import DashboardTrazabilidadFull from "@/components/DashboardTrazabilidadFull";
import EnProduccion from "@/components/EnProduccion";
import { permisoDelUsuario, puedeVerBorradores } from "@/lib/permisos";
import { authConfigurada } from "@/lib/supabase/env";
import { getUsuario } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata = { title: "Trazabilidad de Full — Tablero Brandmark" };

/**
 * Trazabilidad del stock en Full, todavía en construcción — igual que /stock,
 * del que cuelga. Quién ve qué se decide acá y no en el proxy: ver la nota en
 * app/(tablero)/stock/page.tsx.
 */
export default async function TrazabilidadFullPage() {
  const usuario = authConfigurada ? await getUsuario() : null;
  const permiso = permisoDelUsuario(usuario);

  if (authConfigurada && !puedeVerBorradores(permiso)) {
    return <EnProduccion titulo="Trazabilidad de Full" />;
  }

  return <DashboardTrazabilidadFull />;
}
