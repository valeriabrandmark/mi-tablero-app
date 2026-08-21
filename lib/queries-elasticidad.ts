import { query } from "@/lib/db";
import { agregarFiltro } from "@/lib/filtros";
import {
  BANDAS,
  EXPERIMENTO_FIN,
  EXPERIMENTO_INICIO,
  SEMANAS,
  UDS_MINIMAS_SKU,
  mejorBanda,
  semanaDe,
} from "@/lib/elasticidad";
import { CANAL_MELI } from "@/lib/meli";
import type {
  DashboardElasticidad,
  DashboardResultados,
  FilaResultado,
  ResumenSemana,
  DiaSinStock,
  FilaElasticidad,
  FiltrosElasticidad,
  KpisElasticidad,
  ResumenBanda,
} from "@/lib/types";

/**
 * Consultas de "Elasticidad de precios".
 *
 * ---------------------------------------------------------------------------
 * EL %MARGEN, ESCRITO UNA SOLA VEZ
 *
 * Todo este archivo depende de una fórmula, así que está en una constante y no
 * repetida en cada consulta:
 *
 *     (precio bruto − IVA − costo neto − comisión neta − envío neto) / precio bruto
 *
 * OJO CON LOS GRANOS, que es de donde salen todos los errores posibles acá y
 * está verificado con datos (ver `lib/meli.ts`):
 *
 *   precio_unitario  por unidad, CON IVA   -> es el "precio bruto" de la fórmula
 *   precio_neto      por unidad, sin IVA   -> es "precio bruto − IVA"
 *   costo_unitario   por unidad
 *   comision         POR UNIDAD
 *   envio            POR LÍNEA             -> hay que dividirlo por la cantidad
 *
 * Multiplicar el envío por la cantidad, o no dividirlo, mueve el margen lo
 * suficiente como para cambiar de banda a un artículo.
 */
const MARGEN_PCT = `
  (f.precio_neto - f.costo_unitario - f.comision - f.envio / nullif(f.cantidad, 0))
  / nullif(f.precio_unitario, 0)`;

/** El margen en PESOS de la línea entera, con los mismos granos. */
const MARGEN_PESOS = `
  (f.precio_neto - f.costo_unitario - f.comision) * f.cantidad - coalesce(f.envio, 0)`;

/**
 * A qué banda pertenece una línea. Los cortes son cerrados abajo y abiertos
 * arriba, exactamente igual que `bandaDeMargen` en `lib/elasticidad.ts`.
 */
const BANDA = `
  case
    when ${MARGEN_PCT} < 0.10 then '<10'
    when ${MARGEN_PCT} < 0.18 then '10-18'
    when ${MARGEN_PCT} < 0.25 then '18-25'
    when ${MARGEN_PCT} < 0.35 then '25-35'
    else '>35'
  end`;

/**
 * Las líneas que se pueden clasificar. Sin costo no hay margen, y sin margen no
 * hay banda: esas líneas se cuentan aparte en vez de caer en un bucket
 * cualquiera (son 3 sobre 9.900, pero el día que sean 3.000 hay que verlo).
 */
const CLASIFICABLE = `f.costo_unitario > 0 and f.precio_unitario > 0 and f.cantidad > 0`;

type Where = { sql: string; params: unknown[] };

function where(f: FiltrosElasticidad): Where {
  const params: unknown[] = [CANAL_MELI, f.desde, f.hasta];
  const clauses = [
    `f.canal = $1`,
    `f.fecha >= $2::date`,
    `f.fecha <= $3::date`,
    CLASIFICABLE,
  ];
  agregarFiltro(clauses, params, "f.proveedor", f.proveedor);
  agregarFiltro(clauses, params, "f.marca", f.marca);
  agregarFiltro(clauses, params, "f.sku", f.sku);
  // El filtro cruzado de los gráficos. Se aplica sobre la MISMA expresión que
  // clasifica: si acá se repitieran los cortes, un click podría traer una banda
  // distinta de la que se ve en la barra.
  agregarFiltro(clauses, params, `(${BANDA})`, f.banda);
  return { sql: `where ${clauses.join(" and ")}`, params };
}

