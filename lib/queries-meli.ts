import { query, queryOne } from "@/lib/db";
import { agregarFiltro, vacio } from "@/lib/filtros";
import {
  CANAL_MELI,
  CARGA_IMPOSITIVA,
  IMPUESTOS,
  UMBRAL_BAJO,
  UMBRAL_MUY_BAJO,
  accionSugerida,
  nivelDeMargen,
} from "@/lib/meli";
import { mesComercialActual } from "@/lib/constantes";
import type {
  ArticuloMeli,
  DashboardAlertasMeli,
  DashboardMeli,
  FilaAlertaMeli,
  FiltrosMeli,
  KpisMeli,
  OpcionesMeli,
  PuntoDiaMeli,
  RankingMeli,
  ResumenAlerta,
} from "@/lib/types";

/**
 * Consultas de "Venta minorista — Mercado Libre".
 *
 * Fuente única: `gold.fact_ventas` filtrada por `canal = 'Mercado Libre'`. NO se
 * lee la planilla de Google: de ahí se copió la fórmula (ver lib/meli.ts), no el
 * dato.
 *
 * Todo lo que sigue recalcula la rentabilidad en vez de usar `margen_total`,
 * porque esa columna resta la comisión una sola vez y en las líneas de más de
 * una unidad queda corta. La fórmula, en SQL:
 *
 *     venta s/IVA  = precio_neto    * cantidad
 *     costo        = costo_unitario * cantidad
 *     comisión     = comision       * cantidad   <- `comision` es POR UNIDAD
 *     envío        = envio                       <- `envio` ya es POR LÍNEA
 *     rentabilidad = venta s/IVA - costo - comisión - envío
 */

// Se repiten en varias consultas; que vivan en un solo lugar evita que una
// multiplique por cantidad y otra no.
const VENTA_CIVA = "coalesce(total_linea, 0)";
const VENTA_SIVA = "coalesce(precio_neto, 0) * cantidad";
const COSTO = "coalesce(costo_unitario, 0) * cantidad";
const COMISION = "coalesce(comision, 0) * cantidad";
const ENVIO = "coalesce(envio, 0)";
const RENTABILIDAD = `(${VENTA_SIVA}) - (${COSTO}) - (${COMISION}) - (${ENVIO})`;

type Where = { sql: string; params: unknown[] };

const OPCIONALES: [keyof FiltrosMeli, string][] = [
  ["mes", "mes_comercial"],
  ["proveedor", "proveedor"],
  ["marca", "marca"],
  ["sku", "sku"],
];

/**
 * `omitir` desactiva un filtro para una consulta puntual: el ranking de
 * proveedores tiene que seguir mostrándolos a todos aunque haya uno
 * seleccionado, si no queda con una sola barra.
 */
function whereBase(f: FiltrosMeli, omitir: (keyof FiltrosMeli)[] = []): Where {
  const params: unknown[] = [CANAL_MELI];
  const clauses = ["canal = $1"];

  for (const [clave, columna] of OPCIONALES) {
    if (!omitir.includes(clave)) agregarFiltro(clauses, params, columna, f[clave]);
  }

  return { sql: clauses.join("\n     and "), params };
}

/** Fracción, o null cuando el denominador es 0 (que no es lo mismo que 0 %). */
function pct(numerador: number, denominador: number): number | null {
  return denominador === 0 ? null : numerador / denominador;
}

const num = (v: unknown): number => Number(v ?? 0);

// --- KPIs --------------------------------------------------------------------

async function getKpis(f: FiltrosMeli): Promise<KpisMeli> {
  const w = whereBase(f);

  const fila = await queryOne<Record<string, string>>(
    `select coalesce(sum(${VENTA_CIVA}), 0)  as venta_civa,
            coalesce(sum(${VENTA_SIVA}), 0)  as venta_siva,
            coalesce(sum(cantidad), 0)       as unidades,
            count(distinct nro_orden)        as ordenes,
            count(*)                         as lineas,
            coalesce(sum(${COSTO}), 0)       as costo,
            coalesce(sum(${COMISION}), 0)    as comision,
            coalesce(sum(${ENVIO}), 0)       as envio
     from gold.fact_ventas
     where ${w.sql}`,
    w.params,
  );

  const ventaCiva = num(fila?.venta_civa);
  const ventaSiva = num(fila?.venta_siva);
  const costo = num(fila?.costo);
  const comision = num(fila?.comision);
  const envio = num(fila?.envio);
  const ordenes = num(fila?.ordenes);

  const rentabilidad = ventaSiva - costo - comision - envio;
  const impuestos = ventaSiva * CARGA_IMPOSITIVA;

  return {
    ventaCiva,
    ventaSiva,
    unidades: num(fila?.unidades),
    ordenes,
    lineas: num(fila?.lineas),
    costo,
    comision,
    envio,
    rentabilidad,
    // Denominador c/IVA en TODA la sección (ver DENOMINADOR en lib/meli.ts).
    margenPct: pct(rentabilidad, ventaCiva),
    impuestos,
    rentabilidadNeta: rentabilidad - impuestos,
    // Denominador c/IVA, igual que el margen bruto: las dos tarjetas se leen
    // una al lado de la otra y con bases distintas la resta no cerraría.
    margenNetoPct: pct(rentabilidad - impuestos, ventaCiva),
    // Sobre c/IVA igual que todo lo demás, y además es la base real: Mercado
    // Libre cobra su comisión como un % del precio de publicación, que lleva el
    // IVA adentro. Sobre c/IVA da ~13 %, que es la tarifa que ML publica; sobre
    // s/IVA daría ~16 %, un número que no existe en ningún lado.
    pctComision: pct(comision, ventaCiva),
    ticketPromedio: pct(ventaCiva, ordenes),
  };
}

