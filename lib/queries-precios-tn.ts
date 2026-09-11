import { query, queryOne } from "@/lib/db";
import { DIFERENCIA_MINIMA_VISIBLE, type ClaveAlerta } from "@/lib/precios-tn";
import type { FilaPrecioTn, ResumenPreciosTn } from "@/lib/types";

/**
 * Consultas de "Precios TN — Comparador".
 *
 * FUENTE: el schema `precios`, que llena el proyecto
 * github.com/valeriabrandmark/precios. Este tablero LEE de ahí y lo único que
 * escribe es el estado de una propuesta (aprobada / rechazada). No calcula
 * precios ni pisos: eso ya se decidió, con sus motivos, en la corrida.
 *
 * SIEMPRE LA ÚLTIMA CORRIDA. Una propuesta vieja se decidió contra precios de
 * la competencia que ya cambiaron y contra un costo que puede no ser el de
 * hoy; aprobarla sería aplicar una conclusión vencida.
 */

/** La corrida de propuestas más reciente que haya terminado bien. */
const ULTIMA_CORRIDA = `
  select id from precios.corrida
   where tipo = 'propuesta' and estado = 'ok'
   order by id desc limit 1
`;

/**
 * En qué grupo de alerta cae cada propuesta.
 *
 * El orden de los `when` ES la prioridad: una propuesta que está bajo el piso
 * Y además cara entra como "bajo el piso", que es lo más grave. Se evalúa de
 * arriba hacia abajo y la primera que da verdadera gana.
 */
const CLASIFICACION = `
  case
    when p.accion = 'omitir' and p.motivos::text like '%competencia insuficiente%'
      then 'sin_competencia'
    when p.precio_actual < p.piso and p.referencia_competencia < p.piso
      then 'no_competible'
    when p.precio_actual < p.piso
      then 'bajo_piso'
    when p.referencia_competencia is not null and p.precio_actual > p.referencia_competencia
      then 'caros'
    when p.referencia_competencia is not null and p.precio_actual < p.referencia_competencia
      then 'baratos'
  end
`;

/** Cuántos hay en cada grupo, para las tarjetas de arriba. */
export async function getResumenPreciosTn(): Promise<ResumenPreciosTn> {
  const corrida = await queryOne<{ id: number }>(ULTIMA_CORRIDA, []);
  if (!corrida) {
    return { corridaId: null, corridaFecha: null, grupos: {}, pendientes: 0, decididas: 0 };
  }

  const fecha = await queryOne<{ arrancada_en: string }>(
    `select arrancada_en from precios.corrida where id = $1`,
    [corrida.id],
  );

  const grupos = await query<{ grupo: ClaveAlerta; total: number }>(
    `select ${CLASIFICACION} as grupo, count(*)::int as total
       from precios.propuesta p
      where p.corrida_id = $1 and ${CLASIFICACION} is not null
      group by 1`,
    [corrida.id],
  );

  const estados = await query<{ estado: string; total: number }>(
    `select estado, count(*)::int as total
       from precios.propuesta where corrida_id = $1 group by 1`,
    [corrida.id],
  );

  const porEstado = Object.fromEntries(estados.map((e) => [e.estado, e.total]));
  return {
    corridaId: corrida.id,
    corridaFecha: fecha?.arrancada_en ?? null,
    grupos: Object.fromEntries(grupos.map((g) => [g.grupo, g.total])),
    pendientes: porEstado.pendiente ?? 0,
    decididas: (porEstado.aprobada ?? 0) + (porEstado.rechazada ?? 0) + (porEstado.aplicada ?? 0),
  };
}

/**
 * La cola de trabajo, ordenada por la diferencia más grande primero.
 *
 * Se ordena por el VALOR ABSOLUTO de la diferencia contra la competencia y no
 * por el porcentaje del cambio propuesto: lo que importa priorizar es cuánto
 * nos separa del mercado, no cuánto alcanzó a corregir el motor dentro de su
 * banda. Un producto 60 % caro que la banda sólo deja bajar 10 % tiene que
 * salir primero, no décimo.
 */
export async function getFilasPreciosTn(
  grupo: ClaveAlerta | null,
  limite = 200,
): Promise<FilaPrecioTn[]> {
  const corrida = await queryOne<{ id: number }>(ULTIMA_CORRIDA, []);
  if (!corrida) return [];

  const params: unknown[] = [corrida.id, DIFERENCIA_MINIMA_VISIBLE, limite];
  let filtroGrupo = "";
  if (grupo) {
    params.push(grupo);
    filtroGrupo = `and ${CLASIFICACION} = $4`;
  }

  return query<FilaPrecioTn>(
    `select p.id,
            p.sku,
            coalesce(a.descripcion, p.sku)                 as descripcion,
            coalesce(a.marca, a."attributes.marca")        as marca,
            p.accion,
            p.estado,
            p.precio_actual::float8                        as "precioActual",
            p.precio_propuesto::float8                     as "precioPropuesto",
            p.piso::float8                                 as piso,
            p.referencia_competencia::float8               as "mejorCompetencia",
            -- La diferencia contra el mercado, que es lo que ordena la cola.
            case when p.referencia_competencia > 0
                 then ((p.precio_actual - p.referencia_competencia) / p.referencia_competencia)::float8
            end                                            as "difMercado",
            ${CLASIFICACION}                               as grupo,
            p.motivos                                      as motivos,
            -- Los competidores, con su precio y su LINK: quien aprueba tiene
            -- que poder abrir la ficha del otro y mirarla con sus propios ojos.
            coalesce(p.entradas->'observaciones', '[]'::jsonb) as competidores,
            (p.entradas->>'stock')::float8                 as stock,
            (p.entradas->>'costo')::float8                 as costo
       from precios.propuesta p
       left join bronze.sigma_articulos a on a.id = p.sku
      where p.corrida_id = $1
        and ${CLASIFICACION} is not null
        -- Lo que está a menos del umbral no es cola de trabajo, es ruido.
        and (p.referencia_competencia is null
             or abs(p.precio_actual - p.referencia_competencia) / p.referencia_competencia >= $2)
        ${filtroGrupo}
      order by
        -- Los pendientes primero: lo ya decidido no vuelve a la cola.
        (p.estado = 'pendiente') desc,
        abs(coalesce(p.precio_actual - p.referencia_competencia, 0)) / nullif(p.referencia_competencia, 0) desc nulls last
      limit $3`,
    params,
  );
}

/**
 * Aprobar o rechazar. Lo ÚNICO que esta aplicación escribe.
 *
 * Guarda quién y cuándo, y sólo toca filas que sigan `pendiente`: si dos
 * personas abren la pantalla a la vez, la segunda no pisa la decisión de la
 * primera sin enterarse -- devuelve 0 filas y la pantalla lo dice.
 */
export async function decidirPropuesta(
  id: number,
  decision: "aprobada" | "rechazada",
  quien: string,
): Promise<boolean> {
  const filas = await query<{ id: number }>(
    `update precios.propuesta
        set estado = $2, decidida_por = $3, decidida_en = now()
      where id = $1 and estado = 'pendiente'
      returning id`,
    [id, decision, quien],
  );
  return filas.length > 0;
}
