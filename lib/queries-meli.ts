import { query, queryOne } from "@/lib/db";
import { agregarFiltro, vacio } from "@/lib/filtros";
import { hoyArgentina } from "@/lib/rangos";
import {
  CANAL_MELI,
  CARGA_IMPOSITIVA,
  IMPUESTOS,
  UMBRAL_BAJO,
  UMBRAL_MUY_BAJO,
  accionSugerida,
  nivelDeMargen,
} from "@/lib/meli";
import type {
  ArticuloMeli,
  CancelacionesMeli,
  DashboardAlertasMeli,
  DashboardMeli,
  FilaAlertaMeli,
  FiltrosMeli,
  KpisMeli,
  OpcionesMeli,
  PuntoDiaMeli,
  PuntoHora,
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

// Las mismas expresiones calificadas con el alias de la tabla, para las
// consultas que hacen join contra bronze.ml_ventas y donde una columna suelta
// seria ambigua. Se derivan de las de arriba en vez de escribirse dos veces:
// una copia a mano es una copia que algun dia se va a desincronizar.
const conAlias = (expr: string) =>
  expr.replace(/\b(total_linea|precio_neto|cantidad|costo_unitario|comision|envio)\b/g, "fv.$1");
const VENTA_CIVA_P = conAlias(VENTA_CIVA);
const VENTA_SIVA_P = conAlias(VENTA_SIVA);
const COSTO_P = conAlias(COSTO);
const COMISION_P = conAlias(COMISION);
const ENVIO_P = conAlias(ENVIO);

type Where = { sql: string; params: unknown[] };

const OPCIONALES: [keyof FiltrosMeli, string][] = [
  ["proveedor", "proveedor"],
  ["marca", "marca"],
  ["sku", "sku"],
];

/**
 * `omitir` desactiva un filtro para una consulta puntual: el ranking de
 * proveedores tiene que seguir mostrándolos a todos aunque haya uno
 * seleccionado, si no queda con una sola barra.
 */
/**
 * `prefijo` califica las columnas cuando la consulta tiene join y "fecha" sola
 * sería ambigua. Se pasa como parámetro en vez de parchear el SQL después,
 * porque un reemplazo de texto sobre el where terminaría tocando también los
 * valores de los parámetros.
 */
function whereBase(
  f: FiltrosMeli,
  omitir: (keyof FiltrosMeli)[] = [],
  prefijo = "",
): Where {
  const col = (c: string) => `${prefijo}${c}`;
  const params: unknown[] = [CANAL_MELI];
  const clauses = [`${col("canal")} = $1`];

  // El rango va con `::date` explícito: `fecha` es un date y sin el casteo
  // Postgres compara contra texto.
  if (f.desde) {
    params.push(f.desde);
    clauses.push(`${col("fecha")} >= $${params.length}::date`);
  }
  if (f.hasta) {
    params.push(f.hasta);
    clauses.push(`${col("fecha")} <= $${params.length}::date`);
  }

  for (const [clave, columna] of OPCIONALES) {
    if (!omitir.includes(clave)) {
      agregarFiltro(clauses, params, col(columna), f[clave] as string[] | undefined);
    }
  }

  // FILTRO POR HORA DEL DÍA.
  //
  // La hora no está en `gold.fact_ventas` —ahí `fecha` es un `date` pelado—,
  // así que sale de `bronze.ml_ventas`. Va como subconsulta `in (...)` y NO
  // como join: un join habría que agregarlo en las ocho consultas de esta
  // página y calificar cada columna, mientras que esto es una línea más en el
  // `where` y funciona en todas por igual.
  //
  // Postgres arma el hash de la subconsulta UNA vez y después prueba contra
  // él, así que no es una consulta por fila.
  //
  // El `at time zone` no es opcional: ML manda el offset -04:00, que no es el
  // de Argentina. Sin convertir, filtrar "las 14" traería las ventas de las 13.
  if (!omitir.includes("hora") && !vacio(f.hora)) {
    params.push(f.hora);
    clauses.push(`${col("nro_orden")}::bigint in (
       select v.id::bigint from bronze.ml_ventas v
        where extract(hour from (v.date_created::timestamptz
                at time zone 'America/Argentina/Buenos_Aires'))::text
              = any($${params.length}::text[]))`);
  }

  return { sql: clauses.join("\n     and "), params };
}

// --- Rango y período anterior ------------------------------------------------

const DIA_MS = 86_400_000;

/** `YYYY-MM-DD` de un Date leído en UTC (los rangos no tienen hora). */
function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function aFecha(s: string): Date {
  return new Date(`${s}T00:00:00Z`);
}

/**
 * El mismo recorte corrido hacia atrás, pegado al de adelante: si mirás hoy, es
 * ayer; si mirás del 1 al 7, es del 25 al 31.
 *
 * Se usa la misma CANTIDAD de días y no "el mes anterior" ni "la semana
 * anterior" a propósito: comparar 5 días contra 7 haría que el período anterior
 * gane siempre, y la comparación no querría decir nada.
 */
export function periodoAnterior(desde: string, hasta: string): { desde: string; hasta: string } {
  const d = aFecha(desde);
  const h = aFecha(hasta);
  const dias = Math.round((h.getTime() - d.getTime()) / DIA_MS) + 1;
  const hastaAnt = new Date(d.getTime() - DIA_MS);
  const desdeAnt = new Date(hastaAnt.getTime() - (dias - 1) * DIA_MS);
  return { desde: iso(desdeAnt), hasta: iso(hastaAnt) };
}

export function diasDelRango(desde: string, hasta: string): number {
  return Math.round((aFecha(hasta).getTime() - aFecha(desde).getTime()) / DIA_MS) + 1;
}

/**
 * La hora de Argentina como `HH:MM:SS`.
 *
 * Con `timeZone` explicito, igual que `hoyArgentina`: Vercel corre en UTC, y
 * sin esto el corte quedaria tres horas adelantado -- a las 21 de Argentina
 * compararia contra las 24 del dia anterior, o sea el dia entero, que es
 * exactamente lo que este corte viene a evitar.
 */
function horaArgentina(ahora: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Argentina/Buenos_Aires",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(ahora);
}

/** Fracción, o null cuando el denominador es 0 (que no es lo mismo que 0 %). */
function pct(numerador: number, denominador: number): number | null {
  return denominador === 0 ? null : numerador / denominador;
}

const num = (v: unknown): number => Number(v ?? 0);

// --- KPIs --------------------------------------------------------------------

/**
 * KPIs del recorte. `corteHora` (`HH:MM:SS`) recorta el ULTIMO dia del rango a
 * esa hora, y solo se usa para el periodo anterior.
 *
 * POR QUE EXISTE
 * Comparar el dia de hoy a las 16 contra el dia de ayer ENTERO es comparar diez
 * horas de venta contra veinticuatro: el tablero mostraba una caida todos los
 * dias hasta la noche, y esa caida no existia. Con el corte, "ayer" se mide
 * hasta las 16 tambien.
 *
 * La hora no esta en `gold.fact_ventas` -- ahi `fecha` es un `date` pelado --,
 * asi que hay que cruzar contra `bronze.ml_ventas`, que guarda `date_created`
 * con hora y offset. El cruce por numero de orden da 100%.
 *
 * El `at time zone` no es opcional: ML manda el offset -04:00, que no es el de
 * Argentina. Sin convertir, el corte quedaria una hora corrido.
 *
 * Solo se recorta el ULTIMO dia. Los anteriores del rango entran completos, que
 * es lo correcto: si mirás los ultimos 7 dias, los 6 primeros del periodo de
 * comparacion pasaron enteros y el septimo es el que hay que cortar.
 */
async function getKpis(f: FiltrosMeli, corteHora?: string): Promise<KpisMeli> {
  const conCorte = corteHora != null && f.hasta != null;
  const w = whereBase(f, [], conCorte ? "fv." : "");

  let sql = w.sql;
  if (conCorte) {
    w.params.push(f.hasta, corteHora);
    const iHasta = w.params.length - 1;
    const iHora = w.params.length;
    sql += `
     and (fv.fecha < $${iHasta}::date
          or (v.date_created::timestamptz
              at time zone 'America/Argentina/Buenos_Aires')::time <= $${iHora}::time)`;
  }

  const desde = conCorte
    ? `gold.fact_ventas fv
       join bronze.ml_ventas v on v.id::bigint = fv.nro_orden::bigint`
    : "gold.fact_ventas";
  const col = conCorte ? "fv." : "";

  const fila = await queryOne<Record<string, string>>(
    `select coalesce(sum(${conCorte ? VENTA_CIVA_P : VENTA_CIVA}), 0)  as venta_civa,
            coalesce(sum(${conCorte ? VENTA_SIVA_P : VENTA_SIVA}), 0)  as venta_siva,
            coalesce(sum(${col}cantidad), 0)       as unidades,
            count(distinct ${col}nro_orden)        as ordenes,
            count(*)                               as lineas,
            coalesce(sum(${conCorte ? COSTO_P : COSTO}), 0)       as costo,
            coalesce(sum(${conCorte ? COMISION_P : COMISION}), 0) as comision,
            coalesce(sum(${conCorte ? ENVIO_P : ENVIO}), 0)       as envio
     from ${desde}
     where ${sql}`,
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

/** Fila de artículo -> objeto. La comparten el ranking por venta y el de rentabilidad. */
function aArticulo(r: Record<string, string>): ArticuloMeli {
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
}

/**
 * Ventas por hora del día, en hora ARGENTINA.
 *
 * La hora no está en `gold.fact_ventas`: ahí `fecha` es un `date` pelado. Sale
 * de cruzar contra `bronze.ml_ventas`, que guarda `date_created` con la hora y
 * el offset (`2026-08-19T09:54:37.000-04:00`). El cruce es por número de orden
 * y da 100%: las 37.881 líneas de Mercado Libre encuentran su orden.
 *
 * El `at time zone` no es opcional: ML manda el offset -04:00, que no es el de
 * Argentina. Sin convertir, el pico de ventas aparecería una hora antes de
 * cuando pasó. Verificado contra la planilla, que muestra la hora local.
 *
 * Se cuentan ÓRDENES y no líneas: una orden de tres productos es una compra a
 * esa hora, no tres.
 */
async function getPorHora(f: FiltrosMeli): Promise<Record<string, number>[]> {
  // Se omite el filtro de HORA a propósito, igual que en los rankings: si se
  // filtrara a sí mismo, al clickear una barra el gráfico quedaría con esa
  // sola y no habría forma de ver el resto ni de comparar.
  const w = whereBase(f, ["hora"], "fv.");

  return query<Record<string, number>>(
    `select extract(hour from (v.date_created::timestamptz
              at time zone 'America/Argentina/Buenos_Aires'))::int as hora,
            count(distinct fv.nro_orden)                           as ordenes,
            coalesce(sum(${VENTA_CIVA}), 0)                        as venta
     from gold.fact_ventas fv
     join bronze.ml_ventas v on v.id::bigint = fv.nro_orden::bigint
     where ${w.sql}
     group by 1
     order by 1`,
    w.params,
  );
}

/**
 * Los SKUs que más plata dejaron. Es una consulta aparte y no un `sort` de la
 * tabla de artículos porque esa trae el top 300 POR VENTA: un producto que se
 * vende poco pero deja mucho puede no estar ahí, y es justo el que interesa.
 */
async function getTopRentabilidad(f: FiltrosMeli): Promise<ArticuloMeli[]> {
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
     order by rentabilidad desc
     limit 12`,
    w.params,
  );

  return filas.map(aArticulo);
}

/**
 * Ranking por una dimensión. Se omite el filtro de esa misma dimensión para que
 * al clickear un proveedor el gráfico no se quede con una sola barra.
 */
async function getRanking(
  f: FiltrosMeli,
  clave: "proveedor",
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

  return filas.map(aArticulo);
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
  const [proveedores, marcas, bordes] = await Promise.all([
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
    queryOne<{ primera: string | null; ultima: string | null }>(
      `select to_char(min(fecha), 'YYYY-MM-DD') as primera,
              to_char(max(fecha), 'YYYY-MM-DD') as ultima
       from gold.fact_ventas where canal = $1`,
      [CANAL_MELI],
    ),
  ]);

  return {
    proveedores: proveedores.map((r) => r.v),
    marcas: marcas.map((r) => r.v),
    primeraVenta: bordes?.primera ?? null,
    ultimaVenta: bordes?.ultima ?? null,
  };
}

/**
 * El día con el que abre el tablero, resuelto en el SERVIDOR.
 *
 * Es "hoy", como el reporte de Data Studio. Pero "hoy" se calcula en hora
 * argentina y no en la del servidor: Vercel corre en UTC, así que entre las 21
 * y las 24 de Argentina un `new Date()` pelado ya estaría en el día siguiente y
 * el tablero abriría vacío justo en la franja de más venta.
 *
 * Y si hoy todavía no tiene ninguna venta cargada —el orquestador corre en una
 * computadora que puede estar apagada— se abre en el último día que sí tenga.
 * Un tablero en cero se lee como "no vendimos", no como "no hay dato".
 */
export async function getDiaInicialMeli(): Promise<string> {
  const hoy = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  try {
    const fila = await queryOne<{ v: string | null }>(
      `select to_char(max(fecha), 'YYYY-MM-DD') as v
       from gold.fact_ventas where canal = $1 and fecha <= $2::date`,
      [CANAL_MELI, hoy],
    );
    return fila?.v ?? hoy;
  } catch {
    return hoy;
  }
}


// --- Dashboard "Tablero" -----------------------------------------------------

/** Las 24 horas siempre presentes: una hora en cero es un dato, no un hueco. */
function completarHoras(filas: Record<string, number>[]): PuntoHora[] {
  const porHora = new Map(filas.map((r) => [Number(r.hora), r]));
  return Array.from({ length: 24 }, (_, hora) => {
    const r = porHora.get(hora);
    return { hora, ordenes: num(r?.ordenes), venta: num(r?.venta) };
  });
}

export async function getDashboardMeli(f: FiltrosMeli): Promise<DashboardMeli> {
  // El rango siempre está resuelto para cuando llega acá (lo fija la ruta de
  // API), pero el tipo lo permite vacío: sin este piso, `periodoAnterior` haría
  // cuentas con undefined y devolvería fechas inválidas.
  const desde = f.desde ?? f.hasta ?? "";
  const hasta = f.hasta ?? f.desde ?? "";
  const anterior = desde && hasta ? periodoAnterior(desde, hasta) : null;

  // Si el recorte llega hasta HOY, esta a medio pasar: son las 16 y todavia
  // faltan ocho horas de venta. Comparar eso contra un dia entero da una caida
  // que no existe, todos los dias hasta la noche. Se le pasa la hora actual al
  // periodo anterior para medirlo hasta el mismo punto.
  //
  // Cuando el recorte NO llega a hoy -- "el mes pasado", "la semana pasada" --
  // los dos periodos estan cerrados y no hay nada que recortar.
  const corteHora = hasta === hoyArgentina() ? horaArgentina() : undefined;

  const [
    kpis,
    porDia,
    horasCrudas,
    porProveedor,
    topRentabilidad,
    articulos,
    ventaTotalProveedores,
    ultimaVenta,
    cancelaciones,
    kpisAnterior,
  ] = await Promise.all([
    getKpis(f),
    getPorDia(f),
    getPorHora(f),
    getRanking(f, "proveedor", 12),
    getTopRentabilidad(f),
    getArticulos(f),
    getVentaTotalProveedores(f),
    getUltimaVenta(),
    getCancelacionesMeli(f),
    // El período anterior mantiene TODOS los otros filtros: comparar "esta
    // semana de ALGABO" contra "la semana pasada de todo" no diría nada.
    anterior ? getKpis({ ...f, ...anterior }, corteHora) : Promise.resolve(null),
  ]);

  return {
    kpis,
    rango: { desde, hasta, dias: desde && hasta ? diasDelRango(desde, hasta) : 0 },
    comparacion:
      anterior && kpisAnterior && kpisAnterior.lineas > 0
        ? {
            desde: anterior.desde,
            hasta: anterior.hasta,
            hastaHora: corteHora ?? null,
            ventaCiva: kpisAnterior.ventaCiva,
            unidades: kpisAnterior.unidades,
            ordenes: kpisAnterior.ordenes,
            rentabilidad: kpisAnterior.rentabilidad,
            margenPct: kpisAnterior.margenPct,
          }
        : null,
    porDia,
    porHora: completarHoras(horasCrudas),
    porProveedor,
    topRentabilidad,
    articulos,
    ventaTotalProveedores,
    ultimaVenta,
    cancelaciones,
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
            ${RENTABILIDAD}                  as rentabilidad,
            -- Si esa orden tuvo una devolucion PARCIAL. Se lee de bronze y
            -- no de gold porque fact_ventas no guarda el estado de la orden:
            -- guarda la venta. Asi el dato sale sin migrar nada ni esperar un
            -- modelo.py --todo para verlo en el historico.
            --
            -- Va como subconsulta y no como join: si una orden no estuviera
            -- en bronze, la linea tiene que seguir apareciendo en las alertas
            -- (sin marca) en vez de desaparecer de la tabla.
            -- EXISTS y no una subconsulta que devuelva el valor: bronze.ml_ventas
            -- puede tener la misma orden mas de una vez (paso: 790 filas de mas
            -- por un error de huso, ver limpiar_duplicados_ml_ventas.sql), y una
            -- subconsulta escalar revienta con "more than one row returned".
            -- EXISTS es inmune a eso, asi que la pantalla no depende de que la
            -- limpieza este hecha.
            --
            -- ::text para que la fila entera siga siendo de texto, como el resto:
            -- un solo booleano suelto obligaria a ensanchar el tipo de TODAS las
            -- columnas y a andar comprobando cual es cual.
            exists (select 1
                      from bronze.ml_ventas v
                     where v.id::bigint = fv.nro_orden::bigint
                       and v.status = 'partially_refunded')::text as parcial
     from gold.fact_ventas fv
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
      parcial: r.parcial === "true",
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

// --- Cancelaciones -----------------------------------------------------------

/**
 * Las órdenes CANCELADAS del recorte.
 *
 * No salen de `gold.fact_ventas` sino de `bronze.ml_ventas`, y eso es a
 * propósito: una cancelación no es una venta, así que no tiene que estar en la
 * tabla de ventas. Meterla ahí con una marquita obligaría a que cada consulta
 * del sistema se acuerde de excluirla, y el día que una se olvide el número
 * queda mal sin que nadie lo note.
 *
 * El precio es el de la orden (`unit_price`), no hay costo ni margen: la
 * pregunta acá no es cuánto se ganó sino QUÉ se cancela y cuánto pesa.
 *
 * `proveedor` y `marca` salen de cruzar contra `bronze.sigma_articulos`, que es
 * de donde los toma `modelo.py`. Un SKU que no está en el catálogo queda sin
 * proveedor en vez de quedar afuera: la cancelación existió igual.
 */
export async function getCancelacionesMeli(f: FiltrosMeli): Promise<CancelacionesMeli> {
  const params: unknown[] = [];
  const clauses: string[] = [];

  // El rango se compara sobre la fecha YA CONVERTIDA a hora argentina, igual
  // que en el resto de la sección: ML manda el offset -04:00 y sin convertir
  // las ventas de la noche caerían en el día equivocado.
  if (f.desde) {
    params.push(f.desde);
    clauses.push(`l.fecha >= $${params.length}::date`);
  }
  if (f.hasta) {
    params.push(f.hasta);
    clauses.push(`l.fecha <= $${params.length}::date`);
  }
  agregarFiltro(clauses, params, "l.sku", f.sku);
  agregarFiltro(clauses, params, 'a."proveedorNombre"', f.proveedor);
  agregarFiltro(clauses, params, 'a."attributes.marca"', f.marca);

  const where = clauses.length ? `where ${clauses.join("\n     and ")}` : "";

  const filas = await query<Record<string, string | null>>(
    `with lineas as (
       select v.id                                                     as nro_orden,
              (v.date_created::timestamptz
                 at time zone 'America/Argentina/Buenos_Aires')::date   as fecha,
              it->'item'->>'seller_sku'                                 as sku,
              it->'item'->>'title'                                      as producto,
              (it->>'quantity')::numeric                                as cantidad,
              (it->>'unit_price')::numeric * (it->>'quantity')::numeric as monto
       from bronze.ml_ventas v,
            lateral jsonb_array_elements(v.order_items::jsonb) as it
       where v.status = 'cancelled'
     )
     select l.sku,
            max(l.producto)             as producto,
            max(a."proveedorNombre")    as proveedor,
            max(a."attributes.marca")   as marca,
            count(distinct l.nro_orden) as ordenes,
            sum(l.cantidad)             as unidades,
            sum(l.monto)                as monto
     from lineas l
     left join bronze.sigma_articulos a on trim(a.id::text) = trim(l.sku)
     ${where}
     group by l.sku
     order by monto desc
     limit 100`,
    params,
  );

  const mapeadas = filas.map((r) => ({
    sku: r.sku,
    producto: r.producto,
    proveedor: r.proveedor,
    marca: r.marca,
    ordenes: num(r.ordenes),
    unidades: num(r.unidades),
    monto: num(r.monto),
  }));

  return {
    // Las órdenes NO se suman de las filas: una orden cancelada de tres
    // productos aparece en tres filas, y sumarlas la contaría tres veces.
    // Por eso el total viene de su propia consulta.
    ordenes: await contarOrdenesCanceladas(params, where),
    unidades: mapeadas.reduce((a, r) => a + r.unidades, 0),
    monto: mapeadas.reduce((a, r) => a + r.monto, 0),
    filas: mapeadas,
    recortada: mapeadas.length === 100,
  };
}

/** Órdenes canceladas distintas del recorte. Ver por qué en `getCancelacionesMeli`. */
async function contarOrdenesCanceladas(params: unknown[], where: string): Promise<number> {
  const fila = await queryOne<{ n: string }>(
    `with lineas as (
       select v.id                                                    as nro_orden,
              (v.date_created::timestamptz
                 at time zone 'America/Argentina/Buenos_Aires')::date  as fecha,
              it->'item'->>'seller_sku'                                as sku
       from bronze.ml_ventas v,
            lateral jsonb_array_elements(v.order_items::jsonb) as it
       where v.status = 'cancelled'
     )
     select count(distinct l.nro_orden) as n
     from lineas l
     left join bronze.sigma_articulos a on trim(a.id::text) = trim(l.sku)
     ${where}`,
    params,
  );
  return num(fila?.n);
}
