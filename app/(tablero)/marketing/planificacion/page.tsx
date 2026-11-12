import Planificacion from "@/components/Planificacion";

export const dynamic = "force-dynamic";

export const metadata = { title: "Planificación — Tablero Brandmark" };

/**
 * Marketing → Planificación: calendario comercial, iniciativas con brief y
 * subtareas. Sólo el superadmin, como todo /marketing (lib/permisos.ts).
 * Tablas en migraciones/marketing_planificacion.sql.
 */
export default function PlanificacionPage() {
  return <Planificacion />;
}
