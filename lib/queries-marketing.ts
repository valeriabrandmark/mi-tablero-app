import { query } from "@/lib/db";
import { CANAL_MAYORISTA } from "@/lib/constantes";
import type { ClaveMarca } from "@/lib/marketing-demo";
import type { DatosMayorista, DatosMercadoLibre, DatosTiendaNube, DatosVentaReal } from "@/lib/marketing-fuentes";
import { SQL_ES_CANJE } from "@/lib/queries-carga";

/**
 * Lo que el Tablero de Marca lee de la base: los pedidos de Tienda Nube que se
 * importaron a mano y la venta mayorista por marca que ya viene de SIGMA.
 *
 * Todo se calcula sobre el PERÍODO que elige el filtro (mes calendario por
 * omisión, mes comercial, o un rango), en hora argentina.
 *
 * Si una consulta falla (sin base en local, tabla sin crear), esa parte vuelve
 * `null` y la pantalla muestra el ejemplo con el motivo. No se tapa el error
 * con un cero: un cero se lee como "no se vendió nada".
 */

const TZ = "America/Argentina/Buenos_Aires";
const CANAL_MERCADO_LIBRE = "Mercado Libre";
/**
 * Todas las consultas reciben el período como `desde` y `hasta` (YYYY-MM-DD,
 * puntas incluidas). Ya no es "el mes en curso": lo elige el filtro.
 */
type Rango = { desde: string; hasta: string };

/**
 * Cómo aparece cada marca en `gold.fact_ventas.marca` (lo que carga SIGMA).
 * Unibrandco no va: es la tienda multimarca, no una marca que se venda a
 * tiendas con ese nombre.
 */
const PATRON_MARCA_SIGMA: Partial<Record<ClaveMarca, string>> = {
  diaper_genie: "%DIAPER%GENIE%",
  // En SIGMA (y en Mercado Libre) la marca de Hola Toys figura como "HOLA".
  hola_toys: "HOLA%",
  litter_genie: "%LITTER%GENIE%",
};

function motivoDe(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  if (/mkt_tn_pedidos/.test(m) && /does not exist|no existe/.test(m)) {
    return "Falta correr migraciones/marketing_tienda_nube.sql";
  }
  if (/Faltan variables de entorno de la base/.test(m)) return "Sin conexión a la base";
  return m;
}

