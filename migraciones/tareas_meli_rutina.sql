-- migración `tareas_meli_rutina` · 23/10/2026
--
-- La rutina diaria del responsable de Mercado Libre, la que llevaba en una
-- planilla de papel. Las reglas (qué tareas, qué días) están en
-- lib/rutina-meli.ts; acá sólo los casilleros marcados.
--
-- ---------------------------------------------------------------------------
-- UNA FILA POR CASILLERO MARCADO, Y EL VACÍO NO SE GUARDA
--
-- En papel el punto ("quedó pendiente") se escribía a mano. Acá no: un
-- casillero de un día que ya pasó y no tiene fila ES el pendiente. Si hubiera
-- que guardarlo, el día que nadie abre la pantalla no quedaría registrado
-- como incumplido, que es justo el día que más importa medir.
--
-- ---------------------------------------------------------------------------
-- ESTA SÍ SE PISA, A DIFERENCIA DE LAS RESPUESTAS A ALERTAS
--
-- Un tilde puesto por error se corrige, y lo que hay que medir es cómo quedó
-- el día, no cuántas veces se clickeó. Para saber quién lo dejó así están
-- `usuario` y `actualizado_en`.
create schema if not exists app;

create table if not exists app.tareas_meli_rutina (
  fecha           date not null,
  -- La clave de TAREAS_RUTINA, o 'feriado' para el día entero.
  tarea           text not null,
  -- Para las tareas de varias veces por día ("Controlar dashboard", 3).
  vez             smallint not null default 1,
  estado          text not null check (estado in ('hecho', 'no_correspondia')),
  nota            text,
  usuario         text not null,
  actualizado_en  timestamptz not null default now(),
  primary key (fecha, tarea, vez)
);

-- Igual que tareas_meli_respuestas: la escribe el tablero con su usuario de
-- base, nunca el navegador con la clave pública.
revoke all on app.tareas_meli_rutina from anon, authenticated;
