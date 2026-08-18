import { query, queryOne } from "@/lib/db";
import {
  CANAL_MAYORISTA,
  MIN_UNIDADES_MARGEN,
  VENDEDORES_EXCLUIDOS,
} from "@/lib/constantes";
import type {
  DashboardVentasMayoristas,
  Filtros,
  MargenProveedor,
  OpcionesFiltro,
  PuntoDiaVendedor,
  PuntoProveedor,
  SerieDiaria,
} from "@/lib/types";

type Where = { sql: string; params: unknown[] };

const OPCIONALES: [keyof Filtros, string][] = [
  ["vendedor", "vendedor"],
  ["empresa", "empresa"],
  ["mes", "mes_comercial"],
  ["proveedor", "proveedor"],
];

/**
 * Filtro fijo de la página (canal + exclusión de no-vendedores) más los
 * filtros opcionales que haya elegido el usuario.
 * `extra` son condiciones adicionales propias de cada consulta.
 * `omitir` desactiva un filtro opcional para esa consulta puntual: los dos
 * gráficos por proveedor siguen mostrando el ranking completo aunque haya un
 * proveedor seleccionado, si no se quedarían con una sola barra.
 */
function whereBase(
  f: Filtros,
  extra: string[] = [],
  alias = "fv",
  omitir: (keyof Filtros)[] = [],
): Where {
  const params: unknown[] = [CANAL_MAYORISTA, VENDEDORES_EXCLUIDOS];
  const clauses = [
    `${alias}.canal = $1`,
    `coalesce(${alias}.vendedor, '') <> all($2::text[])`,
    ...extra,
  ];

  for (const [key, columna] of OPCIONALES) {
    const valor = f[key];
    if (valor && !omitir.includes(key)) {
      params.push(valor);
      clauses.push(`${alias}.${columna} = $${params.length}`);
    }
  }

  return { sql: clauses.join("\n    and "), params };
}

// --- 1. Totales + margen ajustado -------------------------------------------

type FilaTotales = {
  facturacionNeta: number;
  costoMercaderia: number;
  unidades: number;
  margenTotal: number;
  margenAjustado: number;
  clientesConCompra: string;
  cantidadPedidos: string;
};

async function getTotales(f: Filtros) {
  const w = whereBase(f);
  const fila = await queryOne<FilaTotales>(
    `select coalesce(sum(fv.precio_neto * fv.cantidad), 0)::float8 as "facturacionNeta",
            coalesce(sum(fv.costo_unitario * fv.cantidad), 0)::float8 as "costoMercaderia",
            coalesce(sum(fv.cantidad), 0)::float8 as "unidades",
            coalesce(sum(fv.margen_total), 0)::float8 as "margenTotal",
            coalesce(
              sum(fv.margen_total) - sum(fv.costo_unitario * fv.cantidad * coalesce(fpm.pct_flete, 0)),
              0
            )::float8 as "margenAjustado",
            count(distinct fv.cliente) as "clientesConCompra",
            count(distinct fv.nro_orden) as "cantidadPedidos"
     from gold.fact_ventas fv
     left join gold.fletes_proveedores_pct_mensual fpm
       on fv.proveedor = fpm.proveedor and fv.mes_comercial = fpm.mes_aplicable
     where ${w.sql}`,
    w.params,
  );

  return {
    facturacionNeta: fila?.facturacionNeta ?? 0,
    costoMercaderia: fila?.costoMercaderia ?? 0,
    unidades: fila?.unidades ?? 0,
    margenTotal: fila?.margenTotal ?? 0,
    margenAjustado: fila?.margenAjustado ?? 0,
    // count() vuelve como bigint -> pg lo entrega string.
    clientesConCompra: Number(fila?.clientesConCompra ?? 0),
    cantidadPedidos: Number(fila?.cantidadPedidos ?? 0),
  };
}

// --- 2. % Top 10 clientes ----------------------------------------------------

type FilaTop10 = { totalGeneral: number; totalTop10: number };

