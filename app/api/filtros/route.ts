import { NextResponse } from "next/server";
import { getOpcionesFiltro } from "@/lib/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await getOpcionesFiltro());
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : "Error desconocido";
    console.error("[api/filtros]", error);
    return NextResponse.json({ error: mensaje }, { status: 500 });
  }
}
