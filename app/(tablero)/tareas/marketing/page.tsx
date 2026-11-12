import Planificacion from "@/components/Planificacion";

export const dynamic = "force-dynamic";

export const metadata = { title: "Mis tareas · Marketing — Tablero Brandmark" };

/**
 * Las tareas del área de marca, en "Mis tareas" (lib/tareas.ts): lo pendiente
 * primero, y el calendario comercial, las iniciativas y su planificación en
 * las otras vistas. Sólo el superadmin (RUTAS_MARKETING en lib/permisos.ts).
 *
 * Antes vivía en /marketing/planificacion, que ahora redirige acá.
 */
export default function TareasMarketingPage() {
  return <Planificacion />;
}
