import { NextResponse, type NextRequest } from "next/server";
import {
  enConstruccion,
  permisoDelUsuario,
  puedeVer,
  puedeVerBorradores,
} from "@/lib/permisos";
import { getMaestroParaFactura } from "@/lib/queries-facturas";
import { authConfigurada } from "@/lib/supabase/env";
import { getUsuario } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * El maestro del proveedor de una OC, para cruzar la factura en el navegador.
 *
 * SÓLO LEE. El cruce corre entero en la pantalla (lib/factura-cruce.ts): acá
 * no se decide nada, se entregan los códigos, EAN y tamaños de bulto con los
 * que la pantalla reconoce cada renglón.
 *
 * Es POST y no GET porque una OC pegada puede traer cientos de SKU, y eso en
 * una URL se corta.
 */
export async function POST(request: NextRequest) {
  if (authConfigurada) {
    const permiso = permisoDelUsuario(await getUsuario());
    if (!puedeVer(permiso, "/api/compras")) {
      return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
    }
    if (
      enConstruccion("/stock/compras/facturas") &&
      !puedeVerBorradores(permiso)
    ) {
      return NextResponse.json({ error: "En construcción" }, { status: 403 });
    }
  }

  let cuerpo: { skus?: unknown };
  try {
    cuerpo = await request.json();
  } catch {
    return NextResponse.json(
      { error: "El cuerpo no es JSON válido." },
      { status: 400 },
    );
  }

  const skus = Array.isArray(cuerpo.skus)
    ? [
        ...new Set(
          cuerpo.skus
            .slice(0, 1000)
            .filter((s): s is string => typeof s === "string")
            .map((s) => s.trim().slice(0, 40))
            .filter(Boolean),
        ),
      ]
    : [];

  if (skus.length === 0) {
    return NextResponse.json(
      { error: "No llegó ningún SKU." },
      { status: 400 },
    );
  }

  try {
    return NextResponse.json({ articulos: await getMaestroParaFactura(skus) });
  } catch (error) {
    const mensaje =
      error instanceof Error ? error.message : "Error desconocido";
    console.error("[api/compras/facturas]", error);
    return NextResponse.json({ error: mensaje }, { status: 500 });
  }
}
