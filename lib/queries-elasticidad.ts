import { query, queryOne } from "@/lib/db";
import { agregarFiltro } from "@/lib/filtros";
import {
  HORAS_MINIMAS,
  MAX_SIN_DATO,
  UDS_MINIMAS_SKU,
  mejorBanda,
} from "@/lib/elasticidad";
import { CANAL_MELI } from "@/lib/meli";
import type {
  DashboardElasticidad,
  FilaElasticidad,
  FiltrosElasticidad,
  KpisElasticidad,
  ResumenBanda,
} from "@/lib/types";

/**
 * Consultas de "Elasticidad de precios".
 *
 * Lee `gold.fact_experimento`, que arma `experimento.py --consolidar` en el
 * repo del pipeline. Esta pantalla NO recalcula nada: el reparto de las horas
 * de cada semana entre vendible / quebrada / pausada / sin dato necesita unir
 * intervalos que se solapan entre varias publicaciones del mismo SKU, y eso ya
 * está resuelto allá. Rehacerlo acá en SQL garantizaría que un día los dos
 * lados digan cosas distintas.
 *
 * ---------------------------------------------------------------------------
 * LA REGLA QUE ATRAVIESA TODO EL ARCHIVO: NUNCA DIVIDIR POR LA SEMANA
 *
 * Cada tasa se calcula sobre `horas_vendible`, no sobre las horas del
 * calendario. Un SKU que estuvo quebrado cinco días de siete no vendió menos
 * por caro: no estuvo a la venta. Dividir por la semana entera mezcla las dos
 * cosas y le echa la culpa al precio.
 */

/**
 * Filas que no se pueden leer, descartadas antes de cualquier promedio.
 *
 * Se hace en SQL y no en el navegador porque estas condiciones también deciden
 * los KPIs y el agregado por banda: filtrando solo la tabla, el total diría una
 * cosa y las filas otra.
 *
 * Los umbrales viven en `lib/elasticidad.ts` y se interpolan acá para que haya
 * un solo lugar donde cambiarlos.
 */
const LEGIBLE = `
  horas_vendible >= ${HORAS_MINIMAS}
  and (horas_ventana <= 0 or horas_sin_dato / horas_ventana <= ${MAX_SIN_DATO})`;

const BASE = `
with medido as (
  select *
    from gold.fact_experimento
   where experimento = $1 and ${LEGIBLE}
),
etiquetas as (
  select distinct on (sku) sku, producto, marca, proveedor
    from gold.fact_ventas
   where canal = $2
   order by sku, fecha desc
),
base as (
  select m.*, e.producto, e.marca, e.proveedor
    from medido m
    left join etiquetas e on e.sku = m.sku
)`;

type Where = { sql: string; params: unknown[] };

function where(experimento: string, f: FiltrosElasticidad): Where {
  const params: unknown[] = [experimento, CANAL_MELI];
  const clauses: string[] = [];
  agregarFiltro(clauses, params, "proveedor", f.proveedor);
  agregarFiltro(clauses, params, "marca", f.marca);
  return { sql: clauses.length ? `where ${clauses.join(" and ")}` : "", params };
}

const num = (v: unknown): number => Number(v ?? 0);
const opt = (v: unknown): number | null =>
  v == null || v === "" ? null : Number(v);

/** El experimento con datos más reciente. Hoy hay uno solo, pero no siempre. */
async function experimentoActivo(): Promise<string | null> {
  const fila = await queryOne<{ experimento: string }>(
    `select experimento from gold.experimento_markup
      order by desde desc limit 1`,
  );
  return fila?.experimento ?? null;
}

/**
 * Las tablas del experimento pueden no existir todavía: el pipeline las crea la
 * primera vez que corre `esquema.py`. Sin este chequeo la pantalla mostraría un
 * error de Postgres, que para quien la mira no significa nada.
 */
async function tablasListas(): Promise<boolean> {
  const fila = await queryOne<{ hay: boolean }>(
    `select to_regclass('gold.fact_experimento') is not null
        and to_regclass('gold.experimento_markup') is not null as hay`,
  );
  return Boolean(fila?.hay);
}

/**
 * El resumen por banda: LA respuesta del experimento.
 *
 * Las tasas se calculan sobre los TOTALES de la banda y no promediando las
 * tasas de cada SKU-semana, por el mismo motivo por el que el margen del
 * conjunto no es el promedio de los márgenes: un artículo que estuvo dos días a
 * la venta y vendió uno da una tasa de 0,5/día que pesaría igual que la de otro
 * que estuvo la semana entera. Sumando arriba y abajo, cada artículo pesa lo
 * que efectivamente aportó.
 */
