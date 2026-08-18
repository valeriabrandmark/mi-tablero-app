import { query, queryOne } from "@/lib/db";
import type {
  DashboardLogistica,
  FilaComprobante,
  FiltrosLogistica,
  OpcionesLogistica,
  PuntoEtiqueta,
} from "@/lib/types";
import { agregarFiltro, vacio } from "@/lib/filtros";

/**
 * Página "Logística" — equivalente de la página homónima del tablero de Power BI.
 *
 * El grano natural es la LÍNEA de flete (`gold.fact_ventas_flete`), que se cruza
 * con la venta y con el envío:
 *
 *   fact_ventas  --(nro_orden + sku)--  fact_ventas_flete  --(clave_fila)--  reporte_logistica
 *
 * (En Power BI el primer cruce va por una columna `ClaveFleteLinea` armada en
 * Power Query; acá se hace directo con las dos columnas, que es lo mismo.)
 *
 * Ojo con los dos granos distintos: `kg` y la cantidad de envíos viven a nivel
 * ENVÍO (una fila por `clave_fila` en `reporte_logistica`), así que sumarlos
 * sobre las líneas los multiplicaría. Por eso van en su propia consulta.
 *
 * Filtro fijo de la página (viene del filtro de página del .pbit):
 * `reporte_logistica.provincia <> ''`.
 */

type Where = { sql: string; params: unknown[] };

// `modoFlete` queda afuera: es un modo de cálculo, no una lista de valores.
type ClaveLista = Exclude<keyof FiltrosLogistica, "modoFlete" | "estadoFlete">;

const OPCIONALES: [ClaveLista, string][] = [
  ["vendedor", "fv.vendedor"],
  ["empresa", "fv.empresa"],
  ["mes", "fv.mes_comercial"],
  ["transporte", "rl.transporte"],
  ["provincia", "rl.provincia"],
  ["proveedor", "fv.proveedor"],
];

/**
 * `omitir` desactiva un filtro para una consulta puntual: los gráficos que
 * desglosan por proveedor (o por provincia) tienen que seguir mostrando el
 * ranking completo aunque haya uno seleccionado, si no quedan con una sola barra.
 */
function whereBase(f: FiltrosLogistica, omitir: (keyof FiltrosLogistica)[] = []): Where {
  const params: unknown[] = [];
  const clauses = ["coalesce(rl.provincia, '') <> ''"];

  for (const [key, columna] of OPCIONALES) {
    if (!omitir.includes(key)) agregarFiltro(clauses, params, columna, f[key]);
  }

  // Estado de flete: con los dos tildados no hay nada que filtrar, igual que
  // con ninguno. Solo recorta cuando se eligió uno de los dos.
  const estados = f.estadoFlete ?? [];
  if (!vacio(estados) && estados.length < 2) {
    clauses.push(
      estados.includes("real")
        ? "fvf.tiene_flete_real = true"
        : "coalesce(fvf.tiene_flete_real, false) = false",
    );
  }

  return { sql: clauses.join("\n      and "), params };
}

/** CTE con las líneas que pasan los filtros; la usan casi todas las consultas. */
function cteLineas(w: Where) {
  return `with lineas as (
    select fvf.clave_fila,
           fvf.flete_prorrateado,
           fvf.tiene_flete_real,
           fv.proveedor, fv.cliente, fv.comprobante, fv.nro_orden, fv.fecha,
           fv.precio_neto, fv.cantidad, fv.margen_total,
           rl.provincia
    from gold.fact_ventas_flete fvf
    join gold.fact_ventas fv
      on fv.nro_orden::text = fvf.nro_orden and fv.sku = fvf.sku
    join gold.reporte_logistica rl on rl.clave_fila = fvf.clave_fila
    where ${w.sql}
  )`;
}

// --- KPIs --------------------------------------------------------------------

type FilaTotales = {
  fleteTotal: number;
  fleteRealFiltrado: number;
  fleteEstimadoFiltrado: number;
  lineas: string;
  lineasReales: string;
  facturacionNeta: number;
  margen: number;
};

