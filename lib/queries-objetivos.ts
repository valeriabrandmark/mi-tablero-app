import { query } from "@/lib/db";
import type {
  ComprobanteVencido,
  DashboardObjetivos,
  FilaComprobanteObjetivo,
  FilaObjetivo,
  FiltrosObjetivos,
  OpcionesObjetivos,
  PuntoFacturacion,
  ResumenMetrica,
  VencidoVendedor,
} from "@/lib/types";
import {
  CANAL_MAYORISTA,
  codigoSigmaDe,
  mesComercialActual,
} from "@/lib/constantes";
import { agregarFiltro, vacio } from "@/lib/filtros";

/**
 * Página "Objetivos" — avance de UN vendedor contra su objetivo.
 *
 * El vendedor no es un filtro: lo fija la ruta (`/objetivos/[vendedor]`). Hay
 * una página por vendedor para que más adelante se pueda dar permiso sobre una
 * sola y cada uno vea únicamente la suya.
 *
 * El objetivo NO cuelga del SKU sino de un GRUPO (`gold.objetivos_grupo`), que
 * es la unidad en la que la comercial lo pensó. Cada grupo declara dos cosas:
 *
 *   `criterio` — contra qué se matchean sus items:
 *     'sku'     un SKU suelto, o un MIX de varios SKUs (el objetivo se mide
 *               sobre la SUMA del grupo, no SKU por SKU)
 *     'marca'   una marca entera (caso AVENO, que en la planilla no tiene SKU)
 *     'empresa' todas las ventas de esas empresas (Brandmark = Quo Marketing
 *               SRL + Presupuesto QUO; NOA = Noa Comercial SRL + Presupuesto Noa)
 *
 *   `metrica` — cómo se mide el avance: unidades, facturación o clientes.
 *
 * La métrica es lo que obliga a que TODO lo que agrega objetivos agrupe por
 * ella: sumar un objetivo de $45.000.000 con uno de 480 unidades no significa
 * nada. Por eso los totales son una fila por métrica y no un número solo.
 *
 * Filtro fijo de la página: `canal = 'Mayorista'`. Los objetivos son de la
 * fuerza de venta mayorista; sumar Mercado Libre o Tienda Nube les infla el
 * avance con ventas que no son suyas. Los presupuestos SÍ cuentan (entran como
 * las empresas "Presupuesto QUO" / "Presupuesto Noa"), igual que en el tablero
 * de Data Studio del que sale esta página.
 */

type Where = { sql: string; params: unknown[] };

/**
 * Los filtros se aplican SIEMPRE sobre la tabla de objetivos (alias `o`), no
 * sobre las ventas. Es lo que hace que un vendedor sin ninguna venta del mes
 * siga apareciendo con su objetivo y 0 de avance, en vez de desaparecer de la
 * tabla — que es justo la fila que hay que mirar, y el caso de RICARDO hoy.
 */
function whereObjetivos(
  f: FiltrosObjetivos,
  omitir: (keyof FiltrosObjetivos)[] = [],
): Where {
  const params: unknown[] = [f.vendedor];
  const clauses = ["o.vendedor = $1"];

  // El vendedor va aparte (lo fija la ruta y es uno solo), así que acá solo
  // entran los filtros que son listas.
  const opcionales: [
    Extract<keyof FiltrosObjetivos, "mes" | "grupo">,
    string,
  ][] = [
    ["mes", "o.mes_comercial"],
    ["grupo", "o.grupo"],
  ];

  for (const [key, columna] of opcionales) {
    if (!omitir.includes(key)) agregarFiltro(clauses, params, columna, f[key]);
  }

  return { sql: clauses.join("\n     and "), params };
}

/**
 * Avance por par (mes, grupo): el grano más fino que existe para un vendedor.
 * Todo lo demás sale de agregar esto.
 *
 * El `left join` contra las ventas es deliberado: sin él, un objetivo sin
 * ventas no daría fila y el avance se leería como si no existiera.
 *
 * Ojo con `clientes`: a nivel grupo es un `count(distinct)`, pero al agregar
 * varios grupos se SUMAN esos conteos en vez de recontar. Es lo correcto acá,
 * porque cada grupo es un objetivo separado (Brandmark 40 y NOA 10 son dos
 * metas, no una sola de 50 clientes distintos).
 */
