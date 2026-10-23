-- migración `tareas_meli` · 23/10/2026
--
-- Vive acá por lo mismo que las de órdenes de compra: el schema de `app` lo
-- produce la aplicación, no el orquestador, así que si no está escrito en el
-- repo no está escrito en ningún lado.
--
-- ---------------------------------------------------------------------------
-- POR QUÉ EXISTE
--
-- El responsable de Mercado Libre llevaba sus tareas en una planilla de papel:
-- una fila por tarea, un tilde por día. Funcionaba para acordarse, pero no
-- dejaba medir nada: ni cuántas alertas se miraron, ni qué se hizo con cada
-- una, ni cuántas se dejaron pasar.
--
-- ---------------------------------------------------------------------------
-- SE GUARDAN LAS RESPUESTAS, NO LAS ALERTAS
--
-- La alerta se calcula en vivo cada vez que se abre la pantalla (ver
-- lib/tareas-meli.ts): "este SKU tiene unidades de más de 120 días en Full y
-- no vende". Guardarla también sería tener dos verdades, y la guardada
-- quedaría vieja en cuanto el pipeline corra de nuevo.
--
-- Lo que no se puede recalcular es lo que DECIDIÓ la persona. Eso es esta
-- tabla: una fila por respuesta, con quién, cuándo y qué.
--
-- ---------------------------------------------------------------------------
-- SÓLO SE AGREGA, NUNCA SE PISA
--
-- Responder dos veces la misma alerta deja dos filas. La vigente es la última.
-- Es a propósito: la historia ES la medición ("este artículo se dejó tres
-- veces y al final se descartó igual"), y un update la borraría.
--
-- ---------------------------------------------------------------------------
-- `vence_en` ES LO QUE HACE QUE UNA RESPUESTA NO SEA PARA SIEMPRE
--
-- "Se deja, va a vender" es una apuesta, no un cierre. Si a los 30 días el
-- artículo sigue viejo y sin vender, la alerta tiene que volver. Lo mismo un
-- "retiro armado": si a los 15 días el stock sigue en Full, el retiro no salió.
-- El plazo de cada respuesta está en RESPUESTAS de lib/tareas-meli.ts, y se
-- guarda resuelto como fecha para que cambiarlo no reabra de golpe todo lo
-- que ya se contestó con el plazo anterior.
create schema if not exists app;

create table if not exists app.tareas_meli_respuestas (
  id            bigserial primary key,
  -- Qué regla disparó la alerta: 'riesgo_descarte' por ahora. Texto y no enum
  -- para que una regla nueva no pida migración.
  regla         text not null,
  -- Sobre qué: el SKU. Texto porque otras reglas pueden ir por publicación.
  clave         text not null,
  respuesta     text not null,
  motivo        text,
  nota          text,
  -- Cómo estaba la alerta cuando se contestó: unidades, plata, días. Sin
  -- esto no hay forma de saber después si se decidió sobre 3 unidades o 300.
  datos         jsonb not null default '{}'::jsonb,
  usuario       text not null,
  creado_en     timestamptz not null default now(),
  vence_en      timestamptz not null
);

-- La pantalla busca siempre "la última respuesta de cada alerta".
create index if not exists tareas_meli_respuestas_alerta
  on app.tareas_meli_respuestas (regla, clave, creado_en desc);

-- La escribe el tablero con su usuario de base, nunca el navegador con la
-- clave pública de Supabase: quién respondió sale de la sesión, y una fila
-- escrita desde afuera podría firmarse con cualquier mail.
revoke all on app.tareas_meli_respuestas from anon, authenticated;
