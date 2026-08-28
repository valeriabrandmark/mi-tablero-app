import { query, queryOne } from "@/lib/db";
import { agregarFiltro } from "@/lib/filtros";
import { CARGA_IMPOSITIVA } from "@/lib/impuestos";
import { hoyArgentina } from "@/lib/rangos";
import { CANAL_TIENDA_NUBE } from "@/lib/tiendanube";
import type {
  ArticuloTiendaNube,
  ClienteTiendaNube,
  DashboardTiendaNube,
  FiltrosTiendaNube,
  KpisTiendaNube,
  OpcionesTiendaNube,
  PedidoTiendaNube,
  PuntoDiaTiendaNube,
  RankingTiendaNube,
} from "@/lib/types";

/**
 * Consultas de "Venta minorista — Tienda Nube".
 *
 * Fuente única: `gold.fact_ventas` filtrada por `canal = 'Tienda Nube'`, que
 * arma `modelo.py`. A gold llega YA filtrado por el criterio de venta (pedido
 * pagado y no cancelado), así que acá no se vuelve a decidir qué cuenta como
 * venta: se decide en un solo lugar, en el orquestador.
 *
 * La fórmula, en SQL:
 *
 *     venta s/IVA  = precio_neto    * cantidad
 *     costo        = costo_unitario * cantidad
 *     envío        = envio                       <- ya viene POR LÍNEA
 *     comisión     = comision      * cantidad   <- por unidad, como en ML
 *     rentabilidad = venta s/IVA - costo - envío - comisión
 *
 * La COMISIÓN de la pasarela no viene en el pedido: Tienda Nube no informa el
 * monto. La calcula `modelo.py` cruzando la pasarela y el medio de pago contra
 * `bronze.comisiones_pasarela`, que tiene los aranceles reales del panel de la
 * tienda. No es un porcentaje inventado: sale de la tarifa publicada.
 */

const VENTA_CIVA = "coalesce(total_linea, 0)";
const VENTA_SIVA = "coalesce(precio_neto, 0) * cantidad";
const COSTO = "coalesce(costo_unitario, 0) * cantidad";
const ENVIO = "coalesce(envio, 0)";
/** Lo resignado en la línea, CON IVA. Ya está descontado de `total_linea`. */
const DESCUENTO = "coalesce(descuento, 0)";
/**
 * Lo que se lleva la pasarela de pago. `comision` se guarda POR UNIDAD —igual
 * que en Mercado Libre— así que va multiplicada por la cantidad.
 *
 * Tienda Nube no informa el monto en el pedido: se calcula en `modelo.py`
 * cruzando la pasarela y el medio de pago contra `bronze.comisiones_pasarela`.
 */
const COMISION = "coalesce(comision, 0) * cantidad";
/**
 * La otra mitad de la misma tarifa: lo que cobra **Tienda Nube** por usar la
 * plataforma, separado de lo que cobra la **pasarela** por mover la plata.
 *
 * NO ES UN COSTO NUEVO. Lo que se descuenta de un cobro por Nave son 2,8780 %,
 * y eso siempre fue 2,1780 % de Nave + 0,7 % de Tienda Nube. Antes iba todo
 * junto en `comision`; ahora viene partido. **El total no cambió.**
 *
 * Se separa porque es la única forma de contestar cuánto cuesta cobrar por una
 * pasarela contra otra: Pago Nube bonifica esta parte al 0 %, Nave la cobra
 * entera. Sumadas, esa diferencia queda escondida.
 */
const COSTO_TRANSACCION = "coalesce(costo_transaccion, 0) * cantidad";
const RENTABILIDAD = `(${VENTA_SIVA}) - (${COSTO}) - (${ENVIO}) - (${COMISION}) - (${COSTO_TRANSACCION})`;

/** Rentabilidad neta de la línea: la bruta menos los impuestos sobre venta s/IVA. */
const RENT_NETA = `(${RENTABILIDAD}) - (${VENTA_SIVA}) * ${CARGA_IMPOSITIVA}`;

type Where = { sql: string; params: unknown[] };

