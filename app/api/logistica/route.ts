import { NextResponse, type NextRequest } from "next/server";
import { getDashboardLogistica, getOpcionesLogistica } from "@/lib/queries-logistica";
import type { FiltrosLogistica, ModoFlete } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODOS: ModoFlete[] = ["sin", "real", "real-estimado"];

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const modo = sp.get("modoFlete") as ModoFlete | null;

  const filtros: FiltrosLogistica = {
    vendedor: sp.get("vendedor") || undefined,
    empresa: sp.get("empresa") || undefined,
    mes: sp.get("mes") || undefined,
    transporte: sp.get("transporte") || undefined,
    provincia: sp.get("provincia") || undefined,
    estadoFlete: sp.get("estadoFlete") || undefined,
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
