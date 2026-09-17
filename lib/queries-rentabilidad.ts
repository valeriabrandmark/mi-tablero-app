import { query, queryOne } from "@/lib/db";
import type { FilaRentabilidad, ProveedorRentabilidad, ResumenRentabilidad } from "@/lib/types";

/**
 * Rentabilidad y markup por proveedor.
 *
 * ---------------------------------------------------------------------------
 * POR QUÉ EXISTE ESTA PANTALLA.
 *
 * Compras quiere saber cuánto markup ponerle a cada proveedor. La objeción a
 * eso es que sin precio competitivo no se vende. Las dos cosas son ciertas, y
 * no se contradicen: son dos columnas de la misma tabla.
 *
 *   markup necesario   lo que hay que sumarle al costo para el margen mínimo,
 *                      contando el flete y las cuotas
 *   markup de mercado  lo que el mercado permite sumarle sin salirse de precio
 *
 * Donde el de mercado es MENOR que el necesario, ese proveedor no da. Y ahí la
 * conversación deja de ser "poné más markup" —que no se puede— y pasa a ser
 * "renegociamos el costo o lo sacamos", que tiene respuesta.
 *
 * NO CALCULA NADA. Los tres markups los guarda el motor por propuesta, con la
 * misma función con la que despeja el piso. Recalcularlos acá sería una segunda
 * implementación de la cuenta, y el día que una cambie esta pantalla mostraría
 * un markup que el motor nunca usó. Es la misma regla que ya rige para los
 * márgenes en `queries-precios-tn.ts`.
 * ---------------------------------------------------------------------------
 */

/** La misma corrida que mira el comparador: la última que terminó bien. */
const ULTIMA_CORRIDA = `
  select id from precios.corrida
   where tipo = 'propuesta' and estado = 'ok'
   order by id desc limit 1
`;

/**
 * Las filas con las que se puede hacer esta cuenta, y sólo ésas.
 *
 * SIN COSTO NO HAY MARKUP, y sin competencia no hay "lo que permite el
 * mercado". Un artículo al que le falte cualquiera de los dos no se puede
 * evaluar acá, y meterlo con ceros arrastraría los promedios del proveedor
 * hacia abajo inventando un problema que no existe.
 *
 * Los artículos SIN STOCK sí entran: la pregunta de compras es a cuánto
 * comprar y a cuánto marcar, no qué reponer. Un artículo agotado sigue
 * diciendo algo sobre el markup de su proveedor.
 */
const CUERPO = `
  from precios.propuesta p
  left join bronze.sigma_articulos a on a.id = p.sku
 where p.corrida_id = $1
   and (p.entradas->>'markup_actual') is not null
   and (p.entradas->>'markup_necesario') is not null
   and (p.entradas->>'markup_mercado') is not null
`;

export async function getResumenRentabilidad(): Promise<ResumenRentabilidad | null> {
  const corrida = await queryOne<{ id: number }>(ULTIMA_CORRIDA, []);
  if (!corrida) return null;

  // DE DÓNDE SALEN EL FLETE Y LAS CUOTAS, para poder decirlo en pantalla.
  //
  // Se vuelven a medir acá en vez de leerlos de la propuesta porque son un
  // dato del negocio y no de un artículo: guardarlos 3.788 veces sería repetir
  // el mismo número en cada fila. La cuenta es la misma que usa el motor.
  const eco = await queryOne<{
    pedidos: number;
    flete_pct: number;
    parte_en_cuotas: number;
  }>(
    `select count(*)::int as pedidos,
            coalesce(sum(coalesce(shipping_cost_owner::numeric, 0)
                       - coalesce(shipping_cost_customer::numeric, 0))
                     / nullif(sum(total::numeric), 0), 0)::float8 as flete_pct,
            coalesce(sum(total::numeric)
                       filter (where coalesce("payment_details.installments", 1) > 1)
                     / nullif(sum(total::numeric), 0), 0)::float8 as parte_en_cuotas
       from bronze.tn_pedidos
      where total is not null and status is distinct from 'cancelled'`,
    [],
  );

  const totales = await queryOne<{
    articulos: number;
    proveedores: number;
    no_dan: number;
  }>(
    `select count(*)::int as articulos,
            count(distinct a."proveedorNombre")::int as proveedores,
            count(*) filter (
              where (p.entradas->>'markup_mercado')::numeric
                  < (p.entradas->>'markup_necesario')::numeric
            )::int as no_dan
       ${CUERPO}`,
    [corrida.id],
  );

  return {
    corridaId: corrida.id,
    articulos: totales?.articulos ?? 0,
    proveedores: totales?.proveedores ?? 0,
    noDan: totales?.no_dan ?? 0,
    // El costo de ofrecer cuotas. No sale de ninguna tabla --lo pone el
    // acuerdo con la pasarela-- así que se repite el número que usa el motor.
    // Si algún día cambia, cambia en los dos lados o la pantalla miente.
    fletePct: eco?.flete_pct ?? 0,
    cuotasPct: (eco?.parte_en_cuotas ?? 0) * 0.103,
    parteEnCuotas: eco?.parte_en_cuotas ?? 0,
    pedidosMedidos: eco?.pedidos ?? 0,
  };
}

