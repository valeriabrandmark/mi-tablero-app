import PanelUsuarios from "@/components/PanelUsuarios";
import { Panel } from "@/components/ui";
import { permisoDelUsuario } from "@/lib/permisos";
import { authConfigurada } from "@/lib/supabase/env";
import { getUsuario } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Usuarios — Tablero Brandmark" };

/**
 * Quién entra al tablero, qué ve y qué puede editar.
 *
 * ---------------------------------------------------------------------------
 * POR QUE SALIO DE "MI CUENTA"
 *
 * Son dos cosas distintas que estaban en la misma página. "Mi cuenta" es la
 * contraseña de uno y la ve cualquiera; esto reparte el acceso a todo el
 * tablero y lo ve una sola persona. Mezclados, repartir permisos parecía un
 * ajuste de perfil — y había que pasar por la pantalla de la propia contraseña
 * para llegar.
 *
 * ---------------------------------------------------------------------------
 * EL PERMISO SE DECIDE EN EL SERVIDOR, Y NO SOLO ACA
 *
 * Esconder la página desde el cliente sería cosmética. El chequeo que importa
 * es el de `/api/usuarios`, que vuelve a pedir `superadmin` antes de tocar la
 * llave de servicio. Esto es para no pintar una pantalla que va a contestar
 * 403, y `puedeVer` la cierra igual en el proxy.
 */
export default async function UsuariosPage() {
  const usuario = authConfigurada ? await getUsuario() : null;
  const esSuperadmin = permisoDelUsuario(usuario)?.rol === "superadmin";

  if (!esSuperadmin) {
    return (
      <div className="max-w-2xl">
        <Panel titulo="Usuarios">
          <p className="text-muted text-sm">
            Esta pantalla reparte el acceso al tablero y la ve una sola persona.
          </p>
        </Panel>
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-4">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Usuarios</h1>
        <p className="text-muted mt-1 text-xs">
          Quién entra al tablero, qué ve y qué puede editar
        </p>
      </div>

      <Panel titulo="Usuarios">
        <PanelUsuarios />
      </Panel>
    </div>
  );
}
