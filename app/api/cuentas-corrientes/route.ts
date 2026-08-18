import { NextResponse, type NextRequest } from "next/server";
import { getDashboardCuentas, getOpcionesCuentas } from "@/lib/queries-cuentas";
import type { FiltrosCuentas } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const filtros: FiltrosCuentas = {
    vendedor: sp.get("vendedor") || undefined,
    empresa: sp.get("empresa") || undefined,
    categoria: sp.get("categoria") || undefined,
  };

  try {
    const [data, opciones] = await Promise.all([
      getDashboardCuentas(filtros),
      sp.get("conOpciones") ? getOpcionesCuentas() : Promise.resolve(null),
    ]);
    return NextResponse.json({ ...data, opciones });
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : "Error desconocido";
    console.error("[api/cuentas-corrientes]", error);
    return NextResponse.json({ error: mensaje }, { status: 500 });
  }
}
