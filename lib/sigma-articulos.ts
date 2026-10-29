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
 * UN SOLO INTENTO
 *
 * `sigma.py` reintenta los 429 esperando lo que diga `X-Retry-After-ms`, y los
 * 403 por saturación con esperas de 60s, 120s, 180s. Eso sirve en un proceso de
 * fondo; acá hay alguien mirando la pantalla. Un intento, y si Sigma está
 * saturado se lo dice con esas palabras para que vuelva a apretar en un rato.
 */

const ENDPOINT = "ExportArticulos";

/** Lo que tarda en cortar. Entre los 30 s de las facturas y los 60 s de la OC. */
const TIMEOUT_MS = 30_000;

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
): Promise<RespuestaSigma> {
  const { cliente, alias, id, token } = entorno;
  if (!cliente || !alias || !id || !token) return { estado: "sin_conectar" };

  let respuesta: Response;
  try {
    respuesta = await traer(url(entorno), {
      headers: { "X-Auth-Token": token },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    const e = error as Error;
    if (e?.name === "TimeoutError" || e?.name === "AbortError") {
      return {
        estado: "falla",
        motivo: `Sigma no contestó en ${TIMEOUT_MS / 1000} s.`,
      };
    }
    return { estado: "falla", motivo: `No se pudo llegar a Sigma: ${e?.message ?? e}` };
  }

  // 429 Y 403 SON SATURACION, NO UN ERROR DE LO QUE SE PIDIO. Se nombran
  // aparte porque la acción que corresponde es distinta: no hay nada que
  // corregir, hay que esperar un rato y volver a apretar.
  if (respuesta.status === 429 || respuesta.status === 403) {
    return {
      estado: "falla",
      motivo:
        `Sigma está saturado (HTTP ${respuesta.status}). ` +
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