const num = (v: unknown): number => Number(v ?? 0);
const opt = (v: unknown): number | null => (v == null || v === "" ? null : Number(v));

/**
 * El total de cada banda. Es la respuesta principal: cuánto se vendió y cuánto
 * quedó con cada nivel de margen.
 */
async function getBandas(f: FiltrosElasticidad): Promise<ResumenBanda[]> {
  const w = where(f);
  const filas = await query<Record<string, string | null>>(
    `select ${BANDA} as banda,
            count(distinct f.sku)                as skus,
            count(*)                             as lineas,
            coalesce(sum(f.cantidad), 0)         as unidades,
            coalesce(sum(f.total_linea), 0)      as facturacion,
            coalesce(sum(${MARGEN_PESOS}), 0)    as margen,
            -- El %margen del CONJUNTO: margen total sobre facturación total, y
            -- no el promedio de los porcentajes. Con un artículo que vendió
            -- $500.000 al 8 % y otro $1.000 al 80 %, el promedio simple da 44 %
            -- — un número que no describe a ningún peso que haya entrado.
            coalesce(sum(${MARGEN_PESOS}), 0)
              / nullif(sum(f.total_linea), 0)    as margen_pct
       from gold.fact_ventas f
       ${w.sql}
      group by 1`,
    w.params,
  );

  const porClave = new Map(filas.map((r) => [r.banda as string, r]));
  // Se devuelven SIEMPRE las cinco, en orden, aunque alguna no tenga ventas: una
  // banda que falta del gráfico se lee como "no la probamos", y una en cero se
  // lee como "la probamos y no vendió". Son cosas distintas.
  return BANDAS.map((b) => {
    const r = porClave.get(b.clave);
    return {
      banda: b.clave,
      delExperimento: b.delExperimento,
      skus: num(r?.skus),
      lineas: num(r?.lineas),
      unidades: num(r?.unidades),
      facturacion: num(r?.facturacion),
      margen: num(r?.margen),
      margenPct: opt(r?.margen_pct),
      margenPorUnidad: num(r?.unidades) > 0 ? num(r?.margen) / num(r?.unidades) : null,
    };
  });
}

/**
 * Días en que cada SKU no se pudo comprar, uno por fila.
 *
 * ---------------------------------------------------------------------------
 * SÓLO CUENTA LOS DÍAS QUE MIRAMOS
 *
 * Un día sin ningún pulso no es un día sin stock: es un día sin dato. Por eso
 * el `cross join` es contra los días en que hubo al menos una corrida, y no
 * contra el calendario. Sin ese recorte, cualquier caída del pipeline se
 * reportaría como quiebre de stock de los 4.360 artículos a la vez.
 *
 * Un SKU cuenta como vendible si CUALQUIERA de sus publicaciones lo estuvo en
 * algún momento del día: al comprador le alcanza con una.
 */
const DIAS_SIN_STOCK = `
-- OJO CON LOS PARAMETROS: acá son $1 = desde y $2 = hasta, y NO se pasa el
-- canal. No es un descuido — este bloque no mira ventas, mira el pulso, que no
-- tiene canal.
--
-- Antes recibía \`[CANAL_MELI, desde, hasta]\` para que la posición coincidiera
-- con el resto del archivo, y \`$1\` quedaba sin aparecer en el SQL. Postgres no
-- puede inferir el tipo de un parámetro que no se usa en ningún lado, así que
-- la consulta moría con "could not determine data type of parameter $1" — un
-- error que no menciona ni la consulta ni el parámetro de más.
with dias_mirados as (
  select distinct (c.momento at time zone 'America/Argentina/Buenos_Aires')::date as dia
    from bronze.ml_pulso_corrida c
   where (c.momento at time zone 'America/Argentina/Buenos_Aires')::date
         between $1::date and $2::date
),
skus as (
  select distinct sku from bronze.ml_estado_item where sku is not null
),
vendible as (
  select e.sku, d.dia
    from bronze.ml_estado_item e
    join dias_mirados d
      on e.desde < ((d.dia + 1)::text || ' 00:00-03')::timestamptz
     and coalesce(e.hasta, e.visto_hasta) > (d.dia::text || ' 00:00-03')::timestamptz
   where e.vendible and e.sku is not null
   group by 1, 2
),
sin_stock as (
  select s.sku, d.dia
    from skus s
    cross join dias_mirados d
    left join vendible v on v.sku = s.sku and v.dia = d.dia
   where v.sku is null
)`;

