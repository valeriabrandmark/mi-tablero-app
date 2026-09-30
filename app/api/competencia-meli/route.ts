import { NextResponse, type NextRequest } from "next/server";
import { permisoDelUsuario, puedeVer } from "@/lib/permisos";
import { getDashboardCompetencia, getRivales } from "@/lib/queries-competencia-meli";
import { authConfigurada } from "@/lib/supabase/env";
import { getUsuario } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Datos de "Mercado Libre — Competencia".
 *
 * Sin parámetros: una fila por publicación de catálogo. Con `?producto=`: las
 * publicaciones de todos los vendedores en ese producto, que se piden al abrir
 * una fila y no todas juntas (son miles y casi nadie abre más de un par).
 */
export async function GET(request: NextRequest) {
  if (authConfigurada) {
    const permiso = permisoDelUsuario(await getUsuario());
    if (!puedeVer(permiso, "/api/competencia-meli")) {
      return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
    }
  }

  const producto = request.nextUrl.searchParams.get("producto");
  try {
    if (producto != null) {
      // Un id de catálogo de ML: letras y números. Cualquier otra cosa no llega
      // a la consulta.
      if (!/^[A-Z0-9]{3,30}$/.test(producto)) {
        return NextResponse.json({ error: "Producto inválido" }, { status: 400 });
      }
      return NextResponse.json({ rivales: await getRivales(producto) });
    }
    return NextResponse.json(await getDashboardCompetencia());
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : "Error desconocido";
    console.error("[api/competencia-meli]", error);
    return NextResponse.json({ error: mensaje }, { status: 500 });
  }
}