async function getTop10Clientes(f: Filtros) {
  const w = whereBase(f, ["fv.cliente is not null"]);
  const fila = await queryOne<FilaTop10>(
    `with base as (
       select fv.cliente as cliente, sum(fv.precio_neto * fv.cantidad) as total
       from gold.fact_ventas fv
       where ${w.sql}
       group by fv.cliente
     )
     select coalesce((select sum(total) from base), 0)::float8 as "totalGeneral",
            coalesce((select sum(total)
                      from (select total from base order by total desc nulls last limit 10) t
                     ), 0)::float8 as "totalTop10"`,
    w.params,
  );

  const totalGeneral = fila?.totalGeneral ?? 0;
  const totalTop10 = fila?.totalTop10 ?? 0;
  return totalGeneral > 0 ? totalTop10 / totalGeneral : null;
}

// --- 3. Facturación por proveedor (torta) ------------------------------------

async function getFacturacionPorProveedor(f: Filtros) {
  const w = whereBase(f, [], "fv", ["proveedor"]);

  // El total va aparte porque la lista está cortada en 12 y porque acá no
  // aplica el filtro de proveedor: los porcentajes son sobre el total real.
  const [datos, totalFila] = await Promise.all([
    query<PuntoProveedor>(
      `select coalesce(fv.proveedor, '—') as label,
              coalesce(sum(fv.precio_neto * fv.cantidad), 0)::float8 as total
       from gold.fact_ventas fv
       where ${w.sql}
       group by fv.proveedor
       order by total desc nulls last
       limit 12`,
      w.params,
    ),
    queryOne<{ total: number }>(
      `select coalesce(sum(fv.precio_neto * fv.cantidad), 0)::float8 as total
       from gold.fact_ventas fv
       where ${w.sql}`,
      w.params,
    ),
  ]);

  return { datos, total: totalFila?.total ?? 0 };
}

// --- 4. Margen % por proveedor (barras horizontales) -------------------------

async function getMargenPorProveedor(f: Filtros): Promise<MargenProveedor[]> {
  const w = whereBase(f, ["fv.proveedor is not null"], "fv", ["proveedor"]);
  return query<MargenProveedor>(
    `select fv.proveedor as label,
            case when sum(fv.precio_neto * fv.cantidad) = 0 then 0
                 else (sum(fv.margen_total) - sum(fv.costo_unitario * fv.cantidad * coalesce(fpm.pct_flete, 0)))
                      / sum(fv.precio_neto * fv.cantidad)
            end::float8 as "margenPct",
            coalesce(sum(fv.cantidad), 0)::float8 as unidades
     from gold.fact_ventas fv
     left join gold.fletes_proveedores_pct_mensual fpm
       on fv.proveedor = fpm.proveedor and fv.mes_comercial = fpm.mes_aplicable
     where ${w.sql}
     group by fv.proveedor
     having sum(fv.cantidad) >= ${MIN_UNIDADES_MARGEN}
     order by "margenPct" desc
     limit 15`,
    w.params,
  );
}

// --- 5. Facturación por día y vendedor (líneas) ------------------------------

type FilaDiaria = { fecha: string; vendedor: string; total: number };