function cteAvance(w: Where): string {
  return `with mapa as (
    select g.grupo, g.criterio, g.metrica, i.valor
    from gold.objetivos_grupo g
    join gold.objetivos_grupo_item i on i.grupo = g.grupo
  ),
  ventas as (
    select m.grupo, fv.mes_comercial, fv.vendedor, fv.cliente, fv.cantidad, fv.precio_neto
    from gold.fact_ventas fv
    join mapa m
      on (m.criterio = 'sku'     and m.valor = fv.sku)
      or (m.criterio = 'marca'   and m.valor = fv.marca)
      or (m.criterio = 'empresa' and m.valor = fv.empresa)
    where fv.canal = '${CANAL_MAYORISTA}'
  ),
  avance as (
    select o.mes_comercial,
           o.grupo,
           g.metrica,
           g.orden,
           o.cantidad as objetivo,
           case g.metrica
             when 'clientes'    then count(distinct v.cliente)
             when 'facturacion' then coalesce(sum(v.precio_neto * v.cantidad), 0)
             else                    coalesce(sum(v.cantidad), 0)
           end as vendido
    from gold.objetivos o
    join gold.objetivos_grupo g on g.grupo = o.grupo
    left join ventas v
      on v.grupo = o.grupo
     and v.mes_comercial = o.mes_comercial
     and v.vendedor = o.vendedor
    where ${w.sql}
    group by o.mes_comercial, o.grupo, g.metrica, g.orden, o.cantidad
  )`;
}

// --- Totales por métrica -----------------------------------------------------

/**
 * OJO al comentar el SQL de acá abajo: va adentro de un template literal, así
 * que un backtick corta la cadena y rompe el archivo entero. Sin comillas
 * invertidas, ni siquiera para nombrar una columna.
 */
function getResumen(f: FiltrosObjetivos): Promise<ResumenMetrica[]> {
  const w = whereObjetivos(f);
  return query<ResumenMetrica>(
    `${cteAvance(w)}
     select metrica,
            coalesce(sum(objetivo), 0)::float8 as objetivo,
            coalesce(sum(vendido), 0)::float8 as vendido,
            -- EL EXCEDENTE DE UN OBJETIVO NO TAPA EL FALTANTE DE OTRO.
            --
            -- Sumar el vendido a secas deja que pasarse en un grupo compense a
            -- otro en cero, y el avance total miente. SILVIO en 2026-08 daba
            -- 115,3 % con 2 de 5 objetivos cumplidos: se pasó tanto en AVENO
            -- que tapaba los tres que no arrancaron. Con el tope da 65,6 %.
            --
            -- Adentro de un grupo el excedente SÍ cuenta, y tiene que contar:
            -- un grupo puede ser un mix de varios SKUs y la meta está puesta
            -- sobre el total del grupo, no sobre cada SKU.
            coalesce(sum(least(vendido, objetivo)), 0)::float8 as "vendidoComputable",
            case when sum(objetivo) = 0 then null
                 else sum(least(vendido, objetivo))::float8 / sum(objetivo)
            end::float8 as "avancePct",
            count(*) filter (where vendido >= objetivo)::float8 as cumplidos,
            count(*)::float8 as pares
     from avance
     group by metrica
     order by case metrica when 'unidades' then 1 when 'facturacion' then 2 else 3 end`,
    w.params,
  );
}

/**
 * Avance por grupo. Se omite el filtro cruzado de grupo a propósito: si no, al
 * clickear una barra el panel se quedaría con una sola y no habría contra qué
 * comparar (mismo criterio que las tortas de Logística).
 */
