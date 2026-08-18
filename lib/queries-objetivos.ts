import { query } from "@/lib/db";
import type {
  DashboardObjetivos,
  FilaAporteSku,
  FilaObjetivo,
  FiltrosObjetivos,
  OpcionesObjetivos,
  ResumenMetrica,
} from "@/lib/types";
import { CANAL_MAYORISTA } from "@/lib/constantes";

/**
 * Página "Objetivos" — avance de cada vendedor contra su objetivo.
 *
 * El objetivo NO cuelga del SKU sino de un GRUPO (`gold.objetivos_grupo`), que
 * es la unidad en la que la comercial lo pensó. Cada grupo declara dos cosas:
 *
 *   `criterio` — contra qué se matchean sus items:
 *     'sku'     un SKU suelto, o un MIX de varios SKUs (el objetivo se mide
 *               sobre la SUMA del grupo, no SKU por SKU)
 *     'marca'   una marca entera (caso AVENO, que en la planilla no tiene SKU)
 *     'empresa' todas las ventas de esas empresas (Brandmark = Quo Marketing
 *               SRL + Presupuesto QUO; NOA = Noa Comercial SRL + Presupuesto Noa)
 *
 *   `metrica` — cómo se mide el avance: unidades, facturación o clientes.
 *
 * La métrica es lo que obliga a que TODO lo que agrega objetivos agrupe por
 * ella: sumar un objetivo de $45.000.000 con uno de 480 unidades no significa
 * nada. Por eso los totales son una fila por métrica y no un número solo.
 *
 * Filtro fijo de la página: `canal = 'Mayorista'`. Los objetivos son de la
 * fuerza de venta mayorista; sumar Mercado Libre o Tienda Nube les infla el
 * avance con ventas que no son suyas. Los presupuestos SÍ cuentan (entran como
 * las empresas "Presupuesto QUO" / "Presupuesto Noa"), igual que en el tablero
 * de Data Studio del que sale esta página.
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
 *
 * Ojo con `clientes`: a nivel grupo es un `count(distinct)`, pero al agregar
 * varios grupos se SUMAN esos conteos en vez de recontar. Es lo correcto acá,
 * porque cada grupo es un objetivo separado (Brandmark 40 y NOA 10 son dos
 * metas, no una sola de 50 clientes distintos).
 */
function cteAvance(w: Where): string {
  return `with mapa as (
    select g.grupo, g.criterio, g.metrica, i.valor
    from gold.objetivos_grupo g
    join gold.objetivos_grupo_item i on i.grupo = g.grupo
  ),
  ventas as (
    select m.grupo, fv.mes_comercial, fv.vendedor, fv.cliente,
           fv.sku, fv.producto, fv.cantidad, fv.precio_neto
    from gold.fact_ventas fv
    join mapa m
      on (m.criterio = 'sku'     and m.valor = fv.sku)
      or (m.criterio = 'marca'   and m.valor = fv.marca)
      or (m.criterio = 'empresa' and m.valor = fv.empresa)
    where fv.canal = '${CANAL_MAYORISTA}'
  ),
  avance as (
    select o.mes_comercial,
           o.vendedor,
           o.grupo,
           g.metrica,
           g.orden,
           o.cantidad as objetivo,
           case g.metrica
             when 'clientes'    then count(distinct v.cliente)
             when 'facturacion' then coalesce(sum(v.precio_neto * v.cantidad), 0)
             else                    coalesce(sum(v.cantidad), 0)
           end as vendido
    from gold.objetivos o
    join gold.objetivos_grupo g on g.grupo = o.grupo
    left join ventas v
      on v.grupo = o.grupo
     and v.mes_comercial = o.mes_comercial
     and v.vendedor = o.vendedor
    where ${w.sql}
    group by o.mes_comercial, o.vendedor, o.grupo, g.metrica, g.orden, o.cantidad
  )`;
}

/** Columnas derivadas comunes a todas las aperturas. */
const DERIVADAS = `case when sum(objetivo) = 0 then null
                        else sum(vendido)::float8 / sum(objetivo)
                   end::float8 as "avancePct",
                   greatest(sum(objetivo) - sum(vendido), 0)::float8 as faltan`;

