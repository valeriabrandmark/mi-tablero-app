import ActualizarCostos from "@/components/ActualizarCostos";
import { Panel } from "@/components/ui";
import { permisoDelUsuario } from "@/lib/permisos";
import { authConfigurada } from "@/lib/supabase/env";
import { getUsuario } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Actualizar costos — Tablero Brandmark" };

/**
 * Actualizar los costos sin pasar por el Excel.
 *
 * El permiso se decide en el servidor y lo vuelve a pedir la API: acá es para
 * no pintar una pantalla que va a contestar 403.
 */
export default async function CostosPage() {
  const usuario = authConfigurada ? await getUsuario() : null;
  if (authConfigurada && permisoDelUsuario(usuario)?.rol !== "superadmin") {
    return (
      <div className="max-w-2xl">
        <Panel titulo="Actualizar costos">
          <p className="text-muted text-sm">
            Esta pantalla cambia el costo del que sale el margen de todo el
            tablero, y la ve una sola persona.
          </p>
        </Panel>
      </div>
    );
  }
  return <ActualizarCostos />;
}
