import { query, queryOne } from "@/lib/db";
import type { ArticuloParaCostear } from "@/lib/costos-snapshot";

/**
 * El último maestro que Sigma contestó bien, guardado en `app.sigma_maestro`.
 *
 * ---------------------------------------------------------------------------
 * LA PANTALLA SATURABA A SIGMA SOLA
 *
 * Cada request le pedía a Sigma el maestro entero (~8.300 artículos): dos al
 * abrir la pantalla --la carga, y la recarga cuando vuelve la planilla--, uno
 * al bajar el Excel y otro al aplicar. Y como la respuesta a un 429 era
 * "recargá", recargar sumaba dos más. Sigma se satura justamente con eso, así
 * que la pantalla terminaba casi siempre en la copia del día anterior.
 *
 * Ahora un pedido bueno se guarda y se reusa:
 *
 *   - VIGENCIA corta (ver `VIGENCIA_MS`): dentro de esa ventana nadie vuelve a
 *     llamar a Sigma. Para traer un costo recién cambiado, la pantalla tiene
 *     "Pedir a Sigma de nuevo", que la saltea.
 *
 *   - APLICAR Y BAJAR EL EXCEL usan el pedido que se miró, por id. Antes cada
 *     uno pedía de nuevo, y un 429 en el segundo pedido aplicaba la copia
 *     vieja mientras la pantalla mostraba lo de Sigma.
 *
 *   - PLAN B: si Sigma no contesta, el último pedido bueno del tablero --de
 *     hace minutos u horas-- antes que la copia diaria del orquestador.
 *
 * TODO TOLERA QUE LA TABLA NO EXISTA. Si la migración no corrió, la pantalla
 * anda exactamente como antes: pidiendo a Sigma cada vez.
 */

/** Cuánto sirve un pedido sin volver a llamar a Sigma. */
export const VIGENCIA_MS = 10 * 60_000;

/** Cuántos pedidos se guardan. Cada uno pesa ~1 MB. */
const SE_GUARDAN = 10;

export type MaestroGuardado = {
  id: number;
  /** Cuándo contestó Sigma, en hora de Buenos Aires. */
  pedidoEn: string;
  /** Hace cuánto, en milisegundos. Lo calcula la base para no depender del reloj de acá. */
  edadMs: number;
  articulos: ArticuloParaCostear[];
};

type Fila = {
  id: string;
  pedido_en: string;
  edad_ms: string;
  articulos: ArticuloParaCostear[];
};

const COLUMNAS = `
  id,
  to_char(pedido at time zone 'America/Argentina/Buenos_Aires', 'DD/MM/YYYY HH24:MI') as pedido_en,
  floor(extract(epoch from (now() - pedido)) * 1000)::bigint as edad_ms,
  articulos`;

function deFila(f: Fila | null): MaestroGuardado | null {
  if (!f || !Array.isArray(f.articulos) || f.articulos.length === 0) return null;
  return {
    id: Number(f.id),
    pedidoEn: f.pedido_en,
    edadMs: Number(f.edad_ms),
    articulos: f.articulos,
  };
}

/** El último pedido bueno, o `null` si no hay (o si la tabla no existe). */
export async function ultimoMaestroGuardado(): Promise<MaestroGuardado | null> {
  try {
    return deFila(
      await queryOne<Fila>(
        `select ${COLUMNAS} from app.sigma_maestro order by pedido desc limit 1`,
      ),
    );
  } catch (error) {
    console.warn("[sigma-maestro] no se pudo leer el último pedido", error);
    return null;
  }
}

/** Un pedido en particular: el que se miró en pantalla. */
export async function maestroGuardadoPorId(id: number): Promise<MaestroGuardado | null> {
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  try {
    return deFila(
      await queryOne<Fila>(`select ${COLUMNAS} from app.sigma_maestro where id = $1`, [id]),
    );
  } catch (error) {
    console.warn("[sigma-maestro] no se pudo leer el pedido", id, error);
    return null;
  }
}

/**
 * Guarda un pedido bueno y poda los viejos. Devuelve el id, o `null` si no se
 * pudo: no guardarlo no puede voltear la pantalla, sólo hace que el próximo
 * request vuelva a pedir.
 */
export async function guardarMaestro(
  articulos: ArticuloParaCostear[],
): Promise<{ id: number; pedidoEn: string } | null> {
  try {
    const fila = await queryOne<{ id: string; pedido_en: string }>(
      `insert into app.sigma_maestro (articulos, n)
       values ($1::jsonb, $2)
       returning id,
                 to_char(pedido at time zone 'America/Argentina/Buenos_Aires',
                         'DD/MM/YYYY HH24:MI') as pedido_en`,
      [JSON.stringify(articulos), articulos.length],
    );
    await query(
      `delete from app.sigma_maestro
        where id not in (select id from app.sigma_maestro order by pedido desc limit $1)`,
      [SE_GUARDAN],
    );
    return fila ? { id: Number(fila.id), pedidoEn: fila.pedido_en } : null;
  } catch (error) {
    console.warn("[sigma-maestro] no se pudo guardar el pedido", error);
    return null;
  }
}

/**
 * Si un pedido guardado es más nuevo que la copia que deja el orquestador.
 * `null` si no se sabe (no hay estado del orquestador, o no se pudo leer).
 *
 * Aparte de las otras lecturas porque `ops.estado` es del orquestador: que
 * cambie de forma no puede dejar sin caché a la pantalla.
 *
 * El paso del orquestador escribe hora local sin zona --es la que se muestra
 * tal cual en "copia del ..."--, así que se la lee como hora de Buenos Aires.
 */
export async function esMasNuevoQueLaCopia(id: number): Promise<boolean | null> {
  try {
    const fila = await queryOne<{ mas_nuevo: boolean | null }>(
      `select m.pedido > (
                select (valor -> 'sigma.py --catalogo' ->> 'ok')::timestamp
                         at time zone 'America/Argentina/Buenos_Aires'
                  from ops.estado where clave = 'pasos'
              ) as mas_nuevo
         from app.sigma_maestro m
        where m.id = $1`,
      [id],
    );
    return fila?.mas_nuevo ?? null;
  } catch {
    return null;
  }
}
