import { query } from "@/lib/db";
import type {
  DashboardObjetivos,
  FilaAporteSku,
  FilaObjetivo,
  FiltrosObjetivos,
  KpisObjetivos,
  OpcionesObjetivos,
} from "@/lib/types";
import { CANAL_MAYORISTA } from "@/lib/constantes";

/**
 * Página "Objetivos" — avance de cada vendedor contra su objetivo en unidades.
 *
 * El objetivo NO cuelga del SKU sino de un GRUPO (`gold.objetivos_grupo`), que
 * es la unidad en la que la comercial lo pensó:
 *
 *   - un SKU suelto            -> grupo con un solo item (criterio 'sku')
 *   - un MIX de varios SKUs    -> grupo con N items; el objetivo se mide sobre
 *                                 la SUMA del grupo, no SKU por SKU
 *   - una marca entera         -> grupo con criterio 'marca' (caso AVENO, que
 *                                 en la planilla original no tiene SKU)
 *
 * Por eso todo arranca del CTE `ventas`, que le pega a cada línea de venta el
 * grupo al que corresponde. Un SKU vive en un solo grupo, así que el join no
 * multiplica filas; si algún día un SKU entrara en dos grupos, esa línea
 * contaría en ambos (que es lo que uno querría).
 *
 * Filtro fijo de la página: `canal = 'Mayorista'`, igual que Ventas Mayoristas.
 * Los objetivos son de la fuerza de venta mayorista; sumar Mercado Libre o
 * Tienda Nube les infla el avance con ventas que no son suyas.
 */

type Where = { sql: string; params: unknown[] };

/**
 * Los filtros se aplican SIEMPRE sobre la tabla de objetivos (alias `o`), no
 * sobre las ventas. Es lo que hace que un vendedor sin ninguna venta del mes
 * siga apareciendo con su objetivo y 0 de avance, en vez de desaparecer de la
 * tabla — que es justo la fila que hay que mirar.
 */
function whereObjetivos(f: FiltrosObjetivos, omitir: (keyof FiltrosObjetivos)[] = []): Where {
  const params: unknown[] = [];
  const clauses: string[] = [];

  const opcionales: [keyof FiltrosObjetivos, string][] = [
    ["mes", "o.mes_comercial"],
    ["vendedor", "o.vendedor"],
    ["grupo", "o.grupo"],
  ];

  for (const [key, columna] of opcionales) {
    const valor = f[key];
    if (valor && !omitir.includes(key)) {
      params.push(valor);
      clauses.push(`${columna} = $${params.length}`);
    }
  }

  return { sql: clauses.length > 0 ? clauses.join("\n     and ") : "true", params };
}

/**
 * Avance por par (mes, vendedor, grupo): el grano más fino que existe.
 * Todo lo demás sale de agregar esto.
 *
 * El `left join` contra las ventas es deliberado: sin él, un objetivo sin
 * ventas no daría fila y el avance se leería como si no existiera.
 */
function cteAvance(w: Where): string {
  return `with mapa as (
    select g.grupo, g.criterio, i.valor
    from gold.objetivos_grupo g
    join gold.objetivos_grupo_item i on i.grupo = g.grupo
  ),
  ventas as (
    select m.grupo, fv.mes_comercial, fv.vendedor, fv.sku, fv.producto, fv.cantidad
    from gold.fact_ventas fv
    join mapa m
      on (m.criterio = 'sku'   and m.valor = fv.sku)
      or (m.criterio = 'marca' and m.valor = fv.marca)
    where fv.canal = '${CANAL_MAYORISTA}'
  ),
  avance as (
    select o.mes_comercial,
           o.vendedor,
           o.grupo,
           o.cantidad as objetivo,
           coalesce(sum(v.cantidad), 0) as vendido
    from gold.objetivos o
    left join ventas v
      on v.grupo = o.grupo
     and v.mes_comercial = o.mes_comercial
     and v.vendedor = o.vendedor
    where ${w.sql}
    group by o.mes_comercial, o.vendedor, o.grupo, o.cantidad
  )`;
}

/** `vendido / objetivo` como fracción; null si el objetivo es 0. */
const AVANCE_PCT = `case when sum(objetivo) = 0 then null
                         else sum(vendido)::float8 / sum(objetivo)
                    end::float8 as "avancePct"`;

const FALTAN = `greatest(sum(objetivo) - sum(vendido), 0)::float8 as faltan`;

// --- KPIs --------------------------------------------------------------------

