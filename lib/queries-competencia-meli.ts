import { query, queryOne } from "@/lib/db";
import {
  DIAS_ENVIO,
  clasificar,
  type Boost,
  type FilaCompetencia,
  type FilaCompetenciaBase,
  type Rival,
} from "@/lib/competencia-meli";
import { ULTIMO_COSTO_CON_OFERTAS } from "@/lib/sql-costos";

/**
 * Consultas de "Mercado Libre — Competencia".
 *
 * Las tablas `ml_competencia`, `ml_competidores`, `ml_vendedores` y
 * `foxie_publicaciones` las crean los scripts de tablero_quo la primera vez que
 * corren. Hasta entonces no existen, y la pantalla tiene que decir "todavía no
 * hay datos" en vez de romperse: por eso se pregunta antes con `to_regclass` y
 * las que son opcionales (Foxie, vendedores) se joinean sólo si están.
 */

/**
 * Uno por vendedor y uno por publicación, aunque la tabla tuviera repetidos.
 * `ml_vendedores` se completa agregando filas: si dos corridas se pisaran, el
 * mismo vendedor quedaría dos veces y el join duplicaría la publicación.
 */
const VENDEDORES = `(select distinct on (seller_id) * from bronze.ml_vendedores order by seller_id)`;
const FOXIE = `(select distinct on (item_id) * from bronze.foxie_publicaciones order by item_id, tipo)`;

type Existen = {
  competencia: boolean;
  competidores: boolean;
  vendedores: boolean;
  foxie: boolean;
};

async function tablasQueExisten(): Promise<Existen> {
  const r = await queryOne<{ [k: string]: boolean }>(
    `select to_regclass('bronze.ml_competencia') is not null     as competencia,
            to_regclass('bronze.ml_competidores') is not null    as competidores,
            to_regclass('bronze.ml_vendedores') is not null      as vendedores,
            to_regclass('bronze.foxie_publicaciones') is not null as foxie`,
  );
  return {
    competencia: !!r?.competencia,
    competidores: !!r?.competidores,
    vendedores: !!r?.vendedores,
    foxie: !!r?.foxie,
  };
}

export type DashboardCompetencia = {
  sinDatos: boolean;
  actualizado: string | null;
  hayFoxie: boolean;
  filas: FilaCompetencia[];
};

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function lista<T>(v: unknown): T[] {
  if (typeof v !== "string" || !v) return [];
  try {
    const x = JSON.parse(v);
    return Array.isArray(x) ? x : [];
  } catch {
    return [];
  }
}

