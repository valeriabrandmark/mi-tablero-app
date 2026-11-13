-- ===========================================================================
--  MARKETING → CARGA DESDE EL TABLERO (reemplaza a la planilla de Sheets)
-- ===========================================================================
--
-- Las colaboraciones, influencers, envíos, gastos, presupuesto y contenido
-- se cargan y se editan desde el tablero (Marketing → Carga). Se guardan
-- acá, en tablas, y cada cambio deja una fila en bronze.mkt_cambios: quién,
-- cuándo, y cómo estaba antes y después. Es el "por las dudas": nada se
-- pierde aunque se edite o se borre.
--
-- LOS CANJES SALEN DE SIGMA: toda venta a los clientes CANJE DIAPER GENIE,
-- CANJES HOLA TOYS y CANJES UNIBRANCO es mercadería entregada en canje. Una
-- colaboración se ata a sus comprobantes de SIGMA (bronze.mkt_colab_canjes)
-- y su costo de canje sale de ahí. Los productos cargados a mano
-- (bronze.mkt_colab_productos) quedan para lo que no pasó por SIGMA, como los
-- canjes históricos migrados de las planillas viejas.
--
-- AL FINAL, MIGRA LO QUE YA HABÍA: la última foto que mandó la planilla de
-- Google Sheets (bronze.mkt_planilla). Se corre una sola vez; si se corre de
-- nuevo no duplica (las colaboraciones e influencers se reconocen por código).
-- ===========================================================================

begin;

create table if not exists bronze.mkt_influencers (
  id               bigserial   primary key,
  codigo           text        not null unique,
  nombre           text        not null,
  instagram        text,
  red              text,
  provincia        text,
  nicho            text,
  seguidores       integer,
  marcas           text[],
  tarifa_historia  numeric,
  tarifa_reel      numeric,
  tarifa_pack      numeric,
  acepta_canje     text,
  email            text,
  whatsapp         text,
  estado_contacto  text,
  ultimo_contacto  date,
  observaciones    text,
  creado_por       text,
  creado_en        timestamptz not null default now(),
  actualizado_por  text,
  actualizado_en   timestamptz not null default now()
);
create unique index if not exists mkt_influencers_nombre on bronze.mkt_influencers (lower(nombre));
create unique index if not exists mkt_influencers_instagram on bronze.mkt_influencers (lower(instagram)) where instagram is not null and instagram <> '';

create table if not exists bronze.mkt_colaboraciones (
  id                     bigserial   primary key,
  codigo                 text        not null unique,
  marca                  text        not null check (marca in ('diaper_genie', 'hola_toys', 'unibrandco', 'litter_genie')),
  fecha                  date        not null,
  influencer_id          bigint      not null references bronze.mkt_influencers (id),
  modalidad              text        not null check (modalidad in ('Pago', 'Canje', 'Pago + canje')),
  formato                text,
  piezas                 integer,
  campana                text,
  producto_promocionado  text,
  objetivo               text,
  honorarios             numeric,
  iva_honorarios         numeric,
  otros_costos           numeric,
  estado                 text        not null,
  estado_pago            text,
  fecha_pago             date,
  medio_pago             text,
  factura                text,
  publicacion_prevista   date,
  publicacion_real       date,
  link                   text,
  cupon                  text,
  alcance                integer,
  interacciones          integer,
  observaciones          text,
  creado_por             text,
  creado_en              timestamptz not null default now(),
  actualizado_por        text,
  actualizado_en         timestamptz not null default now()
);
create index if not exists mkt_colaboraciones_fecha on bronze.mkt_colaboraciones (marca, fecha);

-- Comprobantes de SIGMA (clientes CANJE…) atados a una colaboración. Un
-- comprobante va a UNA sola colaboración: si no, el costo se contaría dos veces.
create table if not exists bronze.mkt_colab_canjes (
  comprobante      text        primary key,
  colaboracion_id  bigint      not null references bronze.mkt_colaboraciones (id) on delete cascade,
  asignado_por     text,
  asignado_en      timestamptz not null default now()
);

