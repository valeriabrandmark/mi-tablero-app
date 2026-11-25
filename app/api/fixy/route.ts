import { NextResponse } from "next/server";
import { fixyConfigurado } from "@/lib/fixy-api";
import {
  enConstruccion,
  permisoDelUsuario,
  puedeEditar,
  puedeVer,
  puedeVerBorradores,
} from "@/lib/permisos";
import { getDashboardFixy } from "@/lib/queries-fixy";
import { authConfigurada } from "@/lib/supabase/env";
import { getUsuario } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Datos de Stock > FIXY. */
export async function GET() {
  let puedeAvisar = !authConfigurada;
  if (authConfigurada) {
    const usuario = await getUsuario();
    const permiso = permisoDelUsuario(usuario);
    if (!puedeVer(permiso, "/api/fixy")) {
      return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
    }
    if (enConstruccion("/stock/fixy") && !puedeVerBorradores(permiso)) {
      return NextResponse.json({ error: "En construcción" }, { status: 403 });
    }
    puedeAvisar = puedeEditar(permiso, "stock", usuario?.email);
  }

  try {
    const data = await getDashboardFixy();
    return NextResponse.json({
      ...data,
      puedeAvisar,
      apiConfigurada: fixyConfigurado(),
    });
  } catch (e) {
    console.error("[/api/fixy]", e);
    return NextResponse.json({ error: "No se pudo consultar" }, { status: 500 });
  }
}