function getPorGrupo(f: FiltrosObjetivos): Promise<FilaObjetivo[]> {
  const w = whereObjetivos(f, ["grupo"]);
  return query<FilaObjetivo>(
    `${cteAvance(w)}
     select grupo,
            null::text as vendedor,
            metrica,
            -- LOS SKU DEL GRUPO, para que la barra diga contra qué se mide.
            --
            -- Sin esto "VASELINE LIP 4.8 G" no deja ver que son DOS SKUs
            -- sumados, y el vendedor no sabe si le cuentan las dos variantes o
            -- una sola. Sale de la misma tabla que usa el match, así que lo que
            -- se muestra es literalmente lo que se está midiendo.
            --
            -- Solo para criterio sku: en los grupos de empresa los items son
            -- nombres de empresa que el titulo ya dice.
            (select string_agg(i.valor, ' + ' order by i.valor)
               from gold.objetivos_grupo_item i
               join gold.objetivos_grupo g2 on g2.grupo = i.grupo
              where i.grupo = avance.grupo
                and g2.criterio = 'sku') as skus,
            sum(objetivo)::float8 as objetivo,
            sum(vendido)::float8 as vendido,
            case when sum(objetivo) = 0 then null
                 else sum(vendido)::float8 / sum(objetivo)
            end::float8 as "avancePct",
            greatest(sum(objetivo) - sum(vendido), 0)::float8 as faltan
     from avance
     group by grupo, metrica, orden
     order by orden`,
    w.params,
  );
}

// --- Líneas de venta del vendedor --------------------------------------------

/**
 * Las líneas de venta del recorte, que alimentan el timeline y el listado de
 * comprobantes.
 *
 * Si hay un grupo seleccionado, se acotan a las líneas DE ESE GRUPO: así el
 * listado contesta "qué comprobantes traen este MIX y cuánto trae cada uno",
 * que es para lo que sirve el filtro cruzado. Sin grupo seleccionado son todas
 * las ventas mayoristas del vendedor en el mes.
 */
function cteLineas(f: FiltrosObjetivos): Where {
  const params: unknown[] = [f.vendedor];
  const clauses = [`fv.canal = '${CANAL_MAYORISTA}'`, "fv.vendedor = $1"];

  agregarFiltro(clauses, params, "fv.mes_comercial", f.mes);
  // El cliente recorta las ventas y no el objetivo: va acá, en las líneas, y
  // NO en `whereObjetivos`, que es el que arma la meta contra la que se compara.
  agregarFiltro(clauses, params, "fv.cliente", f.cliente);

  // EL BUSCADOR VA CONTRA LAS DOS COLUMNAS A LA VEZ. Quien busca tiene el
  // nombre del cliente o el número del comprobante a mano, y no quiere elegir
  // contra cuál compara antes de escribir. Es el mismo criterio que el buscador
  // de Ventas Mayoristas.
  //
  // Recorta las VENTAS y no el objetivo, igual que el filtro de cliente: el
  // objetivo del mes es el mismo se mire un comprobante o todos.
  if (f.buscar) {
    params.push(`%${f.buscar}%`);
    clauses.push(
      `(fv.cliente ilike $${params.length} or fv.comprobante ilike $${params.length})`,
    );
  }

  let join = "";
  if (!vacio(f.grupo)) {
    params.push(f.grupo);
    join = `join (select distinct g.criterio, i.valor
                  from gold.objetivos_grupo g
                  join gold.objetivos_grupo_item i on i.grupo = g.grupo
                  where g.grupo = any($${params.length}::text[])) m
              on (m.criterio = 'sku'     and m.valor = fv.sku)
              or (m.criterio = 'marca'   and m.valor = fv.marca)
              or (m.criterio = 'empresa' and m.valor = fv.empresa)`;
  }

  return {
    sql: `with lineas as (
      select fv.comprobante, fv.fecha, fv.cliente, fv.empresa,
             fv.cantidad, fv.precio_neto
      from gold.fact_ventas fv
      ${join}
      where ${clauses.join("\n        and ")}
    )`,
    params,
  };
}

/** Timeline: facturación neta por día. */
function getSerieFacturacion(f: FiltrosObjetivos): Promise<PuntoFacturacion[]> {
  const l = cteLineas(f);
  return query<PuntoFacturacion>(
    `${l.sql}
     select to_char(fecha, 'YYYY-MM-DD') as fecha,
            coalesce(sum(precio_neto * cantidad), 0)::float8 as total
     from lineas
     where fecha is not null
     group by fecha
     order by fecha`,
    l.params,
  );
}

