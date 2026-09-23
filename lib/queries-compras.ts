import { cacheado } from "@/lib/cache";
import { query, queryOne } from "@/lib/db";
import { agregarFiltro } from "@/lib/filtros";
import { COSTOS_VIGENTES_POR_MES, ULTIMO_COSTO_VIGENTE } from "@/lib/sql-costos";
import {
  COBERTURA_MAXIMA_COMPRA_DIAS,
  COBERTURA_SIN_INFLAR_DIAS,
  RENTABILIDAD_COMPRA_DISCRETA,
  DIAS_ARTICULO_NUEVO,
  MESES_SIN_SELL_IN_PARA_SUGERIR,
  VECES_SOBRE_LO_HABITUAL_PARA_INFLAR,
  recortesValidos,
  FACTOR_OFERTA_MAX,
  MESES_HISTORIA_SELL_IN,
  MESES_RENTABILIDAD,
  PUNTOS_OFERTA_PARA_DUPLICAR,
  coberturaValida,
} from "@/lib/compras";
import {
  COBERTURA_OBJETIVO_DIAS,
  DIAS_MINIMOS_DE_RITMO,
  GRUPO_PROVEEDOR_POR_DEFECTO,
  PLAZO_REPOSICION_DIAS,
  PROVEEDORES_NO_MERCADERIA,
  VENTANA_POR_DEFECTO,
} from "@/lib/stock";
import { POR_INVENTARIO_SKU } from "@/lib/sql-meli";
import type { ArticuloParaOrden } from "@/lib/sigma-orden";
import type {
  DashboardCompras,
  FilaCompra,
  FiltrosCompras,
  RecorteCompras,
} from "@/lib/types";

/**
 * Consultas del panel de Compras.
 *
 * Las cuentas de stock son LAS MISMAS que las del tablero de Stock —ritmo,
 * cobertura, sugerido— y salen de las mismas constantes de lib/stock.ts. Lo que
 * agrega esta pantalla es lo que hace falta para ARMAR LA ORDEN y no sólo para
 * mirarla:
 *
 *   unidadesPorBulto            para poder pedir en bultos
 *   oferta_pct del mes          el descuento del proveedor, que va a FDESCU1
 *   rentabilidad de 3 meses     para saber si se vende bien o si se estaba
 *                               liquidando, que es una decisión distinta
 *
 * $1 ventana del ritmo · $2 proveedores que no son mercadería · $3 mes de oferta
 * $4 días de cobertura que se quieren comprar
 */
