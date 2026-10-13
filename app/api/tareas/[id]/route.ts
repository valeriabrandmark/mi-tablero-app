import { NextResponse, type NextRequest } from "next/server";
import {
  borrarTarea,
  cambiarEstado,
  editarTarea,
  postergarTarea,
} from "@/lib/queries-tareas";
import { ESTADOS, validarTarea, type Tarea } from "@/lib/tareas";
import { duenioDeTareas, errorInterno } from "@/lib/tareas-servidor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Cambiar una tarea. Una sola cosa por pedido, según lo que traiga el cuerpo:
 *
 *   { estado: "hecha" }        arrancar, terminar, cancelar, reabrir
 *   { postergar: 60 }          correrla N minutos (cuenta como postergación)
 *   { tarea: {...} }           editar los datos
 */
export async function PATCH(request: NextRequest, ctx: RouteContext<"/api/tareas/[id]">) {
  const { usuario, rechazo } = await duenioDeTareas();
  if (rechazo) return rechazo;

  const { id } = await ctx.params;
  if (!/^\d+$/.test(id)) return NextResponse.json({ error: "Id inválido" }, { status: 400 });

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;

  try {
    let tarea: Tarea | null;
    if (body?.estado !== undefined) {
      const estado = ESTADOS.find((e) => e === body.estado);
      if (!estado) return NextResponse.json({ error: "Estado inválido" }, { status: 400 });
      tarea = await cambiarEstado(usuario, id, estado);
    } else if (body?.postergar !== undefined) {
      const minutos = Number(body.postergar);
      if (!Number.isInteger(minutos) || minutos < 1 || minutos > 60 * 24 * 60) {
        return NextResponse.json({ error: "Postergación inválida" }, { status: 400 });
      }
      tarea = await postergarTarea(usuario, id, minutos);
    } else {
      const v = validarTarea(body?.tarea);
      if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
      tarea = await editarTarea(usuario, id, v.valor);
    }
    if (!tarea) return NextResponse.json({ error: "No existe" }, { status: 404 });
    return NextResponse.json({ tarea });
  } catch (error) {
    return errorInterno("PATCH", error);
  }
}

export async function DELETE(_: NextRequest, ctx: RouteContext<"/api/tareas/[id]">) {
  const { usuario, rechazo } = await duenioDeTareas();
  if (rechazo) return rechazo;

  const { id } = await ctx.params;
  if (!/^\d+$/.test(id)) return NextResponse.json({ error: "Id inválido" }, { status: 400 });

  try {
    if (!(await borrarTarea(usuario, id))) {
      return NextResponse.json({ error: "No existe" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorInterno("DELETE", error);
  }
}