/**
 * El detalle por artículo y día, SÓLO para los artículos filtrados.
 *
 * POR QUÉ NO SE TRAE SIEMPRE
 * Sin filtro son 2.359 pares (artículo, día) en UN día medido — el 54 % del
 * catálogo está quebrado en cualquier momento dado. Sobre 30 días eso son unas
 * 70.000 filas, que ni viajan bien al navegador ni se leen. Y con un `limit`
 * pelado se recortarían en silencio, que es peor: la pantalla mostraría una
 * lista incompleta con cara de completa.
 *
 * El conteo por artículo (la columna "Días sin stock" de la tabla) sí está
 * siempre, y es el que sirve para descontar el resultado falso. El detalle
 * día por día se pide al hacer click en un artículo, que es cuando importa.
 */
async function getDiasSinStock(f: FiltrosElasticidad): Promise<DiaSinStock[]> {
  if (!f.sku?.length) return [];

  const params: unknown[] = [f.desde, f.hasta];
  const clauses: string[] = [];
  agregarFiltro(clauses, params, "s.sku", f.sku);

  const filas = await query<Record<string, string>>(
    `${DIAS_SIN_STOCK}
     select s.sku, to_char(s.dia, 'YYYY-MM-DD') as dia
       from sin_stock s
      where ${clauses.join(" and ")}
      order by s.dia desc, s.sku`,
    params,
  );
  return filas.map((r) => ({ sku: r.sku, dia: r.dia }));
}

/** Cuántos artículos quebraron al menos un día, sin filtrar por SKU. */
async function getSkusQuebrados(f: FiltrosElasticidad): Promise<number> {
  const filas = await query<{ n: string }>(
    `${DIAS_SIN_STOCK} select count(distinct sku)::text as n from sin_stock`,
    [f.desde, f.hasta],
  );
  return num(filas[0]?.n);
}

/** Cuántos días estuvo quebrado cada SKU, para pegarlo a la tabla de artículos. */
async function getResumenSinStock(f: FiltrosElasticidad): Promise<Map<string, number>> {
  const filas = await query<Record<string, string>>(
    `${DIAS_SIN_STOCK}
     select sku, count(*) as dias from sin_stock group by sku`,
    [f.desde, f.hasta],
  );
  return new Map(filas.map((r) => [r.sku, num(r.dias)]));
}

/** Cuántos días miramos en total, para que el "X de Y días" tenga denominador. */
async function getDiasMirados(f: FiltrosElasticidad): Promise<number> {
  const filas = await query<{ dias: string }>(
    `${DIAS_SIN_STOCK} select count(*)::text as dias from dias_mirados`,
    [f.desde, f.hasta],
  );
  return num(filas[0]?.dias);
}

const TOPE = 400;

/**
 * Una fila por artículo con sus cinco bandas al lado. Es la forma en que la
 * pregunta se contesta mirando: "a este artículo, ¿con qué margen me conviene
 * venderlo?".
 *
 * Se ordena por margen total y no por la mejora entre bandas: con la mediana en
 * 0,58 unidades por semana, ordenar por diferencia porcentual pondría arriba a
 * los artículos que vendieron 0 y 1 unidad —donde la "mejora" es infinita y no
 * significa nada— y dejaría abajo a los que de verdad tienen algo que decir.
 */