const BASE = `
with por_inv as (
  -- Un renglón por INVENTARIO y no por publicación: varias publicaciones
  -- comparten el mismo stock físico, y sumarlas lo contaría de más.
  ${POR_INVENTARIO_SKU}
),
full_ml as (
  select i.sku, sum(coalesce(f.available_quantity, 0)) as unidades
  from bronze.ml_stock_full f
  join por_inv i on i.inventory_id = f.inventory_id
  where i.sku is not null
  group by i.sku
),
tuc as (
  -- Agrupado por código: hay 24 códigos repetidos en el export de Digip.
  select trim(codigo) as sku, sum(coalesce("stock.disponible", 0)) as unidades
  from bronze.digip_stock
  group by 1
),
-- El costo con el que se valoriza: el último que tenga cargado (ver
-- lib/sql-costos.ts).
costo as (
  ${ULTIMO_COSTO_VIGENTE}
),
-- El sell in VIGENTE DEL PROVEEDOR en el mes elegido: el descuento con el que
-- se le pide, y el único que puede ir a FDESCU1.
--
-- SALE DE bronze.sell_in Y NO DE costos_historicos, y la diferencia no es un
-- detalle: el oferta_pct de costos_historicos es un sell in CALCULADO a partir de
-- nuestras compras, que se usa para trasladarlo a las ofertas del mes. Sirve
-- para valorizar lo que ya compramos; NO es lo que el proveedor tiene vigente.
-- Mandarlo en una orden de compra sería pedir con un descuento inventado.
--
-- SE EXCLUYEN LOS EVENTOS, por lo mismo que en la historia de más abajo: una
-- oferta de "HOT SALE" no es el descuento del mes, y con las dos cargadas el
-- join devolvía dos filas para el mismo artículo y duplicaba sus unidades en
-- todos los totales de la tabla.
sell_in as (
  select sku, descuento_pct
  from bronze.sell_in
  where mes_comercial = $3::text
    and evento = ''
),
-- El costo de lista del mes elegido: el número sobre el que se aplica el
-- descuento para llegar a lo que se paga.
oferta as (
  -- UNA fila por SKU: el tramo que rige hoy dentro de ese mes. Desde que un
  -- mes puede tener varios costos, traerlos todos duplicaría cada artículo de
  -- la tabla. Ver lib/sql-costos.ts.
  --
  -- QUEDA POR EL COSTO DE LISTA, que es sobre lo que se aplica el descuento.
  -- El oferta_pct de este mismo CTE se usaba para la columna
  -- "s/ n. compras %", que se sacó de la pantalla.
  select sku, costo_teorico
  from (${COSTOS_VIGENTES_POR_MES}) cv
  where mes_comercial = $3::text
),
-- QUE PROVEEDORES YA MANDARON SU SELL IN DE ESTE MES.
--
-- Es el seguro de la regla de más abajo. Sin esto, el día 1 de cada mes
-- --antes de que entre ninguna planilla-- TODOS los artículos con historia
-- quedarían con sugerido 0, y el panel aparecería vacío justo cuando hay que
-- armar la compra del mes. Con esto, "no dio oferta" sólo se puede afirmar de
-- un proveedor que efectivamente mandó su lista: del que no mandó nada no
-- sabemos, y no saber no es lo mismo que un no.
proveedores_con_sell_in as (
  select distinct a."proveedorNombre" as proveedor
  from bronze.sell_in si
  join bronze.sigma_articulos a on trim(a.id) = si.sku
  where si.mes_comercial = $3::text
    and si.evento = ''
    and si.descuento_pct > 0
    and a."proveedorNombre" is not null
),
compras as (
  select it->>'articuloId' as sku,
         max(c."fechaFactura") as ultima_compra,
         -- Si ese SKU aparece en algún comprobante del mes pasado. Ojo con el
         -- que da false: ver proveedores_mes_pasado aca abajo.
         bool_or(c."fechaFactura" >= to_char(date_trunc('month', current_date)
                                             - interval '1 month', 'YYYY-MM-DD')
             and c."fechaFactura" <  to_char(date_trunc('month', current_date),
                                             'YYYY-MM-DD')) as comprado_mes_pasado,
         -- CUÁNTO, no sólo si. Un "sí" no distingue una compra de 12 unidades
         -- de una de 1.200, y esa es justo la comparación que se quiere hacer
         -- contra el sugerido de al lado.
         coalesce(sum((it->>'cantidad')::numeric) filter (
           where c."fechaFactura" >= to_char(date_trunc('month', current_date)
                                             - interval '1 month', 'YYYY-MM-DD')
             and c."fechaFactura" <  to_char(date_trunc('month', current_date),
                                             'YYYY-MM-DD')
         ), 0) as unidades_mes_pasado
  from bronze.sigma_compras c
  cross join lateral jsonb_array_elements(c.items::jsonb) it
  where it->>'articuloId' is not null
  group by 1
),
-- SI LE COMPRAMOS AL PROVEEDOR EL MES PASADO, mirando la CABECERA y no los
-- renglones. Existe porque el detalle casi no viene: de los 173 comprobantes de
-- agosto, 14 traen items. Sin esto, un artículo sin renglón se mostraría como
-- "no se compró" cuando la verdad es que no sabemos.
--
-- Con las dos cosas juntas se pueden separar tres situaciones distintas:
--   el SKU aparece en un renglón            -> sí, seguro
--   no aparece pero el proveedor sí compró  -> no consta (falta el detalle)
--   el proveedor no compró nada             -> no, y eso sí es seguro
proveedores_mes_pasado as (
  select distinct "proveedorNombre" as proveedor
  from bronze.sigma_compras
  where "fechaFactura" >= to_char(date_trunc('month', current_date)
                                  - interval '1 month', 'YYYY-MM-DD')
    and "fechaFactura" <  to_char(date_trunc('month', current_date), 'YYYY-MM-DD')
    and "proveedorNombre" is not null
),
-- LOS SEIS MESES ANTERIORES AL ELEGIDO. Siempre los mismos seis y siempre en
-- el mismo orden para todos los artículos, que es lo que hace comparable la
-- columna: antes se tomaban "las últimas seis filas que existieran", así que un
-- artículo con oferta en marzo, mayo y agosto mostraba 30 · 20 · 30 al lado de
-- otro con 30 · 20 · 30 de meses completamente distintos. Ahora un mes sin
-- oferta es un 0 explícito.
--
-- ANTERIORES, sin incluir el mes elegido: el descuento vigente ya se ve en la
-- columna "Desc %", y repetirlo acá adelante hacía leer la serie corrida un
-- mes. La historia es contra qué se compara el vigente, no el vigente otra vez.
meses_hist as (
  select to_char(to_date($3::text || '-01', 'YYYY-MM-DD') - (n || ' month')::interval,
                 'YYYY-MM')          as mes,
         -- "Reciente" son los meses anteriores que, junto con el elegido,
         -- forman la ventana de ${MESES_SIN_SELL_IN_PARA_SUGERIR} meses de la
         -- regla de abajo. Con la ventana en 3, son los dos anteriores.
         n < ${MESES_SIN_SELL_IN_PARA_SUGERIR} as reciente
  from generate_series(1, ${MESES_HISTORIA_SELL_IN}) as n
),
-- Van los dos: el sell in del proveedor y el calculado con nuestras compras. La
-- pantalla muestra uno solo y el título dice cuál.
--
-- SE EXCLUYEN LOS EVENTOS (evento <> ''). Una oferta de "HOT SALE" o "Glam" no
-- es el descuento del mes: es otra negociación, con otras fechas. Mezclarlas
-- además duplicaba filas --en 2026-07 hay 302 SKU con las dos-- y eso inflaba
-- los totales de la tabla, no sólo esta columna.
--
-- EL "HABITUAL" ES EL PROMEDIO DE LOS MESES EN QUE HUBO OFERTA, y los meses en
-- cero NO entran en esa cuenta. La diferencia decide compras:
--
--   historia 10 · 10 · 0 · 10 · 0 · 0
--   con los ceros adentro (la mediana que había acá antes) da 5 %, y entonces
--   un 10 % de este mes aparecía como "5 puntos de ventaja" y multiplicaba el
--   sugerido por 1,17. Pero 10 % es exactamente lo que ese proveedor da CADA
--   VEZ QUE DA ALGO: no hay ninguna ventaja que aprovechar.
--
-- Con el promedio de los meses con oferta da 10 %, la ventaja da 0 y el
-- sugerido queda en lo que hace falta. Un mes sin oferta no es "una oferta del
-- 0 %" que baje el promedio: es un mes en el que no hubo nada que comparar.
--
-- Queda NULL para los artículos que nunca tuvieron oferta en la ventana, y más
-- abajo eso se lee como 0: ahí cualquier descuento de hoy es nuevo.
hist_sell_in as (
  select s.sku,
         jsonb_agg(jsonb_build_object('mes', m.mes, 'pct', coalesce(si.descuento_pct, 0))
                   order by m.mes desc)                                        as historia,
         avg(si.descuento_pct) filter (where coalesce(si.descuento_pct, 0) > 0) as habitual,
         -- En cuántos de los ${MESES_HISTORIA_SELL_IN} meses anteriores hubo
         -- oferta. 0 es "este proveedor nunca le dio descuento a este
         -- artículo", que es distinto de "se lo sacó".
         count(*) filter (where coalesce(si.descuento_pct, 0) > 0)             as meses_con_oferta,
         -- Si tuvo oferta en alguno de los meses recientes. Es lo que separa
         -- "justo este mes no la dio" de "hace rato que no la da".
         coalesce(bool_or(m.reciente and coalesce(si.descuento_pct, 0) > 0), false) as oferta_reciente
  from (select distinct sku from bronze.sell_in where evento = '') s
  cross join meses_hist m
  left join bronze.sell_in si
         on si.sku = s.sku and si.mes_comercial = m.mes and si.evento = ''
  group by s.sku
),
hist_calculado as (
  select s.sku,
         jsonb_agg(jsonb_build_object('mes', m.mes, 'pct', coalesce(c.oferta_pct, 0))
                   order by m.mes desc) as historia
  from (select distinct sku from bronze.costos_historicos) s
  cross join meses_hist m
  -- Un solo costo por mes, el que rigió al final (lib/sql-costos.ts): si no,
  -- un mes con dos tramos aparecería dos veces en la historia del artículo.
  left join (${COSTOS_VIGENTES_POR_MES}) c
         on c.sku = s.sku and c.mes_comercial = m.mes
  group by s.sku
),
ventas as (
  select sku,
         max(fecha) as ultima_venta,
         -- DESDE CUANDO ESTE ARTICULO PUDO VENDER. Es lo que convierte el
         -- ritmo en un ritmo y no en un promedio diluido: ver dias_ritmo.
         min(fecha) as primera_venta,
         coalesce(sum(cantidad) filter (where fecha >= current_date - $1::int), 0) as uds,
         -- La rentabilidad de los ÚLTIMOS 3 MESES va con su propia ventana y no
         -- con la del ritmo: son dos preguntas distintas. El ritmo dice cuánto
         -- se vende hoy; la rentabilidad, si lo que se vendió dejaba plata.
         coalesce(sum(cantidad) filter (
           where fecha >= current_date - ${MESES_RENTABILIDAD * 30}), 0) as uds_rent,
         coalesce(sum(margen_total) filter (
           where fecha >= current_date - ${MESES_RENTABILIDAD * 30}), 0) as margen_rent,
         coalesce(sum(precio_neto * cantidad) filter (
           where fecha >= current_date - ${MESES_RENTABILIDAD * 30}), 0) as facturado_rent,
         -- El MES CALENDARIO pasado, aparte de la ventana movil de 3 meses: una
         -- cosa es como viene rindiendo el articulo y otra a cuanto se vendio el
         -- mes que acaba de cerrar, que es contra lo que se compara la oferta
         -- que el proveedor ofrece ahora.
         coalesce(sum(cantidad) filter (
           where fecha >= date_trunc('month', current_date) - interval '1 month'
             and fecha <  date_trunc('month', current_date)), 0) as uds_mes_pasado,
         coalesce(sum(margen_total) filter (
           where fecha >= date_trunc('month', current_date) - interval '1 month'
             and fecha <  date_trunc('month', current_date)), 0) as margen_mes_pasado,
         coalesce(sum(precio_neto * cantidad) filter (
           where fecha >= date_trunc('month', current_date) - interval '1 month'
             and fecha <  date_trunc('month', current_date)), 0) as facturado_mes_pasado
  from gold.fact_ventas
  group by sku
),
stock as (
  -- Los DOS depósitos siempre: se compra para la empresa, no para un depósito.
  select coalesce(t.sku, f.sku)                          as sku,
         coalesce(t.unidades, 0)                         as tuc,
         coalesce(f.unidades, 0)                         as full_ml,
         coalesce(t.unidades, 0) + coalesce(f.unidades, 0) as total
  from tuc t
  full outer join full_ml f on f.sku = t.sku
),
base as (
  select s.sku,
         a.descripcion                                  as producto,
         a."proveedorNombre"                            as proveedor,
         -- QUO MKT por defecto: en bronze.proveedores_grupo están sólo los de
         -- NOA, así que un proveedor nuevo entra como QUO sin que nadie lo
         -- cargue. (Sin backticks: esto vive adentro de un template literal.)
         coalesce(pg.grupo, '${GRUPO_PROVEEDOR_POR_DEFECTO}') as grupo,
         a."attributes.marca"                           as marca,
         a."fechaAlta"::date                            as alta,
         -- DADO DE ALTA HACE POCO. Ver DIAS_ARTICULO_NUEVO en lib/compras.ts.
         (a."fechaAlta"::date >= current_date - ${DIAS_ARTICULO_NUEVO})  as es_nuevo,
         -- LOS DOS CÓDIGOS QUE NO SON NUESTROS. Van sólo al Excel que se le
         -- manda al proveedor, no al archivo de Sigma: el proveedor no conoce
         -- nuestro SKU, conoce el código con el que él lo vende y el EAN.
         -- \`nullif(trim(...), '')\` porque el export trae cadenas vacías, y una
         -- celda vacía se lee mejor que un espacio.
         nullif(trim(a."codigoCompra"), '')             as codigo_compra,
         nullif(trim(a."eanUnidad"), '')                as ean,
         -- Sin dato se toma 1: un bulto de una unidad es lo mismo que la
         -- unidad, así que en el peor caso el artículo se pide de a uno. Poner
         -- 0 haría una división por cero; inventar 6 haría pedir de más.
         greatest(coalesce(a."unidadesPorBulto", 1), 1)  as u_bulto,
         s.tuc,
         s.full_ml,
         s.total,
         coalesce(c.costo_real, 0)                      as costo,
         s.total * coalesce(c.costo_real, 0)            as valor,
         -- El costo de lista del mes elegido, que es sobre el que se aplica el
         -- descuento. Si ese mes no está cargado, cae al último costo conocido.
         coalesce(o.costo_teorico, c.costo_teorico, c.costo_real, 0) as costo_lista,
         si.descuento_pct                               as sell_in_pct,
         coalesce(v.uds, 0)                             as uds,
         v.ultima_venta,
         co.ultima_compra,
         coalesce(v.uds_rent, 0)                        as uds_rent,
         case when coalesce(v.facturado_rent, 0) = 0 then null
              else v.margen_rent / v.facturado_rent
         end                                            as rentabilidad,
         coalesce(v.uds_mes_pasado, 0)                  as uds_mes_pasado,
         case when coalesce(v.facturado_mes_pasado, 0) = 0 then null
              else v.margen_mes_pasado / v.facturado_mes_pasado
         end                                            as rent_mes_pasado,
         coalesce(co.comprado_mes_pasado, false)        as comprado_mes_pasado,
         coalesce(co.unidades_mes_pasado, 0)            as unidades_mes_pasado,
         (pmp.proveedor is not null)                    as proveedor_compro,
         hs.historia                                    as hist_sell_in,
         hs.habitual                                    as habitual_sell_in,
         coalesce(hs.meses_con_oferta, 0)               as meses_con_oferta,
         coalesce(hs.oferta_reciente, false)            as oferta_reciente,
         (pcsi.proveedor is not null)                   as proveedor_mando_sell_in,
         hc.historia                                    as hist_calculado,
         -- SOBRE CUANTOS DIAS SE MIDE EL RITMO.
         --
         -- Era siempre la ventana entera, y para un artículo nuevo eso es una
         -- cuenta mal hecha: uno que se dio de alta hace 30 días y vendió 20
         -- unidades no vende 20/120 = 0,17 por día, vende 0,67. Dividido por
         -- 120 el ritmo queda por debajo de lo que hace falta para que el
         -- sugerido dé algo, y el artículo que MAS necesita reposición --el
         -- que recién arranca y se está vendiendo-- es justo el que no aparece.
         --
         -- Hoy son 1.718 artículos con primera venta dentro de la ventana; 75
         -- de ellos no dan ningún sugerido por esto.
         --
         -- EL PISO DE ${DIAS_MINIMOS_DE_RITMO} DIAS NO ES DECORATIVO. Sin él,
         -- un artículo que vendió 3 unidades ayer daría un ritmo de 3 por día
         -- y pediría cientos: medido, el peor caso sin piso sugería 800
         -- unidades, y con el piso queda en 58. Dos semanas es lo mínimo para
         -- que un promedio diario signifique algo.
         case when v.primera_venta is null then $1::int
              else least($1::int,
                         greatest(${DIAS_MINIMOS_DE_RITMO},
                                  current_date - v.primera_venta::date))
         end                                            as dias_ritmo
  from stock s
  left join bronze.sigma_articulos a on trim(a.id) = s.sku
  left join bronze.proveedores_grupo pg on pg.proveedor = a."proveedorNombre"
  left join costo c on c.sku = s.sku
  left join oferta o on o.sku = s.sku
  left join sell_in si on si.sku = s.sku
  left join ventas v on v.sku = s.sku
  left join compras co on co.sku = s.sku
  left join proveedores_mes_pasado pmp on pmp.proveedor = a."proveedorNombre"
  left join proveedores_con_sell_in pcsi on pcsi.proveedor = a."proveedorNombre"
  left join hist_sell_in hs on hs.sku = s.sku
  left join hist_calculado hc on hc.sku = s.sku
  where coalesce(a."proveedorNombre", '') <> all($2::text[])
),
-- El ritmo y la cobertura salen aca y no de base porque los dos dependen de
-- dias_ritmo, que se calcula ahi: en SQL una columna no se puede usar en la
-- misma lista de select donde se define. (Sin backticks: template literal.)
con_ritmo as (
  select b.*,
         b.uds::numeric / b.dias_ritmo                  as ritmo_diario,
         case when b.uds = 0 then null
              else b.total / (b.uds::numeric / b.dias_ritmo)
         end                                            as cobertura,
         -- Vendió por primera vez DENTRO de la ventana, o sea que el ritmo de
         -- arriba se midió sobre menos días que los demás. La pantalla lo dice:
         -- un ritmo medido sobre 30 días y uno medido sobre 120 no se leen
         -- igual aunque el número sea el mismo.
         --
         -- NO ES LO MISMO QUE es_nuevo, que mira la fecha de alta: un
         -- artículo puede ser viejo y haber empezado a venderse recién ahora
         -- (ritmo recortado, alta vieja), o ser nuevo y no haber vendido nunca
         -- (alta reciente, sin ritmo que recortar).
         (b.dias_ritmo < $1::int)                       as ritmo_recortado
  from base b
),
con_base as (
  select b.*,
         -- Lo mismo que en el tablero de Stock, con las mismas constantes:
         -- lo que falta para cubrir el objetivo contando lo que se vende
         -- mientras la reposición viaja. Es "cuánto necesito".
         -- $4 son los días que se eligieron en pantalla; por defecto
         -- ${COBERTURA_OBJETIVO_DIAS}, el objetivo de siempre.
         greatest(0, b.ritmo_diario * ($4::numeric + ${PLAZO_REPOSICION_DIAS}) - b.total) as sugerido_base,
         -- El techo duro: nunca pasar de esta cobertura, por buena que esté la
         -- oferta. Separa "aprovechar un descuento" de "comprar un año".
         --
         -- PERO NUNCA POR DEBAJO DE LO QUE SE PIDIÓ A MANO. El tope existe para
         -- que el multiplicador de oferta no se dispare solo, no para discutirle
         -- a una persona que eligió comprar para 90 días: si lo dejáramos fijo,
         -- elegir 90 o 120 no cambiaría nada y el selector se leería roto.
         greatest(0, b.ritmo_diario * greatest(
           ${COBERTURA_MAXIMA_COMPRA_DIAS},
           $4::numeric + ${PLAZO_REPOSICION_DIAS}
         ) - b.total)                                                                     as sugerido_tope,
         -- Cuánto está EL DESCUENTO DE ESTE MES por encima de lo habitual, en
         -- puntos. Sin sell in vigente cargado no hay ventaja que medir: queda
         -- en 0 y el factor da 1, o sea el sugerido de siempre.
         greatest(0, coalesce(b.sell_in_pct, 0) - coalesce(b.habitual_sell_in, 0))                   as ventaja_pp,
         -- SE LE SACO LA OFERTA ESTE MES, Y HASTA EL MES PASADO LA TENIA.
         --
         -- Comprar ahora es pagarlo a precio de lista algo que el proveedor
         -- viene bonificando: lo que corresponde es esperar a que vuelva la
         -- oferta, no adelantar la compra. Por eso NO se sugiere nada, ni el
         -- mínimo.
         (b.proveedor_mando_sell_in
          and coalesce(b.sell_in_pct, 0) = 0
          and b.oferta_reciente)                                                             as sin_oferta_por_ahora,
         -- DEJO DE TENER OFERTA: ${MESES_SIN_SELL_IN_PARA_SUGERIR} meses
         -- seguidos sin nada, incluido el elegido, pero antes sí tenía. Acá no
         -- hay oferta que esperar --se terminó-- así que se sugiere lo que
         -- haga falta y la pantalla lo avisa.
         (b.proveedor_mando_sell_in
          and coalesce(b.sell_in_pct, 0) = 0
          and not b.oferta_reciente
          and b.meses_con_oferta > 0)                                                        as dejo_de_tener_sell_in
  from con_ritmo b
),
con_factor as (
  select c.*,
         -- 1 = comprar lo que hace falta. 2 = el doble. Entre medio, lineal:
         -- ${PUNTOS_OFERTA_PARA_DUPLICAR} puntos de ventaja llevan el factor a ${FACTOR_OFERTA_MAX}.
         --
         -- NO SE INFLA LO QUE YA SOBRA: pasado el borde de "Excedido", una
         -- oferta no es una oportunidad, es más plata quieta. Y sin ventas no
         -- hay ritmo, así que tampoco hay nada que adelantar.
         case
           when c.cobertura is null then 1::numeric
           when c.cobertura > ${COBERTURA_SIN_INFLAR_DIAS} then 1::numeric
           -- UN ARTÍCULO QUE NO RINDE NO SE COMPRA DE MÁS POR UNA OFERTA.
           --
           -- Por debajo de ${RENTABILIDAD_COMPRA_DISCRETA} % de rentabilidad,
           -- comprar más es más plata quieta en algo que ya no la devuelve. Los
           -- cuatro Almond Breeze son el caso: sell in del 50 %, y rentabilidad
           -- de -28 %, -9,6 %, -8,1 % y 5,2 %.
           --
           -- CON UNA EXCEPCIÓN, que es la que salva el único caso que sí vale:
           -- que el descuento de ESTE mes sea algo que antes no teníamos. Se
           -- mide contra la MEDIANA de su propia historia y no en puntos,
           -- porque en puntos los dos casos se parecen y no lo son: los Almond
           -- Breeze están 7,5 puntos sobre una mediana de 42,5 --el proveedor
           -- les da eso SIEMPRE--, y el Scotch-Brite está 40 puntos sobre una
           -- mediana de 0. Mediana 0 es "nunca hubo oferta", así que cualquier
           -- descuento de hoy es nuevo y pasa.
           when coalesce(c.rentabilidad, 0) < ${RENTABILIDAD_COMPRA_DISCRETA} / 100.0
                and not (coalesce(c.sell_in_pct, 0)
                         >= greatest(coalesce(c.habitual_sell_in, 0), 0.0001)
                            * ${VECES_SOBRE_LO_HABITUAL_PARA_INFLAR})
             then 1::numeric
           else least(
             ${FACTOR_OFERTA_MAX}::numeric,
             1 + c.ventaja_pp / ${PUNTOS_OFERTA_PARA_DUPLICAR}::numeric
           )
         end as factor_oferta
  from con_base c
),
calculada as (
  select f.*,
         -- El sugerido final: la necesidad, movida por la oferta, contra el
         -- techo. El least va al final y no antes para que el tope sea siempre
         -- lo último que manda.
         --
         -- ARRIBA DE TODO, EL FRENO: a un artículo al que este mes le sacaron
         -- la oferta que venía teniendo no se le sugiere nada. La cuenta de al
         -- lado se calcula igual --sugerido_base y factor_oferta siguen ahí--
         -- para que el tooltip pueda decir cuánto habría dado y por qué no se
         -- pide. (Sin backticks: template literal.)
         --
         -- Y DESPUES, EL MINIMO DE UN BULTO PARA LO QUE NO TIENE HISTORIAL.
         -- Sin ventas en la ventana no hay ritmo, así que la cuenta da 0 y el
         -- artículo desaparece de la tabla: pasa con el que recién se dio de
         -- alta y con el que hace rato no se mueve, que son dos casos donde la
         -- decisión es de una persona y no del cálculo. Un bulto es el piso de
         -- cualquier compra --por debajo no se le pide a un proveedor-- así que
         -- sirve de punto de partida para ajustar a mano.
         --
         -- NO ES UNA NECESIDAD MEDIDA y la pantalla lo dice: viaja
         -- sugerido_minimo para que la celda y el tooltip no lo hagan pasar
         -- por una cuenta.
         case when f.sin_oferta_por_ahora then 0
              when f.uds = 0 then f.u_bulto
              else ceil(least(f.sugerido_base * f.factor_oferta, f.sugerido_tope))
         end as sugerido,
         (not f.sin_oferta_por_ahora and f.uds = 0) as sugerido_minimo
  from con_factor f
)`;

