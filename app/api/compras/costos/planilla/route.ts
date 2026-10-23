import { NextResponse } from "next/server";
import { permisoDelUsuario } from "@/lib/permisos";
import { pedirFotoDeOfertas } from "@/lib/ofertas-webapp";
import { authConfigurada } from "@/lib/supabase/env";
import { getUsuario } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Pedirle a la planilla la foto de las ofertas de ahora.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ESTA SEPARADO DE LA PANTALLA Y NO ADENTRO DEL GET
 *
 * Porque es lo único lento de todo esto. La vuelta --tablero, Apps Script,
 * edge function, base-- lleva varios segundos con once mil filas en el medio,
 * y si fuera parte del GET la pantalla no mostraría NADA hasta que terminara.
 * Peor: si la planilla tarda más de lo que la plataforma aguanta, no se vería
 * un aviso, se vería una pantalla rota.
 *
 * Así, la pantalla abre con la última foto que hay --que es lo que se veía
 * antes de todo esto-- y el pedido corre al lado. Cuando vuelve, la pantalla
 * se rearma sola con la foto nueva. Si no vuelve, queda el aviso y la foto
 * vieja a la vista, con la hora.
 *
 * Y SI ESTA RUTA SE CORTA POR TIEMPO pero la planilla igual llegó a mandar la
 * hoja, no se pierde nada: la fila ya está escrita y la pantalla la encuentra
 * cuando se recarga. Por eso el navegador recarga la foto SIEMPRE, salga bien
 * o salga mal, y recién ahí decide si hubo algo que avisar.
 */
export async function POST() {
  if (authConfigurada) {
    // EL MISMO ROL QUE PARA APLICAR: esto hace que la planilla entera viaje a
    // la base, y lo que llega es lo que va a decidir el costo de todo.
    if (permisoDelUsuario(await getUsuario())?.rol !== "superadmin") {
      return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
    }
  }

  // NO SE DEVUELVE 500 CUANDO LA PLANILLA FALLA. Que no se haya podido pedir
  // la foto no es un error del tablero: es un dato que la pantalla tiene que
  // mostrar, al lado de la foto vieja que igual se puede usar.
  return NextResponse.json(await pedirFotoDeOfertas());
}
