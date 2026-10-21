-- migración `ordenes_compra_numero_sigma` · 21/10/2026
--
-- EL NUMERO DE OC QUE DEVUELVE SIGMA.
--
-- Pedido de ANA: poder identificar la misma orden de los dos lados. Hasta
-- ahora la orden existía en Sigma con un número que nosotros no conocíamos, y
-- en el tablero con un id que Sigma no conoce.
--
-- SIGMA LO DEVUELVE DESDE EL 09/09/2026. Su changelog dice:
--
--   "ImportOrdenDeCompra devuelve 200 con el número de orden generado al
--    importar correctamente. Antes el éxito no devolvía respuesta y la API
--    informaba un error 500 aunque la orden quedaba creada."
--
-- Y la doc del endpoint: 200 con "Orden de compra importada correctamente.
-- OC Nro: <focpnum>".
--
-- PERO NUESTRAS ORDENES SIGUEN VOLVIENDO CON EL CUERPO VACIO. Las 37 que
-- mandamos --incluidas las del 19 y 20 de octubre, más de un mes después del
-- arreglo-- tienen `respuesta` en blanco. O no está desplegado en la instancia
-- de Quo, o el número viaja en un header.
--
-- Por eso esto guarda DOS cosas y no una: el número cuando se lo encuentra, y
-- los headers de la respuesta cuando no. La próxima orden que se mande dice
-- cuál de las dos cosas pasa, sin tener que mandar una de prueba al ERP.
alter table app.ordenes_compra_enviadas
  add column if not exists numero_sigma text;

comment on column app.ordenes_compra_enviadas.numero_sigma is
  'El OC Nro que devuelve ImportOrdenDeCompra. Null si no vino.';

-- Los headers de la respuesta, para encontrar el número si no está en el
-- cuerpo. Es diagnóstico: se puede vaciar cuando se sepa dónde viene.
alter table app.ordenes_compra_enviadas
  add column if not exists respuesta_headers jsonb;

comment on column app.ordenes_compra_enviadas.respuesta_headers is
  'Headers de la respuesta de Sigma. Diagnostico: ver migracion del 21/10/2026.';
