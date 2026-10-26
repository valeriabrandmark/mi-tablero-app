import { cacheado } from "@/lib/cache";
import { query, queryOne } from "@/lib/db";
import { agregarFiltro } from "@/lib/filtros";
import { POR_INVENTARIO_SKU } from "@/lib/sql-meli";
import {
  getCambiosDeRestriccion,
  getDestacadosFull,
  getReposicionPorSku,
  hayTablaReposicion,
} from "@/lib/queries-reposicion-full";
import { buscadorDeArticulo, clausulaCodigoMeli } from "@/lib/sql-codigos";
import { ULTIMO_COSTO_VIGENTE } from "@/lib/sql-costos";
import { CANAL_MELI } from "@/lib/meli";
import {
  UMBRAL_PARADO,
  UMBRALES_TARJETAS,
  DIAS_PARA_PARADO,
  limitesDelTramo,
  tramoDe,
} from "@/lib/stock-full";
import type {
  DashboardStockFull,
  FilaNoDisponible,
  FiltrosStockFull,
  FilaStockFull,
  KpisStockFull,
  TramoStockFull,
} from "@/lib/types";

/**
 * Consultas de "Stock Full · días sin venta".
 *
 * Cruza TRES fuentes, y cada una aporta algo que las otras no tienen:
 *
 *   bronze.ml_publicaciones  el mapa inventory_id -> SKU, y el precio de lista
 *   bronze.ml_stock_full     cuántas unidades hay hoy en el depósito de ML
 *   gold.fact_ventas         cuándo fue la última venta de ese SKU
 *
 * EL SKU NO ESTÁ DONDE UNO ESPERA. `seller_custom_field` está vacío en 7.459 de
 * 7.559 publicaciones; el SKU real vive dentro del array `attributes`, en el
 * atributo `SELLER_SKU`. Ahí está en las 7.559. El Apps Script de la planilla
 * hace exactamente el mismo rodeo, por lo mismo.
 */

/**
 * Un renglón por inventario, no por publicación.
 *
 * Varias publicaciones comparten el mismo `inventory_id` —el mismo stock físico
 * publicado en varios avisos—, así que sin este paso el stock se contaría una
 * vez por aviso. Con 7.559 publicaciones sobre 3.830 inventarios, eso sería el
 * doble.
 */
const POR_INVENTARIO = `
  -- El SKU sale del mapa ya calculado (ver lib/sql-meli.ts); el titulo y el
  -- precio siguen viniendo de las publicaciones, que es donde viven. Asi esta
  -- consulta deja de parsear 14 MB de JSON para sacar un solo campo.
  select p.inventory_id,
         max(m.sku)                 as sku,
         max(p.title)               as titulo,
         max(p.price)               as precio_publicado
  from bronze.ml_publicaciones p
  join (${POR_INVENTARIO_SKU}) m on m.inventory_id = p.inventory_id
  where p."shipping.logistic_type" = 'fulfillment'
    and p.inventory_id is not null
  group by p.inventory_id`;

/**
 * El armado completo, listo para filtrar. Se define una sola vez porque lo usan
 * la tabla, los KPIs y los tramos, y si cada uno lo escribiera por su lado
 * terminarían midiendo cosas distintas.
 *
 * `disponible` es lo que Mercado Libre puede vender. `no_disponible` son
 * unidades que están físicamente en el depósito pero ML no puede vender
 * —dañadas, en revisión, reservadas—: son plata parada de la peor clase, porque
 * ni siquiera está a la venta.
 */
/**
 * La base de la pantalla, con o sin los artículos que YA NO SON VENDIBLES.
 *
 * Es una función y no dos constantes para que las dos versiones no puedan
 * divergir: todo lo que cambia entre una y otra es la última línea.
 *
 *   soloVendible = true    lo normal. Stock que Mercado Libre puede vender, que
 *                          es de lo que habla el resto de la pantalla.
 *   soloVendible = false   suma los que están ENTEROS en no disponible. Sin
 *                          esto, el artículo con cero unidades vendibles y tres
 *                          trabadas no existe para el tablero -- y es el peor
 *                          caso de todos.
 */
