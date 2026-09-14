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

  /**
   * `?todo=1` trae la lista COMPLETA, sin el corte de 200.
   *
   * Es lo que piden los botones de Excel y PDF. La pantalla se limita a 200
   * porque nadie mira más que eso de corrido, pero un archivo que dice "Precios
   * TN (200 artículos)" cuando el filtro tiene 800 es peor que no tener el
   * botón: se reenvía por mail, se toman decisiones sobre él, y en ningún lado
   * dice que le falta el 75 %.
   *
   * El tope de 5.000 no es por la base --la corrida entera son 3.788 filas--
   * sino por el navegador: armar el PDF de más que eso lo deja colgado, y un
   * número redondo por encima del catálogo completo es un freno que hoy no
   * toca nada y mañana evita una pantalla congelada.
   */
  const todo = request.nextUrl.searchParams.get("todo") === "1";

  const [resumen, filas, catalogos, aprobables] = await Promise.all([
    getResumenPreciosTn(),
    getFilasPreciosTn(filtros, todo ? 5000 : undefined),
    getCatalogosPreciosTn(),
    // Cuántas aprobaría el botón de bloque con ESTE filtro. Se calcula acá y no
    // contando las filas de la pantalla: la lista está limitada a 200 y el
    // botón no lo está, así que contarlas en el navegador mentiría por lo bajo.
    contarAprobables(filtros),
  ]);

  return NextResponse.json({ resumen, filas, catalogos, aprobables, filtros });
}
