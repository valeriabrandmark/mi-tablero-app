import { NextResponse, type NextRequest } from "next/server";
import { lista } from "@/lib/filtros";
import { permisoDelUsuario, puedeVer } from "@/lib/permisos";
import {
  getDashboardElasticidad,
  getOpcionesElasticidad,
} from "@/lib/queries-elasticidad";
import { hoyArgentina, sumarDias } from "@/lib/rangos";
import { authConfigurada } from "@/lib/supabase/env";
import { getUsuario } from "@/lib/supabase/server";
import type { FiltrosElasticidad } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Datos de "Elasticidad de precios". */
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;

  if (authConfigurada) {
    const permiso = permisoDelUsuario(await getUsuario());
    if (!puedeVer(permiso, "/api/elasticidad")) {
      return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
    }
  }

  // Las fechas se validan con una expresión y no con `new Date()`: acá no se
  // quiere interpretar nada raro, se quiere `YYYY-MM-DD` o nada. Un valor con
  // otra forma cae al default, que es mejor que meter basura en la consulta.
  const fecha = (clave: string): string | undefined => {
    const v = sp.get(clave);
    return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined;
  };

  // Default: los últimos 30 días. El experimento se lee sobre un período, no
  // sobre un día — con "hoy" como en las otras pantallas, la mayoría de los
  // artículos no tendría ninguna venta y la comparación entre bandas sería ruido.
  const hoy = hoyArgentina();
  let desde = fecha("desde") ?? sumarDias(hoy, -30);
  let hasta = fecha("hasta") ?? hoy;
  if (desde > hasta) [desde, hasta] = [hasta, desde];

  const filtros: FiltrosElasticidad = {
    desde,
    hasta,
    proveedor: lista(sp, "proveedor"),
    marca: lista(sp, "marca"),
    sku: lista(sp, "sku"),
    banda: lista(sp, "banda"),
    soloConfiables: sp.get("soloConfiables") === "1",
  };

  try {
    const [data, opciones] = await Promise.all([
      getDashboardElasticidad(filtros),
      sp.get("conOpciones") ? getOpcionesElasticidad(filtros) : Promise.resolve(null),
    ]);
    return NextResponse.json({ ...data, opciones });
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : "Error desconocido";
    console.error("[api/elasticidad]", error);
    return NextResponse.json({ error: mensaje }, { status: 500 });
  }
}
