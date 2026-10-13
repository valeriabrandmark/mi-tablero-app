import { NextResponse, type NextRequest } from "next/server";
import { frenarRecurrencia } from "@/lib/queries-tareas";
import { duenioDeTareas, errorInterno } from "@/lib/tareas-servidor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Dejar de repetir una tarea. No borra el historial: desactiva la regla y saca
 * del calendario sólo las ocurrencias futuras que nadie tocó.
 *
 * Para CAMBIAR una regla (otro día, otra hora) se frena y se crea otra: así lo
 * ya generado no queda mitad con la regla vieja y mitad con la nueva.
 */
export async function DELETE(
  _: NextRequest,
  ctx: RouteContext<"/api/tareas/recurrentes/[id]">,
) {
  const { usuario, rechazo } = await duenioDeTareas();
  if (rechazo) return rechazo;

  const { id } = await ctx.params;
  if (!/^\d+$/.test(id)) return NextResponse.json({ error: "Id inválido" }, { status: 400 });

  try {
    if (!(await frenarRecurrencia(usuario, id))) {
      return NextResponse.json({ error: "No existe" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorInterno("DELETE recurrente", error);
  }
}