export async function getDashboardCompetencia(): Promise<DashboardCompetencia> {
  const existen = await tablasQueExisten();
  if (!existen.competencia) {
    return { sinDatos: true, actualizado: null, hayFoxie: false, filas: [] };
  }

  const conRivales = existen.competidores;
  const conVendedores = conRivales && existen.vendedores;

  const rows = await query(
    `with costo as (
       ${ULTIMO_COSTO_CON_OFERTAS}
     ),
     -- Lo que efectivamente pagamos de envío por unidad en las ventas
     -- recientes. Incluye los ceros de las ventas sin envío gratis: es el
     -- promedio de lo que cuesta, no de lo que cuesta cuando cuesta.
     envio as (
       select sku, sum(coalesce(envio, 0)) / nullif(sum(cantidad), 0) as envio_unidad
       from gold.fact_ventas
       where canal = 'Mercado Libre' and fecha >= current_date - ${DIAS_ENVIO}
       group by sku
     )
     ${conRivales ? `,
     rivales as (
       select catalog_product_id, count(*) filter (where not propia) as n
       from bronze.ml_competidores
       group by catalog_product_id
     )` : ""}
     select c.item_id,
            c.sku,
            a.descripcion                    as producto,
            a."attributes.marca"             as marca,
            a."proveedorNombre"              as proveedor,
            c.catalog_product_id,
            c.logistica,
            c.estado,
            c.precio_actual,
            c.precio_para_ganar,
            c.visibilidad,
            c.comparten_primer_lugar,
            c.ganador_item_id,
            c.ganador_precio,
            ${conVendedores ? "gv.apodo" : "null"} as ganador_apodo,
            c.boosts,
            c.ganador_boosts,
            c.motivos,
            c.error,
            c.comision_actual,
            c.comision_ganar,
            c.comision_pct,
            c.comision_fija,
            coalesce(a."ivaPorcentual", 21)  as iva_pct,
            co.costo_real,
            co.costo_teorico,
            co.oferta_prov_pct,
            co.oferta_propia_pct,
            e.envio_unidad,
            ${existen.foxie ? "fx.costo_sin_iva" : "null"} as costo_foxie,
            ${existen.foxie ? "fx.costo_envio" : "null"}   as envio_foxie,
            ${conRivales ? "coalesce(r.n, 0)" : "0"}       as rivales
     from bronze.ml_competencia c
     left join bronze.sigma_articulos a on trim(a.id::text) = trim(c.sku)
     left join costo co on co.sku = c.sku
     left join envio e on e.sku = c.sku
     ${existen.foxie ? `left join ${FOXIE} fx on fx.item_id = c.item_id` : ""}
     ${conRivales ? "left join rivales r on r.catalog_product_id = c.catalog_product_id" : ""}
     ${
       conVendedores
         ? `left join bronze.ml_competidores g on g.item_id = c.ganador_item_id
                                            and g.catalog_product_id = c.catalog_product_id
            left join ${VENDEDORES} gv on gv.seller_id = g.seller_id`
         : ""
     }`,
  );

  const ultima = await queryOne<{ actualizado: Date | null }>(
    "select max(actualizado) as actualizado from bronze.ml_competencia",
  );
  const actualizado = ultima?.actualizado
    ? new Date(ultima.actualizado).toISOString()
    : null;

  const filas = rows.map((r) => {
    const envioVentas = num(r.envio_unidad);
    const envioFoxie = num(r.envio_foxie);
    // Sin ventas recientes, el envío que calcula Foxie. Se asume con IVA,
    // como la tarifa que publica ML, y se le saca para sumarlo como el resto.
    const envioUnidad = envioVentas ?? (envioFoxie != null ? envioFoxie / 1.21 : null);

    const base: FilaCompetenciaBase = {
      itemId: String(r.item_id),
      sku: (r.sku as string) ?? null,
      producto: (r.producto as string) ?? null,
      marca: (r.marca as string) ?? null,
      proveedor: (r.proveedor as string) ?? null,
      catalogProductId: (r.catalog_product_id as string) ?? null,
      logistica: (r.logistica as string) ?? null,
      estado: (r.estado as string) ?? null,
      precioActual: num(r.precio_actual),
      precioParaGanar: num(r.precio_para_ganar),
      visibilidad: (r.visibilidad as string) ?? null,
      compartenPrimerLugar: num(r.comparten_primer_lugar),
      ganadorItemId: (r.ganador_item_id as string) ?? null,
      ganadorPrecio: num(r.ganador_precio),
      ganadorApodo: (r.ganador_apodo as string) ?? null,
      boosts: lista<Boost>(r.boosts),
      ganadorBoosts: lista<Boost>(r.ganador_boosts),
      motivos: lista<string>(r.motivos),
      error: (r.error as string) ?? null,
      comisionActual: num(r.comision_actual),
      comisionGanar: num(r.comision_ganar),
      comisionPct: num(r.comision_pct),
      comisionFija: num(r.comision_fija),
      ivaPct: num(r.iva_pct) ?? 21,
      costo: num(r.costo_real),
      costoTeorico: num(r.costo_teorico),
      ofertaProvPct: num(r.oferta_prov_pct),
      ofertaPropiaPct: num(r.oferta_propia_pct),
      envioUnidad,
      envioFuente: envioVentas != null ? "ventas" : envioFoxie != null ? "foxie" : null,
      costoFoxie: num(r.costo_foxie),
      rivales: num(r.rivales) ?? 0,
    };
    return clasificar(base);
  });

  return { sinDatos: false, actualizado, hayFoxie: existen.foxie, filas };
}

/** Todas las publicaciones de un producto de catálogo, de la más barata a la más cara. */
export async function getRivales(catalogProductId: string): Promise<Rival[]> {
  const existen = await tablasQueExisten();
  if (!existen.competidores) return [];

  const rows = await query(
    `select r.item_id, r.seller_id, r.propia, r.precio, r.precio_original,
            r.tipo_publicacion, r.logistica, r.envio_gratis, r.tienda_oficial,
            ${existen.vendedores ? "v.apodo, v.reputacion, v.medalla, v.ventas_totales" : "null as apodo, null as reputacion, null as medalla, null as ventas_totales"}
     from bronze.ml_competidores r
     ${existen.vendedores ? `left join ${VENDEDORES} v on v.seller_id = r.seller_id` : ""}
     where r.catalog_product_id = $1
     order by r.precio nulls last`,
    [catalogProductId],
  );

  return rows.map((r) => ({
    itemId: String(r.item_id),
    sellerId: (r.seller_id as string) ?? null,
    apodo: (r.apodo as string) ?? null,
    reputacion: (r.reputacion as string) ?? null,
    medalla: (r.medalla as string) ?? null,
    ventasTotales: num(r.ventas_totales),
    propia: !!r.propia,
    precio: num(r.precio),
    precioOriginal: num(r.precio_original),
    tipoPublicacion: (r.tipo_publicacion as string) ?? null,
    logistica: (r.logistica as string) ?? null,
    envioGratis: (r.envio_gratis as boolean) ?? null,
    tiendaOficial: r.tienda_oficial != null && r.tienda_oficial !== "" && r.tienda_oficial !== 0,
  }));
}