function baseSql(soloVendible: boolean): string {
  return `
with por_inv as (${POR_INVENTARIO}),
stock as (
  select i.sku,
         max(i.titulo)                              as producto,
         max(i.precio_publicado)                    as precio_publicado,
         sum(coalesce(f.available_quantity, 0))     as disponible,
         sum(coalesce(f.not_available_quantity, 0)) as no_disponible
  from bronze.ml_stock_full f
  join por_inv i on i.inventory_id = f.inventory_id
  where i.sku is not null
  group by i.sku
),
-- ────────────────────────────────────────────────────────────────────────
-- CUANTO HACE QUE EL ARTICULO ESTA EN FULL
--
-- Es el dato que faltaba para poder decir algo útil de los que nunca
-- vendieron. Sale de dos fuentes, y se toma la más vieja de las dos:
--
--   ml_stock_full_historico  la foto diaria del stock en Full. Arrancó el
--                            21/08/2026, así que ve 60 días hacia atrás y
--                            nada más.
--   digip_envios_full        los despachos que NOSOTROS mandamos a Full.
--                            Llega hasta el 08/05, cinco meses, y es un
--                            evento real: si lo despachamos ese día, ese día
--                            entró.
--
-- Juntas fechan 166 de los 176 que nunca vendieron. Los 10 que quedan
-- aparecen en la primera foto y nunca los vimos despachar: de ésos sabemos
-- que están hace 59 días o más, pero no cuántos. Ver entrada_exacta.
-- ────────────────────────────────────────────────────────────────────────
visto_en_full as (
  select i.sku, min(h.fecha) as dia
  from bronze.ml_stock_full_historico h
  join por_inv i on i.inventory_id = h.inventory_id
  where h.available_quantity > 0 and i.sku is not null
  group by i.sku
),
despachado_a_full as (
  -- El patrón no es de más: fecha_estado es TEXTO, y un valor que no sea
  -- una fecha haría tirar el cast y con él la pantalla entera. Hoy los 9.853
  -- están bien, que es exactamente lo que se creía del CRM hasta que no.
  select trim(sku) as sku, min(fecha_estado::date) as dia
  from bronze.digip_envios_full
  where sku is not null
    and fecha_estado ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
  group by 1
),
arranque_foto as (select min(fecha) as dia from bronze.ml_stock_full_historico),
motivos as (
  -- POR QUE ML NO LAS PUEDE VENDER. La API lo dice en not_available_detail,
  -- un JSON por inventario con un renglón por motivo. Lo veníamos guardando y
  -- no lo mirábamos, así que la columna "no disponible" era un número sin
  -- explicación -- y la pregunta obvia, "¿dónde están?", no tenía respuesta
  -- en la pantalla.
  --
  -- Los tres motivos que trae la cuenta hoy: withdrawal (en un retiro que
  -- pedimos: ya no son stock, por eso en Mercado Libre no se ven), lost
  -- (ML las perdió) e internalProcess. Se agrega el texto crudo y la pantalla
  -- lo traduce, así un motivo nuevo que aparezca mañana no se pierde: sale
  -- con su nombre en inglés en vez de desaparecer.
  select i.sku,
         string_agg(m.motivo || ':' || m.unidades, '|' order by m.unidades desc, m.motivo) as motivos
  from (
    select f.inventory_id,
           e->>'status'              as motivo,
           sum((e->>'quantity')::int) as unidades
    from bronze.ml_stock_full f
    cross join lateral jsonb_array_elements(nullif(f.not_available_detail, '')::jsonb) e
    group by 1, 2
  ) m
  join por_inv i on i.inventory_id = m.inventory_id
  where i.sku is not null
  group by i.sku
),
costo as (
  -- El costo NETO del último mes que lo tenga cargado: costo_real ya es el
  -- teórico con la oferta del proveedor descontada. Sale del mismo lugar que
  -- en Antigüedad --lib/sql-costos.ts-- así que un artículo vale lo mismo en
  -- las dos pantallas.
  ${ULTIMO_COSTO_VIGENTE}
),
ventas as (
  select sku,
         max(fecha)                                              as ultima_venta,
         coalesce(sum(cantidad) filter (where fecha >= current_date - 30), 0) as uds30,
         avg(precio_unitario)                                    as precio_vendido
  from gold.fact_ventas
  where canal = $1
  group by sku
),
base as (
  select s.sku,
         s.producto,
         a."proveedorNombre"                        as proveedor,
         a."attributes.marca"                       as marca,
         s.disponible,
         s.no_disponible,
         v.ultima_venta,
         case when v.ultima_venta is null then null
              else (current_date - v.ultima_venta)::int end      as dias_sin_venta,
         coalesce(v.uds30, 0)                                    as uds30,
         -- Se valoriza al precio al que se VENDIÓ, y si nunca se vendió, al
         -- precio publicado. Sin ese respaldo los artículos que nunca rotaron
         -- valdrían cero, que es justo lo contrario de lo que son: los que más
         -- preocupan.
         s.disponible * coalesce(v.precio_vendido, s.precio_publicado, 0) as valorizacion,
         -- LO MISMO PERO A COSTO, que contesta otra pregunta. La valorización
         -- a precio de venta dice cuánto se dejaría de facturar; ésta, cuánta
         -- plata NUESTRA está parada ahí. Para decidir si conviene retirar
         -- mercadería de Full, la que manda es ésta.
         s.disponible * coalesce(c.costo_real, 0)                        as valorizacion_costo,
         -- Lo TRABADO valorizado a costo. Sólo a costo: una unidad que ML no
         -- puede vender no tiene precio de venta que valga, y lo que interesa
         -- es cuánta plata nuestra está parada ahí.
         s.no_disponible * coalesce(c.costo_real, 0)                     as valorizacion_costo_nd,
         mo.motivos,
         -- DIAS EN FULL. least() ignora los nulos, así que basta con que una
         -- de las dos fuentes sepa la fecha.
         (current_date - least(vf.dia, df.dia))::int                     as dias_en_full,
         -- SI LA FECHA ES UNA MEDICION O UN PISO. Es de verdad cuando lo
         -- vimos despachar --un evento con fecha propia-- o cuando lo vimos
         -- APARECER en la foto diaria, o sea que el primer día que lo vimos
         -- no es el primer día que miramos. Si la única evidencia es que
         -- estaba en la foto más vieja, lo único que sabemos es que está
         -- desde al menos ese día.
         (df.dia is not null
          or coalesce(vf.dia > (select dia from arranque_foto), false))  as entrada_exacta
  from stock s
  left join ventas v on v.sku = s.sku
  left join costo c on c.sku = s.sku
  left join motivos mo on mo.sku = s.sku
  left join visto_en_full vf on vf.sku = s.sku
  left join despachado_a_full df on df.sku = s.sku
  left join bronze.sigma_articulos a on trim(a.id::text) = trim(s.sku)
  where ${soloVendible ? "s.disponible > 0" : "s.disponible > 0 or s.no_disponible > 0"}
)`;
}