/**
 * SÓLO LO QUE TIENE OFERTA DEL PROVEEDOR ESTE MES.
 *
 * `> 0` y no `is not null`: hoy los artículos con sell in cargado tienen todos
 * descuento mayor que cero, así que las dos formas dan lo mismo -- pero el día
 * que se cargue un 0 %, ese artículo NO tiene oferta y el botón dice "sólo con
 * oferta".
 */
const REGLA_OFERTA = "coalesce(sell_in_pct, 0) > 0";

/**
 * El `where` de la consulta, despiezado.
 *
 * LOS RECORTES VAN APARTE de los filtros que eligió la persona, porque cuando
 * la tabla sale vacía hay que poder contestar cuál de las dos cosas la vació:
 * si el filtro no encontró ningún artículo, o si los encontró y los recortes
 * los dejaron afuera. Con un solo texto de `where` no se distinguen, y la
 * pantalla queda en blanco sin poder decir nada.
 *
 * El caso que lo motivó: filtrando por la marca BUBBA quedaban 23 artículos,
 * uno solo tenía sell in de septiembre y a ese el cálculo no le pedía reponer
 * nada. Cero filas, y la marca entera escondida detrás de un botón que había
 * que adivinar.
 */
type Where = {
  /** Lo que se consulta: los filtros de la persona más lo que recorta la vista. */
  sql: string;
  /** Sólo los filtros de la persona: proveedor, grupo, marca, búsqueda. */
  sqlEstructural: string;
  /** Los recortes que se pidieron, ya saneados. */
  recortes: RecorteCompras[];
  params: unknown[];
};

