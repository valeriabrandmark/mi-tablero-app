import { NextResponse, type NextRequest } from "next/server";
import { desdeSearchParams } from "@/lib/filtros";
import { getDashboardVentasMayoristas } from "@/lib/queries";

// `pg` necesita el runtime de Node (no Edge) y los datos son siempre en vivo.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const filtros = desdeSearchParams(request.nextUrl.searchParams);

  try {
    const data = await getDashboardVentasMayoristas(filtros);
    return NextResponse.json(data);
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : "Error desconocido";
    console.error("[api/ventas-mayoristas]", error);
    return NextResponse.json({ error: mensaje }, { status: 500 });
  }
}