// --- Totales por métrica -----------------------------------------------------

function getResumen(f: FiltrosObjetivos): Promise<ResumenMetrica[]> {
  const w = whereObjetivos(f);
  return query<ResumenMetrica>(
    `${cteAvance(w)}
     select metrica,
            coalesce(sum(objetivo), 0)::float8 as objetivo,
            coalesce(sum(vendido), 0)::float8 as vendido,
            case when sum(objetivo) = 0 then null
                 else sum(vendido)::float8 / sum(objetivo)
            end::float8 as "avancePct",
            count(*) filter (where vendido >= objetivo)::float8 as cumplidos,
            count(*)::float8 as pares
     from avance
     group by metrica
     order by case metrica when 'unidades' then 1 when 'facturacion' then 2 else 3 end`,
    w.params,
  );
}

// --- Aperturas ---------------------------------------------------------------

/**
 * Avance por grupo. Se omite el filtro cruzado de grupo a propósito: si no, al
 * clickear una barra el panel se quedaría con una sola y no habría contra qué
 * comparar (mismo criterio que las tortas de Logística).
 */
function getPorGrupo(f: FiltrosObjetivos): Promise<FilaObjetivo[]> {
  const w = whereObjetivos(f, ["grupo"]);
  return query<FilaObjetivo>(
    `${cteAvance(w)}
     select grupo,
            null::text as vendedor,
            metrica,
            sum(objetivo)::float8 as objetivo,
            sum(vendido)::float8 as vendido,
            ${DERIVADAS}
     from avance
     group by grupo, metrica, orden
     order by orden`,
    w.params,
  );
}

/**
 * Avance por vendedor y métrica. Omite el filtro de vendedor, por el mismo
 * motivo. Va abierto por métrica porque un vendedor tiene tres avances
 * distintos que no se pueden promediar entre sí.
 */
function getPorVendedor(f: FiltrosObjetivos): Promise<FilaObjetivo[]> {
  const w = whereObjetivos(f, ["vendedor"]);
  return query<FilaObjetivo>(
    `${cteAvance(w)}
     select null::text as grupo,
            vendedor,
            metrica,
            sum(objetivo)::float8 as objetivo,
            sum(vendido)::float8 as vendido,
            ${DERIVADAS}
     from avance
     group by vendedor, metrica
     order by vendedor,
              case metrica when 'unidades' then 1 when 'facturacion' then 2 else 3 end`,
    w.params,
  );
}

/** El detalle fino: una fila por vendedor y grupo, que es como se controla. */
function getDetalle(f: FiltrosObjetivos): Promise<FilaObjetivo[]> {
  const w = whereObjetivos(f);
  return query<FilaObjetivo>(
    `${cteAvance(w)}
     select grupo,
            vendedor,
            metrica,
            sum(objetivo)::float8 as objetivo,
            sum(vendido)::float8 as vendido,
            ${DERIVADAS}
     from avance
     group by grupo, vendedor, metrica, orden
     order by orden, vendedor`,
    w.params,
  );
}

/**
 * Qué SKU aportó cada unidad dentro de un MIX. Sin esto el grupo es una caja
 * negra: se ve que faltan 400 unidades pero no si es porque un sabor no se
 * vende o porque no se vende ninguno.
 *
 * Solo tiene sentido para los grupos de unidades: en los de empresa el "aporte
 * por SKU" serían todos los artículos que vendió la empresa, que no dice nada.
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
                     and a.vendedor = v.vendedor
                     and a.metrica = 'unidades')
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
  const [resumen, porGrupo, porVendedor, detalle, aportesSku] = await Promise.all([
    getResumen(f),
    getPorGrupo(f),
    getPorVendedor(f),
    getDetalle(f),
    getAportesSku(f),
  ]);

  return {
    resumen,
    porGrupo,
    porVendedor,
    detalle,
    aportesSku,
    generadoEn: new Date().toISOString(),
  };
}
