import { query, queryOne } from "@/lib/db";
import type {
  DatosRecurrencia,
  DatosTarea,
  Estado,
  Recurrencia,
  Tarea,
} from "@/lib/tareas";

/**
 * Lectura y escritura del organizador de tareas (migraciones/tareas.sql).
 *
 * TODO FILTRA POR `usuario`. El organizador es personal: aunque mañana se abra
 * la página a más gente, cada uno ve y toca sólo lo suyo, y eso no depende de
 * que la pantalla mande el id correcto sino de este `where`.
 */

const COLUMNAS_TAREA = `
  id::text, titulo, nota, categoria, prioridad,
  to_char(inicio at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as inicio,
  duracion_min, recordar_min_antes, estado,
  to_char(iniciada_en at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as iniciada_en,
  to_char(hecha_en at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as hecha_en,
  veces_postergada, accion, resultado_accion, recurrencia_id::text`;

type FilaTarea = {
  id: string;
  titulo: string;
  nota: string | null;
  categoria: string | null;
  prioridad: Tarea["prioridad"];
  inicio: string;
  duracion_min: number;
  recordar_min_antes: number;
  estado: Estado;
  iniciada_en: string | null;
  hecha_en: string | null;
  veces_postergada: number;
  accion: string | null;
  resultado_accion: string | null;
  recurrencia_id: string | null;
};

function aTarea(f: FilaTarea): Tarea {
  return {
    id: f.id,
    titulo: f.titulo,
    nota: f.nota,
    categoria: f.categoria,
    prioridad: f.prioridad,
    inicio: f.inicio,
    duracionMin: f.duracion_min,
    recordarMinAntes: f.recordar_min_antes,
    estado: f.estado,
    iniciadaEn: f.iniciada_en,
    hechaEn: f.hecha_en,
    vecesPostergada: f.veces_postergada,
    accion: f.accion,
    resultadoAccion: f.resultado_accion,
    recurrenciaId: f.recurrencia_id,
  };
}

/**
 * Las tareas entre dos instantes, más las abiertas de antes de `desde` (las
 * atrasadas tienen que verse aunque el calendario esté parado en otra semana).
 *
 * Antes de leer se generan las ocurrencias que falten. El cron ya lo hace cada
 * 5 minutos, pero así una regla recién creada aparece en el acto.
 */
export async function listarTareas(
  usuario: string,
  desde: string,
  hasta: string,
): Promise<Tarea[]> {
  await query("select app.generar_tareas()");
  const filas = await query<FilaTarea>(
    `select ${COLUMNAS_TAREA}
       from app.tareas
      where usuario = $1
        and ((inicio >= $2 and inicio < $3)
             or (inicio < $2 and estado in ('pendiente', 'en_curso')
                 and inicio > now() - interval '60 days'))
      order by inicio`,
    [usuario, desde, hasta],
  );
  return filas.map(aTarea);
}

export async function crearTarea(usuario: string, d: DatosTarea): Promise<Tarea> {
  const fila = await queryOne<FilaTarea>(
    `insert into app.tareas (usuario, titulo, nota, categoria, prioridad, inicio,
                             duracion_min, recordar_min_antes, accion)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     returning ${COLUMNAS_TAREA}`,
    [usuario, d.titulo, d.nota, d.categoria, d.prioridad, d.inicio,
     d.duracionMin, d.recordarMinAntes, d.accion],
  );
  return aTarea(fila!);
}

/**
 * Editar los datos de una tarea. Si se mueve la hora, la acción automática
 * vuelve a la cola: `resultado_accion` en null es lo que la pone ahí (ver el
 * índice `tareas_acciones_pendientes`).
 */
export async function editarTarea(
  usuario: string,
  id: string,
  d: DatosTarea,
): Promise<Tarea | null> {
  const fila = await queryOne<FilaTarea>(
    `update app.tareas
        set titulo = $3, nota = $4, categoria = $5, prioridad = $6,
            resultado_accion = case when inicio is distinct from $7::timestamptz
                                      or accion is distinct from $10
                                    then null else resultado_accion end,
            inicio = $7, duracion_min = $8, recordar_min_antes = $9, accion = $10
      where id = $2 and usuario = $1
      returning ${COLUMNAS_TAREA}`,
    [usuario, id, d.titulo, d.nota, d.categoria, d.prioridad, d.inicio,
     d.duracionMin, d.recordarMinAntes, d.accion],
  );
  return fila ? aTarea(fila) : null;
}

/**
 * Cambiar de estado. Las marcas de tiempo las pone la base y no la pantalla:
 * son lo que mide cuánto llevó cada cosa, y el reloj de la compu puede estar
 * corrido.
 */
