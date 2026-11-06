import type { ArticuloParaCostear } from "@/lib/costos-snapshot";

/**
 * El maestro de artículos pedido a Sigma EN EL MOMENTO.
 *
 * ---------------------------------------------------------------------------
 * POR QUE NO ALCANZA LA COPIA DE LA BASE
 *
 * `bronze.sigma_articulos` la escribe el orquestador con `sigma.py --catalogo`,
 * que corre UNA VEZ POR DIA (`cada_horas: 24`). Para lo que la usa el resto del
 * tablero --proveedor, marca, IVA de cada SKU-- eso sobra: un alta o un cambio
 * de descripción puede esperar.
 *
 * Para el botón de costos no sobra, y se vio el 29/10/2026: ANA cambió costos
 * en Sigma, apretó el botón y no pasó nada. El catálogo había corrido bien a las
 * 11:15 del día anterior y faltaba una hora para que le tocara de nuevo, así que
 * la copia tenía 23 horas y el botón escribió los costos viejos sin decir nada.
 *
 * Y forzar una corrida del orquestador no lo arregla: `cada_horas` se mide sólo
 * en horas transcurridas, así que el paso se saltea igual.
 *
 * ---------------------------------------------------------------------------
 * SI SIGMA NO CONTESTA, SE USA LA COPIA PERO SE DICE
 *
 * No se corta. Que Sigma esté caído no puede dejar sin actualizar una oferta que
 * sí cambió, y la copia del día anterior casi siempre está bien. Lo que no se
 * repite es lo que causó el problema: usarla EN SILENCIO. La pantalla y la
 * carátula del archivo dicen de dónde salió el costo teórico y, cuando es la
 * copia, de cuándo es y por qué no se pudo pedir en vivo.
 *
 * ---------------------------------------------------------------------------
 * SE REINTENTA LO QUE FALLA RAPIDO, Y NADA MAS
 *
 * Antes era un solo intento, y para un 429 eso era muy poco: Sigma se satura
 * por segundos y contesta el 429 en milisegundos, así que un rebote de nada
 * mandaba la pantalla al plan B y a la copia del día anterior. El 06/11/2026
 * pasó con costos cambiados una hora antes.
 *
 * Pero reintentar TODO sería peor. Hay dos formas de fallar y no se parecen:
 *
 *   LAS RAPIDAS --429, 403 por saturación, 502/503/504-- vuelven enseguida y
 *   casi siempre se van solas. Esas se reintentan.
 *
 *   LA LENTA --el timeout-- ya se comió el presupuesto entero. Reintentarla
 *   duplicaría la espera y la ruta tiene `maxDuration = 60`: el segundo
 *   intento no terminaría, y en vez de "Sigma está lento" la pantalla daría
 *   un error pelado. Esa NO se reintenta.
 *
 * Por eso el presupuesto es de los 30 s PARA TODOS LOS INTENTOS, y cada uno
 * corta con lo que queda. Con dos reintentos cortos, el peor caso sigue
 * entrando en los 30 s de siempre y la ruta conserva sus 30 s de aire.
 *
 * LA ESPERA LA DICE SIGMA. Si manda `X-Retry-After-ms` --que es lo que lee
 * `sigma.py`-- se respeta, con un techo: en un proceso de fondo se puede
 * esperar tres minutos, acá hay alguien esperando la pantalla.
 *
 * Y si después de todo sigue saturado, se dice igual que antes: que vuelva a
 * apretar en un rato. Lo que no cambia es el final; cambia cuántas veces se
 * llega a él.
 */

const ENDPOINT = "ExportArticulos";

/**
 * El tiempo para TODOS los intentos juntos, no para cada uno.
 *
 * Entre los 30 s de las facturas y los 60 s de la OC, y la mitad del
 * `maxDuration` de la ruta: la otra mitad es para la consulta a la base y el
 * armado de la foto.
 */
const PRESUPUESTO_MS = 30_000;

/** Un intento y dos reintentos. */
const INTENTOS = 3;

/** Lo máximo que se espera entre intentos, diga lo que diga Sigma. */
const ESPERA_TOPE_MS = 4_000;

