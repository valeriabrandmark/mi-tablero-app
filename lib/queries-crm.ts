/**
 * Pantalla "Posventa" — reclamos, mediaciones, mensajes y preguntas de
 * Mercado Libre en un solo lugar.
 *
 * DE DÓNDE SALE. Las cuatro tablas que escribe `ml_crm.py` en el orquestador:
 *
 *   bronze.ml_reclamos           uno por reclamo, abierto o cerrado
 *   bronze.ml_reclamos_mensajes  la conversación de cada reclamo
 *   bronze.ml_mensajes_orden     la charla post-venta de esas órdenes
 *   bronze.ml_preguntas          las preguntas de las publicaciones
 *
 * LAS FECHAS VIENEN COMO TEXTO, no como `timestamptz`. Mercado Libre las
 * manda en ISO con zona ("2026-10-05T10:23:19.000-03:00") y el extractor las
 * guarda tal cual: convertirlas en Python sería adivinar una zona, y acá el
 * `::timestamptz` de Postgres las parsea sin ambigüedad porque el offset
 * viaja en el texto. Por eso cada comparación de fecha castea.
 *
 * "GANAMOS" NO ES LO CONTRARIO DE "PERDIMOS". Hay tres resultados posibles
 * --nosotros, la otra parte, los dos-- más los que todavía no tienen
 * resolución, que en el sondeo eran 15 de 20. Esos NO se cuentan como
 * perdidos en ningún lado: un reclamo sin resolver no es un reclamo perdido,
 * y mezclarlos haría ver un desempeño mucho peor que el real.
 */

import { query, queryOne } from "@/lib/db";

/** Una fila del listado de reclamos. */
export type Reclamo = {
  id: string;
  orden: string | null;
  sitio: string | null;
  estado: string | null;
  etapa: string | null;
  tipo: string | null;
  nuestro_rol: string | null;
  quien_gano: string | null;
  cerrado_por: string | null;
  cobertura_ml: boolean | null;
  fecha_creado: string | null;
  fecha_resolucion: string | null;
  mensajes: number;
  ultimo_mensaje: string | null;
  ultimo_de: string | null;
};

export type Pregunta = {
  id: string;
  publicacion: string | null;
  texto: string | null;
  fecha: string | null;
  respuesta: string | null;
  respuesta_fecha: string | null;
  sin_contestar: boolean | null;
};

export type PuntoResultado = {
  mes: string;
  nosotros: number;
  otra_parte: number;
  los_dos: number;
};

export type PuntoPublicacion = {
  publicacion: string;
  preguntas: number;
  sin_contestar: number;
};

export type ResumenCrm = {
  abiertos: number;
  en_mediacion: number;
  preguntas_sin_contestar: number;
  resueltos: number;
  ganados: number;
};

/**
 * Los reclamos abiertos, el que más esperó primero.
 *
 * El orden NO es por fecha de apertura sino por hace cuánto que no se toca.
 * Es la diferencia entre "qué entró hoy" y "qué se está pudriendo", y lo
 * segundo es lo que hace falta mirar: un reclamo de hace tres días sin
 * contestar es más urgente que uno de hace una hora.
 */
export async function getReclamosAbiertos(): Promise<Reclamo[]> {
  return query<Reclamo>(
    `select r.id, r.orden, r.sitio, r.estado, r.etapa, r.tipo,
            r.nuestro_rol, r.quien_gano, r.cerrado_por, r.cobertura_ml,
            r.fecha_creado, r.fecha_resolucion,
            coalesce(m.cuantos, 0)::int as mensajes,
            m.ultimo as ultimo_mensaje,
            m.ultimo_de
       from bronze.ml_reclamos r
       left join lateral (
         select count(*) as cuantos,
                max(x.fecha) as ultimo,
                (array_agg(x.de order by x.fecha desc nulls last))[1] as ultimo_de
           from bronze.ml_reclamos_mensajes x
          where x.reclamo = r.id
       ) m on true
      where r.estado = 'opened'
      order by coalesce(m.ultimo, r.fecha_creado)::timestamptz asc nulls first`,
  );
}

/**
 * Los cerrados de un rango, el más reciente primero.
 *
 * `limite` existe porque el histórico son 8.431 y la pantalla no los puede
 * pintar todos: sin tope, abrir la pestaña bajaría la tabla entera.
 */
