/**
 * Pedirle a la planilla la foto de las ofertas DE AHORA.
 *
 * ---------------------------------------------------------------------------
 * POR QUE HACE FALTA SI YA SE MANDA SOLA
 *
 * El Apps Script del Consolidador manda la hoja cada 12 horas. Para lo que es
 * --una planilla que se toca cuando cambia una lista, en octubre una vez-- eso
 * alcanza y sobra. Pero el botón de actualizar costos es justo el caso en que
 * NO alcanza: se edita la planilla y se actualiza a los cinco minutos, y la
 * foto de las 23:00 de anoche no tiene el cambio.
 *
 * Sin esto la pantalla decía de cuándo era la foto y se confiaba en que quien
 * la mirara se diera cuenta. Un aviso que hay que leer no es una garantía.
 *
 * ---------------------------------------------------------------------------
 * EL CAMINO, QUE DA UNA VUELTA LARGA A PROPOSITO
 *
 *   tablero  ->  doPost del Apps Script  ->  edge function  ->  ofertas_crudo
 *
 * El tablero NO lee la planilla: no tiene --ni tiene por qué tener-- permiso
 * sobre el Drive de nadie. Le pide al script, que ya vive adentro de la
 * planilla, que haga lo mismo que hace cada 12 horas. La hoja viaja por el
 * camino que ya estaba probado y acá sólo se espera el resultado.
 *
 * Cuando `doPost` contesta, la fila ya está escrita: el script espera la
 * respuesta de la edge function antes de contestar. Así que después de esto se
 * puede leer `ofertas_crudo` y la foto nueva está.
 *
 * ---------------------------------------------------------------------------
 * LOS DOS SECRETOS
 *
 *   OFERTAS_WEBAPP_URL   la URL de la implementación del script (termina en
 *                        /exec). No es secreta de verdad --lo que protege es
 *                        el token-- pero cambia cada vez que se publica una
 *                        versión nueva, así que vive en una variable.
 *   OFERTAS_TOKEN        el mismo que ya tienen el script y la edge function.
 *
 * NINGUNA LLEVA `NEXT_PUBLIC_`, y no hay que agregárselo: eso las mandaría al
 * navegador. Este archivo corre sólo en el servidor.
 */

/** Cuánto se espera antes de darlo por perdido. */
const ESPERA_MS = 45_000;

export type ResultadoDelPedido =
  /** Llegó la foto nueva. */
  | { estado: "ok"; id: number | null; filas: number | null }
  /** Todavía no se cargaron los secretos. No es una falla: es que falta atarlo. */
  | { estado: "sin_conectar" }
  /** Se intentó y no se pudo. El motivo va tal cual para poder arreglarlo. */
  | { estado: "falla"; motivo: string };

export const planillaConectada = Boolean(
  process.env.OFERTAS_WEBAPP_URL && process.env.OFERTAS_TOKEN,
);

/**
 * `traer` se puede pasar para poder probar esto sin red. No es un adorno: lo
 * que hay que probar acá no es el fetch sino CADA FORMA DE FALLAR, porque el
 * texto que devuelve es lo único que va a decir qué hay que arreglar.
 */
export async function pedirFotoDeOfertas(
  traer: typeof fetch = fetch,
  entorno: { url?: string; token?: string } = {
    url: process.env.OFERTAS_WEBAPP_URL,
    token: process.env.OFERTAS_TOKEN,
  },
): Promise<ResultadoDelPedido> {
  const { url, token } = entorno;
  if (!url || !token) return { estado: "sin_conectar" };

  let respuesta: Response;
  try {
    respuesta = await traer(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
      // LAS APPS WEB DE GOOGLE CONTESTAN CON UN REDIRECT a
      // script.googleusercontent.com. `fetch` lo sigue solo; si algún día deja
      // de seguirlo, lo que llega es un 302 con el cuerpo vacío.
      redirect: "follow",
      signal: AbortSignal.timeout(ESPERA_MS),
      cache: "no-store",
    });
  } catch (e) {
    const esTiempo = e instanceof Error && e.name === "TimeoutError";
    return {
      estado: "falla",
      motivo: esTiempo
        ? `La planilla no contestó en ${ESPERA_MS / 1000} segundos.`
        : `No se pudo hablar con la planilla: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  if (!respuesta.ok) {
    return { estado: "falla", motivo: `La planilla contestó HTTP ${respuesta.status}.` };
  }

  // EL SCRIPT CONTESTA 200 AUNQUE HAYA FALLADO, con `ok: false` adentro. Es a
  // propósito: así un error de la hoja llega como JSON y no como la página de
  // error en HTML de Apps Script, que desde acá se leería como "anduvo".
  let cuerpo: { ok?: boolean; error?: string; respuesta?: string };
  try {
    cuerpo = (await respuesta.json()) as typeof cuerpo;
  } catch {
    return {
      estado: "falla",
      motivo:
        "La planilla contestó algo que no es JSON. Suele ser que la implementación " +
        "quedó en una versión vieja o que pide iniciar sesión.",
    };
  }

  if (!cuerpo.ok) {
    const motivo = cuerpo.error ?? "sin detalle";
    return {
      estado: "falla",
      motivo:
        motivo === "token invalido"
          ? "El token del tablero no coincide con el de la planilla."
          : `La planilla no pudo mandar la hoja: ${motivo}`,
    };
  }

  // `respuesta` viene como texto: es tal cual lo que contestó la edge
  // function. Si no se puede leer no es un problema -- la fila ya se escribió
  // y la pantalla la va a encontrar igual, sólo que sin el id.
  return { estado: "ok", ...leerLaRespuesta(cuerpo.respuesta) };
}

function leerLaRespuesta(texto: string | undefined): { id: number | null; filas: number | null } {
  if (!texto) return { id: null, filas: null };
  try {
    const j = JSON.parse(texto) as { id?: number; filas?: number };
    return { id: typeof j.id === "number" ? j.id : null, filas: typeof j.filas === "number" ? j.filas : null };
  } catch {
    return { id: null, filas: null };
  }
}