/** Cuánto esperar cuando Sigma no dice nada. Crece, pero poco. */
const ESPERAS_POR_DEFECTO = [700, 2_000];

/**
 * Los HTTP que vuelven rápido y suelen irse solos.
 *
 * El 403 está acá porque Sigma lo usa para saturación y no sólo para permisos
 * --`sigma.py` lo trata igual--. Si fuera un token mal, el reintento cuesta dos
 * segundos y el mensaje final es el mismo.
 */
const SE_REINTENTA = new Set([403, 429, 502, 503, 504]);

/**
 * Cuánto esperar antes del próximo intento, según lo que haya dicho Sigma.
 *
 * Mira `X-Retry-After-ms` primero --es el que manda Sigma y el que lee
 * `sigma.py`-- y después el `Retry-After` estándar, que viene en SEGUNDOS. Lo
 * que pida se respeta sólo hasta el tope: un `Retry-After: 120` es correcto
 * para un proceso de fondo y acá sería dejar la pantalla colgada dos minutos.
 */
export function esperaAntesDeReintentar(
  cabeceras: Headers,
  intento: number,
): number {
  const ms = Number(cabeceras.get("X-Retry-After-ms"));
  if (Number.isFinite(ms) && ms > 0) return Math.min(ms, ESPERA_TOPE_MS);

  const seg = Number(cabeceras.get("Retry-After"));
  if (Number.isFinite(seg) && seg > 0) return Math.min(seg * 1000, ESPERA_TOPE_MS);

  return ESPERAS_POR_DEFECTO[Math.min(intento, ESPERAS_POR_DEFECTO.length - 1)];
}

const dormirDeVerdad = (ms: number) =>
  new Promise<void>((listo) => setTimeout(listo, ms));

export type EntornoSigma = {
  cliente?: string;
  alias?: string;
  id?: string;
  token?: string;
};

export type RespuestaSigma =
  | { estado: "ok"; articulos: ArticuloParaCostear[] }
  /** Sin las variables cargadas. No es una falla: es que no está atado. */
  | { estado: "sin_conectar" }
  | { estado: "falla"; motivo: string };

export function entornoDeSigma(): EntornoSigma {
  return {
    cliente: process.env.SIGMA_URL_CLIENTE,
    alias: process.env.SIGMA_BASEALIAS,
    id: process.env.SIGMA_ID_CLIENTE,
    token: process.env.SIGMA_TOKEN,
  };
}

/** Igual que `URL_BASE` de sigma.py, para que las dos pidan al mismo lugar. */
function url(e: EntornoSigma): string {
  return `https://${e.cliente}/${e.alias}/${e.id}/sigma/api/v10/${ENDPOINT}`;
}

/**
 * Un artículo del maestro, como lo manda Sigma.
 *
 * Se acepta `desactivado` como texto Y como booleano: en `bronze.sigma_articulos`
 * quedó como texto ('false'), pero eso es lo que hizo pandas al guardarlo, no
 * necesariamente lo que manda la API.
 */
function activo(desactivado: unknown): boolean {
  if (desactivado == null) return true;
  if (typeof desactivado === "boolean") return !desactivado;
  return String(desactivado).trim().toLowerCase() !== "true";
}

function texto(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function numero(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).trim());
  return Number.isFinite(n) ? n : null;
}

/**
 * EL MISMO RECORTE QUE HACE LA CONSULTA A LA COPIA: sólo los activos y sólo los
 * que tienen código. Si los dos caminos dejaran distintos artículos, el costo
 * dependería de si Sigma contestó -- y eso sería peor que la copia vieja.
 */
export function articulosDeLaRespuesta(datos: unknown): ArticuloParaCostear[] {
  if (!Array.isArray(datos)) return [];
  const salida: ArticuloParaCostear[] = [];
  for (const fila of datos) {
    if (fila == null || typeof fila !== "object") continue;
    const a = fila as Record<string, unknown>;
    const sku = texto(a.id);
    if (!sku || !activo(a.desactivado)) continue;
    salida.push({
      sku,
      proveedor: texto(a.proveedorNombre),
      descripcion: texto(a.descripcion),
      costoTeorico: numero(a.costoTeorico),
    });
  }
  // Ordenado por SKU, igual que la consulta a la copia (`order by 1`).
  salida.sort((x, y) => x.sku.localeCompare(y.sku));
  return salida;
}