function where(f: FiltrosCompras, mes: string): Where {
  const params: unknown[] = [
    f.ventana ?? VENTANA_POR_DEFECTO,
    PROVEEDORES_NO_MERCADERIA,
    mes,
    coberturaValida(f.cobertura),
  ];

  // LO QUE ELIGIÓ LA PERSONA: qué artículos mirar. Todo lo que se agregue acá
  // tiene que empujar su parámetro acá también, porque las dos consultas
  // --la de la tabla y la que cuenta lo escondido-- comparten `params`.
  const estructurales: string[] = [];

  agregarFiltro(estructurales, params, "proveedor", f.proveedor);
  agregarFiltro(estructurales, params, "grupo", f.grupo);
  agregarFiltro(estructurales, params, "marca", f.marca);

  if (f.buscar) {
    params.push(`%${f.buscar}%`);
    estructurales.push(
      `(sku ilike $${params.length} or producto ilike $${params.length})`,
    );
  }

  // LOS RECORTES, que no eligen QUÉ artículos sino CUÁLES DE ESOS se muestran.
  // SE SUMAN: cada uno que esté marcado agrega una condición, y sin ninguno
  // están todos. El porqué está en `RecorteCompras` (lib/types.ts).
  const recortes = recortesValidos(f.recortes);

  const condicion: Record<RecorteCompras, string> = {
    sugerido: "sugerido > 0",
    oferta: REGLA_OFERTA,
  };

  const armar = (cs: string[]) => (cs.length ? `where ${cs.join(" and ")}` : "");

  return {
    sql: armar([...estructurales, ...recortes.map((r) => condicion[r])]),
    sqlEstructural: armar(estructurales),
    recortes,
    params,
  };
}