const BASE = baseSql(true);
const BASE_CON_TRABADO = baseSql(false);

type Where = { sql: string; params: unknown[] };

/**
 * Lo que dice la columna "Envío a Full", en SQL.
 *
 * ---------------------------------------------------------------------------
 * EL ORDEN IMPORTA, igual que en la celda
 *
 * Un SKU puede tener varios productos en Full, y la celda los resume con una
 * regla: si CUALQUIERA está restringido, el SKU dice "Restringido" -- eso pisa
 * a todo lo demás, porque es lo que impide mandar. Por eso "Conviene reponer"
 * y "No hace falta" llevan el `not bool_or(restringido)`: sin él, un restringido
 * mixto aparecería también en esos dos, y el filtro mostraría filas que en
 * pantalla dicen otra cosa.
 *
 * LO QUE SI SE SUPERPONE, Y ESTA BIEN: un SKU sin restricción con un producto
 * REPLENISH y otro NO_REPLENISHMENT entra en los dos filtros, porque su celda
 * dice las dos cosas ("Conviene reponer / No hace falta reponer"). Son 6 SKU
 * el 26/10/2026. Los filtros muestran lo que dice la columna, y esa columna
 * dice dos cosas.
 *
 * ---------------------------------------------------------------------------
 * POR QUE AGRUPA EN LA SUBCONSULTA Y NO ES UN `exists` CORRELACIONADO
 *
 * Porque el correlacionado NO TERMINA. Escrito como `exists (… where sku =
 * base.sku …)`, Postgres lo corre una vez por fila: no hay índice sobre
 * `coalesce(m.sku, r.sku_ml)`, así que son 4.037 filas unidas de nuevo por
 * cada SKU de la pantalla. Probado contra la base: pasa los 60 segundos y
 * corta por timeout.
 *
 * Agrupando una sola vez y comparando con `in`, el planificador arma un hash
 * join y la misma pregunta tarda 11 ms.
 */
