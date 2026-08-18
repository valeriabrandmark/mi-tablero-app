import { NextResponse, type NextRequest } from "next/server";
import { getDashboardLogistica, getOpcionesLogistica } from "@/lib/queries-logistica";
import { lista } from "@/lib/filtros";
import type { FiltrosLogistica, ModoFlete } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODOS: ModoFlete[] = ["sin", "real", "real-estimado"];

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const modo = sp.get("modoFlete") as ModoFlete | null;

  const filtros: FiltrosLogistica = {
    vendedor: lista(sp, "vendedor"),
    empresa: lista(sp, "empresa"),
    mes: lista(sp, "mes"),
    transporte: lista(sp, "transporte"),
    provincia: lista(sp, "provincia"),
    estadoFlete: lista(sp, "estadoFlete"),
    proveedor: lista(sp, "proveedor"),
    // El modo de flete NO es un filtro sino un cálculo: sigue siendo único.
    modoFlete: modo && MODOS.includes(modo) ? modo : "sin",
  };

  try {
    const [data, opciones] = await Promise.all([
      getDashboardLogistica(filtros),
      sp.get("conOpciones") ? getOpcionesLogistica() : Promise.resolve(null),
    ]);
    return NextResponse.json({ ...data, opciones });
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : "Error desconocido";
    console.error("[api/logistica]", error);
    return NextResponse.json({ error: mensaje }, { status: 500 });
  }
}
