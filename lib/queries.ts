import { query, queryOne } from "@/lib/db";
import {
  CANAL_MAYORISTA,
  DIA_INICIO_MES_COMERCIAL,
  mesComercialActual,
  VENDEDORES_INCLUIDOS,
} from "@/lib/constantes";
import { hoyArgentina } from "@/lib/rangos";
import type {
  DashboardVentasMayoristas,
  FilaArticulo,
  FilaComprobanteVenta,
  Filtros,
  MargenProveedor,
  RentabilidadCliente,
  OpcionesFiltro,
  PuntoDiaVendedor,
  PuntoProveedor,
  SerieDiaria,
} from "@/lib/types";
import { agregarFiltro, vacio } from "@/lib/filtros";

type Where = { sql: string; params: unknown[] };

const OPCIONALES: [keyof Filtros, string][] = [
  ["vendedor", "vendedor"],
  ["empresa", "empresa"],
  ["mes", "mes_comercial"],
  ["proveedor", "proveedor"],
  ["cliente", "cliente"],
  ["sku", "sku"],
  ["comprobante", "comprobante"],
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
  const params: unknown[] = [CANAL_MAYORISTA, VENDEDORES_INCLUIDOS];
  const clauses = [
    `${alias}.canal = $1`,
    `${alias}.vendedor = any($2::text[])`,
    ...extra,
  ];

  for (const [key, columna] of OPCIONALES) {
    if (!omitir.includes(key)) agregarFiltro(clauses, params, `${alias}.${columna}`, f[key]);
  }

  // La provincia no está en fact_ventas: se llega por el envío. Va como EXISTS
  // para no duplicar filas, y solo cuando el filtro está puesto, así las
  // consultas sin provincia no quedan atadas a la cobertura de logística.
  if (!vacio(f.provincia) && !omitir.includes("provincia")) {
    params.push(f.provincia);
    clauses.push(`exists (
      select 1 from gold.fact_ventas_flete fvf
      join gold.reporte_logistica rl on rl.clave_fila = fvf.clave_fila
      where fvf.nro_orden = ${alias}.nro_orden::text
        and fvf.sku = ${alias}.sku
        and rl.provincia = any($${params.length}::text[])
    )`);
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

/**
 * Totales del recorte. `hastaFecha` corta el periodo en ese dia, y solo se usa
 * para el mes de comparacion.
 *
 * POR QUE: el mes comercial en curso esta a medio pasar -- hoy es el dia 14 de
 * 31 --, asi que compararlo contra el mes anterior COMPLETO da una caida que no
 * existe. Con el corte, el mes anterior se mide tambien hasta su dia 14.
 */
async function getTotales(f: Filtros, hastaFecha?: string) {
  // `extra` va como texto crudo al SQL (no acepta parámetros), así que la fecha
  // se valida antes de interpolarla. Hoy siempre la calcula el servidor y nunca
  // llega del navegador, pero eso es una propiedad de QUIEN LLAMA, y quien
  // llama puede cambiar: la barrera va acá, donde está el riesgo.
  if (hastaFecha != null && !/^\d{4}-\d{2}-\d{2}$/.test(hastaFecha)) {
    throw new Error(`Fecha de corte inválida: ${hastaFecha}`);
  }
  const w = whereBase(f, hastaFecha ? [`fv.fecha <= '${hastaFecha}'::date`] : []);
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
       -- Sin tope: la pantalla los muestra a todos. Antes era el top 12.`,
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
     -- SIN el piso de unidades y SIN tope. Antes pedia MIN_UNIDADES_MARGEN
     -- unidades y se quedaba con 15 proveedores; el piso estaba para que un
     -- proveedor de dos unidades no encabezara el ranking con un margen
     -- irreal. Ahora estan todos y el grafico scrollea: la columna de unidades
     -- queda en el tooltip para poder desconfiar de los de muestra chica.
     order by "margenPct" desc`,
    w.params,
  );
}

// --- Rentabilidad por cliente (barras) ---------------------------------------

/**
 * Barras de % rentabilidad ajustada por cliente: TODOS los clientes.
 *
 * Se ordenan por rentabilidad y el gráfico scrollea. Antes se recortaba a los
 * 15 más grandes por facturación, para que un cliente de una compra chica no
 * encabezara el ranking con un porcentaje irreal. Ese riesgo sigue existiendo
 * -- ahora se ve entero y hay que mirarlo sabiendo que arriba de todo puede
 * haber una venta de $ 3.000.
 */
async function getRentabilidadPorCliente(f: Filtros): Promise<RentabilidadCliente[]> {
  const w = whereBase(f, ["fv.cliente is not null"], "fv", ["cliente"]);
  return query<RentabilidadCliente>(
    `with por_cliente as (
       select fv.cliente as label,
              coalesce(sum(fv.precio_neto * fv.cantidad), 0)::float8 as facturacion,
              case when sum(fv.precio_neto * fv.cantidad) = 0 then null
                   else (sum(fv.margen_total)
                         - sum(fv.costo_unitario * fv.cantidad * coalesce(fpm.pct_flete, 0)))
                        / sum(fv.precio_neto * fv.cantidad)
              end::float8 as valor
       from gold.fact_ventas fv
       left join gold.fletes_proveedores_pct_mensual fpm
         on fv.proveedor = fpm.proveedor and fv.mes_comercial = fpm.mes_aplicable
       where ${w.sql}
       group by fv.cliente
       order by facturacion desc nulls last
       -- Sin tope: estan todos los clientes y el grafico scrollea.
     )
     select * from por_cliente order by valor desc nulls last`,
    w.params,
  );
}

// --- Tabla "Articulos incluídos" ---------------------------------------------

async function getArticulos(f: Filtros): Promise<FilaArticulo[]> {
  const w = whereBase(f, [], "fv", ["sku"]);
  return query<FilaArticulo>(
    `select fv.sku,
            max(fv.producto) as producto,
            coalesce(sum(fv.cantidad), 0)::float8 as cantidad,
            avg(nullif(fv.oferta_pct, 0))::float8 as "ofertaPct",
            -- Promedios ponderados por cantidad; sumar precios unitarios no
            -- significaría nada (en el .pbit están como Sum, es un error).
            case when sum(fv.cantidad) = 0 then null
                 else sum(fv.precio_neto * fv.cantidad) / sum(fv.cantidad)
            end::float8 as "precioPromedio",
            case when sum(fv.cantidad) = 0 then null
                 else sum(fv.costo_unitario * fv.cantidad) / sum(fv.cantidad)
            end::float8 as "costoPromedio",
            coalesce(sum(fv.precio_neto * fv.cantidad), 0)::float8 as facturacion,
            case when sum(fv.precio_neto * fv.cantidad) = 0 then null
                 else (sum(fv.margen_total)
                       - sum(fv.costo_unitario * fv.cantidad * coalesce(fpm.pct_flete, 0)))
                      / sum(fv.precio_neto * fv.cantidad)
            end::float8 as "rentabilidadPct"
     from gold.fact_ventas fv
     left join gold.fletes_proveedores_pct_mensual fpm
       on fv.proveedor = fpm.proveedor and fv.mes_comercial = fpm.mes_aplicable
     where ${w.sql}
     group by fv.sku
     order by facturacion desc nulls last
     limit 200`,
    w.params,
  );
}

// --- Tabla "Comprobantes" ----------------------------------------------------

async function getComprobantesVenta(f: Filtros): Promise<FilaComprobanteVenta[]> {
  const w = whereBase(f, ["fv.comprobante is not null"], "fv", ["comprobante"]);
  return query<FilaComprobanteVenta>(
    `select fv.comprobante,
            to_char(max(fv.fecha), 'YYYY-MM-DD') as fecha,
            max(fv.cliente) as cliente,
            coalesce(sum(fv.cantidad), 0)::float8 as unidades,
            coalesce(sum(fv.precio_neto * fv.cantidad), 0)::float8 as facturacion
     from gold.fact_ventas fv
     where ${w.sql}
     group by fv.comprobante
     order by facturacion desc nulls last
     limit 200`,
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
  const provincias = await query<{ valor: string }>(
    `select distinct rl.provincia as valor from gold.reporte_logistica rl
     where rl.provincia is not null and rl.provincia <> '' order by valor`,
  );
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
    provincias: provincias.map((r) => r.valor),
  };
}

// --- Dashboard completo ------------------------------------------------------

/** "2026-08" -> "2026-07". */
function mesAnterior(mes: string): string {
  const [anio, m] = mes.split("-").map(Number);
  return m === 1
    ? `${anio - 1}-12`
    : `${anio}-${String(m - 1).padStart(2, "0")}`;
}

/**
 * Con qué mes comparar, y hasta qué día medirlo.
 *
 * Solo se compara cuando hay UN mes elegido: con varios, o con ninguno, no hay
 * un "mes anterior" que signifique algo, y un número que no significa nada es
 * peor que no mostrarlo.
 *
 * `hasta` sale de cuántos días lleva el mes en curso. Si estamos en el día 14
 * de agosto comercial, julio se mide hasta SU día 14. Sin eso, el tablero
 * compararía medio mes contra un mes entero y mostraría una caída todos los
 * meses hasta el día 5.
 */
function mesDeComparacion(f: Filtros): { mes: string; hasta: string | null } | null {
  if (f.mes?.length !== 1) return null;
  const mes = f.mes[0];
  const anterior = mesAnterior(mes);

  // Si el mes elegido no es el que está corriendo, ya está cerrado: se comparan
  // los dos enteros y no hay nada que recortar.
  if (mes !== mesComercialActual()) return { mes: anterior, hasta: null };

  const dd = String(DIA_INICIO_MES_COMERCIAL).padStart(2, "0");
  const inicioActual = new Date(`${mes}-${dd}T00:00:00Z`);
  const hoy = new Date(`${hoyArgentina()}T00:00:00Z`);
  const dias = Math.round((hoy.getTime() - inicioActual.getTime()) / 86_400_000);

  const inicioAnterior = new Date(`${anterior}-${dd}T00:00:00Z`);
  const corte = new Date(inicioAnterior.getTime() + dias * 86_400_000);
  return { mes: anterior, hasta: corte.toISOString().slice(0, 10) };
}

export async function getDashboardVentasMayoristas(
  f: Filtros,
): Promise<DashboardVentasMayoristas> {
  const comparar = mesDeComparacion(f);

  const [
    totales,
    pctTop10Clientes,
    facturacionPorProveedor,
    margenPorProveedor,
    serieDiaria,
    fletes,
    rentabilidadPorCliente,
    articulos,
    comprobantes,
    totalesAnterior,
  ] = await Promise.all([
    getTotales(f),
    getTop10Clientes(f),
    getFacturacionPorProveedor(f),
    getMargenPorProveedor(f),
    getSerieDiaria(f),
    getFletes(f),
    getRentabilidadPorCliente(f),
    getArticulos(f),
    getComprobantesVenta(f),
    // El mes anterior mantiene TODOS los otros filtros: comparar "agosto de
    // ALGABO" contra "julio de todo" no diría nada.
    comparar
      ? getTotales({ ...f, mes: [comparar.mes] }, comparar.hasta ?? undefined)
      : Promise.resolve(null),
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
    rentabilidadPorCliente,
    articulos,
    comprobantes,
    serieDiaria,
    comparacion:
      comparar && totalesAnterior && totalesAnterior.cantidadPedidos > 0
        ? {
            mes: comparar.mes,
            hasta: comparar.hasta,
            facturacionNeta: totalesAnterior.facturacionNeta,
            costoMercaderia: totalesAnterior.costoMercaderia,
            unidades: totalesAnterior.unidades,
            clientesConCompra: totalesAnterior.clientesConCompra,
            cantidadPedidos: totalesAnterior.cantidadPedidos,
            margenAjustado: totalesAnterior.margenAjustado,
            rentabilidadAjustadaPct:
              totalesAnterior.facturacionNeta > 0
                ? totalesAnterior.margenAjustado / totalesAnterior.facturacionNeta
                : null,
          }
        : null,
    generadoEn: new Date().toISOString(),
  };
}