const num = (v: unknown): number => Number(v ?? 0);

/** El historial de descuentos que devuelve Postgres, ya tipado. */
function historia(v: unknown): { mes: string; pct: number }[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x) => x && typeof x === "object")
    .map((x) => ({
      mes: String((x as { mes: unknown }).mes ?? ""),
      pct: num((x as { pct: unknown }).pct),
    }));
}

/** Lo que la pantalla muestra, y cuántos artículos hay detrás del filtro. */
type Listado = {
  filas: FilaCompra[];
  /** Ver `articulosDelFiltro` en `DashboardCompras` (lib/types.ts). */
  articulosDelFiltro: number;
};

/**
 * Cuántos artículos encontró el filtro, sin los recortes.
 *
 * SE LLAMA SÓLO CON LA TABLA VACÍA, y ahí es lo único útil que se puede decir:
 * "con estos recortes no queda nada, pero la marca tiene 23 artículos". Con eso
 * la pantalla ofrece sacarlos, en vez de quedarse en blanco como si la marca no
 * existiera.
 *
 * Es una segunda pasada por la consulta grande, que no es gratis. Se paga
 * únicamente en la pantalla vacía --donde no hay nada más que mostrar y este
 * número es lo único que se puede decir-- y nunca en el camino normal.
 */
