import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { permisoDelUsuario } from "@/lib/permisos";
import { authConfigurada, SUPABASE_URL } from "@/lib/supabase/env";
import { getUsuario } from "@/lib/supabase/server";

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

/**
 * El portero de todo lo que administra usuarios: devuelve el cliente con la
 * llave de servicio, o la respuesta de error que corresponda.
 *
 * Vive acá y no en una ruta para que las dos --permisos y enlace de acceso--
 * usen LA MISMA comprobación. Dos copias de un chequeo de seguridad es una que
 * alguien va a olvidarse de actualizar.
 */
export async function exigirSuperadmin(): Promise<
  | { error: NextResponse; cliente?: never; yo?: never }
  | { error?: never; cliente: SupabaseClient; yo: string | null }
> {
  if (!authConfigurada) {
    return {
      error: NextResponse.json(
        { error: "Login no configurado" },
        { status: 503 },
      ),
    };
  }

  const usuario = await getUsuario();
  if (permisoDelUsuario(usuario)?.rol !== "superadmin") {
    return {
      error: NextResponse.json({ error: "Sin permiso" }, { status: 403 }),
    };
  }

  if (!adminConfigurado) {
    return {
      error: NextResponse.json(
        {
          error:
            "Falta la llave de servicio de Supabase. Cargá SUPABASE_SERVICE_ROLE_KEY " +
            "en Vercel → Settings → Environment Variables y volvé a desplegar.",
        },
        { status: 503 },
      ),
    };
  }

  return { cliente: createAdminClient(), yo: usuario?.id ?? null };
}

/**
 * El enlace para que alguien ponga su contraseña, relativo a este tablero.
 *
 * Apunta a `/auth/confirmar` --la misma ruta que "¿Olvidaste tu contraseña?"--
 * y NO al `action_link` que devuelve Supabase. Ese consume el token al abrirlo
 * y después redirige a la "Site URL" del proyecto, que estaba en localhost: el
 * token se quemaba en el viaje y el segundo intento decía `otp_expired`.
 *
 * Devuelve la ruta sola; el origen lo pone el navegador, que es el único que
 * sabe con certeza desde qué dirección se está usando el tablero.
 */
export async function rutaParaPonerContrasena(
  cliente: SupabaseClient,
  email: string,
): Promise<string | null> {
  const { data } = await cliente.auth.admin.generateLink({
    type: "recovery",
    email,
  });
  const hash = data?.properties?.hashed_token;
  return hash
    ? `/auth/confirmar?token_hash=${encodeURIComponent(hash)}` +
        "&type=recovery&next=/nueva-contrasena"
    : null;
}
