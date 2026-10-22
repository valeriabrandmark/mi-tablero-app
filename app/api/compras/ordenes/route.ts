import { NextResponse } from "next/server";
import {
  enConstruccion,
  permisoDelUsuario,
  puedeVer,
  puedeVerBorradores,
} from "@/lib/permisos";
import { getOrdenesEnviadas } from "@/lib/queries-ordenes";
import { authConfigurada } from "@/lib/supabase/env";
import { getUsuario } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * El historial de órdenes mandadas al ERP.
 *
 * MIRA MÁS GENTE DE LA QUE PUEDE MANDAR, y es a propósito. Escribir en el ERP
 * es `superadmin`; leer qué se compró es la misma información que ya muestra
 * Compras --SKU, cantidades, costos-- para todo el que tiene la sección. Un
 * historial que sólo ve quien lo escribió no sirve para lo que se pidió: poder
 * comparar contra lo que se mandó la vez pasada.
 *
 * ---------------------------------------------------------------------------
 * TAMBIEN LO LEE LA CARGA DE FACTURAS, Y POR ESO ACEPTA LOS DOS MODULOS
 *
 * Es contra estas órdenes que se cruza una factura: sin ellas, la pantalla
 * puede cargar la factura pero no tiene contra qué compararla. Cuando la carga
 * de facturas se separó en su propio módulo, esta ruta se quedó pidiendo
 * Compras y el primer usuario que tuvo facturas sin Compras entró a una
 * pantalla que le decía "Sin permiso" en el primer panel.
 *
 * Darle las órdenes a quien carga facturas no abre nada nuevo: son los mismos
 * SKU, cantidades y costos que va a ver en el cruce de la factura que está
 * cargando.
 */
export async function GET() {
  if (authConfigurada) {
    const permiso = permisoDelUsuario(await getUsuario());
    // SU PROPIA RUTA, y no dos a mano. Quién puede leerla lo decide
    // `lib/modulos.ts` --Compras la posee, la carga de facturas la lee-- que
    // es la MISMA regla que aplica el proxy. Chequear otra cosa acá fue el
    // error anterior: el proxy cortaba antes y este `if` nunca corría.
    if (!puedeVer(permiso, "/api/compras/ordenes")) {
      return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
    }
    // EL CARTEL DE "EN CONSTRUCCION" ES DE COMPRAS, no de esta ruta. A quien
    // entra por la carga de facturas no le corresponde: su pantalla está
    // publicada, y quedarse sin las órdenes la dejaría sin contra qué cruzar
    // por el estado de OTRO tablero.
    const porCompras = !puedeVer(permiso, "/facturas-compra");
    if (
      porCompras &&
      enConstruccion("/stock/compras") &&
      !puedeVerBorradores(permiso)
    ) {
      return NextResponse.json({ error: "En construcción" }, { status: 403 });
    }
  }

  try {
    return NextResponse.json({ ordenes: await getOrdenesEnviadas(200) });
  } catch (error) {
    const mensaje =
      error instanceof Error ? error.message : "Error desconocido";
    console.error("[api/compras/ordenes]", error);
    return NextResponse.json({ error: mensaje }, { status: 500 });
  }
}
