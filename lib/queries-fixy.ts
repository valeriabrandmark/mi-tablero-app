import { query, queryOne } from "@/lib/db";
import {
  DIAS_PARA_LLEGAR_A_FIXY,
  PATRON_CLIENTE_TRANSFERENCIA_FIXY,
  UMBRAL_DIFERENCIA_UNIDADES,
} from "@/lib/fixy";

/**
 * Consultas de Stock > FIXY. Las reglas están en lib/fixy.ts.
 *
 * Cruza cuatro fuentes:
 *
 *   bronze.fixy_stock(_historico)  lo que FIXY dice que tiene (tablero_quo/fixy.py)
 *   gold.fact_ventas               las TRANSFERENCIAS de Tucumán a FIXY (venta
 *                                  mayorista a "... - DEP BUENOS AIRES") y lo
 *                                  vendido por Tienda Nube y por Flex
 *   app.fixy_recepciones(_items)   lo que le avisamos a FIXY que iba a entrar;
 *                                  las manuales son las importaciones
 *   bronze.digip_envios_fixy       lo que Digip preparó para FIXY
 *
 * NO SE CACHEA, a diferencia del resto de Stock: las recepciones las escribe
 * esta misma pantalla, y avisar una tiene que verse en el momento.
 *
 * TODAS LAS TABLAS PUEDEN NO EXISTIR TODAVÍA: las de bronze las crea el
 * orquestador en su primera corrida con token, y las de app la migración. Una
 * que falta se lee como vacía y la pantalla dice qué falta, en vez de caerse.
 */

const TABLA_INEXISTENTE = "42P01";

async function oVacio<T>(consulta: Promise<T[]>): Promise<{ filas: T[]; falta: boolean }> {
  try {
    return { filas: await consulta, falta: false };
  } catch (e) {
    if ((e as { code?: string }).code === TABLA_INEXISTENTE) return { filas: [], falta: true };
    throw e;
  }
}

const num = (v: unknown): number => Number(v ?? 0);
const txt = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

/**
 * Las ventas que salen de FIXY. Tienda Nube entera y, de Mercado Libre, sólo
 * Flex (`self_service`): Full sale del depósito de Mercado Libre y cross
 * docking de Tucumán.
 *
 * LIMITE CONOCIDO: de Tienda Nube hoy entra por API una sola tienda. Las
 * de Diaper Genie, Hola Toys y Litter Genie no están en `fact_ventas`, así que
 * sus ventas no se descuentan y aparecen como faltante en FIXY hasta que se
 * sumen al pipeline.
 */
export const VENTAS_DESDE_FIXY = `
  select sku, fecha, sum(cantidad) as u
  from gold.fact_ventas
  where sku is not null
    and (canal = 'Tienda Nube'
         or (canal = 'Mercado Libre' and logistica = 'self_service'))
  group by sku, fecha`;

/**
 * Las transferencias de Tucumán a FIXY, por SKU y día de la factura. Las
 * notas de crédito restan (vienen negativas). Ver
 * PATRON_CLIENTE_TRANSFERENCIA_FIXY en lib/fixy.ts.
 *
 * $1 es el patrón del cliente.
 */
const TRANSFERENCIAS_A_FIXY = `
  select sku, fecha, sum(cantidad) as u
  from gold.fact_ventas
  where canal = 'Mayorista' and sku is not null
    and cliente ilike $1
  group by sku, fecha`;

export type Transferencia = {
  comprobante: string;
  fecha: string;
  cliente: string;
  renglones: number;
  unidades: number;
};

