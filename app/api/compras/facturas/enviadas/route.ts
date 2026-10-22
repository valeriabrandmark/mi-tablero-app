import { NextResponse, type NextRequest } from "next/server";
import { permisoDelUsuario, puedeCargarFacturas, puedeVer } from "@/lib/permisos";
import {
  esEstadoReclamo,
  getFacturasEnviadas,
  marcarReclamo,
} from "@/lib/queries-facturas";
import { authConfigurada } from "@/lib/supabase/env";
import { getUsuario } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Las facturas que se mandaron a Sigma, y qué falta reclamarle al proveedor.
 *
 * ---------------------------------------------------------------------------
 * DOS PERMISOS DISTINTOS, A PROPOSITO
 *
 * VER la lista alcanza con ver el módulo: es mirar lo que ya pasó, no cambia
 * nada en ningún lado.
 *
 * MARCAR un reclamo pide el mismo permiso que mandar la factura. No porque
 * escriba en el ERP --no lo hace-- sino por lo que significa: tildar "omitido"
 * es decidir que una diferencia de plata no se le reclama al proveedor, y eso
 * es una decisión comercial, no un cambio de vista.
 */

export async function GET(request: NextRequest) {
  if (authConfigurada) {
    const permiso = permisoDelUsuario(await getUsuario());
    if (!puedeVer(permiso, "/api/compras/facturas")) {
      return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
    }
  }

  try {
    const soloPendientes =
      request.nextUrl.searchParams.get("pendientes") === "1";
    return NextResponse.json({
      facturas: await getFacturasEnviadas({ soloPendientes }),
    });
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : "Error desconocido";
    console.error("[api/compras/facturas/enviadas] GET", error);
    return NextResponse.json({ error: mensaje }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  let usuario: string | null = "local";
  if (authConfigurada) {
    const quien = await getUsuario();
    usuario = quien?.email ?? null;
    if (!puedeCargarFacturas(permisoDelUsuario(quien), usuario)) {
      return NextResponse.json(
        {
          error:
            "Tu usuario no está habilitado para cerrar reclamos. Se habilita " +
            "con el módulo de carga de facturas.",
        },
        { status: 403 },
      );
    }
  }

  let cuerpo: { id?: unknown; reclamo?: unknown; nota?: unknown };
  try {
    cuerpo = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }

  const id = Number(cuerpo.id);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "Falta la factura" }, { status: 400 });
  }
  // EL ESTADO TIENE QUE SER UNO DE LOS TRES. Uno inventado dejaría la factura
  // fuera de las tres listas: ni pendiente, ni reclamada, ni omitida.
  if (!esEstadoReclamo(cuerpo.reclamo)) {
    return NextResponse.json({ error: "Ese estado no existe" }, { status: 400 });
  }

  const nota = typeof cuerpo.nota === "string" ? cuerpo.nota.trim() : "";

  try {
    await marcarReclamo(id, cuerpo.reclamo, usuario, nota || null);
    return NextResponse.json({
      facturas: await getFacturasEnviadas({ soloPendientes: false }),
    });
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : "Error desconocido";
    console.error("[api/compras/facturas/enviadas] PATCH", error);
    return NextResponse.json({ error: mensaje }, { status: 500 });
  }
}