async function getSerieDiaria(f: Filtros): Promise<SerieDiaria> {
  const w = whereBase(f, ["fv.fecha is not null"]);
  const filas = await query<FilaDiaria>(
    `select to_char(fv.fecha, 'YYYY-MM-DD') as fecha,
            coalesce(fv.vendedor, '—') as vendedor,
            coalesce(sum(fv.precio_neto * fv.cantidad), 0)::float8 as total
     from gold.fact_ventas fv
     where ${w.sql}
     group by fv.fecha, fv.vendedor
     order by fv.fecha`,
    w.params,
  );

  // Pivot para recharts: una fila por fecha, una columna por vendedor.
  const porVendedor = new Map<string, number>();
  const porFecha = new Map<string, PuntoDiaVendedor>();

  for (const fila of filas) {
    porVendedor.set(fila.vendedor, (porVendedor.get(fila.vendedor) ?? 0) + fila.total);
    let punto = porFecha.get(fila.fecha);
    if (!punto) {
      punto = { fecha: fila.fecha };
      porFecha.set(fila.fecha, punto);
    }
    punto[fila.vendedor] = ((punto[fila.vendedor] as number) ?? 0) + fila.total;
  }

  // Los vendedores más grandes primero: define el orden de colores y la leyenda.
  const vendedores = [...porVendedor.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([nombre]) => nombre);

  const data = [...porFecha.values()].sort((a, b) => a.fecha.localeCompare(b.fecha));

  // recharts corta la línea si falta la clave; con 0 explícito queda continua.
  for (const punto of data) {
    for (const vendedor of vendedores) {
      if (punto[vendedor] == null) punto[vendedor] = 0;
    }
  }

  return { vendedores, data };
}

// --- 6. Flete real vs estimado -----------------------------------------------

type FilaFlete = { fleteTotalReal: number; fleteEstimadoFiltrado: number };

async function getFletes(f: Filtros) {
  const w = whereBase(f);
  const fila = await queryOne<FilaFlete>(
    `select coalesce(sum(fvf.flete_prorrateado) filter (where fvf.tiene_flete_real = true), 0)::float8 as "fleteTotalReal",
            coalesce(sum(fvf.flete_prorrateado) filter (where coalesce(fvf.tiene_flete_real, false) = false), 0)::float8 as "fleteEstimadoFiltrado"
     from gold.fact_ventas fv
     left join gold.fact_ventas_flete fvf
       on fv.nro_orden::text = fvf.nro_orden and fv.sku = fvf.sku
     where ${w.sql}`,
    w.params,
  );

  return {
    fleteTotalReal: fila?.fleteTotalReal ?? 0,
    fleteEstimadoFiltrado: fila?.fleteEstimadoFiltrado ?? 0,
  };
}

// --- Opciones de los selectores ----------------------------------------------

export async function getOpcionesFiltro(): Promise<OpcionesFiltro> {
  // Sin filtros opcionales: las opciones no dependen de lo ya seleccionado.
  const w = whereBase({});

  const columna = (col: string, orden: string) =>
    query<{ valor: string }>(
      `select distinct fv.${col} as valor
       from gold.fact_ventas fv
       where ${w.sql} and fv.${col} is not null and fv.${col} <> ''
       order by valor ${orden}`,
      w.params,
    );

  const [vendedores, empresas, meses] = await Promise.all([
    columna("vendedor", "asc"),
    columna("empresa", "asc"),
    columna("mes_comercial", "desc"),
  ]);

  return {
    vendedores: vendedores.map((r) => r.valor),
    empresas: empresas.map((r) => r.valor),
    meses: meses.map((r) => r.valor),
  };
}

// --- Dashboard completo ------------------------------------------------------

export async function getDashboardVentasMayoristas(
  f: Filtros,
): Promise<DashboardVentasMayoristas> {
  const [totales, pctTop10Clientes, facturacionPorProveedor, margenPorProveedor, serieDiaria, fletes] =
    await Promise.all([
      getTotales(f),
      getTop10Clientes(f),
      getFacturacionPorProveedor(f),
      getMargenPorProveedor(f),
      getSerieDiaria(f),
      getFletes(f),
    ]);

  return {
    facturacionPorProveedor: facturacionPorProveedor.datos,
    facturacionTotalProveedores: facturacionPorProveedor.total,
    kpis: {
      ...totales,
      ...fletes,
      pctTop10Clientes,
      rentabilidadAjustadaPct:
        totales.facturacionNeta > 0 ? totales.margenAjustado / totales.facturacionNeta : null,
      ticketPromedio:
        totales.cantidadPedidos > 0 ? totales.facturacionNeta / totales.cantidadPedidos : null,
    },
    margenPorProveedor,
    serieDiaria,
    generadoEn: new Date().toISOString(),
  };
}
