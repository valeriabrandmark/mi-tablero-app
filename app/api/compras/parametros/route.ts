import { NextResponse } from "next/server";
import {
  esClaveParametro,
  parametrosPorDefecto,
  type ClaveParametro,
} from "@/lib/compras-parametros";
import {
  enConstruccion,
  permisoDelUsuario,
  puedeEditar,
  puedeVer,
  puedeVerBorradores,
} from "@/lib/permisos";
import {
  getHistorialParametros,
  getParametrosCompras,
  guardarParametrosCompras,
} from "@/lib/queries-parametros-compras";
import { authConfigurada } from "@/lib/supabase/env";
import { getUsuario } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Las reglas del sugerido de Compras.
 *
 * LEER, cualquiera que vea Compras: la pantalla tiene que poder explicar con
 * qué números calculó. ESCRIBIR, sólo quien puede editar Compras: estas reglas
 * cambian el sugerido de TODOS, no el de quien las toca.
 */

type Acceso = { usuario: string; puedeEditar: boolean } | { error: NextResponse };

async function acceso(): Promise<Acceso> {
  if (!authConfigurada) return { usuario: "local", puedeEditar: true };

  const u = await getUsuario();
  const permiso = permisoDelUsuario(u);
  if (!puedeVer(permiso, "/api/compras")) {
    return { error: NextResponse.json({ error: "Sin permiso" }, { status: 403 }) };
  }
  if (enConstruccion("/stock/compras") && !puedeVerBorradores(permiso)) {
    return { error: NextResponse.json({ error: "En construcción" }, { status: 403 }) };
  }
  return {
    usuario: u?.email ?? u?.id ?? "",
    puedeEditar: puedeEditar(permiso, "compras", u?.email),
  };
}

export async function GET() {
  const a = await acceso();
  if ("error" in a) return a.error;
  try {
    const [parametros, historial] = await Promise.all([
      getParametrosCompras(),
      getHistorialParametros(),
    ]);
    return NextResponse.json({
      parametros,
      porDefecto: parametrosPorDefecto(),
      historial,
      puedeEditar: a.puedeEditar,
    });
  } catch (error) {
    console.error("[api/compras/parametros]", error);
    const mensaje = error instanceof Error ? error.message : "Error desconocido";
    return NextResponse.json({ error: mensaje }, { status: 500 });
  }
}

/**
 * Cuerpo: `{ cambios: { clave: número | null } }`. `null` vuelve al valor por
 * defecto. Las claves que no existen se ignoran; los números se recortan a su
 * rango (ver `valorValido`).
 */
export async function PUT(request: Request) {
  const a = await acceso();
  if ("error" in a) return a.error;
  if (!a.puedeEditar || !a.usuario) {
    return NextResponse.json(
      { error: "Sin permiso para cambiar las reglas de Compras" },
      { status: 403 },
    );
  }

  let cuerpo: unknown;
  try {
    cuerpo = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }
  const crudos = (cuerpo as { cambios?: unknown } | null)?.cambios;
  if (!crudos || typeof crudos !== "object") {
    return NextResponse.json({ error: "Faltan los cambios" }, { status: 400 });
  }

  const cambios: Partial<Record<ClaveParametro, number | null>> = {};
  for (const [k, v] of Object.entries(crudos)) {
    if (!esClaveParametro(k)) continue;
    if (v === null) cambios[k] = null;
    else if (typeof v === "number" && Number.isFinite(v)) cambios[k] = v;
  }

  try {
    const parametros = await guardarParametrosCompras(a.usuario, cambios);
    return NextResponse.json({ parametros, historial: await getHistorialParametros() });
  } catch (error) {
    console.error("[api/compras/parametros PUT]", error);
    const mensaje = error instanceof Error ? error.message : "Error desconocido";
    return NextResponse.json({ error: mensaje }, { status: 500 });
  }
}
