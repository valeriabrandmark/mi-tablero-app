import { Pool, type QueryResultRow } from "pg";

/**
 * Pool de conexiones a Postgres (Supabase).
 * Las credenciales SIEMPRE vienen de variables de entorno — ver .env.example.
 */

declare global {
  var __pgPool: Pool | undefined;
}

function createPool(): Pool {
  const host = process.env.DB_HOST;
  const user = process.env.DB_USER;
  const password = process.env.DB_PASS;
  const database = process.env.DB_NAME;

  const faltantes = [
    ["DB_HOST", host],
    ["DB_USER", user],
    ["DB_PASS", password],
    ["DB_NAME", database],
  ]
    .filter(([, v]) => !v)
    .map(([k]) => k);

  if (faltantes.length > 0) {
    throw new Error(
      `Faltan variables de entorno de la base: ${faltantes.join(", ")}. ` +
        `Cargalas en .env.local (local) o en Vercel → Settings → Environment Variables.`,
    );
  }

  return new Pool({
    host,
    port: Number(process.env.DB_PORT ?? 5432),
    user,
    password,
    database,
    // Supabase exige TLS; el certificado es de una CA propia, por eso no se verifica.
    ssl: { rejectUnauthorized: false },
    // En serverless conviene mantener el pool chico.
    max: 3,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 15_000,
  });
}

export function getPool(): Pool {
  // En dev, Next recarga los módulos en cada cambio: cacheamos el pool en global
  // para no abrir una conexión nueva por hot-reload.
  if (!global.__pgPool) {
    global.__pgPool = createPool();
    global.__pgPool.on("error", (err) => {
      console.error("[pg] error en cliente idle:", err.message);
    });
  }
  return global.__pgPool;
}

/**
 * Todo parámetro tiene que aparecer en el SQL. Si alguno sobra, Postgres no
 * puede inferir su tipo y la consulta muere con:
 *
 *     could not determine data type of parameter $1
 *
 * Ese mensaje no dice qué consulta fue ni cuál es el parámetro de más, así que
 * rompió una pantalla entera el 21/08/2026 y hubo que reconstruir a mano cuál
 * de las cinco consultas era. Chequearlo acá cuesta nada y falla nombrando el
 * problema.
 *
 * No agrega falsos positivos: el caso que detecta es exactamente el que
 * Postgres ya rechaza. Sólo adelanta el error y lo dice mejor.
 */
function verificarParametros(text: string, params: unknown[]): void {
  const faltantes = params
    .map((_, i) => i + 1)
    .filter((n) => !new RegExp(`\\$${n}(?![0-9])`).test(text));

  if (faltantes.length > 0) {
    throw new Error(
      `La consulta recibe ${params.length} parámetros pero no usa ` +
        `${faltantes.map((n) => `$${n}`).join(", ")}. Postgres no puede inferir ` +
        `el tipo de un parámetro que no aparece en el SQL: sacalo de la lista, ` +
        `o usalo. SQL: ${text.trim().slice(0, 120)}…`,
    );
  }
}

export async function query<T extends QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  verificarParametros(text, params);
  const res = await getPool().query<T>(text, params);
  return res.rows;
}

/** Primera fila, o `null` si la consulta no devolvió nada. */
export async function queryOne<T extends QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}
