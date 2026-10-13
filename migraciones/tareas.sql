-- migración `tareas` · 13/10/2026
--
-- El organizador de tareas del tablero (/tareas): calendario, recordatorios,
-- tareas que se repiten solas y tareas que ejecutan algo solas.
--
-- Vive en el schema `app` por lo mismo que `ordenes_compra_enviadas`: lo
-- escribe la aplicación, no el orquestador, y una recarga del pipeline no se
-- lo puede llevar puesto.
--
-- ---------------------------------------------------------------------------
-- LAS DOS TABLAS
--
--   app.tareas_recurrentes  la REGLA: "todos los lunes a las 9", "el día 6".
--   app.tareas              cada OCURRENCIA concreta, con su fecha y su estado.
--
-- Una regla no se tilda: se tilda el lunes 13 o el lunes 20. Por eso las
-- ocurrencias se materializan como filas (`app.generar_tareas`), y desde ahí
-- una tarea repetida y una suelta son lo mismo para la pantalla, el resumen y
-- las sugerencias.
--
-- ---------------------------------------------------------------------------
-- QUIÉN EJECUTA LO AUTOMÁTICO: pg_cron, ACÁ ADENTRO
--
-- Ni el navegador --que puede estar cerrado-- ni Vercel --que en Hobby corre
-- un cron por día--. Es el mismo razonamiento de `despertador.sql` en
-- tablero_quo: la base es lo único que tiene que estar viva.
--
-- Cada 5 minutos `app.correr_tareas()` genera las ocurrencias que faltan y
-- ejecuta las tareas con `accion` cuya hora ya llegó. El catálogo de acciones
-- está en `app.ejecutar_accion`; hoy tiene una sola.

create schema if not exists app;

create table if not exists app.tareas_recurrentes (
  id                 bigint generated always as identity primary key,
  -- El email de quien la creó. Texto y no FK a auth.users, igual que en las
  -- órdenes: el organizador es personal y se filtra siempre por acá.
  usuario            text not null,
  titulo             text not null,
  nota               text,
  categoria          text,
  prioridad          text not null default 'media'
                     check (prioridad in ('alta', 'media', 'baja')),
  duracion_min       integer not null default 30 check (duracion_min > 0),
  recordar_min_antes integer not null default 0 check (recordar_min_antes >= 0),
  accion             text,
  frecuencia         text not null check (frecuencia in ('diaria', 'semanal', 'mensual')),
  -- "Cada 2 semanas" = semanal con cada = 2.
  cada               integer not null default 1 check (cada >= 1),
  -- ISO: 1 = lunes … 7 = domingo. Sólo para `semanal`.
  dias_semana        integer[],
  -- Sólo para `mensual`. Un 31 en un mes de 30 cae el último día.
  dia_mes            integer check (dia_mes between 1 and 31),
  hora               time not null default '09:00',
  desde              date not null default current_date,
  hasta              date,
  activa             boolean not null default true,
  -- Hasta qué día ya se generaron ocurrencias. Lo mueve `generar_tareas`.
  generada_hasta     date,
  creada_en          timestamptz not null default now()
);

create table if not exists app.tareas (
  id                 bigint generated always as identity primary key,
  usuario            text not null,
  titulo             text not null,
  nota               text,
  categoria          text,
  prioridad          text not null default 'media'
                     check (prioridad in ('alta', 'media', 'baja')),
  inicio             timestamptz not null,
  duracion_min       integer not null default 30 check (duracion_min > 0),
  recordar_min_antes integer not null default 0 check (recordar_min_antes >= 0),
  estado             text not null default 'pendiente'
                     check (estado in ('pendiente', 'en_curso', 'hecha', 'cancelada')),
  -- Para el resumen: cuánto llevó DE VERDAD contra lo que se estimó.
  iniciada_en        timestamptz,
  hecha_en           timestamptz,
  -- Cuántas veces se corrió para más adelante. Una tarea que se patea cinco
  -- veces es la primera candidata a sugerencia.
  veces_postergada   integer not null default 0,
  -- Si tiene acción, la ejecuta pg_cron a su hora; si no, es un recordatorio.
  accion             text,
  resultado_accion   text,
  recurrencia_id     bigint references app.tareas_recurrentes (id) on delete set null,
  -- El día de la regla que generó esta ocurrencia. Con la regla, es la clave
  -- que impide generar dos veces el mismo lunes aunque se la postergue.
  fecha_origen       date,
  creada_en          timestamptz not null default now()
);

create index if not exists tareas_usuario_inicio on app.tareas (usuario, inicio);
create unique index if not exists tareas_ocurrencia_unica
  on app.tareas (recurrencia_id, fecha_origen) where recurrencia_id is not null;
-- La cola del cron. `resultado_accion is null` es lo que saca de la cola a una
-- acción que ya se intentó: si falló, queda pendiente CON el error a la vista,
-- y no se reintenta cada 5 minutos. Reprogramarla desde la pantalla limpia el
-- resultado y la vuelve a poner en la cola.
create index if not exists tareas_acciones_pendientes
  on app.tareas (inicio)
  where accion is not null and estado = 'pendiente' and resultado_accion is null;