const ENVIO_FULL_POR_SKU = `select trim(coalesce(m.sku, r.sku_ml))
       from bronze.ml_reposicion_full r
       left join bronze.ml_inventario_sku m on m.inventory_id = r.inventory_id
      where coalesce(m.sku, r.sku_ml) is not null
      group by 1`;

const COND_ENVIO_FULL: Record<string, string> = {
  restringido: `trim(base.sku) in (${ENVIO_FULL_POR_SKU} having bool_or(r.restringido))`,
  reponer: `trim(base.sku) in (${ENVIO_FULL_POR_SKU}
      having bool_or(r.recomendacion = 'REPLENISH') and not bool_or(r.restringido))`,
  "no-hace-falta": `trim(base.sku) in (${ENVIO_FULL_POR_SKU}
      having bool_or(r.recomendacion = 'NO_REPLENISHMENT') and not bool_or(r.restringido))`,
  // SIN DATO NO ES UN ESTADO DE ML sino la ausencia de respuesta: productos
  // que la API no contestó, o que no están en el mapa de inventarios. La
  // columna los muestra con un guión y hay que poder juntarlos.
  //
  // `not in` es seguro acá porque la subconsulta ya descarta los nulos; con un
  // null adentro, `not in` no devolvería ninguna fila.
  "sin-dato": `trim(base.sku) not in (${ENVIO_FULL_POR_SKU})`,
};

/** Los filtros de la pantalla, sobre el CTE `base`. */
function where(f: FiltrosStockFull): Where {
  const params: unknown[] = [CANAL_MELI];
  const clauses: string[] = [];

  agregarFiltro(clauses, params, "proveedor", f.proveedor);
  agregarFiltro(clauses, params, "marca", f.marca);
  agregarFiltro(clauses, params, "sku", f.sku);

  // EL BUSCADOR MIRA LOS CODIGOS QUE NO SON NUESTROS, además del SKU y la
  // descripción: el EAN y el código del proveedor (lib/sql-codigos) y el MLA
  // de las publicaciones. En esta pantalla el dato a mano suele venir de ML.
  const termino = f.buscar?.trim();
  if (termino) {
    params.push(`%${termino}%`);
    const i = params.length;
    clauses.push(
      `(${buscadorDeArticulo(termino, i)} or ${clausulaCodigoMeli("base.sku", i)})`,
    );
  }

  // LO QUE DICE "ENVIO A FULL". Varias opciones se suman con `or`: elegir
  // "Restringido" y "Conviene reponer" muestra las dos, como el resto de los
  // selectores múltiples de la pantalla.
  const envios = (f.envioFull ?? []).filter((c) => c in COND_ENVIO_FULL);
  if (envios.length) {
    clauses.push(`(${envios.map((c) => `(${COND_ENVIO_FULL[c]})`).join(" or ")})`);
  }

  // "Sin vender hace más de N días" trata al que nunca vendió como el peor
  // caso, que es lo correcto: si tiene stock y jamás rotó, es exactamente lo
  // que este tablero busca.
  if (f.minDias != null) {
    params.push(f.minDias);
    clauses.push(
      `(dias_sin_venta is null or dias_sin_venta >= $${params.length})`,
    );
  }

  // EL TRAMO SE RESUELVE CON LOS MISMOS CORTES QUE EL GRÁFICO, y por eso salen
  // de `TRAMOS` y no están escritos acá: con los límites en dos lados, el día
  // que se mueva uno el gráfico y la tabla dejan de decir lo mismo -- que es el
  // mismo motivo por el que `getTramos` agrupa en TypeScript y no en SQL.
  if (f.tramo) {
    const lim = limitesDelTramo(f.tramo);
    if (lim == null) {
      // Los tres "nunca vendió" no son rangos de días sino la ausencia de
      // venta, y se separan entre sí por hace cuánto está el artículo en Full.
      // Las condiciones viven acá y la clasificación en `tramoDe`: son los dos
      // lados de la misma regla, así que el corte sale de la misma constante.
      clauses.push("dias_sin_venta is null");
      clauses.push(CONDICION_NUNCA[f.tramo] ?? "true");
    } else {
      params.push(lim.desde);
      clauses.push(
        `dias_sin_venta is not null and dias_sin_venta >= $${params.length}`,
      );
      if (lim.hasta != null) {
        params.push(lim.hasta);
        clauses.push(`dias_sin_venta <= $${params.length}`);
      }
    }
  }

  return {
    sql: clauses.length ? `where ${clauses.join(" and ")}` : "",
    params,
  };
}

