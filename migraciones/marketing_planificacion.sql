-- ===========================================================================
--  MARKETING → PLANIFICACIÓN: calendario, iniciativas y subtareas
-- ===========================================================================
--
-- El apartado de planificación del área de marca. Sigue el esquema con el que
-- planifican los equipos de marketing grandes:
--
--   1. CALENDARIO ANUAL con los "momentos fuertes" (tentpoles): Día del Niño,
--      Día de la Madre, Hot Sale, CyberMonday, Navidad... Cada fecha dice
--      cuántos días antes hay que EMPEZAR a planificarla.
--   2. INICIATIVAS (campañas, colaboraciones, revista, ferias): cada una con
--      su BRIEF (objetivo, KPI y meta, público, canales, presupuesto), un
--      responsable único y una fecha de entrega.
--   3. SUBTAREAS por FASE (brief → producción → aprobación → lanzamiento →
--      medición), con responsable y fecha. El avance de la iniciativa sale de
--      las subtareas hechas, no de un porcentaje cargado a ojo.
--
-- Se corre una sola vez, desde el editor SQL de Supabase. Es idempotente.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Fechas del calendario comercial
-- ---------------------------------------------------------------------------
create table if not exists bronze.mkt_eventos (
  id                 bigserial   primary key,
  nombre             text        not null,
  desde              date        not null,
  hasta              date        not null,
  -- comercial: evento de venta (Hot Sale, CyberMonday)
  -- regalo:    fecha en la que se compra para regalar (Día del Niño, Madre)
  -- estacional: temporada (vuelta al cole, vacaciones de invierno)
  -- efemeride: fecha temática que sirve para contenido (Día del Gato)
  -- feria / interno: lo que cargue el equipo
  tipo               text        not null default 'comercial'
                     check (tipo in ('comercial', 'regalo', 'estacional', 'efemeride', 'feria', 'interno')),
  -- 3 = fecha clave del año, 2 = importante, 1 = oportunidad de contenido
  importancia        smallint    not null default 2 check (importancia between 1 and 3),
  -- Cuántos días antes de `desde` hay que empezar a planificar.
  anticipacion_dias  integer     not null default 45,
  -- Cuántos días antes de `desde` sale la campaña al aire (en una fecha de
  -- regalo la gente compra antes: la campaña tiene que estar dos semanas antes).
  lanzamiento_dias   integer     not null default 0,
  -- null = todas las marcas.
  marcas             text[],
  -- Fecha no confirmada todavía (Hot Sale y CyberMonday los anuncia la CACE).
  estimada           boolean     not null default false,
  nota               text,
  creado_por         text,
  creado_en          timestamptz not null default now(),
  check (hasta >= desde)
);
create index if not exists mkt_eventos_desde on bronze.mkt_eventos (desde);
create unique index if not exists mkt_eventos_nombre_desde on bronze.mkt_eventos (nombre, desde);

-- ---------------------------------------------------------------------------
-- 2. Iniciativas (con su brief)
-- ---------------------------------------------------------------------------
create table if not exists bronze.mkt_iniciativas (
  id              bigserial   primary key,
  titulo          text        not null,
  -- diaper_genie | hola_toys | unibrandco | litter_genie | todas
  marca           text        not null default 'todas',
  tipo            text        not null default 'campana'
                  check (tipo in ('campana', 'contenido', 'influencer', 'revista', 'tienda', 'mayorista', 'feria', 'interna')),
  evento_id       bigint      references bronze.mkt_eventos (id) on delete set null,
  -- El brief.
  objetivo        text,
  kpi             text,
  meta            numeric,
  publico         text,
  canales         text[],
  presupuesto     numeric,
  gasto           numeric,
  -- Colaboraciones con influencers: el cupón único con el que se mide la venta.
  cupon           text,
  -- Ejecución.
  responsable     text,
  inicio          date,
  vence           date        not null,
  estado          text        not null default 'planificada'
                  check (estado in ('idea', 'planificada', 'en_curso', 'en_revision', 'entregada', 'cancelada')),
  prioridad       smallint    not null default 2 check (prioridad between 1 and 3),
  entregado_en    date,
  -- La medición después del lanzamiento: qué pasó contra el KPI.
  resultado       text,
  creado_por      text,
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now()
);
create index if not exists mkt_iniciativas_vence on bronze.mkt_iniciativas (vence);
create index if not exists mkt_iniciativas_evento on bronze.mkt_iniciativas (evento_id);