async function getArticulos(f: FiltrosElasticidad): Promise<FilaElasticidad[]> {
  const w = where(f);
  const filas = await query<Record<string, string | null>>(
    `select f.sku,
            max(f.producto)                   as producto,
            max(f.marca)                      as marca,
            max(f.proveedor)                  as proveedor,
            ${BANDA}                          as banda,
            coalesce(sum(f.cantidad), 0)      as unidades,
            coalesce(sum(${MARGEN_PESOS}), 0) as margen,
            coalesce(sum(f.total_linea), 0)   as facturacion,
            coalesce(sum(${MARGEN_PESOS}), 0)
              / nullif(sum(f.total_linea), 0) as margen_pct
       from gold.fact_ventas f
       ${w.sql}
      group by f.sku, ${BANDA}`,
    w.params,
  );

  const mapa = new Map<string, FilaElasticidad>();
  for (const r of filas) {
    const sku = r.sku as string;
    const fila = mapa.get(sku) ?? {
      sku,
      producto: r.producto,
      marca: r.marca,
      proveedor: r.proveedor,
      unidades: 0,
      margen: 0,
      facturacion: 0,
      unidadesPorBanda: {},
      margenPorBanda: {},
      margenPctPorBanda: {},
      facturacionPorBanda: {},
      mejor: null,
      confiable: false,
      diasSinStock: 0,
    };
    fila.unidades += num(r.unidades);
    fila.margen += num(r.margen);
    fila.facturacion += num(r.facturacion);
    fila.unidadesPorBanda[r.banda as string] = num(r.unidades);
    fila.margenPorBanda[r.banda as string] = num(r.margen);
    fila.margenPctPorBanda[r.banda as string] = opt(r.margen_pct);
    fila.facturacionPorBanda[r.banda as string] = num(r.facturacion);
    mapa.set(sku, fila);
  }

  const sinStock = await getResumenSinStock(f);
  for (const fila of mapa.values()) {
    fila.mejor = mejorBanda(fila.margenPorBanda);
    fila.confiable = fila.unidades >= UDS_MINIMAS_SKU && fila.mejor != null;
    fila.diasSinStock = sinStock.get(fila.sku) ?? 0;
  }

  const todas = [...mapa.values()];
  const visibles = f.soloConfiables ? todas.filter((x) => x.confiable) : todas;
  return visibles.sort((a, b) => b.margen - a.margen).slice(0, TOPE);
}

async function getKpis(f: FiltrosElasticidad, bandas: ResumenBanda[]): Promise<KpisElasticidad> {
  const w = where(f);
  const fila = (
    await query<Record<string, string>>(
      `select count(distinct f.sku) as skus,
              coalesce(sum(f.cantidad), 0)      as unidades,
              coalesce(sum(f.total_linea), 0)   as facturacion,
              coalesce(sum(${MARGEN_PESOS}), 0) as margen
         from gold.fact_ventas f ${w.sql}`,
      w.params,
    )
  )[0];

  const delExperimento = bandas.filter((b) => b.delExperimento);
  const unidades = num(fila?.unidades);

  return {
    skus: num(fila?.skus),
    unidades,
    facturacion: num(fila?.facturacion),
    margen: num(fila?.margen),
    margenPct: num(fila?.facturacion) > 0 ? num(fila?.margen) / num(fila?.facturacion) : null,
    // Qué proporción de lo vendido cayó dentro de las tres bandas del
    // experimento. Si es baja, las conclusiones valen para poca venta.
    dentroDelRango:
      unidades > 0
        ? delExperimento.reduce((a, b) => a + b.unidades, 0) / unidades
        : null,
    diasMirados: 0,
    skusQuebrados: 0,
    votosPorBanda: {},
    comparables: 0,
    comparablesConVolumen: 0,
  };
}

