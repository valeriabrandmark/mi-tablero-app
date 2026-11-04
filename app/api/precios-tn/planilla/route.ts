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
    // SE DISTINGUE "el servidor no tiene token" DE "el token esta mal", Y LA
    // PRIMERA VERSION NO LO HACIA.
    //
    // Parecia lo prudente: no contar nada. Costo una tarde. La variable se
    // cargo en Vercel DESPUES del deploy --que es lo normal, y en Vercel no
    // entra en vigencia hasta el siguiente-- asi que el servidor rechazaba
    // todo, y el cartel del Apps Script afirmaba "el token no coincide". Se
    // reviso tres veces un token que estaba bien.
    //
    // Y NO SE FILTRA NADA UTIL. Cuando no hay token configurado, la ruta
    // rechaza TODO: no hay llave que adivinar ni dato que sacar. Lo unico que
    // se cuenta es que la ruta todavia no esta configurada, que es
    // exactamente lo que quien la configura necesita saber.
    const sinConfigurar = !process.env.PLANILLA_PRECIOS_TOKEN;
    if (sinConfigurar) {
      console.error(
        "PLANILLA_PRECIOS_TOKEN no esta configurada: la planilla no puede leer.",
      );
    }
    return NextResponse.json(
      {
        error: "Sin permiso",
        motivo: sinConfigurar ? "sin_configurar" : "token_invalido",
        detalle: sinConfigurar
          ? "El tablero no tiene PLANILLA_PRECIOS_TOKEN. Si ya la cargaste en " +
            "Vercel, falta volver a desplegar: las variables nuevas recien " +
            "entran en el deploy siguiente."
          : "El token del script no coincide con el del tablero.",
      },
      { status: 401 },
    );
  }

  const { comparadoEn, filas } = await getPreciosParaPlanilla();
  return NextResponse.json({
    // CUANDO CORRIO LA COMPARACION, no cuando se pidio el dato. Ver
    // `getPreciosParaPlanilla`: la hora de la respuesta siempre es ahora, y
    // puesta al lado de unos precios afirma que son de ahora.
    comparadoEn,
    total: filas.length,
    precios: filas,
  });
}
