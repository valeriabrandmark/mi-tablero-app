import { NextResponse, type NextRequest } from "next/server";
import { EXPERIMENTO_FIN, EXPERIMENTO_INICIO } from "@/lib/elasticidad";
import { lista } from "@/lib/filtros";
import { permisoDelUsuario, puedeVer } from "@/lib/permisos";
import {
  getDashboardResultados,
  getOpcionesElasticidad,
} from "@/lib/queries-elasticidad";
import { authConfigurada } from "@/lib/supabase/env";
import { getUsuario } from "@/lib/supabase/server";
import type { FiltrosElasticidad } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Datos de "Elasticidad · resultados por semana". */
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;

  if (authConfigurada) {
    const permiso = permisoDelUsuario(await getUsuario());
    if (!puedeVer(permiso, "/api/resultados-elasticidad")) {
      return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
    }
  }

  // Acá NO hay filtro de fechas, a diferencia de la otra pantalla: el período
  // es el del experimento y está fijo. Que se pudiera mover volvería las
  // columnas "semana 1, 2 y 3" una etiqueta sin sentido.
  const filtros: FiltrosElasticidad = {
    desde: EXPERIMENTO_INICIO,
    hasta: EXPERIMENTO_FIN,
    proveedor: lista(sp, "proveedor"),
    marca: lista(sp, "marca"),
    sku: lista(sp, "sku"),
  };

  try {
    const [data, opciones] = await Promise.all([
      getDashboardResultados(filtros),
      sp.get("conOpciones") ? getOpcionesElasticidad(filtros) : Promise.resolve(null),
    ]);
    return NextResponse.json({ ...data, opciones });
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : "Error desconocido";
    console.error("[api/resultados-elasticidad]", error);
    return NextResponse.json({ error: mensaje }, { status: 500 });
  }
}
