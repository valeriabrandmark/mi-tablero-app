-- GOOGLE ANALYTICS 4 -> TABLERO DE MARCA
--
-- Sesiones, usuarios y compras por dia y por canal de origen
-- (sessionDefaultChannelGroup) de cada tienda. Las manda el Apps Script
-- apps-script/google-analytics-tablero.gs, que corre con el usuario de Ana
-- (tiene acceso a las propiedades) y no necesita cuenta de servicio.
-- Cada envio reemplaza los dias que trae de esa propiedad.
create table if not exists bronze.ga4_diario (
  fecha                  date        not null,
  propiedad              text        not null,
  marca                  text        not null check (marca in ('diaper_genie', 'hola_toys', 'unibrandco', 'litter_genie')),
  canal                  text        not null,
  sesiones               integer     not null default 0,
  usuarios               integer     not null default 0,
  usuarios_nuevos        integer     not null default 0,
  sesiones_comprometidas integer     not null default 0,
  compras                numeric     not null default 0,
  ingresos               numeric     not null default 0,
  recibido_en            timestamptz not null default now(),
  primary key (fecha, propiedad, canal)
);
alter table bronze.ga4_diario enable row level security;
comment on table bronze.ga4_diario is
  'GA4: sesiones, usuarios y compras por dia y canal. La manda apps-script/google-analytics-tablero.gs.';