/**
 * Qué distingue a cada uno de los tres "nunca vendió", en SQL.
 *
 * Tiene que decir LO MISMO que `tramoDe`, que es quien los clasifica para el
 * gráfico y la tabla. Si se separaran, hacer clic en una barra filtraría un
 * conjunto distinto del que la barra cuenta -- y nada avisaría, porque las dos
 * cosas siguen funcionando por separado.
 */
/**
 * QUE CUENTA COMO PLATA PARADA, en SQL.
 *
 * Dos casos distintos y por eso dos condiciones:
 *   - vendió alguna vez, pero hace más de `UMBRAL_PARADO` días;
 *   - nunca vendió Y está en Full hace más de `DIAS_PARA_PARADO`.
 *
 * El segundo es conservador a propósito: deja afuera a los 10 artículos cuya
 * fecha de ingreso es un piso y no una medición. Son 19 unidades, y el mismo
 * criterio que usa el gráfico -- que la tarjeta y la barra cuenten distinto
 * sería peor que contar 19 unidades de menos.
 */
const ES_PARADO =
  `(dias_sin_venta > ${UMBRAL_PARADO}` +
  ` or (dias_sin_venta is null and entrada_exacta` +
  ` and dias_en_full >= ${DIAS_PARA_PARADO}))`;

const CONDICION_NUNCA: Record<string, string> = {
  "nunca-parado": `entrada_exacta and dias_en_full >= ${DIAS_PARA_PARADO}`,
  "nunca-nuevo": `entrada_exacta and dias_en_full < ${DIAS_PARA_PARADO}`,
  "nunca-sindato": "(not entrada_exacta or dias_en_full is null)",
};

/**
 * Una fila como la devuelve el driver, que NO es toda de texto.
 *
 * `pg` convierte según el tipo de Postgres: `bool` llega como booleano e `int4`
 * como número, mientras que `numeric` y `int8` llegan como texto para no perder
 * precisión. Tipar todo como `string | null` --que es lo que había-- hacía que
 * `entrada_exacta === true` no compilara, y la salida fácil, `Boolean(...)`,
 * habría sido verdadera también para el texto "false" si algún día el tipo de
 * la columna cambiara. Declararlo es más largo y no miente.
 */
type FilaCruda = Record<string, string | number | boolean | null>;

const num = (v: unknown): number => Number(v ?? 0);

/** Lo mismo para un booleano: sólo el booleano de verdad cuenta como sí. */
const bool = (v: unknown): boolean => v === true;

