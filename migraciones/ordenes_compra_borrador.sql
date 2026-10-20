-- migración `ordenes_compra_borrador` · 19/10/2026
--
-- Vive acá por lo mismo que la de al lado: el schema de `app` lo produce la
-- aplicación, no el orquestador, así que si no está escrito en el repo no está
-- escrito en ningún lado.
--
-- ---------------------------------------------------------------------------
-- POR QUÉ EXISTE
--
-- Una orden de compra se arma en la pantalla y no existe en ningún lado hasta
-- que se baja el archivo. El encargado de compras estaba armando una, le dio
-- sin querer a recargar y perdió todo lo que llevaba cargado.
--
-- ---------------------------------------------------------------------------
-- SE GUARDAN LAS DECISIONES, NO LA ORDEN
--
-- `renglones` es sólo lo que la persona TOCÓ: el artículo que cargó a mano, el
-- que sacó, el que cambió de unidad. Todo lo demás se recalcula al abrir.
--
-- Es a propósito y es la decisión más importante del diseño. Un borrador del
-- viernes abierto el lunes tiene que mostrar los sugeridos del LUNES con las
-- decisiones del viernes encima; guardando la orden entera mostraría números
-- de hace tres días y nadie se enteraría. Además son unas decenas de SKU y no
-- las 986 filas que puede tener un proveedor.
--
-- ---------------------------------------------------------------------------
-- `sugeridos` ES PARA PODER AVISAR QUE LOS NÚMEROS SE MOVIERON
--
-- Como el resto se recalcula, un borrador puede cambiar solo entre que se
-- guarda y se abre: el pipeline corre cada hora y medía y los sugeridos salen
-- de las ventas. Sin esta foto no habría forma de decir "ojo, esto cambió".
--
-- Guarda el sugerido de cada SKU tal como estaba al guardar, para poder
-- comparar y decir CUÁLES cambiaron -- que es lo que hace que "revisar" sea
-- una instrucción y no una sensación.
create schema if not exists app;

create table if not exists app.ordenes_compra_borrador (
  -- UNO POR PERSONA Y POR PROVEEDOR. Es el modelo mental: "la OC de GLAM que
  -- estoy armando". Sin nombres ni gestor de borradores; para el histórico de
  -- lo que sí se mandó está `ordenes_compra_enviadas`.
  usuario           text not null,
  proveedor         text not null,
  creado_en         timestamptz not null default now(),
  actualizado_en    timestamptz not null default now(),
  -- El contexto con el que se armó: cambia los sugeridos, así que al retomar
  -- hay que volver a ponerlo o los números no son los mismos.
  mes               text,
  ventana           integer,
  cobertura         integer,
  -- La nota de la carátula del Excel, que también se pierde al recargar.
  nota              text,
  -- Sólo lo tocado: { sku: { unidad, cantidad, descuento, descuento2 } }.
  renglones         jsonb not null default '{}'::jsonb,
  -- Foto de los sugeridos al guardar: { sku: cantidad }. Ver arriba.
  sugeridos         jsonb not null default '{}'::jsonb,
  primary key (usuario, proveedor)
);

-- TRES DÍAS Y SE VAN.
--
-- Un borrador es trabajo a medio hacer, no un documento: pasada una semana los
-- sugeridos que tiene adentro ya no se parecen a los de hoy, y retomarlo sería
-- peor que empezar de nuevo. Que caduque solo evita además la otra cosa que
-- pasa siempre -- que queden veinte borradores viejos y nadie sepa cuál vale.
--
-- El corte se aplica AL LEER y no sólo con la limpieza: así un borrador vencido
-- no aparece ni aunque la limpieza no haya corrido todavía. La limpieza es sólo
-- para que la tabla no junte filas muertas.
create index if not exists ordenes_compra_borrador_actualizado
  on app.ordenes_compra_borrador (actualizado_en);

-- Se corre con el pg_cron que ya existe en esta base (ver despertador.sql).
-- Si esta sentencia falla porque cron no está disponible, no es grave: la
-- lectura ya ignora los vencidos.
select cron.schedule(
  'limpiar-borradores-oc',
  '17 4 * * *',
  $$delete from app.ordenes_compra_borrador
     where actualizado_en < now() - interval '3 days'$$
);