async function leerTiendaNube(r: Rango): Promise<Partial<Record<ClaveMarca, DatosTiendaNube>> | string> {
  try {
    const [dias, cupones, clientes, historia, ultima, provincias] = await Promise.all([
      query<{ marca: ClaveMarca; dia: number; venta: string; pedidos: string }>(
        `select marca, ((fecha at time zone '${TZ}')::date - $1::date) + 1 as dia,
                sum(total) as venta, count(*) as pedidos
           from bronze.mkt_tn_pedidos
          where es_venta and (fecha at time zone '${TZ}')::date between $1::date and $2::date
          group by 1, 2`,
        [r.desde, r.hasta],
      ),
      query<{ marca: ClaveMarca; cupon: string; pedidos: string; venta: string }>(
        `select marca, upper(cupon) as cupon, count(*) as pedidos, sum(total) as venta
           from bronze.mkt_tn_pedidos
          where es_venta and cupon is not null
            and (fecha at time zone '${TZ}')::date between $1::date and $2::date
          group by 1, 2 order by 4 desc`,
        [r.desde, r.hasta],
      ),
      // Nuevo = su primera compra pagada en esa tienda es de este mes.
      query<{ marca: ClaveMarca; nuevos: string; recurrentes: string }>(
        `with primera as (
           select marca, cliente_hash, min(fecha) as primera
             from bronze.mkt_tn_pedidos
            where es_venta and cliente_hash is not null
            group by 1, 2)
         select p.marca,
                count(distinct p.cliente_hash) filter (where (pr.primera at time zone '${TZ}')::date >= $1::date) as nuevos,
                count(distinct p.cliente_hash) filter (where (pr.primera at time zone '${TZ}')::date <  $1::date) as recurrentes
           from bronze.mkt_tn_pedidos p
           join primera pr using (marca, cliente_hash)
          where p.es_venta and (p.fecha at time zone '${TZ}')::date between $1::date and $2::date
          group by 1`,
        [r.desde, r.hasta],
      ),
      query<{ marca: ClaveMarca; mes: string; venta: string }>(
        `select marca, to_char(date_trunc('month', fecha at time zone '${TZ}'), 'YYYY-MM') as mes,
                sum(total) as venta
           from bronze.mkt_tn_pedidos
          where es_venta and (fecha at time zone '${TZ}')::date between date_trunc('month', $1::date) - interval '3 months' and $1::date
          group by 1, 2`,
        [r.hasta],
      ),
      query<{ marca: ClaveMarca; ultimo_pedido: string; ultima_importacion: string }>(
        `select marca, max(fecha) as ultimo_pedido, max(importado_en) as ultima_importacion
           from bronze.mkt_tn_pedidos group by 1`,
      ),
      query<{ marca: ClaveMarca; provincia: string; pedidos: string }>(
        `select marca, coalesce(provincia, 'Sin dato') as provincia, count(*) as pedidos
           from bronze.mkt_tn_pedidos
          where es_venta and (fecha at time zone '${TZ}')::date between $1::date and $2::date
          group by 1, 2`,
        [r.desde, r.hasta],
      ),
    ]);

    const out: Partial<Record<ClaveMarca, DatosTiendaNube>> = {};
    for (const u of ultima) {
      const d = dias.filter((x) => x.marca === u.marca);
      const diaria: number[] = [];
      for (const x of d) diaria[x.dia - 1] = Number(x.venta);
      const c = clientes.find((x) => x.marca === u.marca);
      out[u.marca] = {
        origen: "importado",
        venta: d.reduce((s, x) => s + Number(x.venta), 0),
        pedidos: d.reduce((s, x) => s + Number(x.pedidos), 0),
        diaria: Array.from(diaria, (v) => v ?? 0),
        cupones: cupones
          .filter((x) => x.marca === u.marca)
          .map((x) => ({ cupon: x.cupon, pedidos: Number(x.pedidos), venta: Number(x.venta) })),
        clientesNuevos: Number(c?.nuevos ?? 0),
        clientesRecurrentes: Number(c?.recurrentes ?? 0),
        historia: historia
          .filter((x) => x.marca === u.marca)
          .map((x) => ({ mes: x.mes, venta: Number(x.venta) })),
        provincias: provincias
          .filter((x) => x.marca === u.marca)
          .map((x) => ({ provincia: x.provincia, pedidos: Number(x.pedidos) }))
          .sort((a, b) => b.pedidos - a.pedidos)
          .slice(0, 6),
        ultimoPedido: new Date(u.ultimo_pedido).toISOString(),
        ultimaImportacion: new Date(u.ultima_importacion).toISOString(),
      };
    }
    return out;
  } catch (e) {
    return motivoDe(e);
  }
}

async function leerMayorista(r: Rango): Promise<Partial<Record<ClaveMarca, DatosMayorista>> | string> {
  const marcas = Object.entries(PATRON_MARCA_SIGMA) as [ClaveMarca, string][];
  try {
    const [dias, historia, tiendas] = await Promise.all([
      query<{ clave: ClaveMarca; dia: number; venta: string }>(
        `select m.clave, (fv.fecha - $4::date) + 1 as dia,
                sum(fv.precio_neto * fv.cantidad)::numeric as venta
           from gold.fact_ventas fv
           join unnest($2::text[], $3::text[]) as m(clave, patron)
             on upper(fv.marca) like m.patron
          where fv.canal = $1 and fv.fecha between $4::date and $5::date
            and not ${SQL_ES_CANJE("fv.")}
          group by 1, 2`,
        [CANAL_MAYORISTA, marcas.map(([k]) => k), marcas.map(([, p]) => p), r.desde, r.hasta],
      ),
      query<{ clave: ClaveMarca; mes: string; venta: string }>(
        `select m.clave, to_char(date_trunc('month', fv.fecha), 'YYYY-MM') as mes,
                sum(fv.precio_neto * fv.cantidad)::numeric as venta
           from gold.fact_ventas fv
           join unnest($2::text[], $3::text[]) as m(clave, patron)
             on upper(fv.marca) like m.patron
          where fv.canal = $1 and fv.fecha between date_trunc('month', $4::date) - interval '3 months' and $4::date
            and not ${SQL_ES_CANJE("fv.")}
          group by 1, 2`,
        [CANAL_MAYORISTA, marcas.map(([k]) => k), marcas.map(([, p]) => p), r.hasta],
      ),
      // Tiendas que compran la marca por PRIMERA VEZ este mes. Es la mitad
      // "demanda" de las tiendas nuevas: Agatina la genera, el comisionista
      // la cierra. gold.fact_ventas arranca el 06/05/2026, así que "primera
      // vez" quiere decir "primera vez desde mayo".
      query<{ clave: ClaveMarca; nuevas: string }>(
        `with primera as (
           select m.clave, fv.cliente, min(fv.fecha) as primera
             from gold.fact_ventas fv
             join unnest($2::text[], $3::text[]) as m(clave, patron)
               on upper(fv.marca) like m.patron
            where fv.canal = $1 and fv.precio_neto * fv.cantidad > 0
              and not ${SQL_ES_CANJE("fv.")}
            group by 1, 2)
         select clave, count(*) filter (where primera between $4::date and $5::date) as nuevas
           from primera group by 1`,
        [CANAL_MAYORISTA, marcas.map(([k]) => k), marcas.map(([, p]) => p), r.desde, r.hasta],
      ),
    ]);
    const out: Partial<Record<ClaveMarca, DatosMayorista>> = {};
    for (const [clave] of marcas) {
      const d = dias.filter((x) => x.clave === clave);
      const diaria: number[] = [];
      for (const x of d) diaria[x.dia - 1] = Number(x.venta);
      out[clave] = {
        venta: d.reduce((s, x) => s + Number(x.venta), 0),
        diaria: Array.from(diaria, (v) => v ?? 0),
        historia: historia
          .filter((x) => x.clave === clave)
          .map((x) => ({ mes: x.mes, venta: Number(x.venta) })),
        tiendasNuevas: Number(tiendas.find((x) => x.clave === clave)?.nuevas ?? 0),
      };
    }
    return out;
  } catch (e) {
    return motivoDe(e);
  }
}

