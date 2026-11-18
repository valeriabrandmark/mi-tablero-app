-- migración `sigma_maestro_tablero` · 18/11/2026
--
-- Cada vez que la pantalla de costos le pide el maestro a Sigma y Sigma
-- contesta bien, la respuesta se guarda acá. Ver lib/sigma-maestro-guardado.ts.
--
-- ---------------------------------------------------------------------------
-- POR QUÉ EXISTE
--
-- La pantalla le pedía el maestro entero a Sigma en CADA request: dos al
-- abrirla (la carga y la recarga cuando vuelve la planilla), una al bajar el
-- Excel y otra al aplicar. Recargar para "volver a probar" sumaba dos más.
-- Sigma contesta 429 cuando se lo apura, así que la pantalla misma lo saturaba
-- y terminaba en la copia del orquestador, que es del día anterior.
--
-- Con esto:
--   * Un pedido bueno sirve unos minutos para todos los requests que siguen.
--   * El POST de aplicar y el Excel usan EXACTAMENTE el pedido que se miró,
--     por id, sin volver a llamar a Sigma.
--   * Si Sigma no contesta, el plan B es el último pedido bueno del tablero
--     (de hace minutos u horas) antes que la copia diaria del orquestador.
--
-- Sin esta tabla la pantalla sigue andando como antes: todo lo que la lee y
-- la escribe tolera que no exista.

create schema if not exists app;

create table if not exists app.sigma_maestro (
  id        bigserial primary key,
  pedido    timestamptz not null default now(),
  -- La lista ya recortada (activos con código), como `ArticuloParaCostear[]`.
  articulos jsonb not null,
  n         integer not null
);

create index if not exists sigma_maestro_pedido_idx
  on app.sigma_maestro (pedido desc);
