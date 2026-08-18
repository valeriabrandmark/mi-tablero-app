import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { authConfigurada } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Canjea el link del mail por una sesión.
 *
 * Soporta los DOS formatos de link que puede mandar Supabase, porque cuál de
 * ellos llega depende de la plantilla de mail del proyecto y no del código:
 *
 *   - `?code=...`                  flujo PKCE  -> exchangeCodeForSession
 *   - `?token_hash=...&type=...`   link de mail -> verifyOtp
 *
 * Soportar los dos sale una línea y evita el clásico "anda en un proyecto y en
 * otro no" cuando alguien toca las plantillas.
 *
 * Después redirige a `next`, que siempre se valida: un `next` con URL absoluta
 * convertiría esto en un redirect abierto, útil para phishing.
 */
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const crudo = sp.get("next") ?? "/nueva-contrasena";
  // Solo rutas internas: "/algo", nunca "//host" ni "https://host".
  const next = crudo.startsWith("/") && !crudo.startsWith("//") ? crudo : "/nueva-contrasena";

  const aLogin = (motivo: string) => {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?error=${encodeURIComponent(motivo)}`;
    return NextResponse.redirect(url);
  };

  if (!authConfigurada) return aLogin("auth-no-configurada");

  const supabase = await createClient();

  const code = sp.get("code");
  const tokenHash = sp.get("token_hash");
  const tipo = sp.get("type") as EmailOtpType | null;

  if (code) {
    const flowId = sp.get("sb_flow_id");
    const { error } = await supabase.auth.exchangeCodeForSession(
      code,
      flowId ? { flowId } : undefined,
    );
    if (error) {
      console.error("[auth/confirmar] exchangeCodeForSession:", error.message);
      return aLogin("link-vencido");
    }
  } else if (tokenHash && tipo) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: tipo });
    if (error) {
      console.error("[auth/confirmar] verifyOtp:", error.message);
      return aLogin("link-vencido");
    }
  } else {
    return aLogin("link-invalido");
  }

  const url = request.nextUrl.clone();
  url.pathname = next;
  url.search = "";
  return NextResponse.redirect(url);
}
