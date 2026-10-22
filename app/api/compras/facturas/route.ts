import { NextResponse, type NextRequest } from "next/server";
import { permisoDelUsuario, puedeVer } from "@/lib/permisos";
import {
  getMaestroDelProveedor,
  getMaestroParaFactura,
  getProveedoresDeCompra,
} from "@/lib/queries-facturas";
import { authConfigurada } from "@/lib/supabase/env";
import { getUsuario } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * La lista de proveedores para elegir, con su código.
 *
 * SALE DEL MAESTRO Y NO DE LAS ORDENES MANDADAS. El desplegable se armaba con
 * las OC del tablero y eso dejaba 12 proveedores sobre 46: una factura de un
 * proveedor al que la OC se le pasó por teléfono no se podía cargar. La OC
 * sirve para CRUZAR la factura, no para que la factura exista.
 */
export async function GET() {
  if (authConfigurada) {
    const permiso = permisoDelUsuario(await getUsuario());
    if (!puedeVer(permiso, "/api/compras/facturas")) {
      return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
    }
  }

  try {
    return NextResponse.json({ proveedores: await getProveedoresDeCompra() });
  } catch (error) {
    const mensaje =
      error instanceof Error ? error.message : "Error desconocido";
    console.error("[api/compras/facturas] GET", error);
    return NextResponse.json({ error: mensaje }, { status: 500 });
  }
}

/**
 * El maestro con el que se reconocen los renglones de una factura: por los
 * SKU de la OC, o por el proveedor cuando no hay OC.
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
    if (!puedeVer(permiso, "/api/compras/facturas")) {
      return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
    }
  }

  let cuerpo: { skus?: unknown; proveedor?: unknown };
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

  // SIN SKU SE PUEDE ENTRAR POR EL PROVEEDOR. Es el caso de una factura cuya
  // OC no se mandó desde el tablero: no hay SKU de los que partir, pero el
  // proveedor alcanza para traer el mismo maestro.
  const proveedor =
    typeof cuerpo.proveedor === "string"
      ? cuerpo.proveedor.trim().slice(0, 40)
      : "";

  if (skus.length === 0 && !proveedor) {
    return NextResponse.json(
      { error: "No llegó ningún SKU ni proveedor." },
      { status: 400 },
    );
  }

  try {
    const articulos =
      skus.length > 0
        ? await getMaestroParaFactura(skus)
        : await getMaestroDelProveedor(proveedor);
    return NextResponse.json({ articulos });
  } catch (error) {
    const mensaje =
      error instanceof Error ? error.message : "Error desconocido";
    console.error("[api/compras/facturas]", error);
    return NextResponse.json({ error: mensaje }, { status: 500 });
  }
}
