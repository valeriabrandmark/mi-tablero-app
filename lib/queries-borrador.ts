import { DIAS_DE_VIDA_BORRADOR } from "@/lib/compras";
import { query, queryOne } from "@/lib/db";

/**
 * El borrador de una orden de compra a medio armar.
 *
 * ---------------------------------------------------------------------------
 * POR QUÉ EXISTE
 *
 * Una orden se arma en la pantalla y no existe en ningún lado hasta que se baja
 * el archivo. El encargado de compras estaba armando una, le dio sin querer a
 * recargar y perdió todo.
 *
 * ---------------------------------------------------------------------------
 * SE GUARDAN LAS DECISIONES, NO LA ORDEN
 *
 * `renglones` es sólo lo que la persona TOCÓ. Todo lo demás --el sugerido de
 * cada artículo, el costo, la oferta del mes-- se recalcula al abrir.
 *
 * Es la decisión más importante del diseño. Un borrador del viernes abierto el
 * lunes muestra los sugeridos del LUNES con las decisiones del viernes encima;
 * guardando la orden entera mostraría números de hace tres días y nadie se
 * enteraría.
 *
 * ---------------------------------------------------------------------------
 * TRES DÍAS
 *
 * El corte se aplica ACÁ, al leer, y no sólo en la limpieza nocturna: así un
 * borrador vencido no aparece ni aunque la limpieza no haya corrido. La
 * limpieza es sólo para que la tabla no junte filas muertas.
 */

// `DIAS_DE_VIDA_BORRADOR` vive en lib/compras.ts, que es client-safe: la
// pantalla también lo dice en voz alta ("se guardan 3 días") y este archivo
// importa el driver de la base.

/** Una decisión sobre un artículo. Es `RenglonOrden` del lado del navegador. */
export type RenglonBorrador = {
  unidad: string;
  cantidad: number;
  descuento: number;
  descuento2: number;
};

export type Borrador = {
  proveedor: string;
  actualizadoEn: string;
  mes: string | null;
  ventana: number | null;
  cobertura: number | null;
  nota: string | null;
  /** Sólo lo tocado, por SKU. */
  renglones: Record<string, RenglonBorrador>;
  /** El sugerido de cada SKU cuando se guardó, para poder avisar si cambió. */
  sugeridos: Record<string, number>;
};

/**
 * El borrador de esa persona para ese proveedor, o `null`.
 *
 * Devuelve null también cuando venció: para quien llama, un borrador de hace
 * cuatro días y uno que no existe son lo mismo.
 */
export async function getBorrador(
  usuario: string,
  proveedor: string,
): Promise<Borrador | null> {
  const fila = await queryOne<{
    proveedor: string;
    actualizado_en: string;
    mes: string | null;
    ventana: number | null;
    cobertura: number | null;
    nota: string | null;
    renglones: Record<string, RenglonBorrador> | null;
    sugeridos: Record<string, number> | null;
  }>(
    `select proveedor,
            to_char(actualizado_en at time zone 'America/Argentina/Buenos_Aires',
                    'DD/MM/YYYY HH24:MI')  as actualizado_en,
            mes, ventana, cobertura, nota, renglones, sugeridos
       from app.ordenes_compra_borrador
      where usuario = $1
        and proveedor = $2
        and actualizado_en > now() - ($3 || ' days')::interval`,
    [usuario, proveedor, String(DIAS_DE_VIDA_BORRADOR)],
  );

  if (!fila) return null;

  return {
    proveedor: fila.proveedor,
    actualizadoEn: fila.actualizado_en,
    mes: fila.mes,
    ventana: fila.ventana,
    cobertura: fila.cobertura,
    nota: fila.nota,
    renglones: fila.renglones ?? {},
    sugeridos: fila.sugeridos ?? {},
  };
}

/**
 * Guarda o pisa el borrador. Uno por persona y por proveedor.
 *
 * `actualizado_en` se mueve en cada guardado, así que los tres días se cuentan
 * desde la última vez que se tocó y no desde que se empezó: un borrador que se
 * sigue trabajando no vence en el medio.
 */
export async function guardarBorrador(
  usuario: string,
  b: Omit<Borrador, "actualizadoEn">,
): Promise<void> {
  await query(
    `insert into app.ordenes_compra_borrador
       (usuario, proveedor, mes, ventana, cobertura, nota, renglones, sugeridos)
     values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb)
     on conflict (usuario, proveedor) do update
        set mes            = excluded.mes,
            ventana        = excluded.ventana,
            cobertura      = excluded.cobertura,
            nota           = excluded.nota,
            renglones      = excluded.renglones,
            sugeridos      = excluded.sugeridos,
            actualizado_en = now()`,
    [
      usuario,
      b.proveedor,
      b.mes,
      b.ventana,
      b.cobertura,
      b.nota,
      JSON.stringify(b.renglones),
      JSON.stringify(b.sugeridos),
    ],
  );
}

/** Lo descarta. Se llama al mandar la orden y desde el botón de descartar. */
export async function borrarBorrador(
  usuario: string,
  proveedor: string,
): Promise<void> {
  await query(
    `delete from app.ordenes_compra_borrador
      where usuario = $1 and proveedor = $2`,
    [usuario, proveedor],
  );
}

/**
 * Los proveedores con borrador vigente de esa persona, del más nuevo al más
 * viejo. Es lo que deja avisar "tenés una orden a medio armar" sin que haya que
 * acordarse de qué proveedor era.
 */
export async function getBorradoresVigentes(
  usuario: string,
): Promise<{ proveedor: string; actualizadoEn: string; renglones: number }[]> {
  return query<{ proveedor: string; actualizadoEn: string; renglones: number }>(
    `select proveedor,
            to_char(actualizado_en at time zone 'America/Argentina/Buenos_Aires',
                    'DD/MM/YYYY HH24:MI')            as "actualizadoEn",
            -- Los renglones que CUENTAN son los que tienen cantidad: un
            -- borrador donde sólo se vaciaron cosas no es trabajo a medio
            -- hacer, es una orden que se decidió no hacer.
            (select count(*)
               from jsonb_each(renglones) r
              where (r.value->>'cantidad')::numeric > 0)::int as renglones
       from app.ordenes_compra_borrador
      where usuario = $1
        and actualizado_en > now() - ($2 || ' days')::interval
      order by actualizado_en desc`,
    [usuario, String(DIAS_DE_VIDA_BORRADOR)],
  );
}
