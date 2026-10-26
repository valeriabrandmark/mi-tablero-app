import { query, queryOne } from "@/lib/db";
import type {
  CambioDeRestriccion,
  DestacadoFull,
  ReposicionFull,
} from "@/lib/reposicion-full";

export type { CambioDeRestriccion, DestacadoFull, ReposicionFull };

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

/**
 * Si la tabla de reposición ya existe.
 *
 * SE RECUERDA EL "SI" Y NO EL "NO". Una tabla no desaparece, así que una vez
 * que está se puede dejar de preguntar; mientras no está hay que seguir
 * mirando, porque la crea la primera corrida del orquestador y la pantalla
 * tiene que enterarse sin esperar un redeploy.
 */
let tablaConfirmada = false;

export async function hayTablaReposicion(): Promise<boolean> {
  if (tablaConfirmada) return true;
  const existe = await queryOne<{ ok: boolean }>(
    "select to_regclass('bronze.ml_reposicion_full') is not null as ok",
  );
  tablaConfirmada = Boolean(existe?.ok);
  return tablaConfirmada;
}

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
                 else max(r.plazo) end                              as plazo,
            -- DESTACADO POR MERCADO LIBRE. Viene en la columna tags, que se
            -- guarda como el JSON crudo: se busca con like y no parseando,
            -- porque es una etiqueta suelta en una lista de dos o tres.
            bool_or(r.tags like '%star_product%')                    as destacado
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
      destacado: Boolean(r.destacado),
    });
  }
  return mapa;
}

/**
 * Los productos que Mercado Libre marca como DESTACADOS (`star_product`).
 *
 * ---------------------------------------------------------------------------
 * POR QUE TIENEN PANEL PROPIO Y NO ALCANZA CON LA ESTRELLA EN LA TABLA
 *
 * Porque la tabla de Artículos lista lo que TIENE stock (`disponible > 0 or
 * no_disponible > 0`), y de los 18 destacados del 26/10/2026 SIETE estaban en
 * cero. O sea que los que más importan son justo los que ahí no se ven: un
 * destacado vacío no es un artículo parado más, es el que Mercado Libre mismo
 * iba a empujar y no tiene con qué vender.
 *
 * El más caro de la lista ese día --AC01001-- había facturado $1.541.490 en 30
 * días y tenía cero unidades en Full, marcado urgente.
 *
 * Van ordenados por stock ascendente: los vacíos arriba, que es donde hay algo
 * que hacer. A igual stock, primero los que más facturaron.
 */
export async function getDestacadosFull(): Promise<DestacadoFull[]> {
  const existe = await queryOne<{ ok: boolean }>(
    "select to_regclass('bronze.ml_reposicion_full') is not null as ok",
  );
  if (!existe?.ok) return [];

  const rows = await query(
    `select coalesce(m.sku, r.sku_ml)                               as sku,
            max(p.title)                                            as producto,
            sum(coalesce(r.stock_total, 0))                         as en_full,
            sum(r.unidades_30d)                                     as unidades_30d,
            sum(r.facturacion_30d)                                  as facturacion_30d,
            bool_or(r.restringido)                                  as restringido,
            string_agg(distinct r.recomendacion, ' / ')             as recomendacion,
            sum(r.cantidad_sugerida)                                as cantidad_sugerida,
            case when bool_or(r.urgencia = 'URGENT') then 'URGENT'
                 else max(r.urgencia) end                           as urgencia,
            case when bool_or(r.plazo = 'THIS_WEEK') then 'THIS_WEEK'
                 else max(r.plazo) end                              as plazo
       from bronze.ml_reposicion_full r
       left join bronze.ml_inventario_sku m on m.inventory_id = r.inventory_id
       -- EL TITULO SE AGRUPA ANTES DE UNIRLO, no en el join.
       --
       -- Un inventario esta publicado en varios avisos --hasta 6, y 3.887 de
       -- los inventarios tienen mas de uno-- asi que unir publicaciones
       -- directo multiplica la fila y las sumas salen infladas: AC01001 daba
       -- 30 unidades y $4.624.470 en vez de 10 y $1.541.490. Es el mismo
       -- motivo por el que Stock Full agrupa por inventario antes de sumar.
       left join (select inventory_id, max(title) as title
                    from bronze.ml_publicaciones
                   where inventory_id is not null
                   group by inventory_id) p on p.inventory_id = r.inventory_id
      where r.tags like '%star_product%'
      group by 1
      order by sum(coalesce(r.stock_total, 0)) asc,
               sum(r.facturacion_30d) desc nulls last`,
  );

  return rows.map((r) => {
    const cant = r.cantidad_sugerida == null ? null : Number(r.cantidad_sugerida);
    return {
      sku: typeof r.sku === "string" ? r.sku.trim() : null,
      producto: typeof r.producto === "string" ? r.producto : null,
      enFull: Number(r.en_full ?? 0),
      unidades30d: r.unidades_30d == null ? null : Number(r.unidades_30d),
      facturacion30d: r.facturacion_30d == null ? null : Number(r.facturacion_30d),
      reposicion: {
        restringido: r.restringido == null ? null : Boolean(r.restringido),
        recomendacion: (r.recomendacion as string) ?? null,
        cantidadSugerida: cant != null && Number.isFinite(cant) ? cant : null,
        urgencia: (r.urgencia as string) ?? null,
        plazo: (r.plazo as string) ?? null,
        destacado: true,
      },
    };
  });
}

