import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getPreciosParaPlanilla } from "@/lib/queries-precios-tn";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Los precios para la planilla "markup tienda nube".
 *
 * ---------------------------------------------------------------------------
 * LA LLAMA UN APPS SCRIPT, NO UN NAVEGADOR CON SESION.
 *
 * El resto de las rutas de Precios TN se protegen con el usuario de Supabase:
 * la pantalla manda su cookie y `permisoDelUsuario` decide. Un Apps Script no
 * tiene cookie ni usuario del tablero -- corre en Google, con la cuenta de
 * quien abre la planilla -- asi que necesita otra llave.
 *
 * Es el mismo patron que ya usa `lib/ofertas-webapp.ts` para el camino
 * contrario (el tablero llamando a un Apps Script): un token compartido que
 * viaja en el header. Quien lo tiene, lee; nadie mas.
 *
 * DEVUELVE DOS NUMEROS POR SKU Y NADA MAS. Ver `getPreciosParaPlanilla`: la
 * planilla ya tiene las formulas de markup, margen y estado esperando que se
 * llenen las columnas I y N. Mandar tambien esas cuentas seria calcularlas de
 * este lado con otros supuestos y terminar con dos numeros que se contradicen
 * en la misma fila.
 * ---------------------------------------------------------------------------
 */
function tokenValido(request: NextRequest): boolean {
  const esperado = process.env.PLANILLA_PRECIOS_TOKEN;
  if (!esperado) return false;

  const cabecera = request.headers.get("authorization") ?? "";
  const recibido = cabecera.startsWith("Bearer ") ? cabecera.slice(7) : "";
  if (!recibido) return false;

  // SE COMPARAN LOS HASH Y NO LOS TEXTOS, por dos motivos. `timingSafeEqual`
  // explota si los buffers miden distinto, y medir distinto ya filtraria el
  // largo del token; y comparar con `===` tarda mas cuanto mas prefijo
  // coincide, que es lo que permite adivinarlo de a un caracter.
  const a = createHash("sha256").update(recibido).digest();
  const b = createHash("sha256").update(esperado).digest();
  return timingSafeEqual(a, b);
}

export async function GET(request: NextRequest) {
  if (!tokenValido(request)) {
    // NO SE DISTINGUE "falta el token" de "el token esta mal", a proposito:
    // la diferencia solo le sirve a quien esta probando llaves. Lo que sí se
    // distingue, en el log del servidor y no acá, es que falte la variable.
    if (!process.env.PLANILLA_PRECIOS_TOKEN) {
      console.error(
        "PLANILLA_PRECIOS_TOKEN no esta configurada: la planilla no puede leer.",
      );
    }
    return NextResponse.json({ error: "Sin permiso" }, { status: 401 });
  }

  const filas = await getPreciosParaPlanilla();
  return NextResponse.json({
    // La fecha viaja para que la planilla pueda decir de cuando es lo que
    // acaba de pegar. Sin eso, una corrida que fallo se ve igual que una que
    // anduvo: las mismas celdas, con los numeros de antes.
    generadoEn: new Date().toISOString(),
    total: filas.length,
    precios: filas,
  });
}