async function getBandas(experimento: string, f: FiltrosElasticidad): Promise<ResumenBanda[]> {
  const w = where(experimento, f);
  const filas = await query<Record<string, string | null>>(
    `${BASE}
     select banda,
            count(*)                            as sku_semanas,
            count(distinct sku)                 as skus,
            coalesce(sum(horas_vendible), 0)    as horas_vendible,
            coalesce(sum(horas_sin_stock), 0)   as horas_sin_stock,
            coalesce(sum(horas_sin_dato), 0)    as horas_sin_dato,
            coalesce(sum(horas_ventana), 0)     as horas_ventana,
            coalesce(sum(unidades), 0)          as unidades,
            coalesce(sum(facturacion), 0)       as facturacion,
            coalesce(sum(margen), 0)            as margen,
            -- Ponderado por horas a la venta y no simple: el markup que
            -- enfrentaron los compradores es el que estuvo más tiempo puesto.
            sum(markup_realizado * horas_vendible)
              / nullif(sum(horas_vendible) filter (where markup_realizado is not null), 0)
                                                as markup_realizado,
            sum(horas_ganando_bb) / nullif(sum(horas_vendible)
              filter (where horas_ganando_bb is not null), 0) as ganando_bb
     from base ${w.sql}
     group by banda`,
    w.params,
  );

  return filas.map((r) => {
    const horasVendible = num(r.horas_vendible);
    const dias = horasVendible / 24;
    return {
      banda: r.banda as string,
      skuSemanas: num(r.sku_semanas),
      skus: num(r.skus),
      horasVendible,
      horasSinStock: num(r.horas_sin_stock),
      horasSinDato: num(r.horas_sin_dato),
      horasVentana: num(r.horas_ventana),
      unidades: num(r.unidades),
      facturacion: num(r.facturacion),
      margen: num(r.margen),
      // Null y no cero cuando no hubo exposición: cero ventas sin haber estado
      // a la venta no es un fracaso comercial, es un dato que no existe.
      udsPorDia: dias > 0 ? num(r.unidades) / dias : null,
      margenPorDia: dias > 0 ? num(r.margen) / dias : null,
      // Sobre las unidades vendidas y no sobre los SKU-semana: es "cuánto me
      // dejó cada unidad que saqué del depósito", que es la pregunta de la que
      // sale el desempate.
      margenPorUnidad: num(r.unidades) > 0 ? num(r.margen) / num(r.unidades) : null,
      markupRealizado: opt(r.markup_realizado),
      ganandoBb: opt(r.ganando_bb),
    };
  });
}

async function getKpis(experimento: string, f: FiltrosElasticidad): Promise<KpisElasticidad> {
  const w = where(experimento, f);

  // Los KPIs de cobertura salen SIN el filtro de legibilidad: la pregunta es
  // justamente cuánto del experimento se pudo observar, y filtrando por eso
  // primero la respuesta siempre daría 100 %.
  const [legible, todo] = await Promise.all([
    queryOne<Record<string, string>>(
      `${BASE}
       select count(distinct sku) as skus, count(*) as sku_semanas,
              coalesce(sum(unidades), 0) as unidades,
              coalesce(sum(margen), 0)   as margen
       from base ${w.sql}`,
      w.params,
    ),
    queryOne<Record<string, string>>(
      `select coalesce(sum(horas_ventana), 0)   as ventana,
              coalesce(sum(horas_vendible), 0)  as vendible,
              coalesce(sum(horas_sin_stock), 0) as sin_stock,
              coalesce(sum(horas_sin_dato), 0)  as sin_dato
         from gold.fact_experimento where experimento = $1`,
      [experimento],
    ),
  ]);

  const ventana = num(todo?.ventana);
  const observado = ventana - num(todo?.sin_dato);

  return {
    skus: num(legible?.skus),
    semanasMedidas: num(legible?.sku_semanas),
    cobertura: ventana > 0 ? observado / ventana : null,
    disponibilidad: observado > 0 ? num(todo?.vendible) / observado : null,
    quiebre: observado > 0 ? num(todo?.sin_stock) / observado : null,
    unidades: num(legible?.unidades),
    margen: num(legible?.margen),
  };
}

/** Tope de filas que bajan al navegador. */
const TOPE = 400;

/**
 * Una fila por SKU con las tres bandas al lado, que es la forma en que la
 * pregunta se contesta mirando: "a este artículo, ¿qué markup le rinde más?".
 *
 * Se ordena por unidades y no por la mejora entre bandas: con la mediana en
 * 0,58 unidades por semana, ordenar por diferencia porcentual pondría arriba a
 * los artículos que vendieron 0 y 1 unidad —donde la "mejora" es infinita y no
 * significa nada— y dejaría abajo a los que de verdad tienen algo que decir.
 */
