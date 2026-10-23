import TareasMeli from "@/components/TareasMeli";
import { permisoDelUsuario, puedeEditar } from "@/lib/permisos";
import { authConfigurada } from "@/lib/supabase/env";
import { getUsuario } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata = { title: "Mis tareas · Mercado Libre — Tablero Brandmark" };

/**
 * La bandeja del responsable de Mercado Libre. La ve todo el que ve Mercado
 * Libre; contestar, sólo quien puede editar el módulo (`puedeEditar`).
 *
 * `puedeContestar` es SÓLO para no dibujar botones que no van a andar. Quien
 * decide es la API, que vuelve a mirar el permiso en cada respuesta.
 */
export default async function TareasMeliPage() {
  let puedeContestar = true;
  if (authConfigurada) {
    const u = await getUsuario();
    puedeContestar = puedeEditar(permisoDelUsuario(u), "meli", u?.email);
  }
  return <TareasMeli puedeContestar={puedeContestar} />;
}
