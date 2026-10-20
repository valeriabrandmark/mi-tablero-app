import { NextResponse, type NextRequest } from "next/server";
import {
  getDashboardLogistica,
  getOpcionesLogistica,
} from "@/lib/queries-logistica";
import { LARGO_MAX_BUSQUEDA, lista } from "@/lib/filtros";
import type { FiltrosLogistica } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const filtros: FiltrosLogistica = {
    vendedor: lista(sp, "vendedor"),
    empresa: lista(sp, "empresa"),
    mes: lista(sp, "mes"),
    transporte: lista(sp, "transporte"),
    provincia: lista(sp, "provincia"),
    estadoFlete: lista(sp, "estadoFlete"),
    proveedor: lista(sp, "proveedor"),
    // El término libre no es una lista: viaja solo y se recorta acá, que es
    // donde entra lo que alguien pueda escribir a mano en la URL.
    buscar: sp.get("buscar")?.trim().slice(0, LARGO_MAX_BUSQUEDA) || undefined,
  };

  try {
    const [data, opciones] = await Promise.all([
      getDashboardLogistica(filtros),
      sp.get("conOpciones") ? getOpcionesLogistica() : Promise.resolve(null),
    ]);
    return NextResponse.json({ ...data, opciones });
  } catch (error) {
    const mensaje =
      error instanceof Error ? error.message : "Error desconocido";
    console.error("[api/logistica]", error);
    return NextResponse.json({ error: mensaje }, { status: 500 });
  }
}
