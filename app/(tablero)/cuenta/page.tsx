import FormularioCambiarContrasena from "@/components/FormularioCambiarContrasena";
import { Panel } from "@/components/ui";
import { authConfigurada } from "@/lib/supabase/env";
import { getUsuario } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Mi cuenta — Tablero Brandmark" };

export default async function CuentaPage() {
  const usuario = authConfigurada ? await getUsuario() : null;

  return (
    <div className="max-w-2xl space-y-4">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Mi cuenta</h1>
        {usuario?.email && <p className="text-muted mt-1 text-xs">{usuario.email}</p>}
      </div>

      <Panel titulo="Cambiar contraseña" nota="Se pide la actual para confirmar que sos vos">
        {usuario?.email ? (
          <FormularioCambiarContrasena email={usuario.email} />
        ) : (
          <p className="text-muted text-sm">
            El login no está configurado, así que no hay contraseña que cambiar.
          </p>
        )}
      </Panel>
    </div>
  );
}