// --- Series y rankings -------------------------------------------------------

async function getPorDia(f: FiltrosMeli): Promise<PuntoDiaMeli[]> {
  const w = whereBase(f);

  const filas = await query<Record<string, string>>(
    `select to_char(fecha, 'YYYY-MM-DD')      as fecha,
            coalesce(sum(${VENTA_CIVA}), 0)   as venta,
            coalesce(sum(${RENTABILIDAD}), 0) as rentabilidad
     from gold.fact_ventas
     where ${w.sql} and fecha is not null
     group by 1
     order by 1`,
    w.params,
  );

  return filas.map((r) => ({
    fecha: r.fecha,
    venta: num(r.venta),
    rentabilidad: num(r.rentabilidad),
  }));
}

/**
 * Ranking por una dimensión. Se omite el filtro de esa misma dimensión para que
 * al clickear un proveedor el gráfico no se quede con una sola barra.
 */
async function getRanking(
  f: FiltrosMeli,
  clave: "proveedor" | "marca",
  limite: number,
): Promise<RankingMeli[]> {
  const w = whereBase(f, [clave]);

  const filas = await query<Record<string, string>>(
    `select coalesce(${clave}, 'Sin dato')    as label,
            coalesce(sum(${VENTA_CIVA}), 0)   as venta,
            coalesce(sum(cantidad), 0)        as unidades,
            coalesce(sum(${RENTABILIDAD}), 0) as rentabilidad
     from gold.fact_ventas
     where ${w.sql}
     group by 1
     order by venta desc
     limit ${limite}`,
    w.params,
  );

  return filas.map((r) => {
    const venta = num(r.venta);
    const rentabilidad = num(r.rentabilidad);
    return {
      label: r.label,
      venta,
      unidades: num(r.unidades),
      rentabilidad,
      margenPct: pct(rentabilidad, venta),
    };
  });
}

/** Denominador de la torta: sin el filtro de proveedor, para que sume 100 %. */
async function getVentaTotalProveedores(f: FiltrosMeli): Promise<number> {
  const w = whereBase(f, ["proveedor"]);
  const fila = await queryOne<Record<string, string>>(
    `select coalesce(sum(${VENTA_CIVA}), 0) as total from gold.fact_ventas where ${w.sql}`,
    w.params,
  );
  return num(fila?.total);
}

async function getArticulos(f: FiltrosMeli): Promise<ArticuloMeli[]> {
  const w = whereBase(f);

  const filas = await query<Record<string, string>>(
    `select sku,
            max(producto)                     as producto,
            max(proveedor)                    as proveedor,
            max(marca)                        as marca,
            coalesce(sum(cantidad), 0)        as unidades,
            coalesce(sum(${VENTA_CIVA}), 0)   as venta_civa,
            coalesce(sum(${VENTA_SIVA}), 0)   as venta_siva,
            coalesce(sum(${COSTO}), 0)        as costo,
            coalesce(sum(${COMISION}), 0)     as comision,
            coalesce(sum(${ENVIO}), 0)        as envio,
            coalesce(sum(${RENTABILIDAD}), 0) as rentabilidad
     from gold.fact_ventas
     where ${w.sql}
     group by sku
     order by venta_civa desc
     limit 300`,
    w.params,
  );

  return filas.map((r) => {
    const ventaCiva = num(r.venta_civa);
    const rentabilidad = num(r.rentabilidad);
    return {
      sku: r.sku,
      producto: r.producto,
      proveedor: r.proveedor,
      marca: r.marca,
      unidades: num(r.unidades),
      ventaCiva,
      ventaSiva: num(r.venta_siva),
      costo: num(r.costo),
      comision: num(r.comision),
      envio: num(r.envio),
      rentabilidad,
      margenPct: pct(rentabilidad, ventaCiva),
    };
  });
}

