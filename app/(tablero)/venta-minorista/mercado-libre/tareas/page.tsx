import { redirect } from "next/navigation";

/**
 * "Mis tareas" fue una pestaña de Mercado Libre hasta que pasó a ser un menú
 * propio, con una página por rol. Esto queda para que un favorito viejo no dé
 * 404.
 */
export default function TareasMeliViejaPage() {
  redirect("/tareas/mercado-libre");
}