export async function pedirArticulosASigma(
  traer: typeof fetch = fetch,
  entorno: EntornoSigma = entornoDeSigma(),
  reloj: { dormir?: (ms: number) => Promise<void>; ahora?: () => number } = {},
): Promise<RespuestaSigma> {
  const { cliente, alias, id, token } = entorno;
  if (!cliente || !alias || !id || !token) return { estado: "sin_conectar" };

  const dormir = reloj.dormir ?? dormirDeVerdad;
  const ahora = reloj.ahora ?? Date.now;
  const limite = ahora() + PRESUPUESTO_MS;

  let respuesta: Response;
  let intentos = 0;

  for (;;) {
    const queda = limite - ahora();
    // Sin tiempo no se intenta: un fetch con timeout 0 falla igual, pero con
    // un error que no explica nada.
    if (queda <= 0) {
      return {
        estado: "falla",
        motivo: `Sigma no contestó en ${PRESUPUESTO_MS / 1000} s.`,
      };
    }

    intentos++;
    try {
      respuesta = await traer(url(entorno), {
        headers: { "X-Auth-Token": token },
        signal: AbortSignal.timeout(queda),
      });
    } catch (error) {
      const e = error as Error;
      // EL TIMEOUT NO SE REINTENTA: ya se comió el presupuesto. Ver arriba.
      if (e?.name === "TimeoutError" || e?.name === "AbortError") {
        return {
          estado: "falla",
          motivo: `Sigma no contestó en ${PRESUPUESTO_MS / 1000} s.`,
        };
      }
      return { estado: "falla", motivo: `No se pudo llegar a Sigma: ${e?.message ?? e}` };
    }

    if (!SE_REINTENTA.has(respuesta.status)) break;

    const espera = esperaAntesDeReintentar(respuesta.headers, intentos - 1);
    // No se empieza un intento que no va a llegar a terminar: si lo único que
    // queda alcanza para la espera y nada más, se corta acá y se avisa.
    if (intentos >= INTENTOS || limite - ahora() <= espera) break;
    await dormir(espera);
  }

  // 429 Y 403 SON SATURACION, NO UN ERROR DE LO QUE SE PIDIO. Se nombran
  // aparte porque la acción que corresponde es distinta: no hay nada que
  // corregir, hay que esperar un rato y volver a apretar.
  if (respuesta.status === 429 || respuesta.status === 403) {
    return {
      estado: "falla",
      motivo:
        `Sigma está saturado (HTTP ${respuesta.status}) ` +
        `después de ${intentos} ${intentos === 1 ? "intento" : "intentos"}. ` +
        "Probá de nuevo en un par de minutos.",
    };
  }
  if (!respuesta.ok) {
    return { estado: "falla", motivo: `Sigma contestó HTTP ${respuesta.status}.` };
  }

  let datos: unknown;
  try {
    datos = await respuesta.json();
  } catch {
    return {
      estado: "falla",
      motivo: "Sigma contestó algo que no es JSON (¿una página de error?).",
    };
  }

  if (!Array.isArray(datos)) {
    return { estado: "falla", motivo: "Sigma no devolvió una lista de artículos." };
  }

  const articulos = articulosDeLaRespuesta(datos);

  // UN MAESTRO VACIO NO SE USA. Con cero artículos el snapshot diría que los
  // 8.240 se quedan sin costo, y aplicado dejaría el tablero entero en cero.
  // Es el mismo criterio que `stock_cierre_mes.py`: una foto vacía no pisa a
  // la que había.
  if (articulos.length === 0) {
    return {
      estado: "falla",
      motivo: `Sigma devolvió ${datos.length} filas y ningún artículo activo con código.`,
    };
  }

  return { estado: "ok", articulos };
}