/**
 * Último día con ventas cargadas. Va a la vista porque el dato de Mercado Libre
 * no siempre llega hasta hoy, y un tablero que muestra "el mes" sin decir hasta
 * cuándo llegó se lee como una caída de ventas que no existe.
 */
async function getUltimaVenta(): Promise<string | null> {
  const fila = await queryOne<{ fecha: string | null }>(
    `select to_char(max(fecha), 'YYYY-MM-DD') as fecha
     from gold.fact_ventas where canal = $1`,
    [CANAL_MELI],
  );
  return fila?.fecha ?? null;
}

// --- Opciones de los filtros -------------------------------------------------

export async function getOpcionesMeli(): Promise<OpcionesMeli> {
  const [meses, proveedores, marcas] = await Promise.all([
    query<{ v: string }>(
      `select distinct mes_comercial as v from gold.fact_ventas
       where canal = $1 and mes_comercial is not null order by 1 desc`,
      [CANAL_MELI],
    ),
    query<{ v: string }>(
      `select distinct proveedor as v from gold.fact_ventas
       where canal = $1 and proveedor is not null order by 1`,
      [CANAL_MELI],
    ),
    query<{ v: string }>(
      `select distinct marca as v from gold.fact_ventas
       where canal = $1 and marca is not null order by 1`,
      [CANAL_MELI],
    ),
  ]);

  return {
    meses: meses.map((r) => r.v),
    proveedores: proveedores.map((r) => r.v),
    marcas: marcas.map((r) => r.v),
  };
}

/**
 * Mes con el que abre la sección, resuelto en el servidor.
 *
 * No alcanza con `mesComercialActual()`: el dato de Mercado Libre puede venir
 * atrasado, y abrir en un mes sin ninguna venta se ve igual que un tablero roto.
 * Por eso se toma el mes vigente solo si tiene datos; si no, el último que tenga.
 */
export async function getMesInicialMeli(): Promise<string> {
  const vigente = mesComercialActual();
  try {
    const fila = await queryOne<{ v: string }>(
      `select mes_comercial as v
       from gold.fact_ventas
       where canal = $1 and mes_comercial is not null
       group by mes_comercial
       order by (mes_comercial = $2) desc, mes_comercial desc
       limit 1`,
      [CANAL_MELI, vigente],
    );
    return fila?.v ?? vigente;
  } catch {
    return vigente;
  }
}

// --- Dashboard "Tablero" -----------------------------------------------------

export async function getDashboardMeli(f: FiltrosMeli): Promise<DashboardMeli> {
  const [kpis, porDia, porProveedor, porMarca, articulos, ventaTotalProveedores, ultimaVenta] =
    await Promise.all([
      getKpis(f),
      getPorDia(f),
      getRanking(f, "proveedor", 12),
      getRanking(f, "marca", 12),
      getArticulos(f),
      getVentaTotalProveedores(f),
      getUltimaVenta(),
    ]);

  return {
    kpis,
    porDia,
    porProveedor,
    porMarca,
    articulos,
    ventaTotalProveedores,
    ultimaVenta,
    generadoEn: new Date().toISOString(),
  };
}

// --- Dashboard "Alertas" -----------------------------------------------------

/**
 * Tope de filas que baja al navegador. La pestaña de la planilla es una lista
 * para revisar a mano, no un export: sin tope, un mes entero son miles de líneas
 * y la página se cuelga sin que eso ayude a nadie.
 */
const TOPE_ALERTAS = 500;

/**
 * El margen NETO de la línea, en SQL. Es el que clasifica la alerta, y por eso
 * se calcula acá y no en el cliente: si filtrás por "muy bajo", el recorte tiene
 * que pasar dentro de la consulta o el tope de filas devolvería cualquier cosa.
 *
 * Denominador venta C/IVA, igual que el resto de la sección. Los impuestos en
 * cambio se calculan sobre la venta S/IVA, que es como se liquidan: son dos
 * cosas distintas y por eso conviven las dos en la misma fórmula.
 */
const MARGEN_NETO = `case when (${VENTA_CIVA}) = 0 then null
       else ((${RENTABILIDAD}) - (${VENTA_SIVA}) * ${CARGA_IMPOSITIVA}) / (${VENTA_CIVA}) end`;

