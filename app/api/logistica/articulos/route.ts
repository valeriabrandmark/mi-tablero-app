import { NextResponse, type NextRequest } from "next/server";
import { getArticulosDelEnvio } from "@/lib/queries-logistica";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Los artículos de un envío, o de uno de sus comprobantes.
 *
 * ---------------------------------------------------------------------------
 * EL PERMISO LO RESUELVE EL PROXY
 *
 * `/api/logistica` es una de las rutas del módulo `logistica` (ver
 * lib/modulos.ts) y el chequeo es por prefijo, así que esta ruta queda cubierta
 * sin repetirlo acá — igual que el resto de `/api/logistica`.
 *
 * ---------------------------------------------------------------------------
 * VA APARTE Y NO DENTRO DEL TABLERO
 *
 * Un envío puede tener 236 renglones y la tabla muestra 100 envíos: mandarlo
 * todo con el resto de la página serían decenas de miles de filas para las tres
 * que alguien va a abrir. Se pide al abrir el desglose.
 */
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;

  // La preparación es un bigint: se valida acá y no se le pasa a la consulta
  // lo que venga. Un texto suelto reventaría el casteo en la base, que es un
  // error 500 donde corresponde un 400.
  const cruda = sp.get("preparacion") ?? "";
  const preparacion = Number(cruda);
  if (!/^\d{1,18}$/.test(cruda) || !Number.isSafeInteger(preparacion)) {
    return NextResponse.json(
      { error: "Falta el número de preparación" },
      { status: 400 },
    );
  }

  // Opcional: sin comprobante se devuelven los artículos de todo el envío.
  const comprobante = sp.get("comprobante")?.slice(0, 40) || null;

  try {
    return NextResponse.json({
      articulos: await getArticulosDelEnvio(preparacion, comprobante),
    });
  } catch (error) {
    const mensaje =
      error instanceof Error ? error.message : "Error desconocido";
    console.error("[api/logistica/articulos]", error);
    return NextResponse.json({ error: mensaje }, { status: 500 });
  }
}