/** Listado de comprobantes involucrados. */
function getComprobantes(
  f: FiltrosObjetivos,
): Promise<FilaComprobanteObjetivo[]> {
  const l = cteLineas(f);
  return query<FilaComprobanteObjetivo>(
    `${l.sql}
     select comprobante,
            to_char(max(fecha), 'YYYY-MM-DD') as fecha,
            max(cliente) as cliente,
            max(empresa) as empresa,
            coalesce(sum(cantidad), 0)::float8 as unidades,
            coalesce(sum(precio_neto * cantidad), 0)::float8 as facturacion
     from lineas
     where comprobante is not null
     group by comprobante
     order by max(fecha) desc nulls last, facturacion desc
     limit 300`,
    l.params,
  );
}

// --- Deuda vencida -----------------------------------------------------------

/**
 * Cartera vencida del vendedor.
 *
 * Usa la MISMA definición que la página de Cuentas Corrientes
 * (`saldo_vencido / saldo_total` sobre `cuentas_corrientes_scoring`), para que
 * el mismo número no dé distinto en dos pantallas.
 *
 * Dos cosas que la separan del resto de la página:
 *
 *  - El vendedor va por CÓDIGO de SIGMA (006, 007…), no por nombre, porque así
 *    lo guardan las tablas de cuentas corrientes. Ver `CODIGO_SIGMA`.
 *  - Es una FOTO al momento de la carga, no un acumulado del mes comercial, así
 *    que NO se filtra por mes: cambiar el selector de mes no la mueve. La
 *    `fechaCarga` viaja con el dato para poder decirlo en pantalla.
 */
async function getVencido(
  f: FiltrosObjetivos,
): Promise<VencidoVendedor | null> {
  const codigo = codigoSigmaDe(f.vendedor);
  if (!codigo) return null;

  const filas = await query<VencidoVendedor>(
    `select coalesce(sum(s.saldo_total), 0)::float8 as "deudaTotal",
            coalesce(sum(s.saldo_vencido), 0)::float8 as "deudaVencida",
            case when coalesce(sum(s.saldo_total), 0) = 0 then null
                 else sum(s.saldo_vencido)::float8 / sum(s.saldo_total)
            end::float8 as "pctVencida",
            count(distinct s.razon_social)::float8 as clientes,
            to_char(max(s.fecha_carga), 'YYYY-MM-DD') as "fechaCarga"
     from bronze.cuentas_corrientes_scoring s
     where s.vendedor = $1`,
    [codigo],
  );

  return filas[0] ?? null;
}

/**
 * Los comprobantes vencidos del vendedor, uno por uno.
 *
 * ES EL DETALLE DE LA TARJETA DE ARRIBA. La tarjeta dice cuánta plata está
 * vencida; esto dice de quién y desde cuándo, que es lo que hace falta para ir
 * a cobrarla.
 *
 * SALE DE `aging` Y NO DE `scoring`, y por eso los dos números pueden no dar
 * exactamente iguales: `scoring` guarda un saldo por CLIENTE ya consolidado, y
 * `aging` una fila por COMPROBANTE. Un pago a cuenta que todavía no se imputó a
 * ningún comprobante baja el saldo del cliente y no baja ninguna fila de acá.
 * La pantalla lo dice en vez de esconder la diferencia.
 *
 * NO SE FILTRA POR MES, igual que la tarjeta: es una foto al momento de la
 * carga, no un acumulado del mes comercial.
 *
 * `atraso` ya viene calculado por el orquestador, así que "vencido" es
 * `atraso > 0` y no una resta de fechas nuestra: si las dos contaran distinto,
 * un comprobante aparecería vencido en una pantalla y no en la otra.
 */
