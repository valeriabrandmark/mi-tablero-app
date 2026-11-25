/**
 * Llamadas a la API de FIXY (https://argentina.fixylogistica.com/docs).
 *
 * El token va EN EL CUERPO del pedido (`api_token`), no en un encabezado: es
 * como lo pide FIXY en todos sus endpoints. Por eso se agrega acá, al momento
 * de mandar, y no forma parte del payload que se guarda como constancia.
 */

const URL_BASE =
  process.env.FIXY_URL_BASE ?? "https://argentina.fixylogistica.com/api/v2/";

/** Ver tablero_quo/digip.py: sin tope, un servidor que no contesta cuelga la ruta. */
const TIMEOUT_MS = 30_000;

export function fixyConfigurado(): boolean {
  return Boolean(process.env.FIXY_API_TOKEN);
}

export type RespuestaFixy =
  /** FIXY contestó 2xx. */
  | { tipo: "ok"; status: number; texto: string }
  /** FIXY dijo que no (4xx): no entró nada, se puede corregir y reintentar. */
  | { tipo: "rechazo"; status: number; texto: string }
  /** Error del servidor o se cortó: pudo haber entrado. Hay que mirar antes de reintentar. */
  | { tipo: "incierto"; status: number | null; texto: string };

export async function llamarFixy(
  endpoint: string,
  cuerpo: Record<string, unknown>,
): Promise<RespuestaFixy> {
  const token = process.env.FIXY_API_TOKEN;
  if (!token) throw new Error("FIXY_API_TOKEN no está configurada.");

  let res: Response;
  try {
    res = await fetch(URL_BASE + endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ api_token: token, ...cuerpo }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (e) {
    return {
      tipo: "incierto",
      status: null,
      texto: e instanceof Error ? e.message : "Sin respuesta de FIXY",
    };
  }

  const texto = (await res.text().catch(() => "")).slice(0, 4000);
  if (res.ok) {
    // Algunas APIs de este estilo contestan 200 con {"status": "error"}.
    // Eso es un rechazo, no un ok.
    try {
      const j = JSON.parse(texto);
      if (j && typeof j === "object" && String(j.status).toLowerCase() === "error") {
        return { tipo: "rechazo", status: res.status, texto };
      }
    } catch {
      // No es JSON: se toma el 2xx como ok.
    }
    return { tipo: "ok", status: res.status, texto };
  }
  if (res.status >= 400 && res.status < 500) {
    return { tipo: "rechazo", status: res.status, texto };
  }
  return { tipo: "incierto", status: res.status, texto };
}