const OPCIONALES: [keyof FiltrosTiendaNube, string][] = [
  ["proveedor", "proveedor"],
  ["marca", "marca"],
  ["sku", "sku"],
  ["cliente", "cliente"],
];

/**
 * `omitir` desactiva un filtro para una consulta puntual: el ranking de
 * proveedores tiene que seguir mostrándolos a todos aunque haya uno
 * seleccionado, si no queda con una sola barra.
 */
function whereBase(f: FiltrosTiendaNube, omitir: (keyof FiltrosTiendaNube)[] = []): Where {
  const params: unknown[] = [CANAL_TIENDA_NUBE];
  const clauses = ["canal = $1"];

  // El rango va con `::date` explícito: `fecha` es un date y sin el casteo
  // Postgres compara contra texto.
  if (f.desde) {
    params.push(f.desde);
    clauses.push(`fecha >= $${params.length}::date`);
  }
  if (f.hasta) {
    params.push(f.hasta);
    clauses.push(`fecha <= $${params.length}::date`);
  }

  for (const [clave, columna] of OPCIONALES) {
    if (!omitir.includes(clave)) {
      agregarFiltro(clauses, params, columna, f[clave] as string[] | undefined);
    }
  }

  return { sql: clauses.join("\n     and "), params };
}

// --- Rango y período anterior ------------------------------------------------

const DIA_MS = 86_400_000;

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function aFecha(s: string): Date {
  return new Date(`${s}T00:00:00Z`);
}

/**
 * El mismo recorte corrido hacia atrás, pegado al de adelante: si mirás del 1 al
 * 7, es del 25 al 31. Misma CANTIDAD de días, no "el mes anterior": comparar 5
 * días contra 7 haría que el período anterior gane siempre.
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

/** Fracción, o null cuando el denominador es 0 (que no es lo mismo que 0 %). */
function pct(numerador: number, denominador: number): number | null {
  return denominador === 0 ? null : numerador / denominador;
}

const num = (v: unknown): number => Number(v ?? 0);

// --- KPIs --------------------------------------------------------------------

async function getKpis(f: FiltrosTiendaNube): Promise<KpisTiendaNube> {
  const w = whereBase(f);

  const fila = await queryOne<Record<string, string>>(
    `select coalesce(sum(${VENTA_CIVA}), 0) as venta_civa,
            coalesce(sum(${VENTA_SIVA}), 0) as venta_siva,
            coalesce(sum(cantidad), 0)      as unidades,
            count(distinct nro_orden)       as pedidos,
            count(distinct cliente)         as clientes,
            count(*)                        as lineas,
            coalesce(sum(${COSTO}), 0)      as costo,
            coalesce(sum(${ENVIO}), 0)      as envio,
            coalesce(sum(${COMISION}), 0)   as comision,
            coalesce(sum(${COSTO_TRANSACCION}), 0) as costo_transaccion
     from gold.fact_ventas
     where ${w.sql}`,
    w.params,
  );

  const ventaCiva = num(fila?.venta_civa);
  const ventaSiva = num(fila?.venta_siva);
  const costo = num(fila?.costo);
  const envio = num(fila?.envio);
  const pedidos = num(fila?.pedidos);
  const comision = num(fila?.comision);
  const costoTransaccion = num(fila?.costo_transaccion);

  // OJO: la resta tiene que ser la MISMA que la de `RENTABILIDAD`, que es la
  // que usan las tablas. Acá se calcula en TypeScript y allá en SQL, asi que
  // no hay nada que obligue a las dos a coincidir salvo acordarse -- y ya me
  // pase una vez: agregue la comision a la constante y me olvide de esta
  // linea, con lo cual la tarjeta y el total de la tabla de Pedidos daban
  // distinto por el total de comisiones. Si se suma un componente nuevo, va
  // en los dos lados.
  const rentabilidad = ventaSiva - costo - envio - comision - costoTransaccion;
  const impuestos = ventaSiva * CARGA_IMPOSITIVA;

  return {
    ventaCiva,
    ventaSiva,
    unidades: num(fila?.unidades),
    pedidos,
    lineas: num(fila?.lineas),
    clientes: num(fila?.clientes),
    costo,
    envio,
    comision,
    // El denominador es la venta c/IVA, como todo el resto de la seccion. Ojo
    // con leerlo como "el arancel que nos cobran": la pasarela cobra sobre el
    // TOTAL que pago el cliente, que incluye el envio, y la venta c/IVA no lo
    // incluye. Con envio cobrado, este porcentaje da mas alto que la tarifa
    // publicada, y no esta mal -- son dos bases distintas.
    comisionPct: pct(comision, ventaCiva),
    costoTransaccion,
    rentabilidad,
    // Denominador c/IVA en toda la sección minorista (ver DENOMINADOR).
    margenPct: pct(rentabilidad, ventaCiva),
    impuestos,
    rentabilidadNeta: rentabilidad - impuestos,
    margenNetoPct: pct(rentabilidad - impuestos, ventaCiva),
    ticketPromedio: pct(ventaCiva, pedidos),
  };
}

