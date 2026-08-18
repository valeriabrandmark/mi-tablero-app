import { NextResponse, type NextRequest } from "next/server";
import { getDashboardVentasMayoristas } from "@/lib/queries";
import type { Filtros } from "@/lib/types";

// `pg` necesita el runtime de Node (no Edge) y los datos son siempre en vivo.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const filtros: Filtros = {
    vendedor: sp.get("vendedor") || undefined,
    empresa: sp.get("empresa") || undefined,
    mes: sp.get("mes") || undefined,
    proveedor: sp.get("proveedor") || undefined,
  };

  try {
    const data = await getDashboardVentasMayoristas(filtros);
    return NextResponse.json(data);
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : "Error desconocido";
    console.error("[api/ventas-mayoristas]", error);
    return NextResponse.json({ error: mensaje }, { status: 500 });
  }
}