async function contarDelFiltro(w: Where): Promise<number> {
  const fila = await queryOne<{ v: string }>(
    `${BASE} select count(*) as v from calculada ${w.sqlEstructural}`,
    w.params,
  );
  return Number(fila?.v ?? 0);
}

async function getFilas(f: FiltrosCompras, mes: string): Promise<Listado> {
  const w = where(f, mes);
  const filas = await query<Record<string, unknown>>(
    `${BASE}
     select sku, producto, proveedor, grupo, marca, codigo_compra, ean, u_bulto,
            tuc, full_ml, total, costo, valor, costo_lista,
            sell_in_pct,
            uds, ritmo_diario, dias_ritmo, ritmo_recortado, cobertura, sugerido,
            es_nuevo, sugerido_minimo, to_char(alta, 'YYYY-MM-DD') as alta,
            sugerido_base, sugerido_tope, factor_oferta, habitual_sell_in,
            meses_con_oferta, sin_oferta_por_ahora, dejo_de_tener_sell_in,
            uds_rent, rentabilidad,
            uds_mes_pasado, rent_mes_pasado,
            comprado_mes_pasado, unidades_mes_pasado, proveedor_compro,
            hist_sell_in, hist_calculado,
            to_char(ultima_venta, 'YYYY-MM-DD') as ultima_venta,
            ultima_compra
     from calculada ${w.sql}
     -- Por lo que hay que comprar, no por lo que hay: arriba lo más urgente.
     --
     -- EL SKU AL FINAL ES EL DESEMPATE, y hace falta desde que se pueden ver
     -- todos los artículos: ahí muchas filas empatan en el mismo sugerido, y
     -- sin un criterio estable Postgres las puede devolver en otro orden en
     -- cada consulta. Una tabla que se reordena sola al cambiar un filtro que
     -- no la toca se lee como si hubieran cambiado los datos.
     --
     -- SIN LIMIT, a propósito. Antes había un tope de 500 y sin recortes
     -- cortaba de verdad --GLAM tiene 981 artículos, COTY 824-- así que pedir
     -- todos los de un proveedor devolvía la mitad. Un recorte que nadie pidió,
     -- en la pantalla que sirve para no perderse ningún artículo, es peor que
     -- una tabla larga.
     order by sugerido * costo desc, sugerido desc, sku`,
    w.params,
  );

  // La tabla vacía es la única que necesita explicarse, y sólo si hay algún
  // recorte que pueda ser el culpable: sin ninguno, cero filas es cero
  // artículos y no hay nada más que decir. Ver `contarDelFiltro`.
  const articulosDelFiltro =
    filas.length === 0 && w.recortes.length > 0 ? await contarDelFiltro(w) : 0;

  const mapeadas = filas.map((r) => ({
    sku: r.sku as string,
    producto: (r.producto as string | null) ?? null,
    proveedor: (r.proveedor as string | null) ?? null,
    grupo: (r.grupo as string | null) ?? null,
    marca: (r.marca as string | null) ?? null,
    codigoCompra: (r.codigo_compra as string | null) ?? null,
    ean: (r.ean as string | null) ?? null,
    unidadesPorBulto: num(r.u_bulto),
    tuc: num(r.tuc),
    full: num(r.full_ml),
    total: num(r.total),
    costo: num(r.costo),
    valor: num(r.valor),
    costoLista: num(r.costo_lista),
    sellInPct: r.sell_in_pct == null ? null : num(r.sell_in_pct),
    uds: num(r.uds),
    ritmoDiario: num(r.ritmo_diario),
    diasRitmo: num(r.dias_ritmo),
    ritmoRecortado: r.ritmo_recortado === true,
    esNuevo: r.es_nuevo === true,
    alta: (r.alta as string | null) ?? null,
    cobertura: r.cobertura == null ? null : num(r.cobertura),
    sugerido: num(r.sugerido),
    sugeridoMinimo: r.sugerido_minimo === true,
    sugeridoBase: num(r.sugerido_base),
    sugeridoTope: num(r.sugerido_tope),
    factorOferta: num(r.factor_oferta),
    habitualSellIn: r.habitual_sell_in == null ? null : num(r.habitual_sell_in),
    mesesConOferta: num(r.meses_con_oferta),
    sinOfertaPorAhora: r.sin_oferta_por_ahora === true,
    dejoDeTenerSellIn: r.dejo_de_tener_sell_in === true,
    udsRentabilidad: num(r.uds_rent),
    rentabilidad: r.rentabilidad == null ? null : num(r.rentabilidad),
    udsMesPasado: num(r.uds_mes_pasado),
    rentMesPasado: r.rent_mes_pasado == null ? null : num(r.rent_mes_pasado),
    compradoMesPasado: r.comprado_mes_pasado === true,
    unidadesMesPasado: num(r.unidades_mes_pasado),
    proveedorComproMesPasado: r.proveedor_compro === true,
    histSellIn: historia(r.hist_sell_in),
    histCalculado: historia(r.hist_calculado),
    ultimaVenta: (r.ultima_venta as string | null) ?? null,
    ultimaCompra: (r.ultima_compra as string | null) ?? null,
  }));

  return { filas: mapeadas, articulosDelFiltro };
}

