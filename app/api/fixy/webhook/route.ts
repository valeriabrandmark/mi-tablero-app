import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { query } from "@/lib/db";
import { leerEvento } from "@/lib/fixy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Los avisos de cambio de estado de las guías de FIXY.
 *
 * FIXY no tiene un listado de envíos por fecha, así que esta es la única forma
 * de tener la historia de despachos. Se registra una vez en FIXY
 * (`integracion.json`, con `url` apuntando acá y `token` = FIXY_WEBHOOK_TOKEN)
 * y desde ahí FIXY manda un POST por cada cambio:
 *
 *   { "usuario": "...", "token": "...", "estado": "Entregada",
 *     "codigo_estado": "ENT", "remito": "255", "guia": 220 }
 *
 * NO LLEVA SESION (ver lib/rutas-sin-sesion.ts): la llave es el `token` del
 * cuerpo. Sin FIXY_WEBHOOK_TOKEN configurada se niega todo.
 *
 * FIXY espera un 200 para dar el aviso por recibido.
 */
function tokenValido(recibido: string | null): boolean {
  const esperado = process.env.FIXY_WEBHOOK_TOKEN;
  if (!esperado || !recibido) return false;
  // Hash y comparación en tiempo constante: ver /api/precios-tn/planilla.
  const a = createHash("sha256").update(recibido).digest();
  const b = createHash("sha256").update(esperado).digest();
  return timingSafeEqual(a, b);
}

export async function POST(request: NextRequest) {
  const cuerpo = await request.json().catch(() => null);
  const evento = leerEvento(cuerpo);

  if (!tokenValido(evento.token)) {
    return NextResponse.json({ error: "Token inválido" }, { status: 401 });
  }
  if (!evento.guia && !evento.remito) {
    return NextResponse.json({ error: "Falta guía o remito" }, { status: 400 });
  }

  // El cuerpo se guarda sin el token: no tiene por qué quedar en la base.
  const guardado = { ...(cuerpo as Record<string, unknown>) };
  delete guardado.token;

  try {
    await query(
      `insert into app.fixy_eventos (guia, remito, estado, codigo_estado, cuerpo)
       values ($1, $2, $3, $4, $5::jsonb)`,
      [evento.guia, evento.remito, evento.estado, evento.codigoEstado, JSON.stringify(guardado)],
    );
  } catch (e) {
    // Un 500 hace que FIXY lo reintente (si reintenta): mejor que perderlo.
    console.error("[/api/fixy/webhook]", e);
    return NextResponse.json({ error: "No se pudo guardar" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
