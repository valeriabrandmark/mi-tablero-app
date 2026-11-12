import { query } from "@/lib/db";
import { CANAL_MAYORISTA } from "@/lib/constantes";
import type { ClaveMarca } from "@/lib/marketing-demo";
import type { DatosMayorista, DatosTiendaNube, DatosVentaReal } from "@/lib/marketing-fuentes";

/**
 * Lo que el Tablero de Marca lee de la base: los pedidos de Tienda Nube que se
 * importaron a mano y la venta mayorista por marca que ya viene de SIGMA.
 *
 * Todo es del MES CALENDARIO en curso, en hora argentina: las metas del
 * acuerdo de rol son por mes ("$17MM/mes"), no por mes comercial.
 *
 * Si una consulta falla (sin base en local, tabla sin crear), esa parte vuelve
 * `null` y la pantalla muestra el ejemplo con el motivo. No se tapa el error
 * con un cero: un cero se lee como "no se vendió nada".
 */

const TZ = "America/Argentina/Buenos_Aires";
const INICIO_MES = `date_trunc('month', now() at time zone '${TZ}')::date`;

/**
 * Cómo aparece cada marca en `gold.fact_ventas.marca` (lo que carga SIGMA).
 * Unibrandco no va: es la tienda multimarca, no una marca que se venda a
 * tiendas con ese nombre.
 */
