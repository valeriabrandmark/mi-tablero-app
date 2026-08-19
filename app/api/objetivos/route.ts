import { NextResponse, type NextRequest } from "next/server";
import { getDashboardObjetivos, getOpcionesObjetivos } from "@/lib/queries-objetivos";
import { VENDEDORES_OBJETIVOS } from "@/lib/constantes";
import { lista } from "@/lib/filtros";
import { permisoDelUsuario, puedeVerVendedor } from "@/lib/permisos";
import { authConfigurada } from "@/lib/supabase/env";
import { getUsuario } from "@/lib/supabase/server";
import type { FiltrosObjetivos } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const vendedor = sp.get("vendedor");

  // El vendedor se valida contra la lista, no se pasa tal cual a la consulta:
  // esta ruta es la que va a haber que proteger cuando cada vendedor tenga
  // permiso sobre su propia página.
  if (!vendedor || !VENDEDORES_OBJETIVOS.some((v) => v === vendedor)) {
    return NextResponse.json({ error: "Vendedor inválido" }, { status: 400 });
  }

  // El proxy ya dejó pasar solo a esta ruta, pero el vendedor viene por query
  // string, que desde el middleware no se ve: sin este chequeo, un vendedor con
  // sesión pediría ?vendedor=RAMON y vería los datos del otro. El middleware
  // protege la página, no el dato.
  if (authConfigurada) {
    const permiso = permisoDelUsuario(await getUsuario());
    if (!puedeVerVendedor(permiso, vendedor)) {
      return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
    }
  }

  const filtros: FiltrosObjetivos = {
    vendedor,
    mes: lista(sp, "mes"),
    grupo: lista(sp, "grupo"),
    cliente: lista(sp, "cliente"),
  };

  try {
    const [data, opciones] = await Promise.all([
      getDashboardObjetivos(filtros),
      sp.get("conOpciones") ? getOpcionesObjetivos() : Promise.resolve(null),
    ]);
    return NextResponse.json({ ...data, opciones });
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : "Error desconocido";
    console.error("[api/objetivos]", error);
    return NextResponse.json({ error: mensaje }, { status: 500 });
  }
}
