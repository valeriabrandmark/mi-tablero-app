import { NextResponse } from "next/server";
import {
  enConstruccion,
  permisoDelUsuario,
  puedeVer,
  puedeVerBorradores,
} from "@/lib/permisos";
import { getOrdenesEnviadas } from "@/lib/queries-ordenes";
import { authConfigurada } from "@/lib/supabase/env";
import { getUsuario } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * El historial de órdenes mandadas al ERP.
 *
 * MIRA MÁS GENTE DE LA QUE PUEDE MANDAR, y es a propósito. Escribir en el ERP
 * es `superadmin`; leer qué se compró es la misma información que ya muestra
 * Compras --SKU, cantidades, costos-- para todo el que tiene la sección. Un
 * historial que sólo ve quien lo escribió no sirve para lo que se pidió: poder
 * comparar contra lo que se mandó la vez pasada.
 */
export async function GET() {
  if (authConfigurada) {
    const permiso = permisoDelUsuario(await getUsuario());
    if (!puedeVer(permiso, "/api/compras")) {
      return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
    }
    if (enConstruccion("/stock/compras") && !puedeVerBorradores(permiso)) {
      return NextResponse.json({ error: "En construcción" }, { status: 403 });
    }
  }

  try {
    return NextResponse.json({ ordenes: await getOrdenesEnviadas() });
  } catch (error) {
    const mensaje =
      error instanceof Error ? error.message : "Error desconocido";
    console.error("[api/compras/ordenes]", error);
    return NextResponse.json({ error: mensaje }, { status: 500 });
  }
}
