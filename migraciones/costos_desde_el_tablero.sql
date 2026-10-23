-- migración `costos_desde_el_tablero` · 23/10/2026
--
-- ACTUALIZAR LOS COSTOS DESDE UN BOTON, SIN EL EXCEL DEL MEDIO.
--
-- Hoy la actualización de costos es: exportar el maestro de Sigma a un Excel,
-- pegarle encima la hoja del Consolidador de Ofertas, nombrar el archivo con
-- la fecha, subirlo al repositorio del orquestador y esperar la corrida.
--
-- Las dos mitades ya existen sin el Excel:
--
--   costo teórico   lo sincroniza `sigma.py --catalogo` por API. Se verificó
--                   contra el archivo: 8.184 de 8.299 idénticos, y los 13
--                   distintos eran artículos que Sigma modificó DESPUES del
--                   export -- o sea que el maestro es el número más fresco.
--   ofertas         las manda el Apps Script del Consolidador a
--                   `bronze.ofertas_crudo` (ver el PR 129 de tablero_quo).
--
-- ---------------------------------------------------------------------------
-- POR QUE UNA TABLA PARA LOS TRAMOS
--
-- `costos_historicos` guarda los números. Lo que no guarda es POR QUE: hoy eso
-- vive en el nombre del archivo ("2026-10-21.xlsx") y en la cabeza de quien lo
-- subió. Dos meses después, mirando un tramo a mitad de mes, no hay forma de
-- saber si fue un aumento de un proveedor, una corrección o el cierre.
--
-- Acá queda la nota, quién lo aplicó y cuándo. Un tramo que vino del Excel no
-- tiene fila en esta tabla, y eso también dice algo: salió del camino viejo.
--
-- Los contadores (artículos, con_oferta, faltantes, cambian) se guardan en vez
-- de recalcularse porque describen la foto DEL MOMENTO en que se aplicó. El
-- maestro y la planilla cambian; lo que se vio al apretar el botón, no.
create table if not exists bronze.costos_tramos (
  mes_comercial text not null,
  vigente_desde date not null,
  nota          text,
  aplicado_por  text,
  aplicado_en   timestamptz not null default now(),
  articulos     integer not null default 0,
  con_oferta    integer not null default 0,
  faltantes     integer not null default 0,
  cambian       integer not null default 0,
  primary key (mes_comercial, vigente_desde)
);

-- LOS QUE SE QUEDAN SIN COSTO TEORICO van aparte de `cambian` y no sumados a
-- el. Salio de probar el boton contra los datos de verdad: de 16 articulos que
-- "cambiaban", 3 iban a cero porque el maestro ya no los cotiza (CI123 de
-- consumo interno y dos perfumes Puig discontinuados). El costo viejo les sigue
-- rigiendo --las consultas saltean los ceros-- asi que no es un cambio: es una
-- ausencia, y contarla como cambio hacia leer 16 donde cambiaban 13.
alter table bronze.costos_tramos
  add column if not exists sin_costo_teorico integer not null default 0;
