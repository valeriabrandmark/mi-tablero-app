import { NextResponse, type NextRequest } from "next/server";
import { enConstruccion, permisoDelUsuario, puedeVer, puedeVerBorradores } from "@/lib/permisos";
import { deshacerCambio, getCambiosPreciosTn } from "@/lib/queries-precios-tn";
import { authConfigurada } from "@/lib/supabase/env";
import { getUsuario } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function autorizar(): Promise<{ error: NextResponse } | { quien: string }> {
  if (!authConfigurada) return { quien: "desarrollo" };

  const usuario = await getUsuario();
  const permiso = permisoDelUsuario(usuario);
  if (!puedeVer(permiso, "/api/precios-tn")) {
    return { error: NextResponse.json({ error: "Sin permiso" }, { status: 403 }) };
  }
  if (enConstruccion("/precios-tn") && !puedeVerBorradores(permiso)) {
    return { error: NextResponse.json({ error: "En construcción" }, { status: 403 }) };
  }
  return { quien: usuario?.email ?? "sin email" };
}

/** El historial de precios escritos en la tienda. */
export async function GET() {
  const auth = await autorizar();
  if ("error" in auth) return auth.error;

  return NextResponse.json({ cambios: await getCambiosPreciosTn() });
}

/**
 * Deshacer un cambio.
 *
 * ESTA RUTA NO HABLA CON TIENDA NUBE, igual que el resto de la aplicación.
 * Crea una propuesta en sentido contrario, ya aprobada, y la escritura la hace
 * `precios aplicar` con el token que este tablero no tiene. La vuelta larga es
 * el punto: hace que deshacer pase por los mismos controles que cualquier otro
 * precio, incluido el que impide pisar una corrección que alguien haya hecho a
 * mano en el medio.
 */
export async function POST(request: NextRequest) {
  const auth = await autorizar();
  if ("error" in auth) return auth.error;

  const cuerpo = await request.json().catch(() => null);
  const id = Number(cuerpo?.id);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: "Pedido inválido" }, { status: 400 });
  }

  const propuesta = await deshacerCambio(id, auth.quien);
  if (propuesta === null) {
    // No es un error del servidor: ese cambio ya tenía una vuelta atrás en
    // cola, o no existe. Fingir que funcionó sería peor.
    return NextResponse.json(
      { error: "Ese cambio ya tiene una vuelta atrás pedida, o no existe." },
      { status: 409 },
    );
  }
  return NextResponse.json({ ok: true, propuesta });
}
