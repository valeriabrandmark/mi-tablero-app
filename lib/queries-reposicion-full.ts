import { query, queryOne } from "@/lib/db";
import type { ReposicionFull } from "@/lib/reposicion-full";

export type { ReposicionFull };

/**
 * La recomendación de reposición de Full de Mercado Libre, por SKU.
 *
 * La carga `tablero_quo/ml_reposicion_full.py` en `bronze.ml_reposicion_full`,
 * una fila por producto (user_product) en Full. De ahí sale lo que muestra la
 * pantalla de envíos a Full de ML: si el producto está RESTRINGIDO ("Eliminá
 * este producto") y, si no, cuánto conviene mandar.
 *
 * LO QUE NO TRAE: el motivo de la restricción. "Prohibido en Full",
 * "temporalmente no lo recibimos" y "mejorá las ventas" llegan iguales
 * (tag `is_restricted`). El motivo sólo está en la pantalla de ML.
 *
 * Es una consulta aparte y no un join dentro de cada pantalla porque la tabla
 * no existe hasta la primera corrida del script: así, sin ella, las pantallas
 * siguen igual que antes en vez de romperse.
 */

export async function getReposicionPorSku(): Promise<Map<string, ReposicionFull> | null> {
  const existe = await queryOne<{ ok: boolean }>(
    "select to_regclass('bronze.ml_reposicion_full') is not null as ok",
  );
  if (!existe?.ok) return null;

  // El SKU sale del mapa de inventarios (el mismo que usa Stock Full) y, si el
  // inventario no está, del que guardó el script. Un SKU puede tener más de un
  // producto en Full: está restringido si lo está cualquiera, y las
  // sugerencias se suman.
  const rows = await query(
    `select coalesce(m.sku, r.sku, r.sku_ml)                       as sku,
            bool_or(r.restringido)                                  as restringido,
            string_agg(distinct r.recomendacion, ' / ')             as recomendacion,
            sum(r.cantidad_sugerida)                                as cantidad_sugerida,
            -- Si un producto del SKU es urgente, el SKU lo es. Con case y no
            -- con max(): sobre texto max ordena alfabéticamente, no por apuro.
            case when bool_or(r.urgencia = 'URGENT') then 'URGENT'
                 else max(r.urgencia) end                           as urgencia,
            case when bool_or(r.plazo = 'THIS_WEEK') then 'THIS_WEEK'
                 else max(r.plazo) end                              as plazo
     from bronze.ml_reposicion_full r
     left join bronze.ml_inventario_sku m on m.inventory_id = r.inventory_id
     where coalesce(m.sku, r.sku, r.sku_ml) is not null
     group by 1`,
  );

  const mapa = new Map<string, ReposicionFull>();
  for (const r of rows) {
    const cant = r.cantidad_sugerida == null ? null : Number(r.cantidad_sugerida);
    mapa.set(String(r.sku).trim(), {
      restringido: r.restringido == null ? null : Boolean(r.restringido),
      recomendacion: (r.recomendacion as string) ?? null,
      cantidadSugerida: cant != null && Number.isFinite(cant) ? cant : null,
      urgencia: (r.urgencia as string) ?? null,
      plazo: (r.plazo as string) ?? null,
    });
  }
  return mapa;
}