export async function getOpcionesElasticidad(f: FiltrosElasticidad) {
  // Sin los filtros de proveedor/marca puestos: si se filtrara por proveedor,
  // el desplegable de proveedores mostraría únicamente el ya elegido y no se
  // podría cambiar sin limpiar antes.
  const w = where({ desde: f.desde, hasta: f.hasta });   // sin proveedor, marca ni banda
  const [proveedores, marcas] = await Promise.all([
    query<{ v: string }>(
      `select distinct f.proveedor as v from gold.fact_ventas f ${w.sql}
        and f.proveedor is not null order by 1`,
      w.params,
    ),
    query<{ v: string }>(
      `select distinct f.marca as v from gold.fact_ventas f ${w.sql}
        and f.marca is not null order by 1`,
      w.params,
    ),
  ]);
  return { proveedores: proveedores.map((r) => r.v), marcas: marcas.map((r) => r.v) };
}

export async function getDashboardElasticidad(
  f: FiltrosElasticidad,
): Promise<DashboardElasticidad> {
  const bandas = await getBandas(f);

  const [kpis, articulos, diasSinStock, diasMirados, skusQuebrados] = await Promise.all([
    getKpis(f, bandas),
    getArticulos(f),
    getDiasSinStock(f),
    getDiasMirados(f),
    getSkusQuebrados(f),
  ]);

  kpis.diasMirados = diasMirados;
  kpis.skusQuebrados = skusQuebrados;

  // El voto por artículo. Se cuenta sobre `articulos`, que ya trae `mejor`
  // calculado con la misma función que usa la tabla — así el titular y la
  // columna "Mejor" no pueden discrepar.
  //
  // OJO: `articulos` viene recortada al tope y puede venir filtrada por
  // "solo confiables", así que este voto es sobre lo que se está mirando, no
  // sobre el catálogo entero. Es lo correcto: si el usuario filtró por un
  // proveedor, el titular tiene que hablar de ese proveedor.
  const comparables = articulos.filter((a) => a.mejor != null);
  kpis.comparables = comparables.length;
  kpis.comparablesConVolumen = comparables.filter((a) => a.confiable).length;
  kpis.votosPorBanda = {};
  for (const a of comparables) {
    kpis.votosPorBanda[a.mejor!] = (kpis.votosPorBanda[a.mejor!] ?? 0) + 1;
  }

  const conVentas = bandas.filter((b) => b.unidades > 0);

  return {
    // `false` sólo cuando no hay NADA que clasificar. Con ventas en una sola
    // banda igual se muestra: es un dato —"todo se vendió con el mismo margen"—
    // y esconderlo detrás de "faltan datos" sería mentir.
    hayDatos: conVentas.length > 0,
    falta: conVentas.length > 0 ? null : "ventas",
    desde: f.desde,
    hasta: f.hasta,
    kpis,
    bandas,
    articulos,
    diasSinStock,
    recortada: articulos.length === TOPE,
    generadoEn: new Date().toISOString(),
  };
}


// --- Resultados por semana ---------------------------------------------------

/**
 * Las ventas del experimento agrupadas por artículo y DÍA.
 *
 * POR QUÉ POR DÍA Y NO POR SEMANA
 * El corte de las semanas vive en `lib/elasticidad.ts` (`SEMANAS`), que es
 * también el que dibuja las columnas. Si el SQL volviera a decidir dónde
 * termina cada semana, habría dos definiciones del mismo corte y el día que se
 * agregue una cuarta semana una de las dos se va a quedar atrás — con la tabla
 * mostrando una columna que la consulta no llena.
 *
 * Traer por día cuesta poco: son ~5.000 filas para las tres semanas, y el
 * agrupado lo hace `semanaDe`, una sola función, la misma para todos.
 */
