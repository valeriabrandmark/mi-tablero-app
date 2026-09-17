import { NextResponse, type NextRequest } from "next/server";
import { enConstruccion, permisoDelUsuario, puedeVer, puedeVerBorradores } from "@/lib/permisos";
import {
  getArticulosRentabilidad,
  getProveedoresRentabilidad,
  getResumenRentabilidad,
} from "@/lib/queries-rentabilidad";
import { authConfigurada } from "@/lib/supabase/env";
import { getUsuario } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Rentabilidad y markup por proveedor. SÓLO LEE.
 *
 * No escribe nada, ni acá ni en Tienda Nube: es la cuenta de qué markup hace
 * falta y qué markup permite el mercado, sobre la última corrida.
 *
 * EL PERMISO ES EL DE PRECIOS TN. `esApiPreciosTn` cubre `/api/precios-tn` y
 * todo lo que empieza con eso, así que esta ruta ya está adentro sin tocar
 * `lib/permisos.ts`. Se comprueba igual acá porque es la misma regla que miran
 * el proxy y la página, y las tres la consultan en el mismo lugar.
 */
export async function GET(request: NextRequest) {
  if (authConfigurada) {
    const permiso = permisoDelUsuario(await getUsuario());
    if (!puedeVer(permiso, "/api/precios-tn")) {
      return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
    }
    if (enConstruccion("/precios-tn") && !puedeVerBorradores(permiso)) {
      return NextResponse.json({ error: "En construcción" }, { status: 403 });
    }
  }

  // EL DETALLE DE UN PROVEEDOR SE PIDE APARTE, y no viene todo junto: son
  // 3.788 artículos y la pantalla abre mostrando ~15 proveedores. Bajar el
  // detalle de todos para mostrar el resumen sería regalar el tiempo de espera
  // de la primera pantalla, que es la que se mira siempre.
  const proveedor = request.nextUrl.searchParams.get("proveedor");
  if (proveedor) {
    return NextResponse.json({
      articulos: await getArticulosRentabilidad(proveedor.slice(0, 120)),
    });
  }

  const [resumen, proveedores] = await Promise.all([
    getResumenRentabilidad(),
    getProveedoresRentabilidad(),
  ]);

  return NextResponse.json({ resumen, proveedores });
}