/** Los comprobantes de transferencia a FIXY, el más nuevo primero. */
async function getTransferencias() {
  return query<Record<string, unknown>>(
    `select comprobante, fecha::text as fecha, cliente,
            count(distinct sku) as renglones, sum(cantidad) as unidades
       from gold.fact_ventas
      where canal = 'Mayorista' and cliente ilike $1
      group by comprobante, fecha, cliente
      order by fecha desc, comprobante desc
      limit 100`,
    [PATRON_CLIENTE_TRANSFERENCIA_FIXY],
  ).then((filas) =>
    filas.map(
      (r): Transferencia => ({
        comprobante: String(r.comprobante ?? "—"),
        fecha: String(r.fecha),
        cliente: String(r.cliente),
        renglones: num(r.renglones),
        unidades: num(r.unidades),
      }),
    ),
  );
}

/* ---------------------------------------------------------------------------
   ENVIOS DESDE TUCUMAN, Y SI YA SE AVISARON
   --------------------------------------------------------------------------- */

export type EnvioDigip = {
  pedido: string;
  fecha: string | null;
  estado: string | null;
  renglones: number;
  unidades: number;
  recepcionId: number | null;
  avisadaEn: string | null;
  resultado: string | null;
};

async function getEnvios() {
  return oVacio(
    query<Record<string, unknown>>(
      `select e.pedido_codigo                         as pedido,
              left(max(e.fecha_estado), 10)           as fecha,
              max(e.preparacion_estado)               as estado,
              count(distinct e.sku)                   as renglones,
              sum(e.unidades_satisfecha)              as unidades,
              r.id                                    as recepcion_id,
              r.creada_en::text                       as avisada_en,
              r.resultado
         from bronze.digip_envios_fixy e
         left join app.fixy_recepciones r on r.pedido_digip = e.pedido_codigo
        where e.sku is not null
        group by e.pedido_codigo, r.id, r.creada_en, r.resultado
        -- Lo que falta avisar primero, después lo más nuevo.
        order by (r.id is null) desc, max(e.fecha_estado) desc nulls last
        limit 100`,
    ).then((filas) =>
      filas.map(
        (r): EnvioDigip => ({
          pedido: String(r.pedido),
          fecha: txt(r.fecha),
          estado: txt(r.estado),
          renglones: num(r.renglones),
          unidades: num(r.unidades),
          recepcionId: r.recepcion_id == null ? null : num(r.recepcion_id),
          avisadaEn: txt(r.avisada_en),
          resultado: txt(r.resultado),
        }),
      ),
    ),
  );
}

/** Los renglones de un pedido de Digip, listos para avisar a FIXY. */
export async function getRenglonesDePedido(pedido: string) {
  return query<{
    sku: string;
    descripcion: string | null;
    cantidad: string;
    unidades_por_bulto: string | null;
  }>(
    `select trim(e.sku)                          as sku,
            max(coalesce(a.descripcion, e.articulo)) as descripcion,
            sum(e.unidades_satisfecha)          as cantidad,
            max(a."unidadesPorBulto")           as unidades_por_bulto
       from bronze.digip_envios_fixy e
       left join bronze.sigma_articulos a on trim(a.id) = trim(e.sku)
      where e.pedido_codigo = $1 and e.sku is not null
      group by trim(e.sku)
      having sum(e.unidades_satisfecha) > 0
      order by 1`,
    [pedido],
  );
}

/** Descripción y bulto de Sigma para una lista de SKU (recepciones manuales). */
export async function getArticulosSigma(skus: string[]) {
  return query<{ sku: string; descripcion: string | null; unidades_por_bulto: string | null }>(
    `select trim(a.id) as sku, a.descripcion, a."unidadesPorBulto" as unidades_por_bulto
       from bronze.sigma_articulos a
      where upper(trim(a.id)) = any($1::text[])`,
    [skus.map((s) => s.toUpperCase())],
  );
}

/* ---------------------------------------------------------------------------
   RECEPCIONES AVISADAS
   --------------------------------------------------------------------------- */

export type Recepcion = {
  id: number;
  creadaEn: string;
  usuario: string | null;
  remito: string;
  origen: string;
  fechaPactada: string;
  renglones: number;
  unidades: number;
  resultado: string;
};

