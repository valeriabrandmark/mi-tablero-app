import { query, queryOne } from "@/lib/db";
import type { FilaPvp } from "@/lib/pvp";

/**
 * Los PVP de las marcas que importamos: la planilla que se baja y la que vuelve.
 *
 * ---------------------------------------------------------------------------
 * QUÉ MARCAS. Las que tienen `repreciar = false` en `precios.politica`, que
 * hoy son HOLA, DIAPER GENIE y SUAVINEX. NO van escritas acá: se leen de la
 * política, que es donde se decidieron y donde van a cambiar. Una lista
 * repetida en el tablero sería una segunda fuente de verdad que nadie se
 * acuerda de actualizar el día que se agregue una marca.
 * ---------------------------------------------------------------------------
 */

export type FilaPlanillaPvp = {
  sku: string;
  nombre: string;
  marca: string | null;
  precio: number | null;
  oferta: number | null;
};

export type LotePvp = {
  id: number;
  nombre: string;
  filas: number;
  cargadoPor: string | null;
  cargadoEn: string;
};

/**
 * Lo que va en el CSV que se baja: un renglón por artículo de marca propia.
 *
 * EL PRECIO SALE DE `precio_propio` Y NO DE LA ÚLTIMA PROPUESTA. Es la foto
 * diaria de lo que Tienda Nube tiene puesto, cubre 4.399 SKU contra 3.829 de
 * la corrida, y sobre todo: para estas marcas el motor OMITE, así que la
 * propuesta de un SUAVINEX no lleva precio propuesto. La pregunta que
 * contesta esta planilla es "qué precio tiene hoy", y eso es `precio_propio`.
 */
export async function getFilasParaPvp(): Promise<FilaPlanillaPvp[]> {
  return query<FilaPlanillaPvp>(
    `with congeladas as (
         select distinct clave as marca
           from precios.politica
          where ambito = 'marca'
            and (hasta is null or hasta >= current_date)
            and desde <= current_date
            and parametros->>'repreciar' = 'false'
     ),
     ultimo_precio as (
         -- EL PRECIO DE LISTA, NO EL VIGENTE, y la diferencia importa desde
         -- que el PVP es el precio de lista. precio_vigente es lo que se
         -- cobra hoy: con una promo puesta, es el precio YA con descuento.
         -- Exportar eso como PVP y volver a subirlo aplicaria el descuento
         -- dos veces, y cada vuelta lo aplicaria de nuevo.
         --
         -- Hoy no se nota porque ningun SUAVINEX tiene promo. Se nota la
         -- primera vez que una se publique, que es justamente lo que este
         -- cambio viene a hacer.
         select distinct on (sku) sku, coalesce(precio_lista, precio_vigente) as precio
           from precios.precio_propio
          where sku is not null
          order by sku, dia desc, id desc
     ),
     ultimo_pvp as (
         select distinct on (sku) sku, oferta_pct
           from precios.pvp
          order by sku, lote_id desc, id desc
     )
     select a.id                                     as sku,
            coalesce(a.descripcion, a.id)            as nombre,
            coalesce(a.marca, a."attributes.marca")  as marca,
            up.precio::float8                        as precio,
            pv.oferta_pct::float8                    as oferta
       from bronze.sigma_articulos a
       join congeladas c
         on c.marca = coalesce(a.marca, a."attributes.marca")
       left join ultimo_precio up on up.sku = a.id
       left join ultimo_pvp     pv on pv.sku = a.id
      where (a.desactivado is null or a.desactivado = 'false')
        and (a.suspendido  is null or a.suspendido  = 'false')
      order by coalesce(a.marca, a."attributes.marca"), a.id`,
  );
}

/**
 * Guarda la planilla subida: el lote y sus filas, en UNA sentencia.
 *
 * ES UN SOLO `with` Y NO DOS QUERIES porque no hay helper de transacción en
 * `lib/db`. Partido en dos, una caída entre medio dejaría un lote registrado
 * con cero filas —una carga que el historial muestra como hecha y que no
 * cambió ningún precio—. Postgres corre una sentencia entera o ninguna.
 */
export async function guardarLotePvp(
  nombre: string,
  csv: string,
  filas: FilaPvp[],
  cargadoPor: string | null,
): Promise<{ id: number; filas: number }> {
  const fila = await queryOne<{ id: number; filas: number }>(
    `with lote as (
         insert into precios.pvp_lote (nombre, csv, filas, cargado_por)
         values ($1, $2, $3, $4)
         returning id
     ),
     puestas as (
         insert into precios.pvp (lote_id, sku, precio, oferta_pct, fila)
         select lote.id, d.sku, d.precio, d.oferta, d.fila
           from lote,
                unnest($5::text[], $6::numeric[], $7::numeric[], $8::int[])
                  as d(sku, precio, oferta, fila)
         returning 1
     )
     select (select id from lote) as id,
            (select count(*) from puestas)::int as filas`,
    [
      nombre,
      csv,
      filas.length,
      cargadoPor,
      filas.map((f) => f.sku),
      filas.map((f) => f.precio),
      filas.map((f) => f.oferta),
      filas.map((f) => f.fila),
    ],
  );
  return fila ?? { id: 0, filas: 0 };
}

/** Las planillas que se fueron subiendo, de la más nueva a la más vieja. */
export async function getLotesPvp(limite = 20): Promise<LotePvp[]> {
  return query<LotePvp>(
    `select id,
            nombre,
            filas,
            cargado_por as "cargadoPor",
            cargado_en  as "cargadoEn"
       from precios.pvp_lote
      order by cargado_en desc, id desc
      limit $1`,
    [limite],
  );
}

/** El archivo crudo de una carga, tal como se subió. */
export async function getCsvDeLote(id: number): Promise<{ nombre: string; csv: string } | null> {
  return queryOne<{ nombre: string; csv: string }>(
    `select nombre, csv from precios.pvp_lote where id = $1`,
    [id],
  );
}