create table if not exists bronze.mkt_colab_productos (
  id               bigserial   primary key,
  colaboracion_id  bigint      not null references bronze.mkt_colaboraciones (id) on delete cascade,
  fecha_entrega    date,
  sku              text,
  producto         text        not null,
  cantidad         numeric     not null default 1,
  costo_unitario   numeric,
  pvp_unitario     numeric,
  observaciones    text
);

create table if not exists bronze.mkt_envios (
  id               bigserial   primary key,
  colaboracion_id  bigint      references bronze.mkt_colaboraciones (id) on delete set null,
  fecha            date,
  destinatario     text        not null,
  marca            text        not null check (marca in ('diaper_genie', 'hola_toys', 'unibrandco', 'litter_genie')),
  tipo             text        not null,
  transporte       text,
  seguimiento      text,
  costo            numeric,
  estado           text,
  recibido         date,
  publico          text,
  observaciones    text,
  creado_por       text,
  creado_en        timestamptz not null default now(),
  actualizado_por  text,
  actualizado_en   timestamptz not null default now()
);

create table if not exists bronze.mkt_gastos (
  id               bigserial   primary key,
  fecha            date,
  mes              text,
  marca            text        not null check (marca in ('diaper_genie', 'hola_toys', 'unibrandco', 'litter_genie')),
  concepto         text        not null,
  proveedor        text,
  detalle          text,
  monto            numeric     not null,
  iva              numeric,
  estado_pago      text,
  fecha_pago       date,
  factura          text,
  observaciones    text,
  creado_por       text,
  creado_en        timestamptz not null default now(),
  actualizado_por  text,
  actualizado_en   timestamptz not null default now()
);

create table if not exists bronze.mkt_presupuesto (
  id               bigserial   primary key,
  mes              text        not null check (mes ~ '^\d{4}-\d{2}$'),
  marca            text        not null check (marca in ('diaper_genie', 'hola_toys', 'unibrandco', 'litter_genie')),
  monto            numeric     not null,
  nota             text,
  actualizado_por  text,
  actualizado_en   timestamptz not null default now(),
  unique (mes, marca)
);

create table if not exists bronze.mkt_contenido (
  id               bigserial   primary key,
  colaboracion_id  bigint      not null references bronze.mkt_colaboraciones (id) on delete cascade,
  formato          text,
  titulo           text        not null,
  concepto         text,
  guion            text,
  copy             text,
  fecha            date,
  link             text,
  estado           text,
  observaciones    text,
  creado_por       text,
  creado_en        timestamptz not null default now()
);

-- El historial: cada alta, cambio o baja hecho desde el tablero.
create table if not exists bronze.mkt_cambios (
  id           bigserial   primary key,
  tabla        text        not null,
  registro_id  bigint,
  accion       text        not null check (accion in ('alta', 'cambio', 'baja')),
  antes        jsonb,
  despues      jsonb,
  usuario      text,
  en           timestamptz not null default now()
);
create index if not exists mkt_cambios_registro on bronze.mkt_cambios (tabla, registro_id, en desc);

alter table bronze.mkt_influencers      enable row level security;
alter table bronze.mkt_colaboraciones   enable row level security;
alter table bronze.mkt_colab_canjes     enable row level security;
alter table bronze.mkt_colab_productos  enable row level security;
alter table bronze.mkt_envios           enable row level security;
alter table bronze.mkt_gastos           enable row level security;
alter table bronze.mkt_presupuesto      enable row level security;
alter table bronze.mkt_contenido        enable row level security;
alter table bronze.mkt_cambios          enable row level security;

-- ---------------------------------------------------------------------------
-- MIGRACIÓN desde la última foto de la planilla de Google Sheets
-- ---------------------------------------------------------------------------
-- Sólo si las tablas nuevas están vacías: la migración es una vez.
do $$
declare
  foto jsonb;