async function getRecepciones() {
  return oVacio(
    query<Record<string, unknown>>(
      `select id, creada_en::text as creada_en, usuario, remito, origen,
              fecha_pactada::text as fecha_pactada, renglones, unidades, resultado
         from app.fixy_recepciones
        order by creada_en desc
        limit 100`,
    ).then((filas) =>
      filas.map(
        (r): Recepcion => ({
          id: num(r.id),
          creadaEn: String(r.creada_en),
          usuario: txt(r.usuario),
          remito: String(r.remito),
          origen: String(r.origen),
          fechaPactada: String(r.fecha_pactada),
          renglones: num(r.renglones),
          unidades: num(r.unidades),
          resultado: String(r.resultado),
        }),
      ),
    ),
  );
}

/* ---------------------------------------------------------------------------
   EL CONTROL: LO QUE ENTRA Y LO QUE SE VENDE CONTRA LO QUE HAY
   --------------------------------------------------------------------------- */

export type FilaControl = {
  sku: string;
  producto: string | null;
  marca: string | null;
  stockHoy: number;
  /** Transferencias de Tucumán (netas de NC) más importaciones avisadas. */
  ingresado: number;
  vendido: number;
  enTransito: number;
  /** Lo que no explican ni la venta ni el ingreso. Negativo = falta. */
  diferencia: number;
};

/**
 * La cuenta, por SKU, entre la primera foto de FIXY y la última:
 *
 *   diferencia = (stock hoy − stock al empezar) + vendido − ingresado
 *
 * Lo vendido y lo ingresado se cuentan desde el día SIGUIENTE a la primera foto:
 * esa foto ya incluye todo lo anterior, es la línea de base.
 *
 * NO SE HACE DIA POR DIA como en Full, a propósito. Día por día, un día sin
 * foto (el orquestador no corrió) pierde las ventas y los avisos de ese día --se
 * juntan por fecha con la foto-- y aparece un faltante que no existe. Con
 * puntas y totales, un hueco en la foto no cambia nada.
 *
 * "INGRESADO" SALE DE DOS LADOS, Y NO DE TRES:
 *
 *   - lo que viene de Tucumán, de las TRANSFERENCIAS de Sigma (factura menos
 *     nota de crédito al cliente "... - DEP BUENOS AIRES");
 *   - las importaciones, que van directo a FIXY y no pasan por Sigma como
 *     transferencia: de las recepciones avisadas A MANO.
 *
 * Las recepciones avisadas desde un pedido de Digip NO cuentan: son la misma
 * mercadería que la transferencia, y sumarlas la contaría dos veces. Sirven
 * para que FIXY sepa qué le llega, no para el control.
 */
