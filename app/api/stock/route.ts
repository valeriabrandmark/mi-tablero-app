import { NextResponse, type NextRequest } from "next/server";
import { lista } from "@/lib/filtros";
import { enConstruccion, permisoDelUsuario, puedeVer, puedeVerBorradores } from "@/lib/permisos";
import { getDashboardStock, getOpcionesStock } from "@/lib/queries-stock";
import {
  DEPOSITOS,
  DEPOSITO_POR_DEFECTO,
  VENTANAS_RITMO,
  VENTANA_POR_DEFECTO,
} from "@/lib/stock";
import { authConfigurada } from "@/lib/supabase/env";
import { getUsuario } from "@/lib/supabase/server";
import type { FiltrosStock } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Datos del tablero de Stock. */
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;

  if (authConfigurada) {
    const permiso = permisoDelUsuario(await getUsuario());
    if (!puedeVer(permiso, "/api/stock")) {
      return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
    }
    // Mientras la página esté en construcción, su API tampoco contesta a nadie
    // más que al superadmin. Sin esto, el borrador quedaría accesible por la
    // ruta de datos aunque la pantalla lo tape.
    if (enConstruccion("/stock") && !puedeVerBorradores(permiso)) {
      return NextResponse.json({ error: "En construcción" }, { status: 403 });
    }
  }

  // La ventana se valida contra la lista y no como número suelto: cualquier
  // otro valor entraría en un `$1::int` sin romper nada y devolvería un ritmo
  // que nadie pidió.
  const crudaVentana = Number(sp.get("ventana"));
  const ventana = VENTANAS_RITMO.find((v) => v === crudaVentana) ?? VENTANA_POR_DEFECTO;

  // Mismo criterio que la ventana: se valida contra la lista. Un depósito
  // inventado entraría en el `case` del SQL y caería silencioso en "los dos",
  // que es justo lo que el usuario no pidió.
  const crudoDeposito = sp.get("deposito");
  const deposito =
    DEPOSITOS.find((d) => d.clave === crudoDeposito)?.clave ?? DEPOSITO_POR_DEFECTO;

  const filtros: FiltrosStock = {
    proveedor: lista(sp, "proveedor"),
    marca: lista(sp, "marca"),
    sku: lista(sp, "sku"),
    tramo: sp.get("tramo") ?? undefined,
    buscar: sp.get("buscar")?.slice(0, 80) || undefined,
    ventana,
    deposito,
  };

  try {
    const [data, opciones] = await Promise.all([
      getDashboardStock(filtros),
      sp.get("conOpciones") ? getOpcionesStock() : Promise.resolve(null),
    ]);
    return NextResponse.json({ ...data, opciones });
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : "Error desconocido";
    console.error("[api/stock]", error);
    return NextResponse.json({ error: mensaje }, { status: 500 });
  }
}
