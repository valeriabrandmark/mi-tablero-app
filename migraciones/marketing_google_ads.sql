-- GOOGLE ADS -> TABLERO DE MARCA
--
-- La inversion en Google Ads por dia y campana. La escribe el script que se
-- pega en la cuenta de Google Ads (apps-script/google-ads-tablero.js) via
-- /api/marketing/google-ads, cada hora. Cada envio reemplaza los dias que trae
-- de esa cuenta: mandar dos veces lo mismo deja lo mismo.
--
-- La marca NO se guarda: se resuelve al leer (lib/queries-marketing.ts), por
-- la variable GOOGLE_ADS_CUENTA_<MARCA> o por el nombre de la cuenta / campana.
-- Asi un cambio de criterio vale tambien para lo ya cargado.
create table if not exists bronze.google_ads_diario (
  fecha             date        not null,
  cuenta_id         text        not null,
  cuenta_nombre     text,
  moneda            text        not null default 'ARS',
  campana_id        text        not null,
  campana           text,
  costo             numeric     not null default 0,
  clics             integer     not null default 0,
  impresiones       integer     not null default 0,
  conversiones      numeric     not null default 0,
  valor_conversiones numeric    not null default 0,
  recibido_en       timestamptz not null default now(),
  primary key (fecha, cuenta_id, campana_id)
);
alter table bronze.google_ads_diario enable row level security;
comment on table bronze.google_ads_diario is
  'Google Ads: inversion por dia y campana. La manda apps-script/google-ads-tablero.js (script de Google Ads).';