begin
  if exists (select 1 from bronze.mkt_colaboraciones) then
    raise notice 'Ya hay colaboraciones cargadas: no se migra nada.';
    return;
  end if;
  if to_regclass('bronze.mkt_planilla') is null then
    raise notice 'No hay planilla que migrar.';
    return;
  end if;
  select datos -> 'hojas' into foto from bronze.mkt_planilla order by recibido_en desc limit 1;
  if foto is null then
    raise notice 'La planilla nunca mandó datos.';
    return;
  end if;

  -- Funciones de conversión: los valores llegan como texto o número, y vacío es "".
  create temporary table _f as select foto;

  insert into bronze.mkt_influencers (codigo, nombre, instagram, red, provincia, nicho, seguidores, marcas,
    tarifa_historia, tarifa_reel, tarifa_pack, acepta_canje, email, whatsapp, estado_contacto, ultimo_contacto,
    observaciones, creado_por)
  select distinct on (lower(trim(x->>'Nombre')))
    coalesce(nullif(x->>'ID', ''), 'INF-M' || row_number() over ()),
    trim(x->>'Nombre'),
    nullif(trim(x->>'Instagram'), ''),
    nullif(x->>'Red', ''),
    nullif(x->>'Provincia / ciudad', ''),
    nullif(x->>'Nicho', ''),
    nullif(regexp_replace(x->>'Seguidores', '[^0-9.]', '', 'g'), '')::numeric::integer,
    (select array_agg(case trim(m) when 'Diaper Genie' then 'diaper_genie' when 'Hola Toys' then 'hola_toys'
                                   when 'Unibrandco' then 'unibrandco' when 'Litter Genie' then 'litter_genie' end)
       from unnest(string_to_array(x->>'Marcas', ',')) m where trim(m) <> ''),
    nullif(x->>'Tarifa historia ($)', '')::numeric,
    nullif(x->>'Tarifa reel ($)', '')::numeric,
    nullif(x->>'Tarifa pack ($)', '')::numeric,
    nullif(x->>'Acepta canje', ''),
    nullif(x->>'Email', ''),
    nullif(x->>'WhatsApp', ''),
    nullif(x->>'Estado del contacto', ''),
    nullif(x->>'Último contacto', '')::date,
    nullif(x->>'Observaciones', ''),
    'migración planilla'
  from jsonb_array_elements(foto -> 'influencers') x
  where trim(coalesce(x->>'Nombre', '')) <> ''
  order by lower(trim(x->>'Nombre')), x->>'ID'
  on conflict do nothing;

  -- Influencers que aparecen en colaboraciones y no estaban en la base.
  insert into bronze.mkt_influencers (codigo, nombre, creado_por)
  select 'INF-C' || row_number() over (), n, 'migración planilla'
  from (select distinct trim(x->>'Influencer') n from jsonb_array_elements(foto -> 'colaboraciones') x) t
  where n <> '' and not exists (select 1 from bronze.mkt_influencers i where lower(i.nombre) = lower(t.n));

  insert into bronze.mkt_colaboraciones (codigo, marca, fecha, influencer_id, modalidad, formato, piezas, campana,
    producto_promocionado, objetivo, honorarios, iva_honorarios, otros_costos, estado, estado_pago, fecha_pago,
    medio_pago, factura, publicacion_prevista, publicacion_real, link, cupon, alcance, interacciones, observaciones,
    creado_por)
  select x->>'ID',
    case x->>'Marca' when 'Diaper Genie' then 'diaper_genie' when 'Hola Toys' then 'hola_toys'
                     when 'Unibrandco' then 'unibrandco' when 'Litter Genie' then 'litter_genie' end,
    coalesce(nullif(x->>'Fecha', '')::date, current_date),
    (select id from bronze.mkt_influencers i where lower(i.nombre) = lower(trim(x->>'Influencer'))),
    coalesce(nullif(x->>'Modalidad', ''), 'Canje'),
    nullif(x->>'Formato', ''),
    nullif(x->>'Piezas', '')::numeric::integer,
    nullif(x->>'Campaña / fecha comercial', ''),
    nullif(x->>'Producto / marca promocionada', ''),
    nullif(x->>'Objetivo', ''),
    nullif(x->>'Honorarios ($)', '')::numeric,
    nullif(x->>'IVA honorarios ($)', '')::numeric,
    nullif(x->>'Otros costos ($)', '')::numeric,
    coalesce(nullif(x->>'Estado', ''), 'Acordada'),
    nullif(x->>'Estado de pago', ''),
    nullif(x->>'Fecha de pago', '')::date,
    nullif(x->>'Medio de pago', ''),
    nullif(x->>'Factura', ''),
    nullif(x->>'Publicación prevista', '')::date,
    nullif(x->>'Publicación real', '')::date,
    nullif(x->>'Link', ''),
    nullif(upper(x->>'Cupón'), ''),
    nullif(x->>'Alcance', '')::numeric::integer,
    nullif(x->>'Interacciones', '')::numeric::integer,
    nullif(x->>'Observaciones', ''),
    'migración planilla'
  from jsonb_array_elements(foto -> 'colaboraciones') x
  where coalesce(x->>'ID', '') <> '' and x->>'Marca' in ('Diaper Genie', 'Hola Toys', 'Unibrandco', 'Litter Genie');

  insert into bronze.mkt_colab_productos (colaboracion_id, fecha_entrega, sku, producto, cantidad, costo_unitario, pvp_unitario, observaciones)
  select c.id, nullif(x->>'Fecha de entrega', '')::date, nullif(x->>'SKU', ''),
    coalesce(nullif(x->>'Producto', ''), x->>'SKU', 'Producto'),
    coalesce(nullif(x->>'Cantidad', '')::numeric, 1),
    -- Si la fila no tenía costo propio, el que le daba el catálogo.
    coalesce(nullif(x->>'Costo unitario ($)', '')::numeric, nullif(x->>'Costo de catálogo ($)', '')::numeric),
    nullif(x->>'PVP unitario ($)', '')::numeric,
    nullif(x->>'Observaciones', '')
  from jsonb_array_elements(foto -> 'productos') x
  join bronze.mkt_colaboraciones c on c.codigo = x->>'ID colaboración';

  insert into bronze.mkt_envios (colaboracion_id, fecha, destinatario, marca, tipo, transporte, seguimiento, costo,
    estado, recibido, publico, observaciones, creado_por)
  select c.id, nullif(x->>'Fecha', '')::date, coalesce(nullif(x->>'Destinatario', ''), '?'),
    coalesce(case x->>'Marca' when 'Diaper Genie' then 'diaper_genie' when 'Hola Toys' then 'hola_toys'
                              when 'Unibrandco' then 'unibrandco' when 'Litter Genie' then 'litter_genie' end, c.marca, 'diaper_genie'),
    coalesce(nullif(x->>'Tipo', ''), 'Influencer'), nullif(x->>'Transporte', ''), nullif(x->>'Seguimiento', ''),
    nullif(x->>'Costo envío ($)', '')::numeric, nullif(x->>'Estado', ''), nullif(x->>'Recibido el', '')::date,
    nullif(x->>'Publicó contenido', ''), nullif(x->>'Observaciones', ''), 'migración planilla'
  from jsonb_array_elements(foto -> 'envios') x
  left join bronze.mkt_colaboraciones c on c.codigo = x->>'ID colaboración';

  insert into bronze.mkt_gastos (fecha, mes, marca, concepto, proveedor, detalle, monto, iva, estado_pago, fecha_pago,
    factura, observaciones, creado_por)
  select nullif(x->>'Fecha', '')::date, nullif(x->>'Mes', ''),
    case x->>'Marca' when 'Diaper Genie' then 'diaper_genie' when 'Hola Toys' then 'hola_toys'
                     when 'Unibrandco' then 'unibrandco' when 'Litter Genie' then 'litter_genie' end,
    x->>'Concepto', nullif(x->>'Proveedor', ''), nullif(x->>'Detalle', ''),
    coalesce(nullif(x->>'Monto ($)', '')::numeric, nullif(x->>'Total ($)', '')::numeric),
    nullif(x->>'IVA ($)', '')::numeric, nullif(x->>'Estado de pago', ''), nullif(x->>'Fecha de pago', '')::date,
    nullif(x->>'Factura', ''), nullif(x->>'Observaciones', ''), 'migración planilla'
  from jsonb_array_elements(foto -> 'gastos') x
  where x->>'Marca' in ('Diaper Genie', 'Hola Toys', 'Unibrandco', 'Litter Genie')
    and coalesce(x->>'Concepto', '') <> ''
    and coalesce(nullif(x->>'Monto ($)', ''), nullif(x->>'Total ($)', '')) is not null;

  insert into bronze.mkt_presupuesto (mes, marca, monto, nota, actualizado_por)
  select x->>'Mes',
    case x->>'Marca' when 'Diaper Genie' then 'diaper_genie' when 'Hola Toys' then 'hola_toys'
                     when 'Unibrandco' then 'unibrandco' when 'Litter Genie' then 'litter_genie' end,
    (x->>'Presupuesto ($)')::numeric, nullif(x->>'Nota', ''), 'migración planilla'
  from jsonb_array_elements(foto -> 'presupuesto') x
  where (x->>'Mes') ~ '^\d{4}-\d{2}$' and coalesce(x->>'Presupuesto ($)', '') <> ''
    and x->>'Marca' in ('Diaper Genie', 'Hola Toys', 'Unibrandco', 'Litter Genie')
  on conflict (mes, marca) do nothing;

  insert into bronze.mkt_cambios (tabla, accion, despues, usuario)
  values ('migracion', 'alta', jsonb_build_object('desde', 'bronze.mkt_planilla', 'foto', foto), 'migración planilla');

  drop table _f;
