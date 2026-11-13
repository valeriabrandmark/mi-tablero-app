import { NextResponse, type NextRequest } from "next/server";
import { TABLAS, type ClaveTabla, type Fila } from "@/lib/marketing-carga";
import { permisoDelUsuario } from "@/lib/permisos";
import { borrar, ErrorCarga, guardar, leerCarga, leerHistorial, type Extra } from "@/lib/queries-carga";
import { authConfigurada } from "@/lib/supabase/env";
import { getUsuario } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Marketing → Carga: colaboraciones, influencers, envíos, gastos,
 * presupuesto y contenido, con sus canjes de SIGMA.
 *
 *   GET                                   todo
 *   GET    ?historial=<tabla>&id=<id>     los cambios de un registro
 *   POST   { tabla, datos, extra? }       alta
 *   PATCH  { tabla, id, datos, extra? }   cambio
 *   DELETE ?tabla=&id=                    baja (queda en el historial)
 *
 * Sólo el superadmin, como todo /marketing.
 */
async function quienPuede(): Promise<string | null | false> {
  if (!authConfigurada) return "local";
  const quien = await getUsuario();
  if (permisoDelUsuario(quien)?.rol !== "superadmin") return false;
  return quien?.email ?? null;
}

const esTabla = (t: unknown): t is ClaveTabla => typeof t === "string" && t in TABLAS;
const idValido = (v: unknown) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

function error(e: unknown, donde: string) {
  if (e instanceof ErrorCarga) return NextResponse.json({ error: e.message }, { status: 400 });
  console.error(`[api/marketing/carga] ${donde}`, e);
  return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
}

export async function GET(request: NextRequest) {
  if ((await quienPuede()) === false) return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  const sp = request.nextUrl.searchParams;
  try {
    const t = sp.get("historial");
    if (t) {
      const id = idValido(sp.get("id"));
      if (!esTabla(t) || !id) return NextResponse.json({ error: "Tabla o id inválido" }, { status: 400 });
      return NextResponse.json({ historial: await leerHistorial(t, id) });
    }
    return NextResponse.json(await leerCarga());
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    if (/mkt_/.test(m) && /does not exist|no existe/.test(m)) {
      return NextResponse.json({ error: "Falta correr migraciones/marketing_carga.sql en Supabase" }, { status: 500 });
    }
    return error(e, "GET");
  }
}

type Cuerpo = { tabla?: unknown; id?: unknown; datos?: Fila; extra?: Extra };

async function leer(request: NextRequest): Promise<Cuerpo | null> {
  try {
    return (await request.json()) as Cuerpo;
  } catch {
    return null;
  }
}

function extraLimpio(e: Extra | undefined): Extra {
  if (!e || typeof e !== "object") return {};
  return {
    productos: Array.isArray(e.productos) ? e.productos.slice(0, 100) : undefined,
    comprobantes: Array.isArray(e.comprobantes)
      ? e.comprobantes.filter((c) => typeof c === "string" && c.length < 40).slice(0, 100)
      : undefined,
  };
}

export async function POST(request: NextRequest) {
  const usuario = await quienPuede();
  if (usuario === false) return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  const b = await leer(request);
  if (!b || !esTabla(b.tabla) || !b.datos) return NextResponse.json({ error: "Faltan los datos" }, { status: 400 });
  try {
    return NextResponse.json({ id: await guardar(b.tabla, null, b.datos, usuario, extraLimpio(b.extra)) });
  } catch (e) {
    return error(e, "POST");
  }
}

export async function PATCH(request: NextRequest) {
  const usuario = await quienPuede();
  if (usuario === false) return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  const b = await leer(request);
  const id = idValido(b?.id);
  if (!b || !esTabla(b.tabla) || !b.datos || !id) return NextResponse.json({ error: "Faltan los datos" }, { status: 400 });
  try {
    return NextResponse.json({ id: await guardar(b.tabla, id, b.datos, usuario, extraLimpio(b.extra)) });
  } catch (e) {
    return error(e, "PATCH");
  }
}

export async function DELETE(request: NextRequest) {
  const usuario = await quienPuede();
  if (usuario === false) return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  const t = request.nextUrl.searchParams.get("tabla");
  const id = idValido(request.nextUrl.searchParams.get("id"));
  if (!esTabla(t) || !id) return NextResponse.json({ error: "Tabla o id inválido" }, { status: 400 });
  try {
    await borrar(t, id, usuario);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return error(e, "DELETE");
  }
}
