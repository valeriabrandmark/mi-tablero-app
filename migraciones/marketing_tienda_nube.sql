-- ===========================================================================
--  TABLERO DE MARCA: PEDIDOS DE TIENDA NUBE IMPORTADOS A MANO
-- ===========================================================================
--
-- Las tiendas de las marcas no tienen el plan que habilita la API (Escala),
-- así que los pedidos entran por el importador de /marketing/importar: se
-- exporta el CSV de "Ventas" desde el administrador de cada tienda y se sube.
--
-- UNA FILA POR PEDIDO, NO POR PRODUCTO. El CSV de Tienda Nube trae una fila
-- por producto y repite (o deja vacíos) los datos del pedido; el importador
-- los junta antes de mandar. Los productos quedan en `productos` (jsonb)
-- porque para el tablero de marca alcanza con saber qué se vendió, no hace
-- falta cruzarlos con costos como en gold.fact_ventas.
--
-- REIMPORTAR ES SEGURO: la clave es (marca, numero) y el importador hace
-- upsert. Un pedido que estaba "pendiente" y ahora figura "pagado" se
-- actualiza solo; se puede subir el mes entero todas las semanas.
--
-- SIN DATOS PERSONALES. No se guarda nombre, email, DNI, teléfono ni
-- dirección: el navegador manda solamente un hash SHA-256 del email, que
-- alcanza para distinguir cliente nuevo de recurrente y no permite volver al
-- email. La provincia sí se guarda (sirve para ver dónde pega la pauta).
--
-- Se corre una sola vez, desde el editor SQL de Supabase.
-- ===========================================================================

begin;

create table if not exists bronze.mkt_tn_pedidos (
  marca          text        not null
                 check (marca in ('diaper_genie', 'hola_toys', 'unibrandco', 'litter_genie')),
  numero         text        not null,
  fecha          timestamptz not null,
  estado         text,
  estado_pago    text,
  estado_envio   text,
  -- Una venta es un pedido pagado y no cancelado. Lo calcula el importador y
  -- se guarda, para decidirlo en un solo lugar y no en cada consulta.
  es_venta       boolean     not null,
  subtotal       numeric,
  descuento      numeric,
  envio          numeric,
  total          numeric     not null,
  cupon          text,
  medio_pago     text,
  provincia      text,
  cliente_hash   text,
  unidades       integer,
  productos      jsonb,
  archivo        text,
  importado_por  text,
  importado_en   timestamptz not null default now(),
  primary key (marca, numero)
);

create index if not exists mkt_tn_pedidos_fecha on bronze.mkt_tn_pedidos (marca, fecha);
create index if not exists mkt_tn_pedidos_cupon on bronze.mkt_tn_pedidos (upper(cupon)) where cupon is not null;

comment on table bronze.mkt_tn_pedidos is
  'Pedidos de las tiendas Tienda Nube de cada marca, importados desde el CSV de Ventas (sin API). Una fila por pedido.';

-- Historial de importaciones: quién subió qué y cuándo. Sirve para que el
-- tablero diga "datos al 10/11" en vez de mostrar un número viejo como si
-- fuera de hoy.
create table if not exists bronze.mkt_tn_importaciones (
  id             bigserial   primary key,
  marca          text        not null,
  archivo        text,
  pedidos        integer     not null,
  nuevos         integer     not null,
  actualizados   integer     not null,
  desde          timestamptz,
  hasta          timestamptz,
  importado_por  text,
  importado_en   timestamptz not null default now()
);

-- Igual que el resto de bronze: sin acceso desde la API pública. El tablero
-- entra con el usuario de la base, del lado del servidor.
alter table bronze.mkt_tn_pedidos enable row level security;
alter table bronze.mkt_tn_importaciones enable row level security;

commit;
