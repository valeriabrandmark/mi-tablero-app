import { NextResponse, type NextRequest } from "next/server";
import { lista } from "@/lib/filtros";
import { permisoDelUsuario, puedeVer } from "@/lib/permisos";
import { getDashboardStockFull, getOpcionesStockFull } from "@/lib/queries-stock-full";
import { authConfigurada } from "@/lib/supabase/env";
import { getUsuario } from "@/lib/supabase/server";
import type { FiltrosStockFull } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Datos de "Stock Full · días sin venta". */
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;

  if (authConfigurada) {
    const permiso = permisoDelUsuario(await getUsuario());
    if (!puedeVer(permiso, "/api/stock-full")) {
      return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
    }
  }

  // `minDias` se valida como número: un texto cualquiera se descarta en vez de
  // llegar a la consulta. Sin filtro es undefined, que muestra todo.
  const crudo = sp.get("minDias");
  const minDias = crudo != null && /^\d{1,4}$/.test(crudo) ? Number(crudo) : undefined;

  const filtros: FiltrosStockFull = {
    proveedor: lista(sp, "proveedor"),
    marca: lista(sp, "marca"),
    sku: lista(sp, "sku"),
    minDias,
  };

  try {
    const [data, opciones] = await Promise.all([
      getDashboardStockFull(filtros),
      sp.get("conOpciones") ? getOpcionesStockFull() : Promise.resolve(null),
    ]);
    return NextResponse.json({ ...data, opciones });
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : "Error desconocido";
    console.error("[api/stock-full]", error);
    return NextResponse.json({ error: mensaje }, { status: 500 });
  }
}
