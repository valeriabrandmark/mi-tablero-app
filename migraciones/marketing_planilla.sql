-- ===========================================================================
--  LA PLANILLA DE MARKETING (Google Sheets) → TABLERO
-- ===========================================================================
--
-- El Apps Script de la planilla "Marketing Brandmark" (apps-script/
-- planilla-marketing.gs) manda una FOTO ENTERA de la planilla a
-- /api/marketing/planilla, y queda acá como una fila. El Tablero de Marca lee
-- siempre la última.
--
-- POR QUÉ UNA FOTO EN JSON Y NO UNA TABLA POR HOJA: la planilla es la fuente
-- de verdad y se edita a mano; lo que importa es que el tablero vea lo mismo
-- que la planilla, completo. Reemplazar la foto entera hace imposible que
-- quede una fila vieja que en la planilla ya se borró. Se guardan las últimas
-- para poder ver qué cambió si un número sorprende.
--
-- Se corre una sola vez, desde el editor SQL de Supabase.
-- ===========================================================================

begin;

create table if not exists bronze.mkt_planilla (
  id           bigserial   primary key,
  recibido_en  timestamptz not null default now(),
  -- Lo que mandó el script, tal cual (encabezados de la planilla como claves).
  datos        jsonb       not null,
  filas        integer     not null,
  origen       text
);

create index if not exists mkt_planilla_recibido on bronze.mkt_planilla (recibido_en desc);

alter table bronze.mkt_planilla enable row level security;

commit;
