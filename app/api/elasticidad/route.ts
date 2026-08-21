import { NextResponse, type NextRequest } from "next/server";
import { lista } from "@/lib/filtros";
import { permisoDelUsuario, puedeVer } from "@/lib/permisos";
import {
  getDashboardElasticidad,
  getOpcionesElasticidad,
} from "@/lib/queries-elasticidad";
import { authConfigurada } from "@/lib/supabase/env";
import { getUsuario } from "@/lib/supabase/server";
import type { FiltrosElasticidad } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Datos de "Elasticidad de precios". */
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;

  if (authConfigurada) {
    const permiso = permisoDelUsuario(await getUsuario());
    if (!puedeVer(permiso, "/api/elasticidad")) {
      return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
    }
  }

  const filtros: FiltrosElasticidad = {
    proveedor: lista(sp, "proveedor"),
    marca: lista(sp, "marca"),
    soloConfiables: sp.get("soloConfiables") === "1",
  };

  try {
    const [data, opciones] = await Promise.all([
      getDashboardElasticidad(filtros),
      sp.get("conOpciones") ? getOpcionesElasticidad() : Promise.resolve(null),
    ]);
    return NextResponse.json({ ...data, opciones });
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : "Error desconocido";
    console.error("[api/elasticidad]", error);
    return NextResponse.json({ error: mensaje }, { status: 500 });
  }
}
