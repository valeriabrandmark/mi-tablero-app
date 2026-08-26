import { NextResponse, type NextRequest } from "next/server";
import { lista } from "@/lib/filtros";
import { NIVELES_ALERTA, hoyArgentina } from "@/lib/meli";
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

  // Las fechas se validan con una expresión y no con `new Date()`: acá no se
  // quiere interpretar nada raro, se quiere `YYYY-MM-DD` o nada. Un valor con
  // otra forma se descarta y el rango cae al default, que es mejor que meter
  // basura en la consulta.
  const fecha = (clave: string): string | undefined => {
    const v = sp.get(clave);
    return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined;
  };

  const hoy = hoyArgentina();
  let desde = fecha("desde") ?? hoy;
  let hasta = fecha("hasta") ?? hoy;
  // Si vienen dadas vuelta se ordenan en vez de devolver un recorte vacío.
  if (desde > hasta) [desde, hasta] = [hasta, desde];

  // La hora se valida contra 0-23: un valor fuera de rango no filtraría nada y
  // la página mostraría todo, que es lo contrario de lo que pidió quien lo mandó.
  const hora = lista(sp, "hora")?.filter((v) => /^\d{1,2}$/.test(v) && Number(v) <= 23);

  const filtros: FiltrosMeli = {
    desde,
    hasta,
    hora: hora && hora.length > 0 ? hora : undefined,
    proveedor: lista(sp, "proveedor"),
    marca: lista(sp, "marca"),
    sku: lista(sp, "sku"),
    alerta: alerta && alerta.length > 0 ? alerta : undefined,
    // Se recorta a 80 caracteres: mas que eso no es una busqueda, y el termino
    // entra en un `like` que conviene mantener corto.
    buscar: (sp.get("buscar") ?? "").trim().slice(0, 80) || undefined,
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
