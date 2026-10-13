import { NextResponse, type NextRequest } from "next/server";
import {
  crearRecurrencia,
  crearTarea,
  listarRecurrencias,
  listarTareas,
} from "@/lib/queries-tareas";
import { validarRecurrencia, validarTarea } from "@/lib/tareas";
import { duenioDeTareas, errorInterno } from "@/lib/tareas-servidor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Las tareas de un rango (`?desde=…&hasta=…`, ISO) y las reglas que se repiten.
 *
 * Sin rango devuelve las de los últimos 35 días y los próximos 35: alcanza para
 * cualquier mes que se esté mirando y para el resumen del mes.
 */
export async function GET(request: NextRequest) {
  const { usuario, rechazo } = await duenioDeTareas();
  if (rechazo) return rechazo;

  const p = request.nextUrl.searchParams;
  const ahora = Date.now();
  const desde = new Date(p.get("desde") ?? ahora - 35 * 86_400_000);
  const hasta = new Date(p.get("hasta") ?? ahora + 35 * 86_400_000);
  if (Number.isNaN(desde.getTime()) || Number.isNaN(hasta.getTime())) {
    return NextResponse.json({ error: "Rango inválido" }, { status: 400 });
  }

  try {
    const [tareas, recurrencias] = await Promise.all([
      listarTareas(usuario, desde.toISOString(), hasta.toISOString()),
      listarRecurrencias(usuario),
    ]);
    return NextResponse.json({ tareas, recurrencias });
  } catch (error) {
    return errorInterno("GET", error);
  }
}

/**
 * Crear una tarea suelta (`{ tarea: {...} }`) o una regla que se repite
 * (`{ recurrencia: {...} }`).
 */
export async function POST(request: NextRequest) {
  const { usuario, rechazo } = await duenioDeTareas();
  if (rechazo) return rechazo;

  const body = (await request.json().catch(() => null)) as {
    tarea?: unknown;
    recurrencia?: unknown;
  } | null;

  try {
    if (body?.recurrencia) {
      const v = validarRecurrencia(body.recurrencia);
      if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
      return NextResponse.json({ recurrencia: await crearRecurrencia(usuario, v.valor) });
    }
    const v = validarTarea(body?.tarea);
    if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
    return NextResponse.json({ tarea: await crearTarea(usuario, v.valor) });
  } catch (error) {
    return errorInterno("POST", error);
  }
}