/**
 * Un renglón por proveedor.
 *
 * LA MEDIANA Y NO EL PROMEDIO. Un solo artículo con markup del 900% --un
 * costo mal cargado, un pack comparado contra una unidad-- mueve el promedio
 * de un proveedor entero y hace que parezca sano cuando no lo está. La mediana
 * dice "el artículo del medio", que es lo que alguien quiere saber cuando
 * pregunta "cómo viene este proveedor".
 */
export async function getProveedoresRentabilidad(): Promise<ProveedorRentabilidad[]> {
  const corrida = await queryOne<{ id: number }>(ULTIMA_CORRIDA, []);
  if (!corrida) return [];

  return query<ProveedorRentabilidad>(
    `select coalesce(a."proveedorNombre", 'sin proveedor')   as proveedor,
            count(*)::int                                    as articulos,
            percentile_cont(0.5) within group (
              order by (p.entradas->>'markup_actual')::numeric
            )::float8                                        as "markupActual",
            percentile_cont(0.5) within group (
              order by (p.entradas->>'markup_necesario')::numeric
            )::float8                                        as "markupNecesario",
            percentile_cont(0.5) within group (
              order by (p.entradas->>'markup_mercado')::numeric
            )::float8                                        as "markupMercado",
            percentile_cont(0.5) within group (
              order by (p.entradas->>'margen_completo')::numeric
            )::float8                                        as "margenCompleto",
            count(*) filter (
              where (p.entradas->>'markup_mercado')::numeric
                  < (p.entradas->>'markup_necesario')::numeric
            )::int                                           as "noDan"
       ${CUERPO}
      group by 1
      -- LOS PEORES PRIMERO: el proveedor donde más artículos no llegan es el
      -- que hay que ir a renegociar, y tiene que estar arriba sin que nadie
      -- ordene la tabla.
      order by "noDan" desc, articulos desc`,
    [corrida.id],
  );
}

/** El detalle de un proveedor, para cuando el número de arriba no alcanza. */
export async function getArticulosRentabilidad(
  proveedor: string,
  limite = 300,
): Promise<FilaRentabilidad[]> {
  const corrida = await queryOne<{ id: number }>(ULTIMA_CORRIDA, []);
  if (!corrida) return [];

  return query<FilaRentabilidad>(
    `select p.sku,
            coalesce(a.descripcion, p.sku)                   as descripcion,
            coalesce(a.marca, a."attributes.marca")          as marca,
            (p.entradas->>'costo')::float8                   as costo,
            p.precio_actual::float8                          as "precioActual",
            p.referencia_competencia::float8                 as "mejorCompetencia",
            (p.entradas->>'markup_actual')::float8           as "markupActual",
            (p.entradas->>'markup_necesario')::float8        as "markupNecesario",
            (p.entradas->>'markup_mercado')::float8          as "markupMercado",
            (p.entradas->>'margen_completo')::float8         as "margenCompleto"
       ${CUERPO}
        and coalesce(a."proveedorNombre", 'sin proveedor') = $2
      -- El que más lejos está de poder cumplir, primero.
      order by (p.entradas->>'markup_mercado')::numeric
             - (p.entradas->>'markup_necesario')::numeric asc
      limit $3`,
    [corrida.id, proveedor, limite],
  );
}