/** Nivel de alerta en SQL, con los mismos cortes que `nivelDeMargen`. */
const NIVEL = `case
       when (${MARGEN_NETO}) is null or (${MARGEN_NETO}) < ${UMBRAL_MUY_BAJO} then 'muy-bajo'
       when (${MARGEN_NETO}) < ${UMBRAL_BAJO} then 'bajo'
       else 'ok' end`;

function whereAlertas(f: FiltrosMeli): Where {
  const w = whereBase(f);
  if (!vacio(f.alerta)) {
    w.params.push(f.alerta);
    w.sql += `\n     and (${NIVEL}) = any($${w.params.length}::text[])`;
  }
  return w;
}

async function getResumenAlertas(f: FiltrosMeli): Promise<ResumenAlerta[]> {
  // El resumen ignora el filtro de nivel a propósito: es el que deja elegir el
  // nivel, así que si se filtrara a sí mismo quedaría una sola barra.
  const w = whereBase(f);

  const filas = await query<Record<string, string>>(
    `select (${NIVEL})                       as nivel,
            count(*)                         as lineas,
            coalesce(sum(${VENTA_SIVA}), 0)  as venta_siva,
            coalesce(sum((${RENTABILIDAD}) - (${VENTA_SIVA}) * ${CARGA_IMPOSITIVA}), 0) as rent_neta
     from gold.fact_ventas
     where ${w.sql}
     group by 1`,
    w.params,
  );

  return filas.map((r) => ({
    nivel: r.nivel,
    lineas: num(r.lineas),
    ventaSiva: num(r.venta_siva),
    rentabilidadNeta: num(r.rent_neta),
  }));
}

async function getFilasAlertas(f: FiltrosMeli): Promise<FilaAlertaMeli[]> {
  const w = whereAlertas(f);

  const filas = await query<Record<string, string | null>>(
    `select to_char(fecha, 'YYYY-MM-DD')     as fecha,
            nro_orden::bigint::text          as nro_orden,
            sku, producto, proveedor, marca,
            cantidad,
            ${VENTA_CIVA}                    as venta_civa,
            ${VENTA_SIVA}                    as venta_siva,
            costo_unitario,
            ${COSTO}                         as costo,
            ${COMISION}                      as comision,
            ${ENVIO}                         as envio,
            ${RENTABILIDAD}                  as rentabilidad
     from gold.fact_ventas
     where ${w.sql}
     order by (${MARGEN_NETO}) asc nulls first, ${VENTA_SIVA} desc
     limit ${TOPE_ALERTAS}`,
    w.params,
  );

  return filas.map((r) => {
    const ventaCiva = num(r.venta_civa);
    const ventaSiva = num(r.venta_siva);
    const rentabilidad = num(r.rentabilidad);

    // Los tres impuestos se calculan acá y no en SQL para que la página muestre
    // exactamente los mismos números que suman en la fila: si uno se redondeara
    // en la base y otro no, la resta no cerraría a la vista.
    const iibb = ventaSiva * IMPUESTOS.iibb;
    const cheque = ventaSiva * IMPUESTOS.cheque;
    const municipal = ventaSiva * IMPUESTOS.municipal;
    const rentabilidadNeta = rentabilidad - iibb - cheque - municipal;
    // Los dos porcentajes sobre venta c/IVA. Los impuestos de arriba SÍ se
    // calculan sobre la venta s/IVA: esa es su base real de liquidación.
    const margenNetoPct = pct(rentabilidadNeta, ventaCiva);
    const nivel = nivelDeMargen(margenNetoPct);

    return {
      nivel,
      fecha: r.fecha,
      nroOrden: r.nro_orden,
      sku: r.sku,
      producto: r.producto,
      proveedor: r.proveedor,
      marca: r.marca,
      cantidad: num(r.cantidad),
      ventaCiva,
      ventaSiva,
      costoUnitario: r.costo_unitario == null ? null : num(r.costo_unitario),
      costo: num(r.costo),
      comision: num(r.comision),
      envio: num(r.envio),
      rentabilidad,
      margenPct: pct(rentabilidad, ventaCiva),
      iibb,
      cheque,
      municipal,
      rentabilidadNeta,
      margenNetoPct,
      accion: accionSugerida(rentabilidadNeta, nivel),
    };
  });
}

export async function getDashboardAlertasMeli(f: FiltrosMeli): Promise<DashboardAlertasMeli> {
  const [resumen, filas] = await Promise.all([getResumenAlertas(f), getFilasAlertas(f)]);

  const lineasTotales = resumen.reduce((a, r) => a + r.lineas, 0);

  return {
    resumen,
    lineasTotales,
    filas,
    recortada: filas.length === TOPE_ALERTAS,
    generadoEn: new Date().toISOString(),
  };
}
