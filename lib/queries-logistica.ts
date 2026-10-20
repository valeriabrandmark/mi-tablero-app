import { cacheado } from "@/lib/cache";
import { query, queryOne } from "@/lib/db";
import type {
  DashboardLogistica,
  FilaArticuloEnvio,
  FilaEnvio,
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

type ClaveLista = Exclude<keyof FiltrosLogistica, "estadoFlete" | "buscar">;

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
function whereBase(
  f: FiltrosLogistica,
  omitir: (keyof FiltrosLogistica)[] = [],
): Where {
  const params: unknown[] = [];
  const clauses = ["coalesce(rl.provincia, '') <> ''"];

  for (const [key, columna] of OPCIONALES) {
    if (!omitir.includes(key)) agregarFiltro(clauses, params, columna, f[key]);
  }

  // EL BUSCADOR PEGA CONTRA LAS CINCO COSAS CON LAS QUE SE BUSCA UN ENVIO.
  //
  // Nadie llega a un envío por el mismo lado: desde una queja viene el nombre
  // del cliente, desde contabilidad el comprobante o el CUIT, y desde depósito
  // el número de preparación o de pedido. Un buscador que sólo mirara el
  // nombre obligaría a saber de antemano dónde mirar.
  //
  // El CUIT entra sin guiones de los dos lados: en la base está "20-11111111-1"
  // y nadie lo escribe así cuando lo está buscando. Va contra el maestro de
  // clientes por código, que es lo único que tiene el documento.
  const termino = f.buscar?.trim();
  if (termino) {
    params.push(`%${termino.toUpperCase()}%`);
    const t = params.length;
    params.push(`%${termino.replace(/[^0-9A-Za-z]/g, "")}%`);
    const d = params.length;
    clauses.push(
      `(upper(rl.cliente) like $${t}
        or upper(coalesce(fv.cliente, '')) like $${t}
        or upper(coalesce(fv.comprobante, '')) like $${t}
        or rl.preparacion_id::text like $${d}
        or upper(coalesce(rl.pedidos, '')) like $${t}
        or rl.cliente_codigo in (
             select trim(c.id) from bronze.sigma_clientes c
             where regexp_replace(coalesce(c."numeroDocumento", ''), '[^0-9A-Za-z]', '', 'g') like $${d}
               and coalesce(c."numeroDocumento", '') <> ''
           ))`,
    );
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

/**
 * CTE con las líneas que pasan los filtros; la usan casi todas las consultas.
 *
 * `flete_prorrateado` se divide por `lineas_venta`: `fact_ventas_flete` tiene
 * una fila por (nro_orden, sku) y `fact_ventas` puede tener varios renglones
 * para esa combinación —una línea facturada en dos comprobantes, o una factura
 * más su nota de crédito—, así que este join la repite y sin dividir el mismo
 * flete se sumaría dos o tres veces. Como todas las consultas de la página leen
 * el flete de acá, alcanza con arreglarlo en este lugar.
 *
 * `lineas_venta` lo calcula `prorratear_flete.py`; el `coalesce(..., 1)` cubre
 * el rato hasta la primera corrida que llena la columna.
 */
function cteLineas(w: Where) {
  return `with lineas as (
    select fvf.clave_fila,
           (fvf.flete_prorrateado / coalesce(fvf.lineas_venta, 1))::float8 as flete_prorrateado,
           fvf.tiene_flete_real,
           fv.proveedor, fv.cliente, fv.comprobante, fv.nro_orden, fv.fecha,
           fv.precio_neto, fv.cantidad, fv.margen_total, fv.empresa,
           rl.provincia,
           -- Lo del ENVIO. El cliente y la fecha van aliasados porque los de la
           -- venta ya ocupan esos nombres, y no son lo mismo: la fecha del
           -- envío es la del despacho, no la de la factura.
           rl.preparacion_id, rl.transporte, rl.localidad, rl.cliente_codigo,
           rl.cliente as cliente_envio, rl.fecha as fecha_envio
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
  return {
    cantidadEnvios: Number(fila?.envios ?? 0),
    kgTotales: fila?.kg ?? 0,
  };
}

// --- Gráficos ----------------------------------------------------------------

function porProveedor(
  expr: string,
  orden = "valor desc nulls last",
  limite = 12,
) {
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

/**
 * Tabla "Envíos": una fila por PREPARACION, con el reparto del flete adentro.
 *
 * ---------------------------------------------------------------------------
 * POR QUE POR PREPARACION Y NO POR COMPROBANTE
 *
 * El flete se PAGA por envío y se COBRA por comprobante. Esta tabla iba por
 * comprobante, que es el grano equivocado para mirar un costo: un envío
 * partido en cinco facturas se veía como cinco fletes sueltos, y lo que
 * realmente salió ese envío no estaba en ningún lado. Peor todavía, un mismo
 * envío puede llevar facturas de Quo y de Noa a la vez (ver `empresas`), así
 * que ni sumando a ojo se llegaba al número.
 *
 * Ahora la fila es el envío y el reparto entre comprobantes es su detalle.
 *
 * ---------------------------------------------------------------------------
 * EL REPARTO CIERRA, Y ESO ESTA MEDIDO
 *
 * La suma de lo prorrateado a los renglones de un envío da exactamente lo que
 * facturó el transportista (bronze.fletes.neto_cobrado_transporte): de 453
 * envíos con flete real, ninguno se aparta más de nueve centavos, que es
 * redondeo. Por eso el detalle puede mostrar porcentajes del total del envío
 * sin aclarar nada: suman 100.
 *
 * ---------------------------------------------------------------------------
 * LOS KG Y LOS BULTOS VAN APARTE
 *
 * Viven a nivel ENVIO en reporte_logistica, así que sumarlos sobre las líneas
 * los multiplicaría por la cantidad de renglones. Y una preparación puede
 * tener DOS filas ahí --una por empresa, con el sufijo -Quo / -Noa en
 * `clave_fila`-- así que se suman esas dos y no se toma una.
 */
async function getTablaEnvios(f: FiltrosLogistica): Promise<FilaEnvio[]> {
  const w = whereBase(f);
  return query<FilaEnvio>(
    `${cteLineas(w)},
     por_envio as (
       select preparacion_id,
              min(fecha_envio)                                   as fecha,
              max(cliente_envio)                                 as cliente,
              max(cliente_codigo)                                as cliente_codigo,
              max(provincia)                                     as provincia,
              max(localidad)                                     as localidad,
              max(transporte)                                    as transporte,
              coalesce(sum(flete_prorrateado), 0)::float8        as flete,
              coalesce(sum(precio_neto * cantidad), 0)::float8   as facturacion,
              count(*) filter (where tiene_flete_real)           as lineas_reales,
              count(*)                                           as lineas_totales,
              array_remove(array_agg(distinct empresa), null)    as empresas
       from lineas
       group by preparacion_id
     ),
     por_comprobante as (
       select preparacion_id,
              comprobante,
              max(empresa)                                       as empresa,
              max(nro_orden::text)                               as nro_orden,
              coalesce(sum(flete_prorrateado), 0)::float8        as flete,
              coalesce(sum(precio_neto * cantidad), 0)::float8   as facturacion,
              count(*) filter (where tiene_flete_real)           as lineas_reales,
              count(*)                                           as lineas_totales
       from lineas
       where comprobante is not null
       group by preparacion_id, comprobante
     ),
     bultos as (
       select rl.preparacion_id,
              sum(rl.kg)::float8      as kg,
              sum(rl.bultos)::float8  as bultos
       from gold.reporte_logistica rl
       where rl.preparacion_id in (select preparacion_id from por_envio)
       group by rl.preparacion_id
     )
     select e.preparacion_id::text                      as "preparacionId",
            to_char(e.fecha, 'YYYY-MM-DD')              as fecha,
            e.cliente,
            -- El documento sale del maestro por código. Queda null para los
            -- clientes que no están cargados ahí (24 de 236 códigos), que es
            -- mejor que inventar uno.
            nullif(trim(c."numeroDocumento"), '')       as documento,
            e.provincia, e.localidad, e.transporte,
            e.empresas,
            b.kg, b.bultos,
            e.facturacion,
            e.flete,
            case when e.facturacion = 0 then null
                 else e.flete / e.facturacion
            end::float8                                 as "pctFlete",
            e.lineas_reales                             as "lineasReales",
            e.lineas_totales                            as "lineasTotales",
            coalesce(
              (select jsonb_agg(jsonb_build_object(
                        'comprobante',   k.comprobante,
                        'nroOrden',      k.nro_orden,
                        'empresa',       k.empresa,
                        'facturacion',   k.facturacion,
                        'flete',         k.flete,
                        'pctFlete',      case when k.facturacion = 0 then null
                                              else k.flete / k.facturacion end,
                        'lineasReales',  k.lineas_reales,
                        'lineasTotales', k.lineas_totales)
                      order by k.flete desc nulls last, k.comprobante)
                 from por_comprobante k
                where k.preparacion_id = e.preparacion_id),
              '[]'::jsonb)                              as comprobantes
     from por_envio e
     left join bultos b on b.preparacion_id = e.preparacion_id
     left join bronze.sigma_clientes c on trim(c.id) = trim(e.cliente_codigo)
     order by e.flete desc nulls last
     limit 100`,
    w.params,
  );
}

/**
 * LOS ARTICULOS DE UN ENVIO, o de uno de sus comprobantes.
 *
 * ---------------------------------------------------------------------------
 * POR QUE EXISTE
 *
 * La tabla de envíos contesta CUANTO costó el flete y cómo se repartió. Esto
 * contesta la siguiente pregunta, que es la que importa: por qué ese
 * comprobante dejó tan poco.
 *
 * Y la respuesta casi nunca es "en general": está en dos o tres renglones. En
 * el envío 12750394 conviven una pala de pie con margen de +$7.445 y $34.936
 * de flete --el flete se la comió-- y un perfume con margen de -$4.863 y $121
 * de flete --se vendió por debajo del costo--. Los dos terminan en rojo y se
 * arreglan de maneras opuestas. Ver `porQueElMargen` en lib/logistica.ts.
 *
 * ---------------------------------------------------------------------------
 * NO LLEVA LOS FILTROS DE LA PAGINA, Y ES A PROPOSITO
 *
 * Se pide por preparación y comprobante, que ya identifican un conjunto
 * cerrado. Si además se le aplicara el filtro de proveedor de arriba, alguien
 * abriría un comprobante para ver por qué da mal y le faltarían renglones --
 * justo los que explican el número. Un desglose que no desglosa todo no sirve.
 *
 * ---------------------------------------------------------------------------
 * SE TRAE A DEMANDA
 *
 * Un envío puede tener 236 renglones y la tabla muestra 100 envíos: mandarlo
 * todo siempre serían decenas de miles de filas para las tres que alguien va a
 * abrir. Se pide al abrir y no se cachea con el resto de la página.
 */
export async function getArticulosDelEnvio(
  preparacionId: number,
  comprobante: string | null,
): Promise<FilaArticuloEnvio[]> {
  const params: unknown[] = [preparacionId];
  let filtroComprobante = "";
  if (comprobante) {
    params.push(comprobante);
    filtroComprobante = `and fv.comprobante = $${params.length}`;
  }

  return query<FilaArticuloEnvio>(
    `with renglones as (
       select fv.sku, fv.producto, fv.marca, fv.proveedor, fv.comprobante,
              fv.cantidad,
              fv.precio_neto, fv.costo_unitario, fv.margen_total,
              fvf.tiene_flete_real,
              -- La misma división que el resto de la página: el join a
              -- fact_ventas repite la fila de flete cuando una línea se
              -- facturó en dos comprobantes. Ver cteLineas.
              (fvf.flete_prorrateado / coalesce(fvf.lineas_venta, 1)) as flete
       from gold.fact_ventas_flete fvf
       join gold.fact_ventas fv
         on fv.nro_orden::text = fvf.nro_orden and fv.sku = fvf.sku
       join gold.reporte_logistica rl on rl.clave_fila = fvf.clave_fila
       where rl.preparacion_id = $1
         ${filtroComprobante}
     )
     select sku, producto, marca, proveedor, comprobante,
            coalesce(cantidad, 0)::float8                          as cantidad,
            coalesce(precio_neto, 0)::float8                       as "precioNeto",
            coalesce(costo_unitario, 0)::float8                    as "costoUnitario",
            coalesce(precio_neto * cantidad, 0)::float8            as facturacion,
            coalesce(margen_total, 0)::float8                      as margen,
            coalesce(flete, 0)::float8                             as flete,
            coalesce(margen_total - flete, 0)::float8              as "margenReal",
            case when coalesce(precio_neto * cantidad, 0) = 0 then null
                 else (margen_total - flete) / (precio_neto * cantidad)
            end::float8                                            as "pctMargenReal",
            coalesce(tiene_flete_real, false)                      as "fleteReal"
     from renglones
     -- PEOR PRIMERO: lo que hay que mirar está arriba. Ordenar por SKU
     -- obligaría a recorrer 236 renglones para encontrar los tres que
     -- explican el número.
     order by (margen_total - flete) asc nulls last
     limit 500`,
    params,
  );
}

// --- Opciones de los selectores ----------------------------------------------

async function getOpcionesLogisticaDirecto(): Promise<OpcionesLogistica> {
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
  const [vendedores, empresas, meses, provincias, transportes] =
    await Promise.all([
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

async function getDashboardLogisticaDirecto(
  f: FiltrosLogistica,
): Promise<DashboardLogistica> {
  const [totales, envios, graficos, tablaEnvios] = await Promise.all([
    getTotales(f),
    getEnvios(f),
    getGraficos(f),
    getTablaEnvios(f),
  ]);

  // EL MARGEN AJUSTADO DESCUENTA TODO EL FLETE, SIEMPRE.
  //
  // Antes esto dependía del selector "Flete a descontar del margen", que venía
  // por defecto en "sin": o sea que la tarjeta decía "% Rentabilidad Ajustada"
  // y no ajustaba nada salvo que alguien tocara el desplegable. Sacado el
  // selector, queda la única definición que hace honor al nombre, y además es
  // la misma que usa Ventas Mayoristas: margen menos flete real menos flete
  // estimado.
  const margenAjustado =
    totales.margen - totales.fleteRealFiltrado - totales.fleteEstimadoFiltrado;

  return {
    kpis: {
      ...envios,
      fleteTotal: totales.fleteTotal,
      fleteRealFiltrado: totales.fleteRealFiltrado,
      fleteEstimadoFiltrado: totales.fleteEstimadoFiltrado,
      facturacionNeta: totales.facturacionNeta,
      pctLineasFleteReal:
        totales.lineas > 0 ? totales.lineasReales / totales.lineas : null,
      pctFleteSobreFacturacion:
        totales.facturacionNeta > 0
          ? totales.fleteTotal / totales.facturacionNeta
          : null,
      costoPorKg:
        envios.kgTotales > 0 ? totales.fleteTotal / envios.kgTotales : null,
      margenAjustado,
      rentabilidadAjustadaPct:
        totales.facturacionNeta > 0
          ? margenAjustado / totales.facturacionNeta
          : null,
    },
    unidadesPorProveedor: graficos.unidades,
    margenPorProveedor: graficos.margen,
    fletePorProveedor: graficos.flete,
    totalesProveedor: graficos.totales,
    pctFletePorProvincia: graficos.provincias,
    envios: tablaEnvios,
    generadoEn: new Date().toISOString(),
  };
}


/* ---------------------------------------------------------------------------
   LAS ENTRADAS QUE CONSUME LA RUTA, CACHEADAS.

   Se envuelven acá al final y no en la ruta para que cualquier consumidor
   futuro herede el caché sin acordarse de pedirlo. La version sin cachear
   queda como `...Directo` por si alguna vez hace falta saltearlo.

   Ver lib/cache.ts para por que esto es seguro (y cuando dejaria de serlo).
   --------------------------------------------------------------------------- */
export const getOpcionesLogistica = cacheado(
  "logistica:opciones",
  getOpcionesLogisticaDirecto,
);
export const getDashboardLogistica = cacheado(
  "logistica:dashboard",
  getDashboardLogisticaDirecto,
);
