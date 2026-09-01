import { NextResponse, type NextRequest } from "next/server";
import { lista } from "@/lib/filtros";
import { enConstruccion, permisoDelUsuario, puedeVer, puedeVerBorradores } from "@/lib/permisos";
import {
  getDashboardAntiguedad,
  getOpcionesAntiguedad,
} from "@/lib/queries-stock-antiguedad";
import { TRAMOS_ANTIGUEDAD, TRAMOS_VENCIMIENTO } from "@/lib/stock-antiguedad";
import { authConfigurada } from "@/lib/supabase/env";
import { getUsuario } from "@/lib/supabase/server";
import type { FiltrosAntiguedad } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Datos de la pantalla de Antigüedad de stock. */
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;

  if (authConfigurada) {
    const permiso = permisoDelUsuario(await getUsuario());
    if (!puedeVer(permiso, "/api/stock-antiguedad")) {
      return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
    }
    // Igual que en /api/stock: mientras la página esté en construcción, su ruta
    // de datos tampoco contesta. Sin esto el borrador quedaría accesible por
    // acá aunque la pantalla lo tape.
    if (enConstruccion("/stock/antiguedad") && !puedeVerBorradores(permiso)) {
      return NextResponse.json({ error: "En construcción" }, { status: 403 });
    }
  }

  // Los dos tramos se validan contra su lista y no se pasan crudos: un valor
  // inventado no encontraría columna y el filtro caería silencioso en "todo",
  // que es justo lo que el usuario no pidió.
  const crudoTramo = sp.get("tramo");
  const tramo = TRAMOS_ANTIGUEDAD.find((t) => t.clave === crudoTramo)?.clave;

  const crudoVto = sp.get("vencimiento");
  const vencimiento = TRAMOS_VENCIMIENTO.find((t) => t.clave === crudoVto)?.clave;

  const filtros: FiltrosAntiguedad = {
    proveedor: lista(sp, "proveedor"),
    marca: lista(sp, "marca"),
    sku: lista(sp, "sku"),
    tramo,
    vencimiento,
    buscar: sp.get("buscar")?.slice(0, 80) || undefined,
  };

  try {
    const [data, opciones] = await Promise.all([
      getDashboardAntiguedad(filtros),
      sp.get("conOpciones") ? getOpcionesAntiguedad() : Promise.resolve(null),
    ]);
    return NextResponse.json({ ...data, opciones });
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : "Error desconocido";
    console.error("[api/stock-antiguedad]", error);
    return NextResponse.json({ error: mensaje }, { status: 500 });
  }
}