async function getKpis(f: FiltrosObjetivos): Promise<KpisObjetivos> {
  const w = whereObjetivos(f);
  const filas = await query<KpisObjetivos>(
    `${cteAvance(w)}
     select coalesce(sum(objetivo), 0)::float8 as objetivo,
            coalesce(sum(vendido), 0)::float8 as vendido,
            case when sum(objetivo) = 0 then null
                 else sum(vendido)::float8 / sum(objetivo)
            end::float8 as "avancePct",
            count(*) filter (where vendido >= objetivo)::float8 as cumplidos,
            count(*)::float8 as pares
     from avance`,
    w.params,
  );

  return filas[0] ?? { objetivo: 0, vendido: 0, avancePct: null, cumplidos: 0, pares: 0 };
}

// --- Aperturas ---------------------------------------------------------------

/**
 * Avance por grupo. Se omite el filtro cruzado de grupo a propósito: si no, al
 * clickear una barra el gráfico se quedaría con una sola y no habría contra qué
 * comparar (mismo criterio que las tortas de Logística).
 */
function getPorGrupo(f: FiltrosObjetivos): Promise<FilaObjetivo[]> {
  const w = whereObjetivos(f, ["grupo"]);
  return query<FilaObjetivo>(
    `${cteAvance(w)}
     select a.grupo,
            null::text as vendedor,
            sum(a.objetivo)::float8 as objetivo,
            sum(a.vendido)::float8 as vendido,
            ${AVANCE_PCT},
            ${FALTAN}
     from avance a
     join gold.objetivos_grupo g on g.grupo = a.grupo
     group by a.grupo, g.orden
     order by g.orden`,
    w.params,
  );
}

/** Avance por vendedor. Omite el filtro de vendedor, por el mismo motivo. */
function getPorVendedor(f: FiltrosObjetivos): Promise<FilaObjetivo[]> {
  const w = whereObjetivos(f, ["vendedor"]);
  return query<FilaObjetivo>(
    `${cteAvance(w)}
     select null::text as grupo,
            vendedor,
            sum(objetivo)::float8 as objetivo,
            sum(vendido)::float8 as vendido,
            ${AVANCE_PCT},
            ${FALTAN}
     from avance
     group by vendedor
     order by vendedor`,
    w.params,
  );
}

/** El detalle fino: una fila por vendedor y grupo, que es como se controla. */
function getDetalle(f: FiltrosObjetivos): Promise<FilaObjetivo[]> {
  const w = whereObjetivos(f);
  return query<FilaObjetivo>(
    `${cteAvance(w)}
     select a.grupo,
            a.vendedor,
            sum(a.objetivo)::float8 as objetivo,
            sum(a.vendido)::float8 as vendido,
            ${AVANCE_PCT},
            ${FALTAN}
     from avance a
     join gold.objetivos_grupo g on g.grupo = a.grupo
     group by a.grupo, a.vendedor, g.orden
     order by g.orden, a.vendedor`,
    w.params,
  );
}

/**
 * Qué SKU aportó cada unidad dentro de un MIX. Sin esto el grupo es una caja
 * negra: se ve que faltan 400 unidades pero no si es porque un sabor no se
 * vende o porque no se vende ninguno.
 */
function getAportesSku(f: FiltrosObjetivos): Promise<FilaAporteSku[]> {
  const w = whereObjetivos(f);
  return query<FilaAporteSku>(
    `${cteAvance(w)}
     select v.grupo,
            v.sku,
            max(v.producto) as producto,
            coalesce(sum(v.cantidad), 0)::float8 as vendido
     from ventas v
     where exists (select 1 from avance a
                   where a.grupo = v.grupo
                     and a.mes_comercial = v.mes_comercial
                     and a.vendedor = v.vendedor)
     group by v.grupo, v.sku
     having sum(v.cantidad) <> 0
     order by v.grupo, vendido desc`,
    w.params,
  );
}

// --- Opciones de los selectores ----------------------------------------------

export async function getOpcionesObjetivos(): Promise<OpcionesObjetivos> {
  const [meses, vendedores, grupos] = await Promise.all([
    query<{ valor: string }>(
      `select distinct mes_comercial as valor from gold.objetivos order by valor desc`,
    ),
    query<{ valor: string }>(
      `select distinct vendedor as valor from gold.objetivos order by valor`,
    ),
    query<{ valor: string }>(`select grupo as valor from gold.objetivos_grupo order by orden`),
  ]);

  return {
    meses: meses.map((r) => r.valor),
    vendedores: vendedores.map((r) => r.valor),
    grupos: grupos.map((r) => r.valor),
  };
}

// --- Dashboard completo ------------------------------------------------------

export async function getDashboardObjetivos(f: FiltrosObjetivos): Promise<DashboardObjetivos> {
  const [kpis, porGrupo, porVendedor, detalle, aportesSku] = await Promise.all([
    getKpis(f),
    getPorGrupo(f),
    getPorVendedor(f),
    getDetalle(f),
    getAportesSku(f),
  ]);

  return { kpis, porGrupo, porVendedor, detalle, aportesSku, generadoEn: new Date().toISOString() };
}
