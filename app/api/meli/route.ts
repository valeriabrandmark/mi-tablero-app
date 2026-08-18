import { NextResponse, type NextRequest } from "next/server";
import { lista } from "@/lib/filtros";
import { NIVELES_ALERTA } from "@/lib/meli";
import { permisoDelUsuario, puedeVer } from "@/lib/permisos";
import {
  getDashboardAlertasMeli,
  getDashboardMeli,
  getOpcionesMeli,
} from "@/lib/queries-meli";
import { authConfigurada } from "@/lib/supabase/env";
import { getUsuario } from "@/lib/supabase/server";
import type { FiltrosMeli } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Datos de la sección Venta minorista — Mercado Libre.
 *
 * `?vista=alertas` devuelve la pestaña de alertas; sin eso, el tablero. Es una
 * sola ruta y no dos porque comparten filtros, permiso y opciones: partirla
 * obligaría a mantener el mismo chequeo en dos lados.
 */
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;

  // El proxy ya corta por ruta, pero la barrera se repite acá: el middleware
  // protege la página, no el dato, y esta ruta se puede pedir sola.
  if (authConfigurada) {
    const permiso = permisoDelUsuario(await getUsuario());
    if (!puedeVer(permiso, "/api/meli")) {
      return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
    }
  }

  // El nivel de alerta se valida contra la lista en vez de pasarlo tal cual:
  // un valor inventado no filtraría nada y la página mostraría todo, que es
  // exactamente lo contrario de lo que pidió quien lo mandó.
  const alerta = lista(sp, "alerta")?.filter((v) => NIVELES_ALERTA.some((n) => n === v));

  const filtros: FiltrosMeli = {
    mes: lista(sp, "mes"),
    proveedor: lista(sp, "proveedor"),
    marca: lista(sp, "marca"),
    sku: lista(sp, "sku"),
    alerta: alerta && alerta.length > 0 ? alerta : undefined,
  };

  try {
    const [data, opciones] = await Promise.all([
      sp.get("vista") === "alertas"
        ? getDashboardAlertasMeli(filtros)
        : getDashboardMeli(filtros),
      sp.get("conOpciones") ? getOpcionesMeli() : Promise.resolve(null),
    ]);
    return NextResponse.json({ ...data, opciones });
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : "Error desconocido";
    console.error("[api/meli]", error);
    return NextResponse.json({ error: mensaje }, { status: 500 });
  }
}