const PATRON_MARCA_SIGMA: Partial<Record<ClaveMarca, string>> = {
  diaper_genie: "%DIAPER%GENIE%",
  hola_toys: "%HOLA%TOYS%",
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

async function leerTiendaNube(): Promise<Partial<Record<ClaveMarca, DatosTiendaNube>> | string> {
  try {
    const [dias, cupones, clientes, historia, ultima, provincias] = await Promise.all([
      query<{ marca: ClaveMarca; dia: number; venta: string; pedidos: string }>(
        `select marca, extract(day from fecha at time zone '${TZ}')::int as dia,
                sum(total) as venta, count(*) as pedidos
           from bronze.mkt_tn_pedidos
          where es_venta and (fecha at time zone '${TZ}')::date >= ${INICIO_MES}
          group by 1, 2`,
      ),
      query<{ marca: ClaveMarca; cupon: string; pedidos: string; venta: string }>(
        `select marca, upper(cupon) as cupon, count(*) as pedidos, sum(total) as venta
           from bronze.mkt_tn_pedidos
          where es_venta and cupon is not null
            and (fecha at time zone '${TZ}')::date >= ${INICIO_MES}
          group by 1, 2 order by 4 desc`,
      ),
      // Nuevo = su primera compra pagada en esa tienda es de este mes.
      query<{ marca: ClaveMarca; nuevos: string; recurrentes: string }>(
        `with primera as (
           select marca, cliente_hash, min(fecha) as primera
             from bronze.mkt_tn_pedidos
            where es_venta and cliente_hash is not null
            group by 1, 2)
         select p.marca,
                count(distinct p.cliente_hash) filter (where (pr.primera at time zone '${TZ}')::date >= ${INICIO_MES}) as nuevos,
                count(distinct p.cliente_hash) filter (where (pr.primera at time zone '${TZ}')::date <  ${INICIO_MES}) as recurrentes
           from bronze.mkt_tn_pedidos p
           join primera pr using (marca, cliente_hash)
          where p.es_venta and (p.fecha at time zone '${TZ}')::date >= ${INICIO_MES}
          group by 1`,
      ),
      query<{ marca: ClaveMarca; mes: string; venta: string }>(
        `select marca, to_char(date_trunc('month', fecha at time zone '${TZ}'), 'YYYY-MM') as mes,
                sum(total) as venta
           from bronze.mkt_tn_pedidos
          where es_venta and (fecha at time zone '${TZ}')::date >= ${INICIO_MES} - interval '3 months'
          group by 1, 2`,
      ),
      query<{ marca: ClaveMarca; ultimo_pedido: string; ultima_importacion: string }>(
        `select marca, max(fecha) as ultimo_pedido, max(importado_en) as ultima_importacion
           from bronze.mkt_tn_pedidos group by 1`,
      ),
      query<{ marca: ClaveMarca; provincia: string; pedidos: string }>(
        `select marca, coalesce(provincia, 'Sin dato') as provincia, count(*) as pedidos
           from bronze.mkt_tn_pedidos
          where es_venta and (fecha at time zone '${TZ}')::date >= ${INICIO_MES}
          group by 1, 2`,
      ),
    ]);

    const out: Partial<Record<ClaveMarca, DatosTiendaNube>> = {};
    for (const u of ultima) {
      const d = dias.filter((x) => x.marca === u.marca);
      const diaria: number[] = [];
      for (const x of d) diaria[x.dia - 1] = Number(x.venta);
      const c = clientes.find((x) => x.marca === u.marca);
      out[u.marca] = {
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

async function leerMayorista(): Promise<Partial<Record<ClaveMarca, DatosMayorista>> | string> {
  const marcas = Object.entries(PATRON_MARCA_SIGMA) as [ClaveMarca, string][];
  try {
    const [dias, historia, tiendas] = await Promise.all([
      query<{ clave: ClaveMarca; dia: number; venta: string }>(
        `select m.clave, extract(day from fv.fecha)::int as dia,
                sum(fv.precio_neto * fv.cantidad)::numeric as venta
           from gold.fact_ventas fv
           join unnest($2::text[], $3::text[]) as m(clave, patron)
             on upper(fv.marca) like m.patron
          where fv.canal = $1 and fv.fecha >= ${INICIO_MES}
          group by 1, 2`,
        [CANAL_MAYORISTA, marcas.map(([k]) => k), marcas.map(([, p]) => p)],
      ),
      query<{ clave: ClaveMarca; mes: string; venta: string }>(
        `select m.clave, to_char(date_trunc('month', fv.fecha), 'YYYY-MM') as mes,
                sum(fv.precio_neto * fv.cantidad)::numeric as venta
           from gold.fact_ventas fv
           join unnest($2::text[], $3::text[]) as m(clave, patron)
             on upper(fv.marca) like m.patron
          where fv.canal = $1 and fv.fecha >= ${INICIO_MES} - interval '3 months'
          group by 1, 2`,
        [CANAL_MAYORISTA, marcas.map(([k]) => k), marcas.map(([, p]) => p)],
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
            group by 1, 2)
         select clave, count(*) filter (where primera >= ${INICIO_MES}) as nuevas
           from primera group by 1`,
        [CANAL_MAYORISTA, marcas.map(([k]) => k), marcas.map(([, p]) => p)],
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

/** Tiendas (clientes mayoristas) cuya PRIMERA compra de cualquier marca es de este mes. */
async function leerTiendasNuevas(): Promise<number | string> {
  try {
    const [fila] = await query<{ nuevas: string }>(
      `select count(*) as nuevas from (
         select cliente from gold.fact_ventas
          where canal = $1 and precio_neto * cantidad > 0
          group by cliente
         having min(fecha) >= ${INICIO_MES}) t`,
      [CANAL_MAYORISTA],
    );
    return Number(fila?.nuevas ?? 0);
  } catch (e) {
    return motivoDe(e);
  }
}

export async function leerVentaReal(): Promise<DatosVentaReal> {
  const [tiendaNube, mayorista, tiendasNuevas] = await Promise.all([
    leerTiendaNube(),
    leerMayorista(),
    leerTiendasNuevas(),
  ]);
  return {
    tiendaNube: typeof tiendaNube === "string" ? { motivo: tiendaNube, porMarca: {} } : { porMarca: tiendaNube },
    mayorista: typeof mayorista === "string" ? { motivo: mayorista, porMarca: {} } : { porMarca: mayorista },
    tiendasNuevas: typeof tiendasNuevas === "string" ? { motivo: tiendasNuevas, cantidad: null } : { cantidad: tiendasNuevas },
  };
}
