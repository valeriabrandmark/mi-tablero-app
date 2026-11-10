import { enTransaccion, query } from "@/lib/db";
import {
  normalizarParametros,
  parametrosPorDefecto,
  valorValido,
  type ClaveParametro,
  type ParametrosCompras,
} from "@/lib/compras-parametros";

/**
 * Lectura y escritura de las reglas del sugerido. Ver lib/compras-parametros.ts
 * y migraciones/compras_parametros.sql.
 */

export type CambioParametro = {
  clave: string;
  valorAnterior: number | null;
  valor: number | null;
  usuario: string;
  creadoEn: string;
};

/** Código de Postgres para "la tabla no existe". */
const TABLA_INEXISTENTE = "42P01";

function esTablaInexistente(e: unknown): boolean {
  return (e as { code?: string } | null)?.code === TABLA_INEXISTENTE;
}

/**
 * Los parámetros vigentes: lo guardado encima de los valores por defecto.
 *
 * SI LA MIGRACIÓN NO SE CORRIÓ, LOS DE SIEMPRE. Compras no puede dejar de
 * cargar porque falta una tabla de configuración: sin ella, el sugerido es el
 * de antes de que existiera.
 */
export async function getParametrosCompras(): Promise<ParametrosCompras> {
  try {
    const filas = await query<{ clave: string; valor: string }>(
      `select clave, valor from app.compras_parametros`,
    );
    return normalizarParametros(Object.fromEntries(filas.map((f) => [f.clave, f.valor])));
  } catch (e) {
    if (esTablaInexistente(e)) return parametrosPorDefecto();
    throw e;
  }
}

/** Los últimos cambios, para mostrar quién tocó qué. */
export async function getHistorialParametros(limite = 20): Promise<CambioParametro[]> {
  try {
    const filas = await query<{
      clave: string;
      valor_anterior: string | null;
      valor: string | null;
      usuario: string;
      creado_en: Date;
    }>(
      `select clave, valor_anterior, valor, usuario, creado_en
         from app.compras_parametros_historial
        order by creado_en desc
        limit $1`,
      [limite],
    );
    return filas.map((f) => ({
      clave: f.clave,
      valorAnterior: f.valor_anterior == null ? null : Number(f.valor_anterior),
      valor: f.valor == null ? null : Number(f.valor),
      usuario: f.usuario,
      creadoEn: new Date(f.creado_en).toISOString(),
    }));
  } catch (e) {
    if (esTablaInexistente(e)) return [];
    throw e;
  }
}

/**
 * Guarda los cambios. `null` en un valor es "volver al valor por defecto":
 * se borra la fila. Todo en una transacción, con su renglón de historial.
 *
 * Sólo se registra lo que CAMBIÓ: guardar el panel entero sin tocar nada no
 * llena el historial de renglones iguales.
 */
export async function guardarParametrosCompras(
  usuario: string,
  cambios: Partial<Record<ClaveParametro, number | null>>,
): Promise<ParametrosCompras> {
  await enTransaccion(async (ejecutar) => {
    const actuales = await ejecutar<{ clave: string; valor: string }>(
      `select clave, valor from app.compras_parametros for update`,
    );
    const antes = new Map(actuales.map((f) => [f.clave, Number(f.valor)]));

    for (const [clave, crudo] of Object.entries(cambios) as [
      ClaveParametro,
      number | null,
    ][]) {
      const nuevo = crudo == null ? null : valorValido(clave, crudo);
      if (crudo != null && nuevo == null) continue;
      const anterior = antes.get(clave) ?? null;
      if (anterior === nuevo) continue;

      if (nuevo == null) {
        await ejecutar(`delete from app.compras_parametros where clave = $1`, [clave]);
      } else {
        await ejecutar(
          `insert into app.compras_parametros (clave, valor, actualizado_por)
           values ($1, $2, $3)
           on conflict (clave) do update
              set valor = excluded.valor,
                  actualizado_por = excluded.actualizado_por,
                  actualizado_en = now()`,
          [clave, nuevo, usuario],
        );
      }
      await ejecutar(
        `insert into app.compras_parametros_historial
           (clave, valor_anterior, valor, usuario)
         values ($1, $2, $3, $4)`,
        [clave, anterior, nuevo, usuario],
      );
    }
  });
  return getParametrosCompras();
}
