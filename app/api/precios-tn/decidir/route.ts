import { NextResponse, type NextRequest } from "next/server";
import { enConstruccion, permisoDelUsuario, puedeVer, puedeVerBorradores } from "@/lib/permisos";
import { aprobarFiltradas, decidirPropuesta } from "@/lib/queries-precios-tn";
import { leerFiltros } from "@/lib/precios-tn";
import { authConfigurada } from "@/lib/supabase/env";
import { getUsuario } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Aprobar o rechazar propuestas. LO ÚNICO QUE ESTA APLICACIÓN ESCRIBE.
 *
 * NO TOCA TIENDA NUBE, y no puede: cambia `estado` en filas de Postgres y nada
 * más. La escritura del precio la hace el workflow del proyecto `precios` con
 * un token que esta aplicación no tiene. Por eso una sesión robada del tablero
 * no puede publicar un precio — lo peor que puede hacer es aprobar algo, que
 * queda firmado con el mail de quien lo hizo.
 *
 * Dos formas de pedirlo:
 *
 *   { id, decision }        una propuesta.
 *   { todas: true, ...f }   todo lo que cumple el filtro `f`.
 *
 * EL BLOQUE VIAJA COMO FILTRO Y NO COMO LISTA DE IDs, a propósito. Si el
 * navegador mandara los IDs, estaría aprobando lo que su pantalla recordaba —
 * que puede ser de hace media hora, de antes de que otra persona decidiera la
 * mitad. Mandando el filtro, el servidor vuelve a resolver "todo lo de esta
 * marca" contra la base de ahora, que es lo que la persona quiso decir.
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

  if (cuerpo?.todas === true) {
    const filtros = leerFiltros(new URLSearchParams(cuerpo?.filtros ?? {}));
    const total = await aprobarFiltradas(filtros, quien);
    return NextResponse.json({ ok: true, aprobadas: total, quien });
  }

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