end $$;

-- Contenido de Unibrandco (guiones y copys): no viajaba en la foto de la
-- planilla, se toma de la migración original. Sólo si todavía no hay contenido.
insert into bronze.mkt_contenido (colaboracion_id, formato, titulo, concepto, guion, copy, fecha, link, estado, observaciones, creado_por)
select c.id, v.formato, v.titulo, v.concepto, v.guion, v.copy, v.fecha, v.link, v.estado, v.obs, 'migración planilla'
from (values
  ('COL-0001','Reel','Peinado fácil para todos los días','Un peinado simple y rápido que cualquier persona pueda replicar antes de salir a trabajar, estudiar o hacer actividades.',null,'Si hay algo que necesito durante la semana es un peinado rápido y productos que realmente me ayuden a controlar el frizz
Este producto de John Frieda se convirtió en uno de mis favoritos.
Lo conseguís en @unibrandco
#JohnFrieda #HairCare #PeinadoFácil #BeautyTips #Unibrandco',null::date,null,'Planificado',null),
  ('COL-0001','Historia','Historia (sin título)',null,null,'Historia 1
Texto:
"¿A alguien más le pasa que algunos días no tiene tiempo de peinarse pero igual quiere verse arreglada? "
Sticker de encuesta:
Siempre  
Nunca
Historia 2 – El problema
Video mostrando el cabello antes de peinarse.
Texto:
"Mi principal problema es el frizz y que el pelo se ve sin forma cuando tengo poco tiempo."
Sticker de encuesta:
"¿Cuál es tu mayor problema con el pelo?"
Frizz
Falta de brillo
Poco volumen',null::date,null,'Planificado',null),
  ('COL-0002','Reel','Mi rutina de skincare en menos de 5 minutos','Demostrar que tener una rutina de cuidado de la piel no tiene por qué ser complicada ni llevar mucho tiempo.',null,'No necesitás una rutina de 10 pasos para cuidar tu piel 
Estos son mis infaltables para una piel limpia, hidratada y protegida en menos de 5 minutos.
Todos los productos de @unibrandco
#SkincareRoutine #Bioderma #Unibrandco #Dermocosmética #BeautyRoutine',null::date,null,'Publicado',null),
  ('COL-0002','Historia','Historia (sin título)',null,null,'Story 1
Selfie.
"¿Ustedes son team skincare simple o de mil pasos?"
Encuesta:
Simple
Completa
Story 2
Mostrando los productos.
"Estos son los productos que uso todos los días y los conseguí en @unibrandco."
Story 3
Sticker de enlace.
"Les dejo el link porque tienen muchísimas opciones de skincare y envíos a todo el país."',null::date,null,'Planificado',null),
  ('COL-0003','Reel','El producto viral que por fin llegó a Argentina','Generar conocimiento y deseo de prueba de HERO, posicionando a Unibrandco como el lugar donde conseguir el nuevo viral de skincare.','Escena 1 (Hook)
Texto:
"El producto de skincare que veo por todos lados en TikTok finalmente llegó a Argentina "

Escena 2
Mostrando el empaque.
Texto:
"Son los famosos parches para granitos de HERO."

Escena 3
Primer plano del parche.
Texto:
"Se colocan sobre la imperfección y ayudan a absorber las impurezas."

Escena 4
Aplicando el parche.
Texto:
"Fáciles de usar y prácticamente invisibles."

Escena 5
Cierre.
Texto:
"Ya están disponibles en @unibrandco."
','¿Soy la única que los veía por todos lados y quería probarlos? 
Por fin llegaron los famosos parches para granitos de HERO, el skincare viral que arrasa en TikTok.
Los conseguís en @unibrandco 
#HeroMightyPatch #HeroArgentina #Skincare #AcnePatch #Unibrandco #BeautyTok',null::date,null,'Planificado',null),
  ('COL-0003','Historia','Historia (sin título)',null,null,'Historia 1
Selfie.
Texto:
"¿Ya probaron los parches para granitos?"
Encuesta:
Sí 
Quiero probarlos 
Historia 2
Mostrando el packaging.
Texto:
"Estos son los famosos HERO que veía en TikTok todo el tiempo."
Historia 3
Aplicando el parche.
Texto:
"Los colocás sobre la imperfección y dejás que hagan su trabajo."
Cupón de descuento: VALE10',null::date,null,'Planificado',null),
  ('COL-0004','Reel','Lo que siempre llevo en mis días de entrenamiento','Mostrar el "kit imprescindible" de Manuu para entrenar y mantenerse hidratado durante el día.',null,'Entrenar no es solo correr. También es estar preparado antes, durante y después.
Estos son algunos de mis infaltables para mantenerme hidratado y organizado todos los días 
Todo de @unibrandco
#RunningLife #Contigo #Thermos #Coleman #Unibrandco #VidaActiva',null::date,null,'Planificado',null),
  ('COL-0004','Historia','Historia (sin título)',null,null,'Historia 1
Video preparando el bolso.
Texto:
"¿Ustedes son de salir a entrenar con todo organizado o improvisan sobre la marcha?"
Encuesta:
Organizado 
Improviso
Historia 2
Mostrando la botella Contigo.
Texto:
"La botella de agua es probablemente lo que más uso durante el día."
Código de descuento: MANU10',null::date,null,'Planificado',null),
  ('COL-0005','Reel','Un unboxing que tiene de todo','Vico recibe un paquete de Unibrandco y va descubriendo distintos productos. La idea es transmitir el efecto de "cada vez que saco algo, aparece una categoría diferente", reforzando que en una sola compra puede encontrar todo lo que necesita.','Escena 1 (Hook - primeros 3 segundos)
Plano de la caja.
Texto en pantalla:
"Hay algo que me encantó Unibrandco..."

Escena 2
Vico abre la caja mientras habla a cámara.
Diálogo:
"Entré buscando una sola cosa... y terminé encontrando un montón de productos que quería probar."

Escena 3
Plano de todos los productos sobre la mesa.
Diálogo:
"Acompáñenme a ver todo lo que conseguí..."

Escena 4
Saca el protector solar.
Diálogo:
"Primero este protector solar, que ya necesitaba reponer."

Escena 5
Saca el contorno de ojos.
Diálogo:
"También elegí un contorno de ojos para sumar a mi rutina."

Escena 6
Saca el shampoo John Frieda.
Diálogo:
"Hace mucho quería probar John Frieda, así que aproveché y pedí este shampoo."

Escena 7
Saca el perfume.
Diálogo:
"Y obvio no podía faltar un perfume..."

Escena 8
Saca el mate Thermos.
Diálogo:
"Y miren este mate de Thermos... me encantó."

Escena 9 (Cierre)
Plano de todos los productos juntos.
Diálogo:
"Lo que más me sorprendió es que en Unibrandco encontrás skincare, cuidado del cabello, perfumes, tienen un montón de descuentos, 6 cuotas sin interés y 10% de descuento pagando con transferencia".','Hay algo que me encantó de este pedido: entré buscando una cosa... y terminé encontrando un montón de productos que quería probar. 🤍

Skincare, cuidado del cabello, perfumes, accesorios y mucho más, todo en un mismo lugar.

Les muestro todo lo que encontré en este unboxing 👀✨

¿Ya sabían que podían encontrar todo esto en un mismo lugar?

Descubrí todas las marcas y productos en www.unibrandco.com.ar 

@unibrandco

#Unboxing #BeautyFinds #Lifestyle #Unibrandco #Skincare #JohnFrieda #Thermos','2026-08-07'::date,null,'Publicado',null),
  ('COL-0006','Reel','Día del Niño',null,null,null,null::date,null,'Publicado',null),
  ('COL-0007','Reel en colab','Probando los 5 tonos de Vaseline Lip Color + Balm','Aye prueba los 5 tonos disponibles, mostrando cómo queda cada uno en sus labios y comentando las principales características del producto.
La idea es que el reel tenga un formato dinámico, tipo "probando todos los tonos para elegir mi favorito", para aprovechar la curiosidad que genera ver el resultado de cada color.
El mensaje principal sería:
"No tengo que elegir entre hidratación y color."','Escena 1 – Hook (primeros 3 segundos)
Aye muestra los 5 productos juntos frente a cámara.
Diálogo:
"Si, como yo, siempre terminás usando bálsamo labial, pero también te gusta darle un poquito de color a tus labios, tienen que ver esto."
Texto en pantalla:
"Probando los 5 tonos de Vaseline Lip Color + Balm "

Escena 2 – Presentación del producto
Plano de los cinco tonos sobre una mesa o en la mano.
Diálogo:
"Los nuevos Vaseline Lip Color + Balm, están pensados para darle hidratación a los labios, pero también un toque sutil de color."
Texto en pantalla:
Hasta 24 h de hidratación
Color natural
Brillo saludable

Escena 3 – Tono 1
Aye aplica los diferentes tonos comentando que le gusta de cada uno, para que lo usaría y cuál es su favorito.


Escena 4 – Comparativa
Montaje rápido mostrando los 5 resultados.
Puede aparecer en pantalla:
¿Cuál es tu favorito? 
1️⃣
2️⃣
3️⃣
4️⃣
5️⃣

Escena 5 – Cierre
Aye muestra nuevamente los productos.
Diálogo:
"Lo que me gusta es que además de dar un toque de color, ayudan a mantener los labios hidratados hasta por 24 horas. Están formulados con vaselina Vaseline®, manteca de karité y miel de manuka para dejar los labios suaves y con un brillo saludable."
Cierre:
"Los 5 tonos los conseguís en @unibrandco 🤍"','💋 ¿Bálsamo labial o un toque de color? Con Vaseline Lip Color + Balm no tenés que elegir.
Probé los 5 tonos disponibles y cada uno deja un toque de color sutil mientras ayuda a mantener los labios hidratados hasta por 24 horas ✨
Además, están formulados con vaselina Vaseline®, manteca de karité y miel de manuka para dejar los labios suaves y con un brillo saludable. 🤍
¿Cuál de los 5 tonos elegirías vos? 👀
Encontrá todos los tonos de Vaseline Lip Color + Balm en @unibrandco o ingresá a www.unibrandco.com.ar 🛍️
#Vaseline #VaselineLipColorBalm #LipBalm #Beauty #CuidadoDeLabios #Unibrandco',null::date,null,'Planificado',null)
) as v(codigo, formato, titulo, concepto, guion, copy, fecha, link, estado, obs)
join bronze.mkt_colaboraciones c on c.codigo = v.codigo
where not exists (select 1 from bronze.mkt_contenido);

commit;
