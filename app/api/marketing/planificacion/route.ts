import { NextResponse, type NextRequest } from "next/server";
import { permisoDelUsuario } from "@/lib/permisos";
import {
  borrarEvento,
  borrarIniciativa,
  ErrorDeDatos,
  guardarEvento,
  guardarIniciativa,
  leerPlan,
  marcarSubtarea,
} from "@/lib/queries-planificacion";
import { authConfigurada } from "@/lib/supabase/env";
import { getUsuario } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Marketing → Planificación: calendario, iniciativas y subtareas.
 *
 *   GET    ?desde=&hasta=                  plan del rango
 *   POST   { tipo: "iniciativa" | "evento", datos }            crear
 *   PATCH  { tipo: "iniciativa" | "evento", id, datos }        editar
 *   PATCH  { tipo: "subtarea", id, hecha }                     tildar
 *   DELETE ?tipo=iniciativa|evento&id=                         borrar
 *
 * Sólo el superadmin, igual que todo /marketing (lo vuelve a frenar el proxy
 * por prefijo, y acá de nuevo porque escribe).
 */
async function quienPuede(): Promise<string | null | false> {
  if (!authConfigurada) return "local";
  const quien = await getUsuario();
  if (permisoDelUsuario(quien)?.rol !== "superadmin") return false;
  return quien?.email ?? null;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function error(e: unknown, donde: string) {
  if (e instanceof ErrorDeDatos) return NextResponse.json({ error: e.message }, { status: 400 });
  const mensaje = e instanceof Error ? e.message : "Error desconocido";
  console.error(`[api/marketing/planificacion] ${donde}`, e);
  const sinTabla = /mkt_(iniciativas|subtareas|eventos)/.test(mensaje) && /does not exist|no existe/.test(mensaje);
  return NextResponse.json(
    {
      error: sinTabla ? "Falta crear las tablas: correr migraciones/marketing_planificacion.sql en Supabase." : mensaje,
    },
    { status: 500 },
  );
}

export async function GET(request: NextRequest) {
  if ((await quienPuede()) === false) return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  const desde = request.nextUrl.searchParams.get("desde") ?? "";
  const hasta = request.nextUrl.searchParams.get("hasta") ?? "";
  if (!ISO.test(desde) || !ISO.test(hasta)) {
    return NextResponse.json({ error: "Faltan desde y hasta (YYYY-MM-DD)" }, { status: 400 });
  }
  try {
    return NextResponse.json(await leerPlan(desde, hasta));
  } catch (e) {
    return error(e, "GET");
  }
}

type Cuerpo = { tipo?: string; id?: unknown; datos?: Record<string, unknown>; hecha?: unknown };

async function cuerpo(request: NextRequest): Promise<Cuerpo | null> {
  try {
    return (await request.json()) as Cuerpo;
  } catch {
    return null;
  }
}

const idValido = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v > 0 ? v : null);

export async function POST(request: NextRequest) {
  const usuario = await quienPuede();
  if (usuario === false) return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  const b = await cuerpo(request);
  if (!b?.datos) return NextResponse.json({ error: "Faltan los datos" }, { status: 400 });
  try {
    if (b.tipo === "iniciativa") return NextResponse.json({ id: await guardarIniciativa(b.datos, null, usuario) });
    if (b.tipo === "evento") return NextResponse.json({ id: await guardarEvento(b.datos, null, usuario) });
    return NextResponse.json({ error: "Tipo desconocido" }, { status: 400 });
  } catch (e) {
    return error(e, "POST");
  }
}

export async function PATCH(request: NextRequest) {
  const usuario = await quienPuede();
  if (usuario === false) return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  const b = await cuerpo(request);
  const id = idValido(b?.id);
  if (!b || !id) return NextResponse.json({ error: "Falta el id" }, { status: 400 });
  try {
    if (b.tipo === "subtarea") {
      await marcarSubtarea(id, b.hecha === true);
      return NextResponse.json({ ok: true });
    }
    if (!b.datos) return NextResponse.json({ error: "Faltan los datos" }, { status: 400 });
    if (b.tipo === "iniciativa") return NextResponse.json({ id: await guardarIniciativa(b.datos, id, usuario) });
    if (b.tipo === "evento") return NextResponse.json({ id: await guardarEvento(b.datos, id, usuario) });
    return NextResponse.json({ error: "Tipo desconocido" }, { status: 400 });
  } catch (e) {
    return error(e, "PATCH");
  }
}

export async function DELETE(request: NextRequest) {
  if ((await quienPuede()) === false) return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  const tipo = request.nextUrl.searchParams.get("tipo");
  const id = idValido(Number(request.nextUrl.searchParams.get("id")));
  if (!id) return NextResponse.json({ error: "Falta el id" }, { status: 400 });
  try {
    if (tipo === "iniciativa") await borrarIniciativa(id);
    else if (tipo === "evento") await borrarEvento(id);
    else return NextResponse.json({ error: "Tipo desconocido" }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return error(e, "DELETE");
  }
}