async function getVentasPorDia(f: FiltrosElasticidad) {
  const params: unknown[] = [CANAL_MELI, EXPERIMENTO_INICIO, EXPERIMENTO_FIN];
  const clauses = [
    `f.canal = $1`,
    `f.fecha >= $2::date`,
    `f.fecha < $3::date`,   // exclusivo: el último día ya no es del experimento
    CLASIFICABLE,
  ];
  agregarFiltro(clauses, params, "f.proveedor", f.proveedor);
  agregarFiltro(clauses, params, "f.marca", f.marca);
  agregarFiltro(clauses, params, "f.sku", f.sku);

  return query<Record<string, string | null>>(
    `select f.sku,
            to_char(f.fecha, 'YYYY-MM-DD')    as fecha,
            max(f.producto)                   as producto,
            max(f.marca)                      as marca,
            max(f.proveedor)                  as proveedor,
            coalesce(sum(f.cantidad), 0)      as unidades,
            coalesce(sum(${MARGEN_PESOS}), 0) as margen,
            coalesce(sum(f.total_linea), 0)   as facturacion
       from gold.fact_ventas f
      where ${clauses.join(" and ")}
      group by f.sku, f.fecha`,
    params,
  );
}

const vacioSemana = () => ({ unidades: 0, margen: 0, facturacion: 0, diasSinStock: 0 });

export async function getDashboardResultados(
  f: FiltrosElasticidad,
): Promise<DashboardResultados> {
  // Los días sin stock y los días mirados se piden por semana, con el rango de
  // cada una. Es el mismo cálculo que usa la otra pantalla, así que las dos
  // cuentan un quiebre igual.
  const porSemana = await Promise.all(
    SEMANAS.map(async (s) => {
      const rango = { ...f, desde: s.desde, hasta: s.hasta };
      const [sinStock, mirados] = await Promise.all([
        getResumenSinStock(rango),
        getDiasMirados(rango),
      ]);
      return { semana: s, sinStock, mirados };
    }),
  );

  const filas = await getVentasPorDia(f);

  const mapa = new Map<string, FilaResultado>();
  for (const r of filas) {
    const sku = r.sku as string;
    const semana = semanaDe(r.fecha as string);
    if (semana == null) continue;   // no debería pasar: el where ya recorta

    const fila =
      mapa.get(sku) ??
      ({
        sku,
        producto: r.producto,
        marca: r.marca,
        proveedor: r.proveedor,
        semanas: Object.fromEntries(SEMANAS.map((s) => [s.numero, vacioSemana()])),
        unidades: 0,
        margen: 0,
        facturacion: 0,
      } as FilaResultado);

    const celda = fila.semanas[semana];
    celda.unidades += num(r.unidades);
    celda.margen += num(r.margen);
    celda.facturacion += num(r.facturacion);
    fila.unidades += num(r.unidades);
    fila.margen += num(r.margen);
    fila.facturacion += num(r.facturacion);
    mapa.set(sku, fila);
  }

  // Los días sin stock se pegan a TODOS los artículos del experimento, no sólo
  // a los que vendieron: un artículo que no vendió nada porque estuvo quebrado
  // toda la semana es justamente el caso que hay que poder ver.
  for (const { semana, sinStock } of porSemana) {
    for (const [sku, dias] of sinStock) {
      const fila = mapa.get(sku);
      if (fila) fila.semanas[semana.numero].diasSinStock = dias;
    }
  }

  const articulos = [...mapa.values()].sort((a, b) => b.margen - a.margen).slice(0, TOPE);

  const resumen: ResumenSemana[] = porSemana.map(({ semana, mirados }) => {
    const todas = [...mapa.values()];
    const c = todas.map((x) => x.semanas[semana.numero]);
    const unidades = c.reduce((a, x) => a + x.unidades, 0);
    const facturacion = c.reduce((a, x) => a + x.facturacion, 0);
    const margen = c.reduce((a, x) => a + x.margen, 0);
    return {
      numero: semana.numero,
      desde: semana.desde,
      hasta: semana.hasta,
      label: semana.label,
      skus: c.filter((x) => x.unidades > 0).length,
      unidades,
      facturacion,
      margen,
      margenPct: facturacion > 0 ? margen / facturacion : null,
      diasMirados: mirados,
      skusQuebrados: c.filter((x) => x.diasSinStock > 0).length,
    };
  });

  return {
    semanas: resumen,
    articulos,
    recortada: articulos.length === TOPE,
    generadoEn: new Date().toISOString(),
  };
}