/**
 * Los meses que tienen ofertas cargadas, del más nuevo al más viejo.
 *
 * La pantalla arranca en el más nuevo y NO en el mes calendario: el 1° de cada
 * mes los costos del mes nuevo todavía no están cargados, y ofrecer un mes
 * vacío mostraría todos los descuentos en cero como si el proveedor no diera
 * ninguno.
 */
async function getMeses(): Promise<string[]> {
  // La unión de los dos: los meses que tienen sell in cargado y los que tienen
  // costos. Mientras `bronze.sell_in` esté vacía el selector sigue teniendo los
  // meses de siempre —si no, quedaría sin ninguna opción— y el día que se carguen
  // los del sell in aparecen solos.
  const filas = await query<{ v: string }>(
    `select v from (
       select distinct mes_comercial as v from bronze.sell_in
       union
       select distinct mes_comercial from bronze.costos_historicos
     ) m
     order by v desc
     limit 24`,
  );
  return filas.map((r) => r.v);
}

/** Cuántos artículos tiene el sell in del mes elegido. `0` = todavía no se cargó. */
async function getSellInCargado(mes: string): Promise<number> {
  const fila = await queryOne<{ v: string }>(
    `select count(*) as v from bronze.sell_in where mes_comercial = $1::text`,
    [mes],
  );
  return Number(fila?.v ?? 0);
}

/**
 * Cuándo llegó la última foto de la planilla de sell in.
 *
 * POR QUE SE MUESTRA. El descuento del proveedor es lo que viaja a la orden de
 * compra, y no sale del tablero: sale de un Google Sheet que un Apps Script
 * fotografía y deja en `bronze.sell_in_crudo`. Entre editar la planilla y ver
 * el número acá hay un camino con escalas, y sin esta fecha no hay forma de
 * saber si lo que se está mirando incluye el cambio de hace un rato.
 *
 * SALE DE `sell_in_crudo` Y NO DE `sell_in.actualizado`, que es cuándo el
 * pipeline la procesó. Lo que importa para decidir una compra no es cuándo se
 * parseó sino DE CUÁNDO ES LA PLANILLA.
 */
async function getSellInFoto(): Promise<string | null> {
  const fila = await queryOne<{ v: string | null }>(
    `select max(recibido)::text as v from bronze.sell_in_crudo`,
  );
  return fila?.v ?? null;
}