/**
 * MERCADO LIBRE: la cuenta es una sola para todas las marcas, así que se
 * separa por la marca del producto (igual que en SIGMA). `total_linea` es con
 * IVA, como lo que paga el comprador (igual que Tienda Nube).
 */
async function leerMercadoLibre(r: Rango): Promise<Partial<Record<ClaveMarca, DatosMercadoLibre>> | string> {
  const marcas = Object.entries(PATRON_MARCA_SIGMA) as [ClaveMarca, string][];
  try {
    const dias = await query<{ clave: ClaveMarca; dia: number; venta: string; pedidos: string }>(
      `select m.clave, (fv.fecha - $4::date) + 1 as dia,
              sum(fv.total_linea)::numeric as venta, count(distinct fv.nro_orden) as pedidos
         from gold.fact_ventas fv
         join unnest($2::text[], $3::text[]) as m(clave, patron)
           on upper(fv.marca) like m.patron
        where fv.canal = $1 and fv.fecha between $4::date and $5::date
        group by 1, 2`,
      [CANAL_MERCADO_LIBRE, marcas.map(([k]) => k), marcas.map(([, p]) => p), r.desde, r.hasta],
    );
    const out: Partial<Record<ClaveMarca, DatosMercadoLibre>> = {};
    for (const [clave] of marcas) {
      const d = dias.filter((x) => x.clave === clave);
      const diaria: number[] = [];
      for (const x of d) diaria[x.dia - 1] = Number(x.venta);
      out[clave] = {
        venta: d.reduce((s, x) => s + Number(x.venta), 0),
        pedidos: d.reduce((s, x) => s + Number(x.pedidos), 0),
        diaria: Array.from(diaria, (v) => v ?? 0),
      };
    }
    return out;
  } catch (e) {
    return motivoDe(e);
  }
}

/** Tiendas (clientes mayoristas) cuya PRIMERA compra de cualquier marca es de este mes. */
async function leerTiendasNuevas(r: Rango): Promise<number | string> {
  try {
    const [fila] = await query<{ nuevas: string }>(
      `select count(*) as nuevas from (
         select cliente from gold.fact_ventas
          where canal = $1 and precio_neto * cantidad > 0 and not ${SQL_ES_CANJE()}
          group by cliente
         having min(fecha) between $2::date and $3::date) t`,
      [CANAL_MAYORISTA, r.desde, r.hasta],
    );
    return Number(fila?.nuevas ?? 0);
  } catch (e) {
    return motivoDe(e);
  }
}

/**
 * LA TIENDA DE UNIBRANDCO SÍ TIENE API: la lee el orquestador
 * (tablero_quo/tiendanube.py) y llega a gold.fact_ventas con canal
 * 'Tienda Nube', igual que la ve la página Venta minorista → Tienda Nube.
 * Las otras tres tiendas no tienen el plan Escala y van por el importador.
 *
 * gold.fact_ventas tiene una fila por PRODUCTO y ya viene filtrada por el
 * criterio de venta (pagado y no cancelado), así que acá no se vuelve a
 * decidir. `total_linea` es con IVA, igual que el total del CSV importado.
 * El cliente es el nombre del comprador: alcanza para nuevo vs. recurrente.
 */
