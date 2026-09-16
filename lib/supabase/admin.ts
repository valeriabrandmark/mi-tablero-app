import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "@/lib/supabase/env";

/**
 * Cliente de Supabase con la llave de servicio. SÓLO PARA EL SERVIDOR.
 *
 * ---------------------------------------------------------------------------
 * QUÉ ES ESTA LLAVE Y POR QUÉ DA MIEDO
 *
 * `SUPABASE_SERVICE_ROLE_KEY` se saltea TODAS las reglas de la base: puede leer
 * y escribir cualquier tabla, crear usuarios y cambiarles los permisos. Es, en
 * los hechos, la llave del sistema entero.
 *
 * Por eso:
 *
 *   - se lee de `process.env` SIN el prefijo NEXT_PUBLIC_, que es lo que hace
 *     que Next NO la mande al navegador. Si alguien la renombra con ese
 *     prefijo, queda publicada en el JavaScript de la página;
 *   - este archivo no se importa desde ningún componente de cliente. Lo usa la
 *     ruta /api/usuarios y nada más;
 *   - la ruta que la usa chequea que quien pide sea `superadmin` ANTES de
 *     tocarla.
 *
 * Se carga en Vercel → Settings → Environment Variables, y sale de
 * Supabase → Project Settings → API → service_role.
 */

const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

/** `false` si todavía no se cargó la llave: el panel lo dice en vez de fallar. */
export const adminConfigurado = Boolean(SUPABASE_URL && SERVICE_ROLE);

export function createAdminClient() {
  if (!adminConfigurado) {
    throw new Error(
      "Falta SUPABASE_SERVICE_ROLE_KEY. Se carga en Vercel → Settings → " +
        "Environment Variables, y sale de Supabase → Project Settings → API.",
    );
  }
  return createClient(SUPABASE_URL, SERVICE_ROLE, {
    // Este cliente no vive en un navegador: no tiene sesión que refrescar ni
    // dónde guardarla, y dejarlo intentar sólo agrega ruido en los logs.
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