async function getComprobantesVencidos(
  f: FiltrosObjetivos,
): Promise<ComprobanteVencido[]> {
  const codigo = codigoSigmaDe(f.vendedor);
  if (!codigo) return [];

  const params: unknown[] = [codigo];
  const clauses = [
    "a.vendedor = $1",
    "coalesce(a.atraso, 0) > 0",
    // Un comprobante saldado no es una deuda vencida aunque su fecha haya
    // pasado. Sin esto la tabla listaría todo el histórico cobrado.
    "coalesce(a.pendiente, 0) > 0",
    // Sólo la última foto: la tabla guarda una por carga y sin esto cada
    // comprobante saldría repetido una vez por día cargado.
    "a.fecha_carga = (select max(fecha_carga) from bronze.cuentas_corrientes_aging)",
  ];

  if (f.buscar) {
    params.push(`%${f.buscar}%`);
    clauses.push(
      `(a.razon_social ilike $${params.length} or a.comprobante ilike $${params.length})`,
    );
  }

  return query<ComprobanteVencido>(
    `select a.comprobante,
            -- Las fechas vienen como texto dd/mm/yyyy: se dan vuelta acá para
            -- que la pantalla reciba el mismo formato que el resto del tablero
            -- y para que ordenen por fecha y no alfabéticamente.
            to_char(to_date(a.fecha, 'DD/MM/YYYY'), 'YYYY-MM-DD')       as fecha,
            to_char(to_date(a.vencimiento, 'DD/MM/YYYY'), 'YYYY-MM-DD') as vencimiento,
            a.razon_social                    as cliente,
            a.empresa,
            coalesce(a.total, 0)::float8      as total,
            coalesce(a.pendiente, 0)::float8  as adeuda,
            coalesce(a.atraso, 0)::float8     as "diasVencido"
     from bronze.cuentas_corrientes_aging a
     where ${clauses.join("\n       and ")}
     order by a.atraso desc nulls last, a.pendiente desc
     limit 500`,
    params,
  );
}

// --- Opciones de los selectores ----------------------------------------------

export async function getOpcionesObjetivos(): Promise<OpcionesObjetivos> {
  // Solo los meses. La lista de grupos se fue con el selector de Grupo: los
  // grupos se siguen filtrando haciendo click en su barra, que es donde se los
  // está mirando, así que la consulta no tenía a quién servir.
  const meses = await query<{ valor: string }>(
    `select distinct mes_comercial as valor from gold.objetivos order by valor desc`,
  );

  return { meses: meses.map((r) => r.valor) };
}

/**
 * Mes con el que abre la página: el mes comercial vigente si ya tiene objetivos
 * cargados, y si no el último que sí los tenga.
 *
 * El fallback existe para que al pasar de mes la página no abra vacía mientras
 * nadie cargó los objetivos nuevos. No queda escondido: el selector muestra el
 * mes que quedó elegido, y el usuario lo puede cambiar.
 *
 * Si la base no responde devuelve el mes vigente igual, así el error lo muestra
 * el dashboard con su propio cartel en vez de romper la página entera.
 */
export async function getMesInicialObjetivos(
  vendedor: string,
): Promise<string> {
  const vigente = mesComercialActual();
  try {
    const filas = await query<{ valor: string }>(
      `select mes_comercial as valor
       from gold.objetivos
       where vendedor = $1
       group by mes_comercial
       order by (mes_comercial = $2) desc, mes_comercial desc
       limit 1`,
      [vendedor, vigente],
    );
    return filas[0]?.valor ?? vigente;
  } catch {
    return vigente;
  }
}

// --- Dashboard completo ------------------------------------------------------

export async function getDashboardObjetivos(
  f: FiltrosObjetivos,
): Promise<DashboardObjetivos> {
  const [
    resumen,
    porGrupo,
    serieFacturacion,
    comprobantes,
    vencido,
    comprobantesVencidos,
  ] = await Promise.all([
    getResumen(f),
    getPorGrupo(f),
    getSerieFacturacion(f),
    getComprobantes(f),
    getVencido(f),
    getComprobantesVencidos(f),
  ]);

  return {
    resumen,
    vencido,
    comprobantesVencidos,
    porGrupo,
    serieFacturacion,
    comprobantes,
    generadoEn: new Date().toISOString(),
  };
}