async function getFilas(experimento: string, f: FiltrosElasticidad): Promise<FilaElasticidad[]> {
  const w = where(experimento, f);
  const filas = await query<Record<string, string | null>>(
    `${BASE}
     select sku, producto, marca, proveedor, banda,
            max(grupo)                        as grupo,
            coalesce(sum(unidades), 0)        as unidades,
            coalesce(sum(margen), 0)          as margen,
            coalesce(sum(horas_vendible), 0)  as horas_vendible
     from base ${w.sql}
     group by sku, producto, marca, proveedor, banda`,
    w.params,
  );

  const mapa = new Map<string, FilaElasticidad>();
  for (const r of filas) {
    const sku = r.sku as string;
    const actual = mapa.get(sku) ?? {
      sku,
      producto: r.producto,
      marca: r.marca,
      proveedor: r.proveedor,
      grupo: opt(r.grupo),
      unidades: 0,
      porBanda: {},
      udsPorBanda: {},
      margenUnidadPorBanda: {},
      mejor: null,
      confiable: false,
    };
    const dias = num(r.horas_vendible) / 24;
    actual.unidades += num(r.unidades);
    actual.porBanda[r.banda as string] = dias > 0 ? num(r.margen) / dias : null;
    actual.udsPorBanda[r.banda as string] = dias > 0 ? num(r.unidades) / dias : null;
    actual.margenUnidadPorBanda[r.banda as string] =
      num(r.unidades) > 0 ? num(r.margen) / num(r.unidades) : null;
    mapa.set(sku, actual);
  }

  for (const fila of mapa.values()) {
    fila.mejor = mejorBanda(fila.porBanda);
    fila.confiable = fila.unidades >= UDS_MINIMAS_SKU && fila.mejor != null;
  }

  const todas = [...mapa.values()];
  const visibles = f.soloConfiables ? todas.filter((x) => x.confiable) : todas;
  return visibles.sort((a, b) => b.unidades - a.unidades).slice(0, TOPE);
}

async function getVentana(experimento: string) {
  return queryOne<{ desde: string | null; hasta: string | null }>(
    `select to_char(min(desde), 'YYYY-MM-DD') as desde,
            to_char(max(hasta), 'YYYY-MM-DD') as hasta
       from gold.experimento_markup where experimento = $1`,
    [experimento],
  );
}

export async function getOpcionesElasticidad() {
  if (!(await tablasListas())) return { proveedores: [], marcas: [] };
  const experimento = await experimentoActivo();
  if (!experimento) return { proveedores: [], marcas: [] };

  const w = where(experimento, {});
  const [proveedores, marcas] = await Promise.all([
    query<{ v: string }>(
      `${BASE} select distinct proveedor as v from base
        where proveedor is not null order by 1`,
      w.params,
    ),
    query<{ v: string }>(
      `${BASE} select distinct marca as v from base
        where marca is not null order by 1`,
      w.params,
    ),
  ]);
  return { proveedores: proveedores.map((r) => r.v), marcas: marcas.map((r) => r.v) };
}

const SIN_KPIS: KpisElasticidad = {
  skus: 0,
  semanasMedidas: 0,
  cobertura: null,
  disponibilidad: null,
  quiebre: null,
  unidades: 0,
  margen: 0,
};

function vacio(falta: string, experimento: string | null): DashboardElasticidad {
  return {
    experimento,
    hayDatos: false,
    falta,
    desde: null,
    hasta: null,
    kpis: SIN_KPIS,
    bandas: [],
    filas: [],
    recortada: false,
    generadoEn: new Date().toISOString(),
  };
}

export async function getDashboardElasticidad(
  f: FiltrosElasticidad,
): Promise<DashboardElasticidad> {
  // Los tres estados de "todavía no" se distinguen a propósito. Una pantalla en
  // cero se lee como "no vendimos nada", que es una conclusión de negocio
  // gravísima y falsa: acá lo que pasa es que el experimento no arrancó.
  if (!(await tablasListas())) return vacio("pulso", null);

  const experimento = await experimentoActivo();
  if (!experimento) return vacio("asignacion", null);

  const [kpis, bandas, filas, ventana] = await Promise.all([
    getKpis(experimento, f),
    getBandas(experimento, f),
    getFilas(experimento, f),
    getVentana(experimento),
  ]);

  // Con una sola banda medida no hay comparación posible, y una pantalla que
  // muestra una barra sola invita a leer un ganador que se eligió a sí mismo.
  if (bandas.length < 2) {
    return { ...vacio("semanas", experimento), kpis, desde: ventana?.desde ?? null };
  }

  return {
    experimento,
    hayDatos: true,
    falta: null,
    desde: ventana?.desde ?? null,
    hasta: ventana?.hasta ?? null,
    kpis,
    bandas,
    filas,
    recortada: filas.length === TOPE,
    generadoEn: new Date().toISOString(),
  };
}
