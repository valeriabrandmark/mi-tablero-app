-- migración `compras_parametros` · 10/11/2026
--
-- Las reglas del sugerido de Compras, editables desde el panel en vez de
-- constantes en el código. Ver lib/compras-parametros.ts.
--
-- UNA FILA POR REGLA, Y SÓLO LAS QUE SE CAMBIARON. Lo que no está en la tabla
-- vale lo de siempre (el `porDefecto` del código), así que con la tabla vacía
-- el sugerido da exactamente lo mismo que antes de esta migración. "Volver al
-- valor por defecto" es borrar la fila.
--
-- SON DE TODOS, NO DE CADA UNO. A diferencia del borrador de una orden, estas
-- reglas cambian el sugerido que ve cualquiera que abra Compras: por eso
-- escribirlas pide permiso de edición en Compras y queda registrado quién y
-- cuándo en el historial.
create schema if not exists app;

create table if not exists app.compras_parametros (
  clave           text primary key,
  valor           numeric not null,
  actualizado_por text not null,
  actualizado_en  timestamptz not null default now()
);

-- Cada cambio, para poder contestar "¿por qué el sugerido de la semana pasada
-- daba otra cosa?". `valor` null = se volvió al valor por defecto.
create table if not exists app.compras_parametros_historial (
  id              bigserial primary key,
  clave           text not null,
  valor_anterior  numeric,
  valor           numeric,
  usuario         text not null,
  creado_en       timestamptz not null default now()
);

create index if not exists compras_parametros_historial_creado
  on app.compras_parametros_historial (creado_en desc);

-- La tabla que llena tablero_quo (stock_diario.py). Se crea también acá para
-- que la consulta de Compras no falle si el paso todavía no corrió nunca: sin
-- filas, el ritmo cae a la regla de la ventana.
create schema if not exists gold;
create table if not exists gold.dias_con_stock (
  sku             text    not null,
  deposito        text    not null,
  ventana         integer not null,
  dias_con_stock  integer not null,
  dias_con_foto   integer not null,
  actualizado     timestamptz not null default now(),
  primary key (sku, deposito, ventana)
);
