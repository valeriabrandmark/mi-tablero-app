import { NextResponse, type NextRequest } from "next/server";
import { enConstruccion, permisoDelUsuario, puedeVer, puedeVerBorradores } from "@/lib/permisos";
import { decidirPropuesta } from "@/lib/queries-precios-tn";
import { authConfigurada } from "@/lib/supabase/env";
import { getUsuario } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Aprobar o rechazar una propuesta. LO ÚNICO QUE ESTA APLICACIÓN ESCRIBE.
 *
 * NO TOCA TIENDA NUBE, y no puede: cambia `estado` en una fila de Postgres y
 * nada más. La escritura del precio la hace el workflow del proyecto `precios`
 * con un token que esta aplicación no tiene. Por eso una sesión robada del
 * tablero no puede publicar un precio — lo peor que puede hacer es aprobar
 * algo, que queda firmado con el mail de quien lo hizo.
 */
export async function POST(request: NextRequest) {
  let quien = "desconocido";

  if (authConfigurada) {
    const usuario = await getUsuario();
    const permiso = permisoDelUsuario(usuario);
    if (!puedeVer(permiso, "/api/precios-tn")) {
      return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
    }
    if (enConstruccion("/precios-tn") && !puedeVerBorradores(permiso)) {
      return NextResponse.json({ error: "En construcción" }, { status: 403 });
    }
    quien = usuario?.email ?? "sin email";
  }

  const cuerpo = await request.json().catch(() => null);
  const id = Number(cuerpo?.id);
  const decision = cuerpo?.decision;

  if (!Number.isInteger(id) || (decision !== "aprobada" && decision !== "rechazada")) {
    return NextResponse.json({ error: "Pedido inválido" }, { status: 400 });
  }

  const cambio = await decidirPropuesta(id, decision, quien);
  if (!cambio) {
    // La propuesta ya no estaba pendiente. No es un error del servidor: alguien
    // la decidió antes, y la pantalla tiene que decirlo en vez de fingir que
    // funcionó.
    return NextResponse.json(
      { error: "Esa propuesta ya fue decidida por otra persona." },
      { status: 409 },
    );
  }
  return NextResponse.json({ ok: true, id, decision, quien });
}
