import { NextResponse, type NextRequest } from "next/server";
import { lista } from "@/lib/filtros";
import { permisoDelUsuario, puedeVer } from "@/lib/permisos";
import {
  getDashboardTiendaNube,
  getOpcionesTiendaNube,
} from "@/lib/queries-tiendanube";
import { hoyArgentina, mesComercialComoRango } from "@/lib/rangos";
import { authConfigurada } from "@/lib/supabase/env";
import { getUsuario } from "@/lib/supabase/server";
import type { FiltrosTiendaNube } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Datos de la sección Venta minorista — Tienda Nube. */
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;

  // El proxy ya corta por ruta, pero la barrera se repite acá: el middleware
  // protege la página, no el dato, y esta ruta se puede pedir sola.
  if (authConfigurada) {
    const permiso = permisoDelUsuario(await getUsuario());
    if (!puedeVer(permiso, "/api/tienda-nube")) {
      return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
    }
  }

  // Las fechas se validan con una expresión y no con `new Date()`: acá no se
  // quiere interpretar nada raro, se quiere `YYYY-MM-DD` o nada. Un valor con
  // otra forma se descarta y el rango cae al default, que es mejor que meter
  // basura en la consulta.
  const fecha = (clave: string): string | undefined => {
    const v = sp.get(clave);
    return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined;
  };

  // El default es el MES COMERCIAL y no el día, al revés que Mercado Libre:
  // Tienda Nube tiene unos ocho pedidos por mes, así que abrir en "hoy" daría
  // vacío tres de cada cuatro días y se leería como que no vendimos.
  const porDefecto = mesComercialComoRango(hoyArgentina());
  let desde = fecha("desde") ?? porDefecto.desde;
  let hasta = fecha("hasta") ?? porDefecto.hasta;
  // Si vienen dadas vuelta se ordenan en vez de devolver un recorte vacío.
  if (desde > hasta) [desde, hasta] = [hasta, desde];

  const filtros: FiltrosTiendaNube = {
    desde,
    hasta,
    proveedor: lista(sp, "proveedor"),
    marca: lista(sp, "marca"),
    sku: lista(sp, "sku"),
    cliente: lista(sp, "cliente"),
  };

  try {
    const [data, opciones] = await Promise.all([
      getDashboardTiendaNube(filtros),
      sp.get("conOpciones") ? getOpcionesTiendaNube() : Promise.resolve(null),
    ]);
    return NextResponse.json({ ...data, opciones });
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : "Error desconocido";
    console.error("[api/tienda-nube]", error);
    return NextResponse.json({ error: mensaje }, { status: 500 });
  }
}