async function leerUnibrandcoApi(r: Rango): Promise<DatosTiendaNube | null> {
  const CANAL_TN = "Tienda Nube";
  const [dias, cupones, clientes, historia, ultimo] = await Promise.all([
    query<{ dia: number; venta: string; pedidos: string }>(
      `select (fecha - $2::date) + 1 as dia, sum(total_linea) as venta,
              count(distinct nro_orden) as pedidos
         from gold.fact_ventas where canal = $1 and fecha between $2::date and $3::date
        group by 1`,
      [CANAL_TN, r.desde, r.hasta],
    ),
    query<{ cupon: string; pedidos: string; venta: string }>(
      `select upper(cupon) as cupon, count(distinct nro_orden) as pedidos, sum(total_linea) as venta
         from gold.fact_ventas
        where canal = $1 and fecha between $2::date and $3::date and cupon is not null and cupon <> ''
        group by 1 order by 3 desc`,
      [CANAL_TN, r.desde, r.hasta],
    ),
    query<{ nuevos: string; recurrentes: string }>(
      `with primera as (
         select cliente, min(fecha) as primera from gold.fact_ventas
          where canal = $1 and cliente is not null group by 1)
       select count(distinct f.cliente) filter (where p.primera >= $2::date) as nuevos,
              count(distinct f.cliente) filter (where p.primera <  $2::date) as recurrentes
         from gold.fact_ventas f join primera p using (cliente)
        where f.canal = $1 and f.fecha between $2::date and $3::date`,
      [CANAL_TN, r.desde, r.hasta],
    ),
    query<{ mes: string; venta: string }>(
      `select to_char(date_trunc('month', fecha), 'YYYY-MM') as mes, sum(total_linea) as venta
         from gold.fact_ventas
        where canal = $1 and fecha between date_trunc('month', $2::date) - interval '3 months' and $2::date
        group by 1`,
      [CANAL_TN, r.hasta],
    ),
    query<{ ultimo: string | null }>(
      `select max(fecha)::text as ultimo from gold.fact_ventas where canal = $1`,
      [CANAL_TN],
    ),
  ]);
  if (!ultimo[0]?.ultimo) return null;
  const diaria: number[] = [];
  for (const x of dias) diaria[x.dia - 1] = Number(x.venta);
  return {
    origen: "api",
    venta: dias.reduce((s, x) => s + Number(x.venta), 0),
    pedidos: dias.reduce((s, x) => s + Number(x.pedidos), 0),
    diaria: Array.from(diaria, (v) => v ?? 0),
    cupones: cupones.map((x) => ({ cupon: x.cupon, pedidos: Number(x.pedidos), venta: Number(x.venta) })),
    clientesNuevos: Number(clientes[0]?.nuevos ?? 0),
    clientesRecurrentes: Number(clientes[0]?.recurrentes ?? 0),
    historia: historia.map((x) => ({ mes: x.mes, venta: Number(x.venta) })),
    // gold.fact_ventas no guarda la provincia del pedido de Tienda Nube.
    provincias: [],
    ultimoPedido: new Date(`${ultimo[0].ultimo}T12:00:00-03:00`).toISOString(),
    ultimaImportacion: new Date().toISOString(),
  };
}

/** `hasta` es el último día CON DATOS: hoy si el período sigue abierto. */
export async function leerVentaReal(r: Rango): Promise<DatosVentaReal> {
  const [importado, mayorista, tiendasNuevas, unibrandco, meli] = await Promise.all([
    leerTiendaNube(r),
    leerMayorista(r),
    leerTiendasNuevas(r),
    leerUnibrandcoApi(r).catch((e: unknown) => {
      console.error("[marketing] Unibrandco API", e);
      return null;
    }),
    leerMercadoLibre(r),
  ]);
  // Unibrandco por API pisa a un CSV que se haya importado de esa tienda.
  // Si la tabla del importador falla, Unibrandco igual se ve: es otra fuente.
  const porMarca = typeof importado === "string" ? {} : { ...importado };
  if (unibrandco) porMarca.unibrandco = unibrandco;
  return {
    tiendaNube: {
      motivo: typeof importado === "string" ? importado : undefined,
      porMarca,
    },
    mayorista: typeof mayorista === "string" ? { motivo: mayorista, porMarca: {} } : { porMarca: mayorista },
    mercadoLibre: typeof meli === "string" ? { motivo: meli, porMarca: {} } : { porMarca: meli },
    tiendasNuevas: typeof tiendasNuevas === "string" ? { motivo: tiendasNuevas, cantidad: null } : { cantidad: tiendasNuevas },
  };
}
