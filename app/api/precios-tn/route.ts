import { NextResponse, type NextRequest } from "next/server";
import { enConstruccion, permisoDelUsuario, puedeVer, puedeVerBorradores } from "@/lib/permisos";
import {
  contarAprobables,
  getCatalogosPreciosTn,
  getFilasPreciosTn,
  getResumenPreciosTn,
} from "@/lib/queries-precios-tn";
import { leerFiltros } from "@/lib/precios-tn";
import { authConfigurada } from "@/lib/supabase/env";
import { getUsuario } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Datos de Precios TN. Sólo `superadmin` y `admin_tn` (ver lib/permisos.ts). */
export async function GET(request: NextRequest) {
  if (authConfigurada) {
    const permiso = permisoDelUsuario(await getUsuario());
    if (!puedeVer(permiso, "/api/precios-tn")) {
      return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
    }
    // Mientras la página esté en construcción su ruta de datos tampoco
    // contesta: sin esto el borrador quedaría accesible por acá.
    if (enConstruccion("/precios-tn") && !puedeVerBorradores(permiso)) {
      return NextResponse.json({ error: "En construcción" }, { status: 403 });
    }
  }

  const filtros = leerFiltros(request.nextUrl.searchParams);

  const [resumen, filas, catalogos, aprobables] = await Promise.all([
    getResumenPreciosTn(),
    getFilasPreciosTn(filtros),
    getCatalogosPreciosTn(),
    // Cuántas aprobaría el botón de bloque con ESTE filtro. Se calcula acá y no
    // contando las filas de la pantalla: la lista está limitada a 200 y el
    // botón no lo está, así que contarlas en el navegador mentiría por lo bajo.
    contarAprobables(filtros),
  ]);

  return NextResponse.json({ resumen, filas, catalogos, aprobables, filtros });
}