/**
 * Los productos que ENTRARON o SALIERON de restricción en Full.
 *
 * ---------------------------------------------------------------------------
 * ES LO UNICO QUE LA FOTO NO PUEDE DECIR
 *
 * `ml_reposicion_full` se reemplaza entera en cada corrida: dice quién está
 * restringido hoy y no deja rastro de quién lo estaba ayer. El orquestador
 * anota los cambios en `ml_restricciones_eventos` antes de pisarla.
 *
 * ---------------------------------------------------------------------------
 * EL QUE SALE IMPORTA MAS QUE EL QUE ENTRA
 *
 * Entrar se nota solo: el stock deja de reponerse y en algún momento alguien
 * pregunta. Salir no avisa -- el producto queda habilitado y nadie se entera,
 * así que se siguen perdiendo semanas de venta de algo que ya se podía mandar.
 * Ya pasó. Por eso los que salieron van primero y en verde.
 */
export async function getCambiosDeRestriccion(
  dias = 60,
): Promise<CambioDeRestriccion[]> {
  const existe = await queryOne<{ ok: boolean }>(
    "select to_regclass('bronze.ml_restricciones_eventos') is not null as ok",
  );
  if (!existe?.ok) return [];

  const rows = await query(
    `select coalesce(m.sku, e.sku_ml)                   as sku,
            max(p.title)                                as producto,
            e.restringido,
            to_char(e.fecha, 'DD/MM/YYYY')              as fecha,
            (current_date - e.fecha)::int               as hace
       from bronze.ml_restricciones_eventos e
       left join bronze.ml_inventario_sku m on m.inventory_id = e.inventory_id
       -- El título se agrupa antes de unirlo: un inventario está en varias
       -- publicaciones y el join directo multiplicaría la fila.
       left join (select inventory_id, max(title) as title
                    from bronze.ml_publicaciones
                   where inventory_id is not null
                   group by inventory_id) p on p.inventory_id = e.inventory_id
      where e.fecha >= current_date - $1::int
      group by 1, e.restringido, e.fecha
      -- LOS QUE SALIERON PRIMERO, y entre ellos los más recientes.
      order by e.restringido asc, e.fecha desc, 1`,
    [dias],
  );

  return rows.map((r) => ({
    sku: typeof r.sku === "string" ? r.sku.trim() : null,
    producto: typeof r.producto === "string" ? r.producto : null,
    restringido: Boolean(r.restringido),
    fecha: String(r.fecha),
    hace: Number(r.hace ?? 0),
  }));
}