async function getKpis(f: FiltrosStockFull): Promise<KpisStockFull> {
  const w = where(f);
  // SOBRE LA BASE COMPLETA, incluidos los que están enteros en no disponible.
  // Todo lo que se suma acá los filtra igual --el disponible de esos artículos
  // es 0 y su valorización también-- MENOS `no_disponible`, que es justamente
  // el número que venía saliendo mal: 33 de 120 unidades.
  //
  // `skus` sí cambia de significado y por eso se cuenta aparte: el resto de la
  // pantalla habla de "SKU con stock vendible".
  const fila = await queryOne<Record<string, string>>(
    `${BASE_CON_TRABADO}
     select count(*) filter (where disponible > 0)              as skus,
            coalesce(sum(disponible), 0)                        as disponible,
            coalesce(sum(no_disponible), 0)                     as no_disponible,
            coalesce(sum(valorizacion), 0)                      as valorizacion,
            coalesce(sum(valorizacion_costo), 0)                as valorizacion_costo,
            coalesce(sum(valorizacion_costo_nd), 0)             as valorizacion_costo_nd,
            -- PARADO YA NO ES "TODO EL QUE NUNCA VENDIO". Antes bastaba con
            -- que dias_sin_venta fuera nulo, y eso metía en la tarjeta a los
            -- que acababan de llegar a Full: 59 SKU por $ 2,1 M contados como
            -- plata parada cuando lo único que les pasa es que son nuevos.
            -- Ahora el que nunca vendió entra sólo si además está hace más de
            -- DIAS_PARA_PARADO, con la misma condición que usa el gráfico.
            count(*) filter (where ${ES_PARADO})                       as skus_parados,
            coalesce(sum(valorizacion) filter (where ${ES_PARADO}), 0) as valorizacion_parada,
            coalesce(sum(uds30), 0)                             as uds30
     from base ${w.sql}`,
    w.params,
  );

  return {
    skus: num(fila?.skus),
    disponible: num(fila?.disponible),
    noDisponible: num(fila?.no_disponible),
    valorizacion: num(fila?.valorizacion),
    valorizacionCosto: num(fila?.valorizacion_costo),
    valorizacionCostoNoDisponible: num(fila?.valorizacion_costo_nd),
    skusParados: num(fila?.skus_parados),
    valorizacionParada: num(fila?.valorizacion_parada),
    uds30: num(fila?.uds30),
  };
}

/**
 * Cuántos SKU caen en cada umbral (+7, +15, +21, +30 días sin vender).
 *
 * Son ACUMULATIVOS y no excluyentes: un SKU con 35 días cuenta en los cuatro.
 * Es lo que hacen las tarjetas del reporte de Data Studio, y es lo que se
 * quiere — la pregunta es "cuánto llevo parado hace más de X", no "cuánto cae
 * justo en esta franja".
 */
async function getUmbrales(
  f: FiltrosStockFull,
): Promise<Record<number, number>> {
  const w = where(f);
  const columnas = UMBRALES_TARJETAS.map(
    (d) =>
      `count(*) filter (where dias_sin_venta is null or dias_sin_venta >= ${d}) as d${d}`,
  ).join(",\n            ");

  const fila = await queryOne<Record<string, string>>(
    `${BASE} select ${columnas} from base ${w.sql}`,
    w.params,
  );

  return Object.fromEntries(
    UMBRALES_TARJETAS.map((d) => [d, num(fila?.[`d${d}`])]),
  );
}

/**
 * Los artículos con unidades que Mercado Libre NO puede vender.
 *
 * ---------------------------------------------------------------------------
 * ES UNA CONSULTA APARTE PORQUE `base` NO LOS TIENE A TODOS
 *
 * `base` termina en `where s.disponible > 0`, y eso está bien para el resto de
 * la pantalla --que habla de stock vendible-- pero deja afuera justo a los peores
 * casos de esta lista: el artículo que está ENTERO en no disponible. De los 54
 * SKU con unidades no vendibles, 35 tienen cero disponible; son 87 de las 120
 * unidades, el 72 %.
 *
 * O sea que la tarjeta de "No disponible" venía mostrando 33 de 120. Esta
 * consulta la alimenta también a ella, no sólo a la tabla.
 *
 * Se valoriza SÓLO A COSTO. Una unidad que ML no puede vender no tiene precio
 * de venta que valga: lo que interesa es cuánta plata nuestra está trabada.
 */
