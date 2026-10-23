import MisTareasMeli from "@/components/MisTareasMeli";
import { permisoDelUsuario, puedeEditar } from "@/lib/permisos";
import { authConfigurada } from "@/lib/supabase/env";
import { getUsuario } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata = { title: "Mis tareas · Mercado Libre — Tablero Brandmark" };

/**
 * Las tareas del responsable de Mercado Libre, en el menú "Mis tareas" (ver
 * lib/tareas.ts): su rutina diaria y las alertas que tiene que contestar. La ve todo el que ve Mercado Libre; completarla y
 * contestar, sólo quien puede editar el módulo (`puedeEditar`).
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
  return (
    <>
      <h1 className="mb-4 text-lg font-semibold tracking-tight">Mis tareas · Mercado Libre</h1>
      <MisTareasMeli puedeContestar={puedeContestar} />
    </>
  );
}