async function getOpcionesComprasDirecto() {
  // Las opciones de los selectores no dependen de la cobertura elegida --son
  // la lista de proveedores, marcas y grupos que existen--, así que va el
  // objetivo de siempre.
  const params = [
    VENTANA_POR_DEFECTO,
    PROVEEDORES_NO_MERCADERIA,
    "",
    COBERTURA_OBJETIVO_DIAS,
  ];
  const [proveedores, marcas, grupos, meses] = await Promise.all([
    query<{ v: string }>(
      `${BASE} select distinct proveedor as v from calculada
       where proveedor is not null order by 1`,
      params,
    ),
    query<{ v: string }>(
      `${BASE} select distinct marca as v from calculada
       where marca is not null order by 1`,
      params,
    ),
    // Igual que en Stock: salen de los datos, así que un grupo nuevo en la
    // tabla aparece en el selector sin tocar código.
    query<{ v: string }>(
      `${BASE} select distinct grupo as v from calculada
       where grupo is not null order by 1`,
      params,
    ),
    getMeses(),
  ]);
  return {
    proveedores: proveedores.map((r) => r.v),
    marcas: marcas.map((r) => r.v),
    grupos: grupos.map((r) => r.v),
    meses,
  };
}

/** Hasta qué fecha hay compras cargadas. Ver la nota en queries-stock.ts. */
async function getComprasHasta(): Promise<string | null> {
  const fila = await queryOne<{ v: string | null }>(
    `select max("fechaFactura") as v from bronze.sigma_compras`,
  );
  return fila?.v ?? null;
}

async function getDashboardComprasDirecto(
  f: FiltrosCompras,
): Promise<DashboardCompras> {
  const meses = await getMeses();
  // El mes pedido sólo vale si existe: uno inventado dejaría todos los
  // descuentos en cero sin decir por qué.
  const mes = (f.mes && meses.includes(f.mes) ? f.mes : meses[0]) ?? "";

  const [listado, comprasHasta, sellInCargado, sellInFoto] = await Promise.all([
    getFilas(f, mes),
    getComprasHasta(),
    getSellInCargado(mes),
    getSellInFoto(),
  ]);

  // El mes pasado, calculado igual que en el SQL, para que la pantalla lo
  // nombre sin volver a deducirlo —y sin la chance de que los dos no coincidan
  // el día 1 de un mes.
  const hoy = new Date();
  const mesPasado = new Date(
    Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() - 1, 1),
  )
    .toISOString()
    .slice(0, 7);

  return {
    filas: listado.filas,
    articulosDelFiltro: listado.articulosDelFiltro,
    mesPasado,
    ventana: f.ventana ?? VENTANA_POR_DEFECTO,
    cobertura: coberturaValida(f.cobertura),
    mes,
    meses,
    sellInCargado,
    sellInFoto,
    comprasHasta,
    generadoEn: new Date().toISOString(),
  };
}

/* -------------------------------------------------------------------------
   LOS DATOS PARA MANDAR LA ORDEN AL ERP

   Es una consulta aparte y chiquita, y no un pedazo de BASE, porque contesta
   otra pregunta: no "qué conviene comprar" sino "cuánto vale de verdad esto
   que la persona ya decidió comprar".

   EXISTE PARA NO CONFIAR EN EL NAVEGADOR. La pantalla manda qué SKU, cuántos y
   con qué descuentos —eso lo decide la persona y está bien—, pero el PRECIO no
   lo edita nadie: se vuelve a leer acá. Aceptarlo del navegador sería dejar
   que cualquiera con la consola abierta cargue una orden al ERP al precio que
   se le ocurra.

   El costo se arma igual que en BASE: el del mes elegido si está, el último
   conocido si no.

   $1 SKUs · $2 mes de la oferta
   ------------------------------------------------------------------------- */
export async function getArticulosParaOrden(
  skus: string[],
  mes: string,
): Promise<ArticuloParaOrden[]> {
  if (skus.length === 0) return [];
  const filas = await query<Record<string, unknown>>(
    `select trim(a.id)                                as sku,
            nullif(trim(a."proveedorCodigo"), '')     as proveedor_codigo,
            a."proveedorNombre"                       as proveedor_nombre,
            coalesce(pg.grupo, '${GRUPO_PROVEEDOR_POR_DEFECTO}') as grupo,
            greatest(coalesce(a."unidadesPorBulto", 1), 1)       as u_bulto,
            coalesce(o.costo_teorico, c.costo_teorico, c.costo_real, 0) as costo_lista
     from bronze.sigma_articulos a
     left join bronze.proveedores_grupo pg on pg.proveedor = a."proveedorNombre"
     left join (
       select sku, costo_teorico
       from (${COSTOS_VIGENTES_POR_MES}) cv
       where mes_comercial = $2::text
     ) o on o.sku = trim(a.id)
     left join (${ULTIMO_COSTO_VIGENTE}) c on c.sku = trim(a.id)
     where trim(a.id) = any($1::text[])`,
    [skus, mes],
  );

  return filas.map((r) => ({
    sku: r.sku as string,
    proveedorCodigo: (r.proveedor_codigo as string | null) ?? null,
    proveedorNombre: (r.proveedor_nombre as string | null) ?? null,
    grupo: (r.grupo as string | null) ?? null,
    unidadesPorBulto: num(r.u_bulto),
    costoLista: num(r.costo_lista),
  }));
}


/* ---------------------------------------------------------------------------
   LAS ENTRADAS QUE CONSUME LA RUTA, CACHEADAS.

   Se envuelven acá al final y no en la ruta para que cualquier consumidor
   futuro herede el caché sin acordarse de pedirlo. La version sin cachear
   queda como `...Directo` por si alguna vez hace falta saltearlo.

   Ver lib/cache.ts para por que esto es seguro (y cuando dejaria de serlo).
   --------------------------------------------------------------------------- */
export const getOpcionesCompras = cacheado(
  "compras:opciones",
  getOpcionesComprasDirecto,
);
export const getDashboardCompras = cacheado(
  "compras:dashboard",
  getDashboardComprasDirecto,
);
