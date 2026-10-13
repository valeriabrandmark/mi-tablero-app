import OrganizadorTareas from "@/components/tareas/OrganizadorTareas";

export const dynamic = "force-dynamic";

export const metadata = { title: "Mis tareas — Tablero Brandmark" };

/**
 * El organizador de tareas: calendario, recordatorios con sonido, tareas que
 * se repiten y tareas que se ejecutan solas.
 *
 * El permiso lo resuelve el proxy con `puedeVer` (hoy, sólo `superadmin`); la
 * API lo vuelve a chequear y además filtra todo por el email de la sesión.
 */
export default function TareasPage() {
  return <OrganizadorTareas />;
}
