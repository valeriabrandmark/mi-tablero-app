-- migración `ordenes_compra_enviadas` · 09/09/2026
--
-- Aplicada en Supabase. Vive acá porque el schema de la base tiene que poder
-- reconstruirse desde el repo: es la ÚNICA tabla que escribe el tablero, así
-- que no la crea ni la recrea el orquestador y no hay otro lugar donde esté
-- escrita.
--
-- ---------------------------------------------------------------------------
-- POR QUÉ UN SCHEMA APARTE
--
-- `bronze` y `gold` los carga el orquestador y el tablero sólo los lee. Esto es
-- al revés: lo produce la aplicación. En su propio schema, una recarga del
-- pipeline no puede llevárselo puesto.
--
-- POR QUÉ EXISTE
--
-- Una orden mandada no se puede deshacer y, del lado de Sigma, lo único que
-- queda es el resultado. Lo que se PIDIÓ --qué cantidad, en qué unidad, con qué
-- descuentos, contra qué costo de ese día-- no quedaba en ningún lado. El
-- 09/09/2026 hubo que reconstruir a mano, mirando una ficha del ERP y haciendo
-- la división, si un renglón se había pedido en bultos o en unidades.
create schema if not exists app;

create table if not exists app.ordenes_compra_enviadas (
  id                bigint generated always as identity primary key,
  enviada_en        timestamptz not null default now(),
  -- Quién la mandó. Texto y no una FK a auth.users: si mañana se borra el
  -- usuario, el registro de qué se compró tiene que seguir en pie.
  usuario           text,
  proveedor_codigo  text,
  proveedor_nombre  text,
  empresa           text,
  -- El mes de la oferta con el que se armó, o sea contra qué costo se pidió.
  mes               text,
  nota              text,
  renglones         integer not null,
  unidades          numeric not null,
  -- Bruto, sin descuentos: lo demás se recalcula desde el payload.
  total_bruto       numeric not null,
  -- 'ok' si Sigma contestó 2xx, 'incierto' si contestó error -- que puede
  -- significar que la orden entró igual, porque su API contesta 500 también
  -- cuando la carga bien. No hay 'error': si no salió, no se guarda.
  resultado         text not null check (resultado in ('ok', 'incierto')),
  respuesta         text,
  -- EL CUERPO EXACTO. Es la constancia: cantidad, unidad, precio y descuentos
  -- de cada renglón, tal como viajaron.
  payload           jsonb not null
);

create index if not exists ordenes_compra_enviadas_fecha
  on app.ordenes_compra_enviadas (enviada_en desc);
