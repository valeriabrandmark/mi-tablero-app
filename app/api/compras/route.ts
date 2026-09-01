import { NextResponse, type NextRequest } from "next/server";
import { lista } from "@/lib/filtros";
import { enConstruccion, permisoDelUsuario, puedeVer, puedeVerBorradores } from "@/lib/permisos";
import { getDashboardCompras, getOpcionesCompras } from "@/lib/queries-compras";
import { VENTANAS_RITMO, VENTANA_POR_DEFECTO } from "@/lib/stock";
import { authConfigurada } from "@/lib/supabase/env";
import { getUsuario } from "@/lib/supabase/server";
import type { FiltrosCompras } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Datos del panel de Compras. */
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;

  if (authConfigurada) {
    const permiso = permisoDelUsuario(await getUsuario());
    if (!puedeVer(permiso, "/api/compras")) {
      return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
    }
    if (enConstruccion("/stock/compras") && !puedeVerBorradores(permiso)) {
      return NextResponse.json({ error: "En construcción" }, { status: 403 });
    }
  }

  const crudaVentana = Number(sp.get("ventana"));
  const ventana = VENTANAS_RITMO.find((v) => v === crudaVentana) ?? VENTANA_POR_DEFECTO;

  // El mes viaja como texto y se valida contra la lista real adentro de
  // `getDashboardCompras`: acá sólo se le pone un largo máximo para que no
  // entre un parámetro gigante.
  const mes = sp.get("mes")?.slice(0, 7) || undefined;

  const filtros: FiltrosCompras = {
    proveedor: lista(sp, "proveedor"),
    marca: lista(sp, "marca"),
    buscar: sp.get("buscar")?.slice(0, 80) || undefined,
    ventana,
    mes,
    todos: sp.get("todos") === "1",
  };

  try {
    const [data, opciones] = await Promise.all([
      getDashboardCompras(filtros),
      sp.get("conOpciones") ? getOpcionesCompras() : Promise.resolve(null),
    ]);
    return NextResponse.json({ ...data, opciones });
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : "Error desconocido";
    console.error("[api/compras]", error);
    return NextResponse.json({ error: mensaje }, { status: 500 });
  }
}