async function getTotales(f: FiltrosLogistica) {
  const w = whereBase(f);
  const fila = await queryOne<FilaTotales>(
    `${cteLineas(w)}
     select coalesce(sum(flete_prorrateado), 0)::float8 as "fleteTotal",
            coalesce(sum(flete_prorrateado) filter (where tiene_flete_real = true), 0)::float8 as "fleteRealFiltrado",
            coalesce(sum(flete_prorrateado) filter (where coalesce(tiene_flete_real, false) = false), 0)::float8 as "fleteEstimadoFiltrado",
            count(*) as "lineas",
            count(*) filter (where tiene_flete_real = true) as "lineasReales",
            coalesce(sum(precio_neto * cantidad), 0)::float8 as "facturacionNeta",
            coalesce(sum(margen_total), 0)::float8 as "margen"
     from lineas`,
    w.params,
  );
  return {
    fleteTotal: fila?.fleteTotal ?? 0,
    fleteRealFiltrado: fila?.fleteRealFiltrado ?? 0,
    fleteEstimadoFiltrado: fila?.fleteEstimadoFiltrado ?? 0,
    lineas: Number(fila?.lineas ?? 0),
    lineasReales: Number(fila?.lineasReales ?? 0),
    facturacionNeta: fila?.facturacionNeta ?? 0,
    margen: fila?.margen ?? 0,
  };
}

/** Envíos y kg: grano `reporte_logistica`, una fila por `clave_fila`. */
async function getEnvios(f: FiltrosLogistica) {
  const w = whereBase(f);
  const fila = await queryOne<{ envios: string; kg: number }>(
    `${cteLineas(w)}
     select count(*) as "envios", coalesce(sum(rl.kg), 0)::float8 as "kg"
     from gold.reporte_logistica rl
     where rl.clave_fila in (select clave_fila from lineas)`,
    w.params,
  );
  return { cantidadEnvios: Number(fila?.envios ?? 0), kgTotales: fila?.kg ?? 0 };
}

// --- Gráficos ----------------------------------------------------------------

function porProveedor(expr: string, orden = "valor desc nulls last", limite = 12) {
  return `select coalesce(proveedor, '—') as label, ${expr} as valor
          from lineas group by proveedor order by ${orden} limit ${limite}`;
}

async function getGraficos(f: FiltrosLogistica) {
  // Los desgloses por proveedor ignoran el filtro de proveedor, y el de
  // provincia ignora el de provincia: así el ranking no se queda con una barra.
  const wp = whereBase(f, ["proveedor"]);
  const wpr = whereBase(f, ["provincia"]);

  const [unidades, flete, margen, provincias, totales] = await Promise.all([
    query<PuntoEtiqueta>(
      `${cteLineas(wp)} ${porProveedor("coalesce(sum(cantidad), 0)::float8")}`,
      wp.params,
    ),
    query<PuntoEtiqueta>(
      `${cteLineas(wp)} ${porProveedor("coalesce(sum(flete_prorrateado), 0)::float8")}`,
      wp.params,
    ),
    query<PuntoEtiqueta>(
      `${cteLineas(wp)} ${porProveedor("coalesce(sum(margen_total), 0)::float8")}`,
      wp.params,
    ),
    query<PuntoEtiqueta>(
      `${cteLineas(wpr)}
       select coalesce(provincia, '—') as label,
              case when sum(precio_neto * cantidad) = 0 then 0
                   else sum(flete_prorrateado) / sum(precio_neto * cantidad)
              end::float8 as valor
       from lineas group by provincia order by valor desc nulls last limit 15`,
      wpr.params,
    ),
    // Denominadores de las tortas: sobre TODOS los proveedores, no solo el top 12.
    queryOne<{ unidades: number; flete: number }>(
      `${cteLineas(wp)}
       select coalesce(sum(cantidad), 0)::float8 as unidades,
              coalesce(sum(flete_prorrateado), 0)::float8 as flete
       from lineas`,
      wp.params,
    ),
  ]);

  return {
    unidades,
    flete,
    margen,
    provincias,
    totales: { unidades: totales?.unidades ?? 0, flete: totales?.flete ?? 0 },
  };
}

