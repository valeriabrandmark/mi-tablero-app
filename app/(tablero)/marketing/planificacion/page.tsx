import { redirect } from "next/navigation";

/**
 * La planificación se mudó a "Mis tareas → Marketing". Se deja la ruta vieja
 * redirigiendo para que no se rompa un link guardado.
 */
export default function PlanificacionVieja() {
  redirect("/tareas/marketing");
}