export async function getReclamosCerrados(
  desde: string,
  hasta: string,
  limite = 300,
): Promise<Reclamo[]> {
  return query<Reclamo>(
    `select r.id, r.orden, r.sitio, r.estado, r.etapa, r.tipo,
            r.nuestro_rol, r.quien_gano, r.cerrado_por, r.cobertura_ml,
            r.fecha_creado, r.fecha_resolucion,
            0::int as mensajes, null::text as ultimo_mensaje,
            null::text as ultimo_de
       from bronze.ml_reclamos r
      where r.estado = 'closed'
        and coalesce(r.fecha_resolucion, r.fecha_creado)::timestamptz
            between $1::timestamptz and ($2::timestamptz + interval '1 day')
      order by coalesce(r.fecha_resolucion, r.fecha_creado)::timestamptz desc
      limit $3`,
    [desde, hasta, limite],
  );
}

/**
 * El resultado de los reclamos resueltos, mes a mes.
 *
 * SOLO LOS QUE TIENEN RESOLUCIÓN. Los otros no entran: un reclamo cerrado sin
 * `resolution` no dice a favor de quién salió, y meterlo en alguna de las tres
 * columnas sería inventar el dato que el gráfico viene a mostrar.
 */
export async function getResultadoPorMes(
  desde: string,
  hasta: string,
): Promise<PuntoResultado[]> {
  return query<PuntoResultado>(
    `select to_char(date_trunc('month',
              coalesce(r.fecha_resolucion, r.fecha_creado)::timestamptz), 'YYYY-MM') as mes,
            count(*) filter (where r.quien_gano = 'nosotros')::int      as nosotros,
            count(*) filter (where r.quien_gano = 'la otra parte')::int as otra_parte,
            count(*) filter (where r.quien_gano = 'los dos')::int       as los_dos
       from bronze.ml_reclamos r
      where r.quien_gano is not null
        and coalesce(r.fecha_resolucion, r.fecha_creado)::timestamptz
            between $1::timestamptz and ($2::timestamptz + interval '1 day')
      group by 1
      order by 1`,
    [desde, hasta],
  );
}

/**
 * Las publicaciones que más preguntas reciben.
 *
 * `limite` corta en las primeras: con 2.004 preguntas repartidas en cientos
 * de publicaciones, un gráfico con todas es una mancha. Las que importan son
 * las de arriba --donde algo de la publicación no se entiende-- y esas están
 * en las primeras diez.
 */
export async function getPreguntasPorPublicacion(
  limite = 10,
): Promise<PuntoPublicacion[]> {
  return query<PuntoPublicacion>(
    `select p.publicacion,
            count(*)::int as preguntas,
            count(*) filter (where p.sin_contestar)::int as sin_contestar
       from bronze.ml_preguntas p
      where p.publicacion is not null
      group by 1
      order by 2 desc, 1
      limit $1`,
    [limite],
  );
}

/** Las preguntas sin contestar, la más vieja primero. */
export async function getPreguntasSinContestar(): Promise<Pregunta[]> {
  return query<Pregunta>(
    `select id, publicacion, texto, fecha, respuesta, respuesta_fecha, sin_contestar
       from bronze.ml_preguntas
      where sin_contestar
      order by fecha::timestamptz asc nulls first`,
  );
}

/** Los números de arriba de la pantalla. */
export async function getResumenCrm(): Promise<ResumenCrm> {
  const fila = await queryOne<ResumenCrm>(
    `select
       (select count(*) from bronze.ml_reclamos
         where estado = 'opened')::int as abiertos,
       (select count(*) from bronze.ml_reclamos
         where estado = 'opened' and etapa = 'dispute')::int as en_mediacion,
       (select count(*) from bronze.ml_preguntas
         where sin_contestar)::int as preguntas_sin_contestar,
       (select count(*) from bronze.ml_reclamos
         where quien_gano is not null)::int as resueltos,
       (select count(*) from bronze.ml_reclamos
         where quien_gano = 'nosotros')::int as ganados`,
  );
  return (
    fila ?? {
      abiertos: 0,
      en_mediacion: 0,
      preguntas_sin_contestar: 0,
      resueltos: 0,
      ganados: 0,
    }
  );
}

/** La conversación de un reclamo, para abrirla sin salir del tablero. */
export async function getMensajesDeReclamo(reclamo: string) {
  return query<{ id: string; de: string | null; texto: string | null; fecha: string | null }>(
    `select id, de, texto, fecha
       from bronze.ml_reclamos_mensajes
      where reclamo = $1
      order by fecha::timestamptz asc nulls first`,
    [reclamo],
  );
}