/** Tabla "Comprobantes Asociados". */
async function getComprobantes(f: FiltrosLogistica): Promise<FilaComprobante[]> {
  const w = whereBase(f);
  return query<FilaComprobante>(
    `${cteLineas(w)}
     select comprobante,
            max(nro_orden::text) as "nroOrden",
            max(cliente) as cliente,
            max(provincia) as provincia,
            to_char(max(fecha), 'YYYY-MM-DD') as fecha,
            coalesce(sum(precio_neto * cantidad), 0)::float8 as facturacion,
            coalesce(sum(flete_prorrateado), 0)::float8 as flete,
            case when sum(precio_neto * cantidad) = 0 then null
                 else sum(flete_prorrateado) / sum(precio_neto * cantidad)
            end::float8 as "pctFlete"
     from lineas
     where comprobante is not null
     group by comprobante
     order by flete desc nulls last
     limit 100`,
    w.params,
  );
}

// --- Opciones de los selectores ----------------------------------------------

export async function getOpcionesLogistica(): Promise<OpcionesLogistica> {
  const w = whereBase({});
  const columna = (col: string, orden: string) =>
    query<{ valor: string }>(
      `${cteLineas(w)}
       select distinct t.valor from (select ${col} as valor from lineas) t
       where t.valor is not null and t.valor <> ''
       order by t.valor ${orden}`,
      w.params,
    );

  // `transporte` no está en el CTE (es del envío), va por separado.
  const [vendedores, empresas, meses, provincias, transportes] = await Promise.all([
    query<{ valor: string }>(
      `select distinct fv.vendedor as valor from gold.fact_ventas fv
       where fv.vendedor is not null and fv.vendedor <> '' order by valor`,
    ),
    query<{ valor: string }>(
      `select distinct fv.empresa as valor from gold.fact_ventas fv
       where fv.empresa is not null and fv.empresa <> '' order by valor`,
    ),
    query<{ valor: string }>(
      `select distinct fv.mes_comercial as valor from gold.fact_ventas fv
       where fv.mes_comercial is not null and fv.mes_comercial <> '' order by valor desc`,
    ),
    columna("provincia", "asc"),
    query<{ valor: string }>(
      `select distinct rl.transporte as valor from gold.reporte_logistica rl
       where rl.transporte is not null and rl.transporte <> '' order by valor`,
    ),
  ]);

  return {
    vendedores: vendedores.map((r) => r.valor),
    empresas: empresas.map((r) => r.valor),
    meses: meses.map((r) => r.valor),
    provincias: provincias.map((r) => r.valor),
    transportes: transportes.map((r) => r.valor),
  };
}

// --- Dashboard completo ------------------------------------------------------

export async function getDashboardLogistica(f: FiltrosLogistica): Promise<DashboardLogistica> {
  const [totales, envios, graficos, comprobantes] = await Promise.all([
    getTotales(f),
    getEnvios(f),
    getGraficos(f),
    getComprobantes(f),
  ]);

  // Espeja `ParamFlete[Modo]` del modelo: cuánto flete se le descuenta al margen.
  const fleteAplicado =
    f.modoFlete === "real"
      ? totales.fleteRealFiltrado
      : f.modoFlete === "real-estimado"
        ? totales.fleteRealFiltrado + totales.fleteEstimadoFiltrado
        : 0;
  const margenAjustado = totales.margen - fleteAplicado;

  return {
    kpis: {
      ...envios,
      fleteTotal: totales.fleteTotal,
      fleteRealFiltrado: totales.fleteRealFiltrado,
      fleteEstimadoFiltrado: totales.fleteEstimadoFiltrado,
      facturacionNeta: totales.facturacionNeta,
      pctLineasFleteReal: totales.lineas > 0 ? totales.lineasReales / totales.lineas : null,
      pctFleteSobreFacturacion:
        totales.facturacionNeta > 0 ? totales.fleteTotal / totales.facturacionNeta : null,
      costoPorKg: envios.kgTotales > 0 ? totales.fleteTotal / envios.kgTotales : null,
      margenAjustado,
      rentabilidadAjustadaPct:
        totales.facturacionNeta > 0 ? margenAjustado / totales.facturacionNeta : null,
    },
    unidadesPorProveedor: graficos.unidades,
    margenPorProveedor: graficos.margen,
    fletePorProveedor: graficos.flete,
    totalesProveedor: graficos.totales,
    pctFletePorProvincia: graficos.provincias,
    comprobantes,
    generadoEn: new Date().toISOString(),
  };
}