-- ---------------------------------------------------------------------------
-- 3. Subtareas
-- ---------------------------------------------------------------------------
create table if not exists bronze.mkt_subtareas (
  id              bigserial   primary key,
  iniciativa_id   bigint      not null references bronze.mkt_iniciativas (id) on delete cascade,
  titulo          text        not null,
  fase            text        not null default 'produccion'
                  check (fase in ('brief', 'produccion', 'aprobacion', 'lanzamiento', 'medicion')),
  responsable     text,
  vence           date,
  hecha           boolean     not null default false,
  hecha_en        timestamptz,
  orden           integer     not null default 0
);
create index if not exists mkt_subtareas_iniciativa on bronze.mkt_subtareas (iniciativa_id, orden);
create index if not exists mkt_subtareas_vence on bronze.mkt_subtareas (vence) where not hecha;

alter table bronze.mkt_eventos     enable row level security;
alter table bronze.mkt_iniciativas enable row level security;
alter table bronze.mkt_subtareas   enable row level security;

-- ---------------------------------------------------------------------------
-- 4. El calendario comercial argentino, para arrancar
-- ---------------------------------------------------------------------------
-- Las fechas por regla fija están calculadas (tercer domingo de agosto, de
-- octubre, de junio; Black Friday = viernes después del 4.º jueves de
-- noviembre). Hot Sale y CyberMonday van como ESTIMADAS: la CACE las confirma
-- con poca anticipación; cuando las anuncie, se corrigen desde la pantalla.
insert into bronze.mkt_eventos (nombre, desde, hasta, tipo, importancia, anticipacion_dias, lanzamiento_dias, marcas, estimada, nota) values
  ('Black Friday',                       '2026-11-27', '2026-11-30', 'comercial',  2, 30,  2, null, false, 'Viernes después del Día de Acción de Gracias de EE.UU.'),
  ('Navidad',                            '2026-12-25', '2026-12-25', 'regalo',     3, 60, 24, null, false, 'La venta se juega del 1 al 23 de diciembre.'),
  ('Reyes Magos',                        '2027-01-06', '2027-01-06', 'regalo',     2, 45, 14, '{hola_toys}', false, null),
  ('San Valentín',                       '2027-02-14', '2027-02-14', 'regalo',     1, 30,  7, null, false, null),
  ('Vuelta al cole',                     '2027-02-15', '2027-03-05', 'estacional', 1, 30,  0, null, true,  'Varía por provincia.'),
  ('Pascuas',                            '2027-03-28', '2027-03-28', 'regalo',     1, 30,  7, '{hola_toys}', false, null),
  ('Día del Animal',                     '2027-04-29', '2027-04-29', 'efemeride',  1, 20,  0, '{litter_genie}', false, 'Fecha para contenido.'),
  ('Hot Sale',                           '2027-05-10', '2027-05-12', 'comercial',  3, 60,  3, null, true,  'Estimado: la CACE confirma la fecha. Suele ser lunes a miércoles de mediados de mayo.'),
  ('Día del Padre',                      '2027-06-20', '2027-06-20', 'regalo',     2, 45, 14, null, false, 'Tercer domingo de junio.'),
  ('Vacaciones de invierno',             '2027-07-12', '2027-07-23', 'estacional', 2, 45,  7, '{hola_toys}', true, 'Varía por provincia.'),
  ('Día del Amigo',                      '2027-07-20', '2027-07-20', 'efemeride',  1, 20,  0, null, false, 'Fecha para contenido.'),
  ('Semana Mundial de la Lactancia',     '2027-08-01', '2027-08-07', 'efemeride',  1, 30,  0, '{diaper_genie}', false, 'Fecha para contenido.'),
  ('Día Internacional del Gato',         '2027-08-08', '2027-08-08', 'efemeride',  1, 20,  0, '{litter_genie}', false, 'Fecha para contenido.'),
  ('Día del Niño',                       '2027-08-15', '2027-08-15', 'regalo',     3, 75, 21, '{hola_toys}', false, 'Tercer domingo de agosto. La fecha más fuerte de juguetes después de Navidad.'),
  ('Día de la Madre',                    '2027-10-17', '2027-10-17', 'regalo',     3, 60, 21, '{diaper_genie,hola_toys}', false, 'Tercer domingo de octubre.'),
  ('CyberMonday',                        '2027-11-01', '2027-11-03', 'comercial',  3, 60,  3, null, true,  'Estimado: la CACE confirma la fecha. Suele ser la primera semana de noviembre.'),
  ('Black Friday',                       '2027-11-26', '2027-11-29', 'comercial',  2, 30,  2, null, false, null),
  ('Navidad',                            '2027-12-25', '2027-12-25', 'regalo',     3, 60, 24, null, false, 'La venta se juega del 1 al 23 de diciembre.')
on conflict (nombre, desde) do nothing;

commit;
