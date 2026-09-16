import { NextResponse, type NextRequest } from "next/server";
import {
  exigirSuperadmin,
  rutaParaPonerContrasena,
} from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Un enlace nuevo para que alguien ponga su contraseña.
 *
 * POR QUÉ HACE FALTA, además del que sale al crear el usuario: ese enlace vence
 * y sirve una sola vez. Sin esto, la persona que no llegó a usarlo a tiempo
 * depende de que el mail de "¿Olvidaste tu contraseña?" salga y llegue — y si
 * el proyecto no tiene el correo configurado, no hay forma de rescatarla desde
 * la pantalla.
 *
 * Genera uno nuevo, que invalida el anterior. Eso es lo correcto: si el viejo
 * se filtró por donde sea, deja de servir en el momento en que se pide otro.
 */
export async function POST(request: NextRequest) {
  const { error, cliente } = await exigirSuperadmin();
  if (error) return error;

  const cuerpo = ((await request.json().catch(() => null)) ?? {}) as {
    email?: unknown;
  };
  const email =
    typeof cuerpo.email === "string" ? cuerpo.email.trim().toLowerCase() : "";
  if (!email)
    return NextResponse.json({ error: "Falta el mail" }, { status: 400 });

  const ruta = await rutaParaPonerContrasena(cliente, email);
  if (!ruta) {
    return NextResponse.json(
      { error: "No se pudo generar el enlace. Probá de nuevo en un minuto." },
      { status: 502 },
    );
  }
  return NextResponse.json({ ruta });
}