async function getControl() {
  const rango = await oVacio(
    query<{ desde: string | null; hasta: string | null; dias: string }>(
      `select min(fecha)::text as desde, max(fecha)::text as hasta,
              count(distinct fecha) as dias
         from bronze.fixy_stock_historico`,
    ),
  );
  const r = rango.filas[0];
  const dias = num(r?.dias);
  if (rango.falta || !r?.desde || dias < 2) {
    return { filas: [] as FilaControl[], desde: r?.desde ?? null, hasta: r?.hasta ?? null, dias, falta: rango.falta };
  }

  // Si la tabla de recepciones no existe todavía, se cuenta como sin avisos.
  const hayRecepciones = await queryOne<{ ok: boolean }>(
    `select to_regclass('app.fixy_recepciones_items') is not null as ok`,
  );
  const importaciones = hayRecepciones?.ok
    ? `select i.sku, r.creada_en::date as fecha, sum(i.cantidad) as u
         from app.fixy_recepciones_items i
         join app.fixy_recepciones r on r.id = i.recepcion_id
        where r.origen = 'manual'
        group by i.sku, r.creada_en::date`
    : `select null::text as sku, null::date as fecha, 0::numeric as u where false`;

  const filas = await query<Record<string, unknown>>(
    `with foto as (
       select fecha, sku, disponible
         from bronze.fixy_stock_historico
        where disponible is not null
     ),
     puntas as (
       select sku,
              min(fecha) as base_fecha,
              (array_agg(disponible order by fecha))[1]      as base,
              (array_agg(disponible order by fecha desc))[1] as hoy
         from foto
        group by sku
     ),
     ultimo as (select max(fecha) as f from foto),
     ventas as (${VENTAS_DESDE_FIXY}),
     ingresos as (
       ${TRANSFERENCIAS_A_FIXY}
       union all
       ${importaciones}
     )
     select p.sku,
            s.descripcion                      as producto,
            s."attributes.marca"               as marca,
            p.hoy                              as stock_hoy,
            coalesce(a.u, 0)                   as ingresado,
            coalesce(v.u, 0)                   as vendido,
            coalesce(a.recientes, 0)           as en_transito,
            (p.hoy - p.base) + coalesce(v.u, 0) - coalesce(a.u, 0) as diferencia
       from puntas p
       left join lateral (
         select sum(u) as u from ventas
          where ventas.sku = p.sku and ventas.fecha > p.base_fecha
       ) v on true
       left join lateral (
         select sum(u) as u,
                sum(u) filter (
                  where ingresos.fecha > (select f from ultimo) - ${DIAS_PARA_LLEGAR_A_FIXY}
                ) as recientes
           from ingresos
          where ingresos.sku = p.sku and ingresos.fecha > p.base_fecha
       ) a on true
       left join bronze.sigma_articulos s on trim(s.id) = p.sku
      -- Sólo los SKU que tuvieron algún día después de la base.
      where p.hoy is not null and p.base_fecha < (select f from ultimo)
      order by 8 asc
      limit 500`,
    [PATRON_CLIENTE_TRANSFERENCIA_FIXY],
  );

  return {
    filas: filas.map(
      (x): FilaControl => ({
        sku: String(x.sku),
        producto: txt(x.producto),
        marca: txt(x.marca),
        stockHoy: num(x.stock_hoy),
        ingresado: num(x.ingresado),
        vendido: num(x.vendido),
        enTransito: num(x.en_transito),
        diferencia: num(x.diferencia),
      }),
    ),
    desde: r.desde,
    hasta: r.hasta,
    dias,
    falta: false,
  };
}

/* ---------------------------------------------------------------------------
   PUBLICADO VS FIXY: QUE CADA CANAL MUESTRE EL STOCK QUE HAY
   --------------------------------------------------------------------------- */

export type FilaPublicado = {
  sku: string;
  producto: string | null;
  fixy: number | null;
  flex: number | null;
  publicacionesFlex: number;
  tiendaNube: number | null;
  alerta: "sobreventa" | "sin_publicar" | null;
};

/**
 * El stock de FIXY es UNO para todos los canales, así que cada canal tiene
 * que mostrar, como mucho, lo que hay en FIXY:
 *
 *   sobreventa    algún canal publica más de lo que hay: se puede vender
 *                 algo que no existe.
 *   sin_publicar  hay stock en FIXY y algún canal muestra cero o no lo
 *                 publica: ventas que se pierden.
 *
 * Flex: publicaciones ACTIVAS con logística `self_service`. Si un SKU tiene
 * varias, se toma la que más muestra (es la que más riesgo tiene).
 * Tienda Nube: la tienda que entra por API (`tn_productos`), por variante.
 */