-- ============================================================================
--  GENERAR OCURRENCIAS
-- ============================================================================
--
-- Idempotente: se puede llamar en cada lectura de la pantalla y desde el cron
-- sin duplicar nada (índice `tareas_ocurrencia_unica` + `on conflict`).
--
-- Las fechas se calculan en hora de Argentina: "todos los días a las 9" son
-- las 9 de acá, no las 9 UTC.
create or replace function app.generar_tareas(dias_adelante integer default 62)
returns integer
language plpgsql
as $$
declare
  hoy   date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  tope  date := hoy + dias_adelante;
  r     app.tareas_recurrentes%rowtype;
  n     integer := 0;
  filas integer;
begin
  for r in
    select * from app.tareas_recurrentes
     where activa
       and coalesce(generada_hasta, desde - 1) < least(tope, coalesce(hasta, tope))
  loop
    insert into app.tareas (usuario, titulo, nota, categoria, prioridad, inicio,
                            duracion_min, recordar_min_antes, accion,
                            recurrencia_id, fecha_origen)
    select r.usuario, r.titulo, r.nota, r.categoria, r.prioridad,
           (d + r.hora) at time zone 'America/Argentina/Buenos_Aires',
           r.duracion_min, r.recordar_min_antes, r.accion, r.id, d
      from generate_series(
             -- No se rellena el pasado: una regla nueva arranca hoy, aunque
             -- `desde` sea anterior.
             greatest(r.desde, coalesce(r.generada_hasta + 1, r.desde), hoy),
             least(tope, coalesce(r.hasta, tope)),
             interval '1 day'
           ) as g(dia),
           lateral (select g.dia::date as d) x
     where case r.frecuencia
             when 'diaria' then
               (d - r.desde) % r.cada = 0
             when 'semanal' then
               extract(isodow from d)::int = any (coalesce(r.dias_semana, array[extract(isodow from r.desde)::int]))
               and ((d - (r.desde - (extract(isodow from r.desde)::int - 1))) / 7) % r.cada = 0
             when 'mensual' then
               extract(day from d)::int = least(
                 coalesce(r.dia_mes, extract(day from r.desde)::int),
                 extract(day from (date_trunc('month', d) + interval '1 month - 1 day'))::int)
               and ((extract(year from d) - extract(year from r.desde)) * 12
                    + extract(month from d) - extract(month from r.desde))::int % r.cada = 0
           end
    on conflict (recurrencia_id, fecha_origen) where recurrencia_id is not null do nothing;

    get diagnostics filas = row_count;
    n := n + filas;

    update app.tareas_recurrentes
       set generada_hasta = least(tope, coalesce(r.hasta, tope))
     where id = r.id;
  end loop;
  return n;
end;
$$;

-- ============================================================================
--  ACCIONES AUTOMÁTICAS
-- ============================================================================
--
-- El catálogo. Cada acción nueva es un `when` más acá y una entrada en
-- `ACCIONES` de lib/tareas.ts (que es lo que ofrece la pantalla). Una clave que
-- la pantalla ofrezca y esta función no conozca termina en "acción
-- desconocida", visible en la tarea, y no en silencio.
create or replace function app.ejecutar_accion(accion text)
returns text
language plpgsql
as $$
begin
  case accion
    when 'actualizar_tablero' then
      -- Lo mismo que el botón "Actualizar ahora": si los datos tienen menos de
      -- 15 minutos no dispara nada (ver tablero_quo/despertador.sql).
      return ops.despertar_orquestador(15);
    else
      return 'acción desconocida: ' || coalesce(accion, '(vacía)');
  end case;
exception when others then
  return 'error: ' || sqlerrm;
end;
$$;

-- Lo que corre el cron. Una tarea automática que se pasó por más de 6 horas
-- --porque el cron estuvo caído, o se creó con una hora pasada-- NO se
-- ejecuta: se marca como vencida. Correr de golpe una semana de acciones
-- atrasadas es peor que avisar que no corrieron.
create or replace function app.correr_tareas()
returns integer
language plpgsql
as $$
declare
  t app.tareas%rowtype;
  n integer := 0;
  res text;
begin
  perform app.generar_tareas();

  for t in
    select * from app.tareas
     where accion is not null and estado = 'pendiente'
       and resultado_accion is null and inicio <= now()
     order by inicio
     for update skip locked
  loop
    if t.inicio < now() - interval '6 hours' then
      update app.tareas
         set estado = 'cancelada',
             resultado_accion = 'no se ejecutó: venció sin que corriera el cron'
       where id = t.id;
    else
      res := app.ejecutar_accion(t.accion);
      update app.tareas
         set estado = case when res like 'error:%' or res like 'acción desconocida%'
                           then 'pendiente' else 'hecha' end,
             iniciada_en = now(),
             hecha_en = case when res like 'error:%' or res like 'acción desconocida%'
                             then null else now() end,
             resultado_accion = res
       where id = t.id;
      n := n + 1;
    end if;
  end loop;
  return n;
end;
$$;

-- pg_cron ya está instalado por despertador.sql; el `if not exists` es por si
-- esto se aplica en una base nueva.
create extension if not exists pg_cron;

select cron.schedule(
  'tareas-automaticas',
  '*/5 * * * *',
  $cron$ select app.correr_tareas(); $cron$
);
