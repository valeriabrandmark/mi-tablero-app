-- migración `fixy` · 24/11/2026
--
-- Lo que el tablero escribe sobre FIXY, el depósito de Buenos Aires que
-- despacha Tienda Nube (UniBrandCo, Diaper Genie, Hola Toys, Litter Genie) y
-- Mercado Libre Flex. Va en `app` por lo mismo que las órdenes de compra: lo
-- produce la aplicación, y una recarga del pipeline no se lo puede llevar.
--
-- Lo que FIXY TIENE (la foto de stock) no está acá: lo carga el orquestador en
-- `bronze.fixy_stock` y `bronze.fixy_stock_historico` (tablero_quo/fixy.py).
--
-- ---------------------------------------------------------------------------
-- RECEPCIONES: LO QUE LE AVISAMOS A FIXY QUE VA A ENTRAR
--
-- Es la mitad del control "que entre lo que mandamos". La API de FIXY permite
-- CREAR una orden de recepción (`generar-recepcion`) pero no CONSULTARLA
-- después: lo que contaron al recibir no vuelve por ningún lado. Lo único que
-- queda es lo que pedimos, y por eso se guarda acá, renglón por renglón,
-- contra la suba que después muestre la foto de stock.
create schema if not exists app;

create table if not exists app.fixy_recepciones (
  id              bigint generated always as identity primary key,
  creada_en       timestamptz not null default now(),
  -- Quién la mandó. Texto y no FK, igual que en las órdenes de compra.
  usuario         text,
  -- El remito con el que la conoce FIXY. Único: mandar dos veces el mismo
  -- envío duplicaría el ingreso esperado y escondería un faltante.
  remito          text not null unique,
  -- 'digip': un envío preparado en Tucumán. 'manual': lo demás, sobre todo
  -- las importaciones, que llegan directo del puerto a FIXY.
  origen          text not null check (origen in ('digip', 'manual')),
  -- El pedido de Digip del que sale, si sale de uno. Único por lo mismo que
  -- el remito: un envío se avisa una sola vez.
  pedido_digip    text unique,
  fecha_pactada   date not null,
  renglones       integer not null,
  unidades        numeric not null,
  -- 'ok' si FIXY contestó 2xx. 'incierto' si contestó un error del servidor
  -- (5xx o se cortó): la orden pudo haber entrado igual, y hay que mirarlo en
  -- el sistema de FIXY antes de reintentar. Un rechazo (4xx) no se guarda.
  resultado       text not null check (resultado in ('ok', 'incierto')),
  respuesta       text,
  -- El cuerpo exacto que viajó, sin el token.
  payload         jsonb not null
);

create table if not exists app.fixy_recepciones_items (
  recepcion_id  bigint not null references app.fixy_recepciones (id) on delete cascade,
  sku           text not null,
  descripcion   text,
  cajas         integer not null,
  cantidad      numeric not null,
  primary key (recepcion_id, sku)
);

create index if not exists fixy_recepciones_items_sku
  on app.fixy_recepciones_items (sku);

-- ---------------------------------------------------------------------------
-- EVENTOS: LOS CAMBIOS DE ESTADO DE LAS GUÍAS QUE NOS MANDA FIXY
--
-- FIXY no tiene un listado de envíos por fecha: sólo el seguimiento de UNA
-- guía. La única forma de tener la historia de despachos (cuántos salen, cuánto
-- tardan, cuántos vuelven) es que FIXY nos avise cada cambio, que es lo que
-- hace su webhook (`integracion.json`) contra /api/fixy/webhook. Se guarda
-- todo lo que llega, tal cual: los tiempos se calculan en la consulta.
create table if not exists app.fixy_eventos (
  id             bigint generated always as identity primary key,
  recibido_en    timestamptz not null default now(),
  guia           text,
  remito         text,
  estado         text,
  codigo_estado  text,
  cuerpo         jsonb not null
);

create index if not exists fixy_eventos_guia on app.fixy_eventos (guia, recibido_en);
create index if not exists fixy_eventos_remito on app.fixy_eventos (remito);