// --- Series y rankings -------------------------------------------------------

async function getPorDia(f: FiltrosTiendaNube): Promise<PuntoDiaTiendaNube[]> {
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

/** Columnas de un artículo agrupado por SKU. Las comparten los dos rankings. */
const COLUMNAS_ARTICULO = `sku,
            max(producto)                     as producto,
            max(proveedor)                    as proveedor,
            max(marca)                        as marca,
            coalesce(sum(cantidad), 0)        as unidades,
            coalesce(sum(${VENTA_CIVA}), 0)   as venta_civa,
            coalesce(sum(${VENTA_SIVA}), 0)   as venta_siva,
            coalesce(sum(${COSTO}), 0)        as costo,
            coalesce(sum(${ENVIO}), 0)        as envio,
            coalesce(sum(${RENTABILIDAD}), 0) as rentabilidad`;

function aArticulo(r: Record<string, string>): ArticuloTiendaNube {
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
    envio: num(r.envio),
    rentabilidad,
    margenPct: pct(rentabilidad, ventaCiva),
  };
}

/**
 * Los SKUs que más plata dejaron. Consulta aparte y no un `sort` de la tabla de
 * artículos: un producto que se vende poco pero deja mucho es justo el que
 * interesa, y ordenar por venta puede dejarlo afuera del recorte.
 */
async function getTopRentabilidad(f: FiltrosTiendaNube): Promise<ArticuloTiendaNube[]> {
  const w = whereBase(f);
  const filas = await query<Record<string, string>>(
    `select ${COLUMNAS_ARTICULO}
     from gold.fact_ventas
     where ${w.sql}
     group by sku
     order by rentabilidad desc
     limit 12`,
    w.params,
  );
  return filas.map(aArticulo);
}