async function getPublicado() {
  return oVacio(
    query<Record<string, unknown>>(
      `with flex as (
         select (select a->>'value_name'
                   from jsonb_array_elements(p.attributes::jsonb) a
                  where a->>'id' = 'SELLER_SKU' limit 1) as sku,
                p.available_quantity
           from bronze.ml_publicaciones p
          where p."shipping.logistic_type" = 'self_service' and p.status = 'active'
       ),
       flex_sku as (
         select trim(sku) as sku, max(available_quantity) as u, count(*) as n
           from flex where sku is not null group by trim(sku)
       ),
       tn as (
         select trim(v->>'sku') as sku, sum((v->>'stock')::numeric) as u
           from bronze.tn_productos t,
                jsonb_array_elements(t.variants::jsonb) v
          where t.published and v->>'sku' is not null and v->>'stock' is not null
          group by trim(v->>'sku')
       ),
       skus as (
         select sku from bronze.fixy_stock
         union select sku from flex_sku
       )
       select k.sku,
              s.descripcion            as producto,
              f.disponible             as fixy,
              x.u                      as flex,
              coalesce(x.n, 0)         as publicaciones_flex,
              t.u                      as tienda_nube
         from skus k
         left join bronze.fixy_stock f on f.sku = k.sku
         left join flex_sku x on x.sku = k.sku
         left join tn t on t.sku = k.sku
         left join bronze.sigma_articulos s on trim(s.id) = k.sku
        order by k.sku
        limit 2000`,
    ).then((filas) =>
      filas.map((r): FilaPublicado => {
        const fixy = r.fixy == null ? null : num(r.fixy);
        const flex = r.flex == null ? null : num(r.flex);
        const tiendaNube = r.tienda_nube == null ? null : num(r.tienda_nube);
        const publicado = [flex, tiendaNube].filter((v): v is number => v !== null);
        let alerta: FilaPublicado["alerta"] = null;
        if (publicado.some((p) => p > (fixy ?? 0))) alerta = "sobreventa";
        else if ((fixy ?? 0) >= UMBRAL_DIFERENCIA_UNIDADES && (flex === null || flex === 0 || tiendaNube === 0))
          alerta = "sin_publicar";
        return {
          sku: String(r.sku),
          producto: txt(r.producto),
          fixy,
          flex,
          publicacionesFlex: num(r.publicaciones_flex),
          tiendaNube,
          alerta,
        };
      }),
    ),
  );
}

/* ---------------------------------------------------------------------------
   DESPACHOS (WEBHOOK)
   --------------------------------------------------------------------------- */

export type ResumenEventos = { guias: number; entregadas: number; ultimo: string | null };

async function getEventos() {
  return oVacio(
    query<Record<string, unknown>>(
      `select count(distinct guia) as guias,
              -- "ENTREGADA" es POD en la cuenta real (api/v2/estados.json); ENT es
              -- el código del ejemplo de la documentación. Se aceptan los dos.
              count(distinct guia) filter (
                where codigo_estado in ('POD', 'ENT') or estado ilike 'entregad%'
              ) as entregadas,
              max(recibido_en)::text as ultimo
         from app.fixy_eventos
        where recibido_en > now() - interval '30 days'`,
    ).then((f) =>
      f.map(
        (r): ResumenEventos => ({
          guias: num(r.guias),
          entregadas: num(r.entregadas),
          ultimo: txt(r.ultimo),
        }),
      ),
    ),
  );
}

export async function getDashboardFixy() {
  const [transferencias, envios, recepciones, control, publicado, eventos] = await Promise.all([
    getTransferencias(),
    getEnvios(),
    getRecepciones(),
    getControl(),
    getPublicado(),
    getEventos(),
  ]);
  return {
    transferencias,
    envios: envios.filas,
    recepciones: recepciones.filas,
    control,
    publicado: publicado.filas,
    eventos: eventos.filas[0] ?? { guias: 0, entregadas: 0, ultimo: null },
    faltan: {
      enviosDigip: envios.falta,
      recepciones: recepciones.falta,
      stock: control.falta || publicado.falta,
      eventos: eventos.falta,
    },
  };
}

export type DashboardFixy = Awaited<ReturnType<typeof getDashboardFixy>>;
