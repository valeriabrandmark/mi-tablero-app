import { NextResponse, type NextRequest } from "next/server";
import { getDashboardObjetivos, getOpcionesObjetivos } from "@/lib/queries-objetivos";
import type { FiltrosObjetivos } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;

  const filtros: FiltrosObjetivos = {
    mes: sp.get("mes") || undefined,
    vendedor: sp.get("vendedor") || undefined,
    grupo: sp.get("grupo") || undefined,
  };

  try {
    const [data, opciones] = await Promise.all([
      getDashboardObjetivos(filtros),
      sp.get("conOpciones") ? getOpcionesObjetivos() : Promise.resolve(null),
    ]);
    return NextResponse.json({ ...data, opciones });
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : "Error desconocido";
    console.error("[api/objetivos]", error);
    return NextResponse.json({ error: mensaje }, { status: 500 });
  }
}