async function getArticulos(f: FiltrosTiendaNube): Promise<ArticuloTiendaNube[]> {
  const w = whereBase(f);
  const filas = await query<Record<string, string>>(
    `select ${COLUMNAS_ARTICULO}
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
 * Ranking por una dimensión. Se omite el filtro de esa misma dimensión para que
 * al clickear un proveedor el gráfico no se quede con una sola barra.
 */
async function getRanking(
  f: FiltrosTiendaNube,
  clave: "proveedor",
  limite: number,
): Promise<RankingTiendaNube[]> {
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
async function getVentaTotalProveedores(f: FiltrosTiendaNube): Promise<number> {
  const w = whereBase(f, ["proveedor"]);
  const fila = await queryOne<Record<string, string>>(
    `select coalesce(sum(${VENTA_CIVA}), 0) as total from gold.fact_ventas where ${w.sql}`,
    w.params,
  );
  return num(fila?.total);
}

/**
 * Los clientes del recorte.
 *
 * Esta consulta no tiene equivalente en Mercado Libre y no es un descuido: allá
 * el "cliente" es el apodo del comprador y hay 33.000 distintos, así que un
 * ranking de clientes no dice nada. Acá son personas con nombre, son pocas y
 * VUELVEN — que un cliente tenga dos pedidos es información.
 *
 * Se omite el filtro de cliente por la misma razón que en los otros rankings:
 * si no, al clickear uno la lista se queda con una sola fila.
 */
async function getClientes(f: FiltrosTiendaNube): Promise<ClienteTiendaNube[]> {
  const w = whereBase(f, ["cliente"]);

  const filas = await query<Record<string, string>>(
    `select coalesce(cliente, 'Sin dato')     as cliente,
            count(distinct nro_orden)         as pedidos,
            coalesce(sum(cantidad), 0)        as unidades,
            coalesce(sum(${VENTA_CIVA}), 0)   as venta_civa,
            coalesce(sum(${RENTABILIDAD}), 0) as rentabilidad,
            to_char(min(fecha), 'YYYY-MM-DD') as primera,
            to_char(max(fecha), 'YYYY-MM-DD') as ultima
     from gold.fact_ventas
     where ${w.sql}
     group by 1
     order by venta_civa desc
     limit 50`,
    w.params,
  );

  return filas.map((r) => {
    const ventaCiva = num(r.venta_civa);
    const rentabilidad = num(r.rentabilidad);
    return {
      cliente: r.cliente,
      pedidos: num(r.pedidos),
      unidades: num(r.unidades),
      ventaCiva,
      rentabilidad,
      margenPct: pct(rentabilidad, ventaCiva),
      primera: r.primera ?? null,
      ultima: r.ultima ?? null,
    };
  });
}

/**
 * Tope de pedidos que bajan al navegador. Con ocho pedidos por mes no se toca
 * nunca, pero está para que un rango de dos años no cuelgue la página.
 */
const TOPE_PEDIDOS = 300;

/**
 * Los pedidos, uno por uno.
 *
 * Es EL panel de este tablero. En Mercado Libre una lista de ventas
 * individuales es un volcado de base que hay que filtrar por nivel de alerta
 * para que sirva; acá son treinta filas en cuatro meses y se pueden leer todas.
 *
 * Se agrupa por `nro_orden` y no se muestra línea por línea porque la unidad de
 * decisión es el pedido: el envío se paga una vez por pedido, así que el margen
 * de una línea suelta de un pedido de tres productos no quiere decir nada.
 */
async function getPedidos(f: FiltrosTiendaNube): Promise<PedidoTiendaNube[]> {
  const w = whereBase(f);

  const filas = await query<Record<string, string | null>>(
    `select nro_orden::bigint::text            as nro_orden,
            to_char(min(fecha), 'YYYY-MM-DD')  as fecha,
            max(cliente)                       as cliente,
            count(*)                           as lineas,
            coalesce(sum(cantidad), 0)         as unidades,
            coalesce(sum(${VENTA_CIVA}), 0)    as venta_civa,
            coalesce(sum(${VENTA_SIVA}), 0)    as venta_siva,
            coalesce(sum(${COSTO}), 0)         as costo,
            coalesce(sum(${ENVIO}), 0)         as envio,
            coalesce(sum(${COMISION}), 0)      as comision,
            coalesce(sum(${COSTO_TRANSACCION}), 0) as costo_transaccion,
            coalesce(sum(${DESCUENTO}), 0)     as descuento,
            -- Un pedido tiene UN cupón, pero se agrupa por orden: max() saca el
            -- único valor no nulo sin tener que agregarlo al group by.
            max(cupon)                         as cupon,
            -- Mismo caso que el cupón: la pasarela es del pedido, no de la
            -- línea. Van crudas y el tablero las traduce.
            max(pasarela)                      as pasarela,
            max(metodo_pago)                   as metodo_pago,
            coalesce(sum(${RENTABILIDAD}), 0)  as rentabilidad,
            coalesce(sum(${RENT_NETA}), 0)     as rent_neta
     from gold.fact_ventas
     where ${w.sql} and nro_orden is not null
     group by nro_orden
     order by min(fecha) desc, nro_orden desc
     limit ${TOPE_PEDIDOS}`,
    w.params,
  );

  return filas.map((r) => {
    const ventaCiva = num(r.venta_civa);
    const rentabilidad = num(r.rentabilidad);
    const rentabilidadNeta = num(r.rent_neta);
    return {
      nroOrden: r.nro_orden,
      fecha: r.fecha,
      cliente: r.cliente,
      lineas: num(r.lineas),
      unidades: num(r.unidades),
      descuento: num(r.descuento),
      comision: num(r.comision),
      costoTransaccion: num(r.costo_transaccion),
      cupon: r.cupon,
      pasarela: r.pasarela,
      metodoPago: r.metodo_pago,
      ventaCiva,
      ventaSiva: num(r.venta_siva),
      costo: num(r.costo),
      envio: num(r.envio),
      rentabilidad,
      margenPct: pct(rentabilidad, ventaCiva),
      rentabilidadNeta,
      margenNetoPct: pct(rentabilidadNeta, ventaCiva),
    };
  });
}

/**
 * El abono del plan que le toca al rango, prorrateado por día.
 *
 * NO RECIBE LOS FILTROS, Y ES A PROPÓSITO. El plan es un costo del canal: se
 * paga igual se venda de un proveedor o de otro. Si respondiera al filtro,
 * filtrar por una marca haría "bajar" el abono, que es exactamente la lectura
 * equivocada. Sólo depende del rango de fechas.
 *
 * Se prorratea por día y no por mes entero para que un rango de quince días no
 * cargue el abono completo — y para que el número no pegue saltos cuando el
 * usuario mueve el calendario un día.
 *
 * `cargado` distingue "el plan sale $0" de "todavía no cargamos cuánto sale".
 * Sin esa diferencia, un canal sin datos se vería como un canal gratis.
 */
async function getCostosFijos(
  desde: string,
  hasta: string,
): Promise<{ monto: number; cargado: boolean }> {
  if (!desde || !hasta) return { monto: 0, cargado: false };

  // `cargado` viene como boolean de Postgres, no como texto: el resto de las
  // consultas de este archivo leen números y ahí `pg` devuelve strings, pero un
  // `bool` llega tipado. Por eso el tipo de la fila no es el de siempre.
  const fila = await queryOne<{ monto: string | null; cargado: boolean | null }>(
    `select coalesce(sum(vigente.abono_mensual / dias_del_mes), 0) as monto,
            bool_or(vigente.abono_mensual is not null)             as cargado
     from generate_series($1::date, $2::date, '1 day') as d
     cross join lateral (
       select extract(day from (date_trunc('month', d) + interval '1 month - 1 day'))
         as dias_del_mes
     ) m
     cross join lateral (
       select c.abono_mensual
       from bronze.costos_plataforma_tn c
       where c.vigente_desde <= d::date
       order by c.vigente_desde desc
       limit 1
     ) vigente`,
    [desde, hasta],
  );

  return { monto: num(fila?.monto), cargado: fila?.cargado === true };
}

/** Último día con ventas cargadas, sin filtros: avisa si el dato viene atrasado. */
async function getUltimaVenta(): Promise<string | null> {
  const fila = await queryOne<{ fecha: string | null }>(
    `select to_char(max(fecha), 'YYYY-MM-DD') as fecha
     from gold.fact_ventas where canal = $1`,
    [CANAL_TIENDA_NUBE],
  );
  return fila?.fecha ?? null;
}

// --- Opciones de los filtros -------------------------------------------------

export async function getOpcionesTiendaNube(): Promise<OpcionesTiendaNube> {
  const [proveedores, marcas, bordes] = await Promise.all([
    query<{ v: string }>(
      `select distinct proveedor as v from gold.fact_ventas
       where canal = $1 and proveedor is not null order by 1`,
      [CANAL_TIENDA_NUBE],
    ),
    query<{ v: string }>(
      `select distinct marca as v from gold.fact_ventas
       where canal = $1 and marca is not null order by 1`,
      [CANAL_TIENDA_NUBE],
    ),
    queryOne<{ primera: string | null; ultima: string | null }>(
      `select to_char(min(fecha), 'YYYY-MM-DD') as primera,
              to_char(max(fecha), 'YYYY-MM-DD') as ultima
       from gold.fact_ventas where canal = $1`,
      [CANAL_TIENDA_NUBE],
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
 * El día con el que abre el tablero, resuelto en el SERVIDOR: hoy en hora
 * argentina. El componente lo usa para armar el mes comercial vigente.
 *
 * A diferencia de Mercado Libre, acá NO se retrocede al último día con ventas:
 * el rango inicial es el mes comercial entero, así que con ocho pedidos por mes
 * casi siempre cae adentro. Retroceder movería el mes de lugar sin motivo.
 */
export async function getDiaInicialTiendaNube(): Promise<string> {
  return hoyArgentina();
}

// --- Dashboard ---------------------------------------------------------------

export async function getDashboardTiendaNube(
  f: FiltrosTiendaNube,
): Promise<DashboardTiendaNube> {
  // El rango siempre está resuelto para cuando llega acá (lo fija la ruta de
  // API), pero el tipo lo permite vacío: sin este piso, `periodoAnterior` haría
  // cuentas con undefined y devolvería fechas inválidas.
  const desde = f.desde ?? f.hasta ?? "";
  const hasta = f.hasta ?? f.desde ?? "";
  const anterior = desde && hasta ? periodoAnterior(desde, hasta) : null;

  const [
    kpis,
    porDia,
    porProveedor,
    topRentabilidad,
    articulos,
    clientes,
    pedidos,
    ventaTotalProveedores,
    ultimaVenta,
    costosFijos,
    kpisAnterior,
  ] = await Promise.all([
    getKpis(f),
    getPorDia(f),
    getRanking(f, "proveedor", 12),
    getTopRentabilidad(f),
    getArticulos(f),
    getClientes(f),
    getPedidos(f),
    getVentaTotalProveedores(f),
    getUltimaVenta(),
    getCostosFijos(desde, hasta),
    // El período anterior mantiene TODOS los otros filtros: comparar "este mes
    // de ALGABO" contra "el mes pasado de todo" no diría nada.
    anterior ? getKpis({ ...f, ...anterior }) : Promise.resolve(null),
  ]);

  return {
    kpis,
    rango: { desde, hasta, dias: desde && hasta ? diasDelRango(desde, hasta) : 0 },
    comparacion:
      anterior && kpisAnterior && kpisAnterior.lineas > 0
        ? {
            desde: anterior.desde,
            hasta: anterior.hasta,
            ventaCiva: kpisAnterior.ventaCiva,
            unidades: kpisAnterior.unidades,
            pedidos: kpisAnterior.pedidos,
            rentabilidad: kpisAnterior.rentabilidad,
            margenPct: kpisAnterior.margenPct,
          }
        : null,
    porDia,
    porProveedor,
    topRentabilidad,
    articulos,
    clientes,
    pedidos,
    pedidosRecortados: pedidos.length === TOPE_PEDIDOS,
    ventaTotalProveedores,
    equilibrio: {
      contribucion: kpis.rentabilidad,
      costosFijos: costosFijos.monto,
      costosFijosCargados: costosFijos.cargado,
      // El % de los costos fijos que la operación llega a cubrir. Null cuando
      // no hay costos fijos cargados: dividir por cero daría "infinito" y se
      // leería como que sobra plata.
      coberturaPct: costosFijos.monto > 0 ? kpis.rentabilidad / costosFijos.monto : null,
      // Cuánto habría que vender para empatar, al margen de contribución de
      // este mismo recorte. Null si el margen es cero o negativo: ahí no hay
      // volumen que alcance, vender más agranda la pérdida.
      ventaEquilibrio:
        costosFijos.monto > 0 && kpis.rentabilidad > 0 && kpis.ventaCiva > 0
          ? costosFijos.monto / (kpis.rentabilidad / kpis.ventaCiva)
          : null,
    },
    ultimaVenta,
    generadoEn: new Date().toISOString(),
  };
}
