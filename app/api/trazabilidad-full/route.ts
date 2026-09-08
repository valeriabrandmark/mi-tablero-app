import { NextResponse, type NextRequest } from "next/server";
import { lista } from "@/lib/filtros";
import { enConstruccion, permisoDelUsuario, puedeVer, puedeVerBorradores } from "@/lib/permisos";
import {
  getDashboardTrazabilidad,
  getOpcionesTrazabilidad,
} from "@/lib/queries-trazabilidad";
import { authConfigurada } from "@/lib/supabase/env";
import { getUsuario } from "@/lib/supabase/server";
import type { FiltrosTrazabilidad } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Una fecha `YYYY-MM-DD`, o undefined. Cualquier otra cosa se descarta. */
function fecha(v: string | null): string | undefined {
  return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined;
}

/** Datos de la trazabilidad del stock en Full. */
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;

  if (authConfigurada) {
    const permiso = permisoDelUsuario(await getUsuario());
    if (!puedeVer(permiso, "/api/trazabilidad-full")) {
      return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
    }
    if (enConstruccion("/stock/trazabilidad-full") && !puedeVerBorradores(permiso)) {
      return NextResponse.json({ error: "En construcción" }, { status: 403 });
    }
  }

  const filtros: FiltrosTrazabilidad = {
    proveedor: lista(sp, "proveedor"),
    grupo: lista(sp, "grupo"),
    sku: lista(sp, "sku"),
    desde: fecha(sp.get("desde")),
    todos: sp.get("todos") === "1",
    soloReclamables: sp.get("soloReclamables") === "1",
    buscar: sp.get("buscar")?.slice(0, 80) || undefined,
  };

  try {
    const data = await getDashboardTrazabilidad(filtros);
    // Las opciones salen del MISMO período que los datos: un proveedor que no
    // tuvo movimiento en la ventana no tiene por qué aparecer en el selector.
    const opciones = data.desde
      ? await getOpcionesTrazabilidad(data.desde)
      : { proveedores: [], grupos: [] };
    return NextResponse.json({ ...data, opciones });
  } catch (e) {
    console.error("[/api/trazabilidad-full]", e);
    return NextResponse.json({ error: "No se pudo consultar" }, { status: 500 });
  }
}
