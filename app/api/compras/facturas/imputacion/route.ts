import { NextResponse, type NextRequest } from "next/server";
import { permisoDelUsuario, puedeEscribirEnElERP } from "@/lib/permisos";
import {
  getImputacionContable,
  guardarImputacion,
  type FilaImputacion,
} from "@/lib/queries-facturas";
import { CONCEPTOS_CONTABLES } from "@/lib/sigma-compra";
import { authConfigurada } from "@/lib/supabase/env";
import { getUsuario } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Las cuentas con las que se imputa una factura de compra en Sigma.
 *
 * MISMO PERMISO QUE MANDAR LA FACTURA, y no el de ver Compras: cambiar una
 * cuenta acá cambia a dónde va la plata en la contabilidad de la próxima
 * factura que se mande. Es una decisión del mismo peso que mandarla.
 */
async function quienPuede(): Promise<string | null | false> {
  if (!authConfigurada) return "local";
  const quien = await getUsuario();
  const email = quien?.email ?? null;
  return puedeEscribirEnElERP(permisoDelUsuario(quien), email) ? email : false;
}

export async function GET() {
  if ((await quienPuede()) === false) {
    return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  }
  try {
    return NextResponse.json({
      imputacion: await getImputacionContable(),
      conceptos: CONCEPTOS_CONTABLES,
    });
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : "Error desconocido";
    console.error("[api/compras/facturas/imputacion] GET", error);
    return NextResponse.json({ error: mensaje }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const usuario = await quienPuede();
  if (usuario === false) {
    return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  }

  let cuerpo: { fila?: Partial<FilaImputacion> };
  try {
    cuerpo = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }

  const concepto = String(cuerpo.fila?.concepto ?? "").trim();
  // EL CONCEPTO TIENE QUE SER UNO DE LOS QUE EXISTEN. Si no, cualquiera
  // llenaría la tabla de filas que ningún comprobante va a leer -- y, peor,
  // una mal escrita se vería cargada sin que ninguna factura la use.
  if (!CONCEPTOS_CONTABLES.includes(concepto)) {
    return NextResponse.json(
      { error: "Ese concepto contable no existe." },
      { status: 400 },
    );
  }

  const texto = (v: unknown, max = 40) =>
    typeof v === "string" ? v.trim().slice(0, max) : "";

  try {
    await guardarImputacion(
      {
        concepto,
        cuenta: texto(cuerpo.fila?.cuenta),
        subcuenta: texto(cuerpo.fila?.subcuenta) || null,
        centroCosto: texto(cuerpo.fila?.centroCosto) || null,
        tipoImpuesto: texto(cuerpo.fila?.tipoImpuesto, 10),
      },
      usuario,
    );
    return NextResponse.json({ imputacion: await getImputacionContable() });
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : "Error desconocido";
    console.error("[api/compras/facturas/imputacion] PUT", error);
    return NextResponse.json({ error: mensaje }, { status: 500 });
  }
}
