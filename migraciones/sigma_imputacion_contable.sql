-- migración `sigma_imputacion_contable` · 21/10/2026
--
-- LAS CUENTAS CON LAS QUE SE IMPUTA UNA FACTURA DE COMPRA EN SIGMA.
--
-- `ImportCompras` pide `contable[]` obligatorio: el neto por alícuota, el IVA
-- por alícuota y una línea por cada percepción, cada una con su cuenta, su
-- tipo de impuesto y a veces una subcuenta.
--
-- ---------------------------------------------------------------------------
-- POR QUE EN UNA TABLA Y NO EN EL CODIGO
--
-- Porque son el plan de cuentas de la empresa, no una constante del programa.
-- Inventar una cuenta manda plata al lugar equivocado en la contabilidad, y
-- eso no se nota en ninguna pantalla: se descubre cerrando el mes.
--
-- Es la misma decisión que tomó la planilla de Google que ya carga facturas:
-- las cuentas se cargan una vez en su pestaña SIGMA. Acá viven en la base para
-- que no dependan de quién abrió qué archivo.
--
-- ---------------------------------------------------------------------------
-- LAS DE IIBB VIENEN CARGADAS Y LAS DEMAS NO
--
-- Las 24 percepciones de Ingresos Brutos van todas a la cuenta 8013 con tipo
-- PIB y la subcuenta de la provincia (901 a 924). Eso es fijo y se sabe, así
-- que se siembra acá.
--
-- El neto gravado, el IVA y la percepción de IVA NO se siembran a propósito:
-- no los sé, y una cuenta inventada es peor que una vacía. La pantalla avisa
-- cuál falta cuando una factura la necesita, y recién ahí hay que cargarla.
create schema if not exists app;

create table if not exists app.sigma_imputacion_contable (
  -- El nombre del concepto, tal como lo arma lib/sigma-compra.ts:
  -- "Neto gravado 21 %", "IVA 10,5 %", "Percepción IIBB Tucumán"...
  concepto        text primary key,
  cuenta          text not null,
  subcuenta       text,
  centro_costo    text,
  tipo_impuesto   text not null,
  actualizado_en  timestamptz not null default now(),
  actualizado_por text
);

-- Las 24 percepciones de IIBB: cuenta 8013, tipo PIB, subcuenta por provincia.
insert into app.sigma_imputacion_contable (concepto, cuenta, subcuenta, tipo_impuesto)
values
  ('Percepción IIBB Capital Federal',     '8013', '901', 'PIB'),
  ('Percepción IIBB Buenos Aires',        '8013', '902', 'PIB'),
  ('Percepción IIBB Catamarca',           '8013', '903', 'PIB'),
  ('Percepción IIBB Córdoba',             '8013', '904', 'PIB'),
  ('Percepción IIBB Corrientes',          '8013', '905', 'PIB'),
  ('Percepción IIBB Chaco',               '8013', '906', 'PIB'),
  ('Percepción IIBB Chubut',              '8013', '907', 'PIB'),
  ('Percepción IIBB Entre Ríos',          '8013', '908', 'PIB'),
  ('Percepción IIBB Formosa',             '8013', '909', 'PIB'),
  ('Percepción IIBB Jujuy',               '8013', '910', 'PIB'),
  ('Percepción IIBB La Pampa',            '8013', '911', 'PIB'),
  ('Percepción IIBB La Rioja',            '8013', '912', 'PIB'),
  ('Percepción IIBB Mendoza',             '8013', '913', 'PIB'),
  ('Percepción IIBB Misiones',            '8013', '914', 'PIB'),
  ('Percepción IIBB Neuquén',             '8013', '915', 'PIB'),
  ('Percepción IIBB Río Negro',           '8013', '916', 'PIB'),
  ('Percepción IIBB Salta',               '8013', '917', 'PIB'),
  ('Percepción IIBB San Juan',            '8013', '918', 'PIB'),
  ('Percepción IIBB San Luis',            '8013', '919', 'PIB'),
  ('Percepción IIBB Santa Cruz',          '8013', '920', 'PIB'),
  ('Percepción IIBB Santa Fe',            '8013', '921', 'PIB'),
  ('Percepción IIBB Santiago del Estero', '8013', '922', 'PIB'),
  ('Percepción IIBB Tierra del Fuego',    '8013', '923', 'PIB'),
  ('Percepción IIBB Tucumán',             '8013', '924', 'PIB')
on conflict (concepto) do nothing;

-- ---------------------------------------------------------------------------
-- EL REGISTRO DE LO QUE SE MANDO
--
-- Misma idea que `ordenes_compra_enviadas`: en una operación que escribe en un
-- sistema ajeno y no se puede deshacer desde acá, la constancia de QUE se
-- mandó vale más que el mensaje de éxito.
--
-- Guarda el cuerpo exacto. `id_sigma` es el que hace idempotente al endpoint:
-- con él se puede saber si una factura ya se mandó sin preguntarle a Sigma.
create table if not exists app.facturas_compra_enviadas (
  id              bigint generated always as identity primary key,
  enviada_en      timestamptz not null default now(),
  usuario         text,
  -- El `id` que viajó: FC-{proveedor}-{codigo}-{numero}. Unico por factura.
  id_sigma        text not null,
  proveedor_id    text,
  proveedor_nombre text,
  empresa         text,
  sucursal        text,
  numero_comprobante text,
  tipo_comprobante   text,
  fecha_factura   date,
  total           numeric,
  renglones       integer not null default 0,
  -- 'ok' si Sigma contestó 2xx, 'rechazada' si contestó 400 con una causa,
  -- 'incierto' para cualquier otra cosa. A diferencia de las órdenes, acá
  -- 'rechazada' SI significa que no entró: ImportCompras devuelve 400 con el
  -- motivo y no mezcla el error de validación con el éxito.
  resultado       text not null check (resultado in ('ok', 'rechazada', 'incierto')),
  respuesta       text,
  payload         jsonb not null
);

create index if not exists facturas_compra_enviadas_id_sigma
  on app.facturas_compra_enviadas (id_sigma);