async function getNoDisponible(
  f: FiltrosStockFull,
): Promise<FilaNoDisponible[]> {
  const w = where(f);
  const extra = w.sql
    ? `${w.sql} and no_disponible > 0`
    : "where no_disponible > 0";
  return query<FilaNoDisponible>(
    `${BASE_CON_TRABADO}
     select sku, producto, proveedor, marca,
            no_disponible::float8                as "noDisponible",
            disponible::float8                   as disponible,
            valorizacion_costo_nd::float8        as "valorizacionCosto",
            motivos
     from base ${extra}
     order by valorizacion_costo_nd desc, no_disponible desc
     limit 300`,
    w.params,
  );
}

/** El desglose por tramo y proveedor, como la tabla del reporte. */
async function getTramos(f: FiltrosStockFull): Promise<TramoStockFull[]> {
  const w = where(f);
  const filas = await query<FilaCruda>(
    `${BASE}
     select coalesce(proveedor, 'Sin dato') as proveedor,
            dias_sin_venta,
            -- Los dos datos que separan a los "nunca vendió" entre sí. Se
            -- agrupan en vez de agregarse porque el tramo se decide fila por
            -- fila, igual que dias_sin_venta.
            dias_en_full,
            entrada_exacta,
            count(*)                        as skus,
            coalesce(sum(disponible), 0)    as disponible,
            coalesce(sum(valorizacion), 0)  as valorizacion
     from base ${w.sql}
     group by 1, 2, 3, 4`,
    w.params,
  );

  // El tramo se resuelve en TypeScript y no en SQL para que use la misma
  // función que la tabla (`tramoDe`). Con los cortes escritos dos veces, el día
  // que se muevan van a quedar distintos en cada lado.
  const mapa = new Map<string, TramoStockFull>();
  for (const r of filas) {
    const dias = r.dias_sin_venta == null ? null : num(r.dias_sin_venta);
    const enFull = r.dias_en_full == null ? null : num(r.dias_en_full);
    const tramo = tramoDe(dias, enFull, bool(r.entrada_exacta));
    const clave = `${r.proveedor}|${tramo}`;
    const actual = mapa.get(clave) ?? {
      proveedor: String(r.proveedor ?? "Sin dato"),
      tramo,
      skus: 0,
      disponible: 0,
      valorizacion: 0,
    };
    actual.skus += num(r.skus);
    actual.disponible += num(r.disponible);
    actual.valorizacion += num(r.valorizacion);
    mapa.set(clave, actual);
  }
  return [...mapa.values()];
}

/** Tope de filas que bajan al navegador. Son ~1.700 SKU, así que no se toca. */
const TOPE = 500;

async function getFilas(f: FiltrosStockFull): Promise<FilaStockFull[]> {
  const w = where(f);
  const [filas, reposicion] = await Promise.all([query<FilaCruda>(
    `${BASE}
     select sku, producto, proveedor, marca,
            disponible, no_disponible,
            to_char(ultima_venta, 'YYYY-MM-DD') as ultima_venta,
            dias_sin_venta, uds30, valorizacion,
            dias_en_full, entrada_exacta
     from base ${w.sql}
     -- Los que nunca vendieron van primero: son el caso más grave y con un
     -- orden numérico quedarían al final, donde nadie los mira.
     order by (dias_sin_venta is null) desc, dias_sin_venta desc nulls first,
              valorizacion desc
     limit ${TOPE}`,
    w.params,
  ),
    // Aparte, porque la tabla puede no existir todavía. Ver el archivo.
    getReposicionPorSku(),
  ]);

  const texto = (v: unknown): string | null => (typeof v === "string" ? v : null);

  return filas.map((r) => ({
    sku: texto(r.sku),
    producto: texto(r.producto),
    proveedor: texto(r.proveedor),
    marca: texto(r.marca),
    disponible: num(r.disponible),
    noDisponible: num(r.no_disponible),
    ultimaVenta: texto(r.ultima_venta),
    diasSinVenta: r.dias_sin_venta == null ? null : num(r.dias_sin_venta),
    diasEnFull: r.dias_en_full == null ? null : num(r.dias_en_full),
    entradaExacta: bool(r.entrada_exacta),
    uds30: num(r.uds30),
    valorizacion: num(r.valorizacion),
    reposicion: (texto(r.sku) && reposicion?.get(texto(r.sku)!.trim())) || null,
  }));
}