export async function cambiarEstado(
  usuario: string,
  id: string,
  estado: Estado,
): Promise<Tarea | null> {
  const fila = await queryOne<FilaTarea>(
    `update app.tareas
        set estado = $3,
            iniciada_en = case when $3 in ('en_curso', 'hecha')
                               then coalesce(iniciada_en, case when $3 = 'en_curso' then now() end)
                               when $3 = 'pendiente' then null
                               else iniciada_en end,
            hecha_en = case when $3 = 'hecha' then now() else null end
      where id = $2 and usuario = $1
      returning ${COLUMNAS_TAREA}`,
    [usuario, id, estado],
  );
  return fila ? aTarea(fila) : null;
}

/** Correrla para más adelante. Cuenta como postergación: es la señal del resumen. */
export async function postergarTarea(
  usuario: string,
  id: string,
  minutos: number,
): Promise<Tarea | null> {
  // Se posterga desde AHORA si ya pasó: correr una tarea de ayer "una hora"
  // la dejaría todavía en el pasado.
  const fila = await queryOne<FilaTarea>(
    `update app.tareas
        set inicio = greatest(inicio, now()) + make_interval(mins => $3),
            veces_postergada = veces_postergada + 1,
            estado = 'pendiente',
            resultado_accion = null
      where id = $2 and usuario = $1
      returning ${COLUMNAS_TAREA}`,
    [usuario, id, minutos],
  );
  return fila ? aTarea(fila) : null;
}

export async function borrarTarea(usuario: string, id: string): Promise<boolean> {
  const filas = await query<{ id: string }>(
    "delete from app.tareas where id = $2 and usuario = $1 returning id::text",
    [usuario, id],
  );
  return filas.length > 0;
}

// ---------------------------------------------------------------------------
//  Reglas que se repiten
// ---------------------------------------------------------------------------

type FilaRecurrencia = {
  id: string;
  titulo: string;
  nota: string | null;
  categoria: string | null;
  prioridad: Recurrencia["prioridad"];
  duracion_min: number;
  recordar_min_antes: number;
  accion: string | null;
  frecuencia: Recurrencia["frecuencia"];
  cada: number;
  dias_semana: number[] | null;
  dia_mes: number | null;
  hora: string;
  desde: string;
  hasta: string | null;
  activa: boolean;
};

const COLUMNAS_RECURRENCIA = `
  id::text, titulo, nota, categoria, prioridad, duracion_min, recordar_min_antes,
  accion, frecuencia, cada, dias_semana, dia_mes, to_char(hora, 'HH24:MI') as hora,
  to_char(desde, 'YYYY-MM-DD') as desde, to_char(hasta, 'YYYY-MM-DD') as hasta, activa`;

function aRecurrencia(f: FilaRecurrencia): Recurrencia {
  return {
    id: f.id,
    titulo: f.titulo,
    nota: f.nota,
    categoria: f.categoria,
    prioridad: f.prioridad,
    duracionMin: f.duracion_min,
    recordarMinAntes: f.recordar_min_antes,
    accion: f.accion,
    frecuencia: f.frecuencia,
    cada: f.cada,
    diasSemana: f.dias_semana,
    diaMes: f.dia_mes,
    hora: f.hora,
    desde: f.desde,
    hasta: f.hasta,
    activa: f.activa,
  };
}

export async function listarRecurrencias(usuario: string): Promise<Recurrencia[]> {
  const filas = await query<FilaRecurrencia>(
    `select ${COLUMNAS_RECURRENCIA}
       from app.tareas_recurrentes
      where usuario = $1 and activa
      order by titulo`,
    [usuario],
  );
  return filas.map(aRecurrencia);
}

export async function crearRecurrencia(
  usuario: string,
  d: DatosRecurrencia,
): Promise<Recurrencia> {
  const fila = await queryOne<FilaRecurrencia>(
    `insert into app.tareas_recurrentes
       (usuario, titulo, nota, categoria, prioridad, duracion_min, recordar_min_antes,
        accion, frecuencia, cada, dias_semana, dia_mes, hora, desde, hasta)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
     returning ${COLUMNAS_RECURRENCIA}`,
    [usuario, d.titulo, d.nota, d.categoria, d.prioridad, d.duracionMin,
     d.recordarMinAntes, d.accion, d.frecuencia, d.cada, d.diasSemana, d.diaMes,
     d.hora, d.desde, d.hasta],
  );
  await query("select app.generar_tareas()");
  return aRecurrencia(fila!);
}

/**
 * Dejar de repetir. Se desactiva la regla y se borran las ocurrencias FUTURAS
 * que todavía no se tocaron. Las pasadas --hechas o no-- quedan: son el
 * historial del resumen.
 */
export async function frenarRecurrencia(usuario: string, id: string): Promise<boolean> {
  const filas = await query<{ id: string }>(
    `update app.tareas_recurrentes set activa = false
      where id = $2 and usuario = $1
      returning id::text`,
    [usuario, id],
  );
  if (filas.length === 0) return false;
  await query(
    `delete from app.tareas
      where recurrencia_id = $2 and usuario = $1
        and estado = 'pendiente' and inicio > now()`,
    [usuario, id],
  );
  return true;
}
