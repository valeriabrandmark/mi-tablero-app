-- migración `facturas_enviadas_reclamo` · 22/10/2026
--
-- QUE SE RECLAMO Y QUE QUEDO SIN RECLAMAR.
--
-- `app.facturas_compra_enviadas` ya guardaba qué se mandó a Sigma. Lo que no
-- guardaba es lo que esta migración agrega: QUE DIFERENCIAS TENIA esa factura
-- contra la orden, y si alguien hizo algo con ellas.
--
-- ---------------------------------------------------------------------------
-- POR QUE HACE FALTA GUARDAR LAS DIFERENCIAS Y NO RECALCULARLAS
--
-- El cruce sale de la OC y del maestro, y los dos cambian: una OC se anula, un
-- artículo cambia de costo, el maestro se reescribe entero en cada corrida del
-- orquestador. Recalcular el cruce de una factura de hace dos meses daría otro
-- número, y el reclamo se hace sobre el que se vio el día que se mandó.
--
-- Por eso van las líneas tal como estaban, congeladas.
--
-- ---------------------------------------------------------------------------
-- LOS TRES ESTADOS, Y POR QUE "OMITIDO" NO ES "RECLAMADO"
--
--   pendiente   tenía diferencias y nadie hizo nada todavía. Es lo que la
--               pantalla muestra primero: lo que falta reclamar.
--   reclamado   se le pidió al proveedor. Queda cerrado.
--   omitido     se decidió NO reclamarlo. También queda cerrado, pero dice
--               otra cosa: no es que se reclamó, es que se dejó pasar.
--
-- Son dos cierres distintos a propósito. Un mes con mucho omitido no se lee
-- igual que uno con mucho reclamado, y meterlos en el mismo estado borraría
-- justo el dato que haría falta para notarlo.
--
-- Una factura sin diferencias nace en 'pendiente' igual, pero no tiene nada
-- que reclamar: la pantalla la cuenta aparte y no la pide.
alter table app.facturas_compra_enviadas
  add column if not exists diferencias jsonb,
  add column if not exists renglones_con_diferencia integer not null default 0,
  add column if not exists dif_costo numeric not null default 0,
  add column if not exists dif_cantidad numeric not null default 0,
  add column if not exists reclamo text not null default 'pendiente',
  add column if not exists reclamo_en timestamptz,
  add column if not exists reclamo_por text,
  add column if not exists reclamo_nota text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'facturas_compra_enviadas_reclamo_ck'
  ) then
    alter table app.facturas_compra_enviadas
      add constraint facturas_compra_enviadas_reclamo_ck
      check (reclamo in ('pendiente', 'reclamado', 'omitido'));
  end if;
end $$;

-- La pantalla entra siempre por "qué falta reclamar", así que ese es el índice
-- que importa: las que tienen diferencias y siguen pendientes.
create index if not exists facturas_compra_enviadas_pendientes
  on app.facturas_compra_enviadas (reclamo, enviada_en desc)
  where renglones_con_diferencia > 0;