/** Desde cuándo hay foto diaria del stock, para poder decirlo en pantalla. */
async function getDesdeCuandoHayHistoria(): Promise<string | null> {
  try {
    const fila = await queryOne<{ v: string | null }>(
      `select to_char(min(fecha), 'YYYY-MM-DD') as v
       from bronze.ml_stock_full_historico`,
    );
    return fila?.v ?? null;
  } catch {
    // La tabla todavía no existe: el orquestador no corrió con el cambio.
    return null;
  }
}

async function getOpcionesStockFullDirecto() {
  const [proveedores, marcas] = await Promise.all([
    query<{ v: string }>(
      `${BASE} select distinct proveedor as v from base
       where proveedor is not null order by 1`,
      [CANAL_MELI],
    ),
    query<{ v: string }>(
      `${BASE} select distinct marca as v from base
       where marca is not null order by 1`,
      [CANAL_MELI],
    ),
  ]);
  return {
    proveedores: proveedores.map((r) => r.v),
    marcas: marcas.map((r) => r.v),
  };
}

async function getDashboardStockFullDirecto(
  f: FiltrosStockFull,
): Promise<DashboardStockFull> {
  // SI LA TABLA DE REPOSICION NO ESTA, el filtro de "Envío a Full" se cae acá
  // y no en cada consulta: así `where()` puede dar por sentado que, si el
  // filtro llegó, las tablas que nombra existen. Pasa en una base recién
  // creada, antes de la primera corrida del orquestador.
  if (f.envioFull?.length && !(await hayTablaReposicion())) {
    f = { ...f, envioFull: undefined };
  }

  const [kpis, umbrales, tramos, filas, noDisponible, historiaDesde, destacados,
         cambiosRestriccion] =
    await Promise.all([
      getKpis(f),
      getUmbrales(f),
      getTramos(f),
      getFilas(f),
      getNoDisponible(f),
      getDesdeCuandoHayHistoria(),
      // SIN FILTRAR, a proposito: son 18 y la gracia es verlos todos. Si
      // siguieran el filtro de la pantalla, el panel se vaciaria justo cuando
      // alguien esta mirando una marca y desapareceria el aviso.
      getDestacadosFull(),
      // TAMPOCO SIGUEN LOS FILTROS: un producto que te liberaron es noticia
      // aunque estés mirando otra marca.
      getCambiosDeRestriccion(),
    ]);

  return {
    kpis,
    umbrales,
    tramos,
    filas,
    noDisponible,
    recortada: filas.length === TOPE,
    destacados,
    cambiosRestriccion,
    historiaDesde,
    generadoEn: new Date().toISOString(),
  };
}


/* ---------------------------------------------------------------------------
   LAS ENTRADAS QUE CONSUME LA RUTA, CACHEADAS.

   Se envuelven acá al final y no en la ruta para que cualquier consumidor
   futuro herede el caché sin acordarse de pedirlo. La version sin cachear
   queda como `...Directo` por si alguna vez hace falta saltearlo.

   Ver lib/cache.ts para por que esto es seguro (y cuando dejaria de serlo).
   --------------------------------------------------------------------------- */
export const getOpcionesStockFull = cacheado(
  "stock-full:opciones",
  getOpcionesStockFullDirecto,
);
export const getDashboardStockFull = cacheado(
  "stock-full:dashboard",
  getDashboardStockFullDirecto,
);
