import { NextResponse, type NextRequest } from "next/server";
import { enConstruccion, permisoDelUsuario, puedeVer, puedeVerBorradores } from "@/lib/permisos";
import { getFilasPreciosTn, getResumenPreciosTn } from "@/lib/queries-precios-tn";
import { ALERTAS, type ClaveAlerta } from "@/lib/precios-tn";
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

  // El grupo se valida contra la lista y no se pasa crudo: un valor inventado
  // no encontraría clasificación y el filtro caería silencioso en "todo", que
  // es justo lo que el usuario no pidió.
  const crudo = request.nextUrl.searchParams.get("grupo");
  const grupo = (ALERTAS.find((a) => a.clave === crudo)?.clave ?? null) as ClaveAlerta | null;

  const [resumen, filas] = await Promise.all([
    getResumenPreciosTn(),
    getFilasPreciosTn(grupo),
  ]);

  return NextResponse.json({ resumen, filas, grupo });
}
