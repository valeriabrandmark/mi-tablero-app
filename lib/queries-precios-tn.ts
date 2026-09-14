import { query, queryOne } from "@/lib/db";
import { DIFERENCIA_MINIMA_VISIBLE, type ClaveAlerta } from "@/lib/precios-tn";
import type {
  CambioPrecioTn,
  CatalogosPreciosTn,
  FilaPrecioTn,
  FiltrosPreciosTn,
  ResumenPreciosTn,
} from "@/lib/types";

/**
 * Consultas de "Precios TN — Comparador".
 *
 * FUENTE: el schema `precios`, que llena el proyecto
 * github.com/valeriabrandmark/precios. Este tablero LEE de ahí y lo único que
 * escribe es el estado de una propuesta (aprobada / rechazada). No calcula
 * precios ni pisos: eso ya se decidió, con sus motivos, en la corrida.
 *
 * SIEMPRE LA ÚLTIMA CORRIDA. Una propuesta vieja se decidió contra precios de
 * la competencia que ya cambiaron y contra un costo que puede no ser el de
 * hoy; aprobarla sería aplicar una conclusión vencida.
 */

/** La corrida de propuestas más reciente que haya terminado bien. */
const ULTIMA_CORRIDA = `
  select id from precios.corrida
   where tipo = 'propuesta' and estado = 'ok'
   order by id desc limit 1
`;

/**
 * En qué grupo de alerta cae cada propuesta.
 *
 * El orden de los `when` ES la prioridad: una propuesta que está bajo el piso
 * Y además cara entra como "bajo el piso", que es lo más grave. Se evalúa de
 * arriba hacia abajo y la primera que da verdadera gana.
 */
const CLASIFICACION = `
  case
    when p.accion = 'omitir' and p.motivos::text like '%competencia insuficiente%'
      then 'sin_competencia'
    when p.precio_actual < p.piso and p.referencia_competencia < p.piso
      then 'no_competible'
    when p.precio_actual < p.piso
      then 'bajo_piso'
    when p.referencia_competencia is not null and p.precio_actual > p.referencia_competencia
      then 'caros'
    when p.referencia_competencia is not null and p.precio_actual < p.referencia_competencia
      then 'baratos'
  end
`;

/**
 * Los competidores de cada fila: nombre, precio, disponibilidad y LINK.
 *
 * EL PRECIO SALE SIEMPRE DE `entradas`, LA URL PUEDE SALIR DE `observacion`.
 * La distinción importa. `entradas` es la foto con la que el motor decidió:
 * leer de ahí es lo que permite explicar seis meses después por qué se propuso
 * ese precio. Si los precios se leyeran en vivo, la pantalla mostraría números
 * que NO son los que produjeron la propuesta, y quien aprueba estaría mirando
 * una cuenta distinta de la que está autorizando.
 *
 * La URL es otra cosa: es la dirección de la ficha del producto, no un dato de
 * la decisión, y no cambia cuando cambia el precio. Por eso se puede completar
 * desde `precios.observacion` sin mezclar fotos — y hace falta, porque las
 * propuestas que ya están en la base se generaron antes de que el pipeline
 * empezara a copiar la URL, y sin esto quedarían para siempre sin link.
 *
 * El EAN se normaliza igual que en el proyecto `precios`: espacios afuera y
 * relleno de ceros a la izquierda hasta 13. Un código que allá no pasó el
 * dígito verificador simplemente no encuentra observación, que es lo correcto.
 *
 * UNA FILA POR COMPETIDOR, LA MÁS NUEVA. `entradas.observaciones` guarda TODAS
 * las de la ventana, y la ventana son varios días: Farmaonline capturado el 11
 * y el 14 son dos entradas del mismo competidor. En pantalla eso se leía como
 * precios repetidos —fue el reporte que abrió este arreglo— y no lo eran: era
 * el mismo negocio en días distintos.
 *
 * El desempate es EL MISMO QUE EL DEL MOTOR (día más nuevo; con empate de día,
 * la más barata). Tiene que serlo: si la pantalla colapsara distinto, mostraría
 * como referencia un precio que no es el que produjo la propuesta, que es
 * exactamente la confusión que esta pantalla existe para evitar.
 *
 * Lo anterior no se tira, se cuenta: `anteriores` alimenta el "+N" del chip,
 * para poder ver que ese competidor venía de otro precio sin que la fila se
 * llene de globitos.
 */
const COMPETIDORES = `
  coalesce((
    select jsonb_agg(to_jsonb(c) order by c.precio)
      from (
        select distinct on (o.fuente)
               o.fuente,
               o.precio,
               o.dia,
               o.disponible,
               coalesce(o.url, u.url)                    as url,
               count(*) over (partition by o.fuente) - 1 as anteriores
          from (
            select e->>'fuente'                as fuente,
                   (e->>'precio')::numeric     as precio,
                   e->>'dia'                   as dia,
                   (e->>'disponible')::boolean as disponible,
                   e->>'url'                   as url
              from jsonb_array_elements(p.entradas->'observaciones') e
          ) o
          left join lateral (
            select ob.url
              from precios.observacion ob
             where ob.fuente = o.fuente
               and ob.ean = lpad(replace(trim(coalesce(a."eanUnidad", '')), ' ', ''), 13, '0')
               and ob.url is not null
             order by ob.dia desc
             limit 1
          ) u on true
         order by o.fuente, o.dia desc, o.precio
      ) c
  ), '[]'::jsonb)
`;

/** Cuántos hay en cada grupo, para las tarjetas de arriba. */
export async function getResumenPreciosTn(): Promise<ResumenPreciosTn> {
  const vacio: ResumenPreciosTn = {
    corridaId: null,
    corridaFecha: null,
    comparadoEn: null,
    grupos: {},
    pendientes: 0,
    decididas: 0,
    aprobadasSinAplicar: 0,
  };

  const corrida = await queryOne<{ id: number }>(ULTIMA_CORRIDA, []);
  if (!corrida) return vacio;

  const fecha = await queryOne<{ arrancada_en: string }>(
    `select arrancada_en from precios.corrida where id = $1`,
    [corrida.id],
  );

  /**
   * CUÁNDO SE MIRÓ A LA COMPETENCIA, que no es cuándo corrió el motor.
   *
   * El motor puede correr hoy sobre observaciones de hace tres días y no tiene
   * forma de saberlo: para él son datos vigentes según la política. Quien
   * aprueba necesita el otro número — hace cuánto que nadie va a mirar los
   * precios de los demás — porque es el que dice si esta pantalla está
   * diciendo algo del mercado de hoy o del de la semana pasada.
   */
  const comparado = await queryOne<{ terminada_en: string }>(
    `select terminada_en from precios.corrida
      where tipo = 'competencia' and estado = 'ok' and terminada_en is not null
      order by terminada_en desc limit 1`,
    [],
  );

  const grupos = await query<{ grupo: ClaveAlerta; total: number }>(
    `select ${CLASIFICACION} as grupo, count(*)::int as total
       from precios.propuesta p
      where p.corrida_id = $1 and ${CLASIFICACION} is not null
      group by 1`,
    [corrida.id],
  );

  const estados = await query<{ estado: string; total: number }>(
    `select estado, count(*)::int as total
       from precios.propuesta where corrida_id = $1 group by 1`,
    [corrida.id],
  );

  // Lo aprobado y todavía sin escribir, de TODAS las corridas y no sólo de la
  // última: es la cola real que tiene esperando el comando `aplicar`, y si una
  // aprobación de ayer quedó sin aplicar, esconderla no la hace desaparecer.
  const esperando = await queryOne<{ total: number }>(
    `select count(*)::int as total from precios.propuesta where estado = 'aprobada'`,
    [],
  );

  const porEstado = Object.fromEntries(estados.map((e) => [e.estado, e.total]));
  return {
    corridaId: corrida.id,
    corridaFecha: fecha?.arrancada_en ?? null,
    comparadoEn: comparado?.terminada_en ?? null,
    grupos: Object.fromEntries(grupos.map((g) => [g.grupo, g.total])),
    pendientes: porEstado.pendiente ?? 0,
    decididas: (porEstado.aprobada ?? 0) + (porEstado.rechazada ?? 0) + (porEstado.aplicada ?? 0),
    aprobadasSinAplicar: esperando?.total ?? 0,
  };
}

/**
 * Arma el `where` de los filtros. Devuelve el SQL y los parámetros agregados.
 *
 * TODO VA PARAMETRIZADO, incluso la búsqueda de texto. Concatenar lo que
 * escribe alguien en un buscador dentro del SQL es la forma clásica de que una
 * pantalla de sólo lectura termine siendo de escritura.
 */
function condicionesDeFiltro(
  filtros: FiltrosPreciosTn,
  params: unknown[],
): string {
  const partes: string[] = [];

  if (filtros.grupo) {
    params.push(filtros.grupo);
    partes.push(`and ${CLASIFICACION} = $${params.length}`);
  }
  if (filtros.proveedor) {
    params.push(filtros.proveedor);
    partes.push(`and a."proveedorNombre" = $${params.length}`);
  }
  if (filtros.marca) {
    params.push(filtros.marca);
    partes.push(`and coalesce(a.marca, a."attributes.marca") = $${params.length}`);
  }
  if (filtros.busqueda) {
    // Un solo parámetro para las dos columnas: quien escribe "CH07038" busca un
    // SKU y quien escribe "chupete" busca una descripción, y no tiene por qué
    // decirnos cuál de las dos cosas está haciendo.
    params.push(`%${filtros.busqueda}%`);
    partes.push(
      `and (p.sku ilike $${params.length} or a.descripcion ilike $${params.length})`,
    );
  }

  return partes.join("\n        ");
}

/** El `where` común a la lista y a la aprobación en bloque. */
function cuerpoDeConsulta(filtros: FiltrosPreciosTn, params: unknown[]): string {
  return `
       from precios.propuesta p
       left join bronze.sigma_articulos a on a.id = p.sku
      where p.corrida_id = $1
        and ${CLASIFICACION} is not null
        -- Lo que está a menos del umbral no es cola de trabajo, es ruido.
        and (p.referencia_competencia is null
             or abs(p.precio_actual - p.referencia_competencia) / p.referencia_competencia >= $2)
        ${condicionesDeFiltro(filtros, params)}`;
}

/**
 * La cola de trabajo, ordenada por la diferencia más grande primero.
 *
 * Se ordena por el VALOR ABSOLUTO de la diferencia contra la competencia y no
 * por el porcentaje del cambio propuesto: lo que importa priorizar es cuánto
 * nos separa del mercado, no cuánto alcanzó a corregir el motor dentro de su
 * banda. Un producto 60 % caro que la banda sólo deja bajar 10 % tiene que
 * salir primero, no décimo.
 */
export async function getFilasPreciosTn(
  filtros: FiltrosPreciosTn,
  limite = 200,
): Promise<FilaPrecioTn[]> {
  const corrida = await queryOne<{ id: number }>(ULTIMA_CORRIDA, []);
  if (!corrida) return [];

  const params: unknown[] = [corrida.id, DIFERENCIA_MINIMA_VISIBLE];
  const cuerpo = cuerpoDeConsulta(filtros, params);
  params.push(limite);
  const limiteParam = params.length;

  return query<FilaPrecioTn>(
    `select p.id,
            p.sku,
            coalesce(a.descripcion, p.sku)                 as descripcion,
            coalesce(a.marca, a."attributes.marca")        as marca,
            a."proveedorNombre"                            as proveedor,
            p.accion,
            p.estado,
            p.precio_actual::float8                        as "precioActual",
            p.precio_propuesto::float8                     as "precioPropuesto",
            p.piso::float8                                 as piso,
            p.referencia_competencia::float8               as "mejorCompetencia",
            -- La diferencia contra el mercado, que es lo que ordena la cola.
            case when p.referencia_competencia > 0
                 then ((p.precio_actual - p.referencia_competencia) / p.referencia_competencia)::float8
            end                                            as "difMercado",
            ${CLASIFICACION}                               as grupo,
            p.motivos                                      as motivos,
            -- Los competidores, con su precio y su LINK: quien aprueba tiene
            -- que poder abrir la ficha del otro y mirarla con sus propios ojos.
            ${COMPETIDORES}                                as competidores,
            (p.entradas->>'stock')::float8                 as stock,
            (p.entradas->>'costo')::float8                 as costo,
            -- EL MARGEN SALE CALCULADO DEL MOTOR, no se recalcula acá.
            -- La cuenta (sacar el IVA, restar pasarela e impuestos) vive en
            -- dominio/margen.py y es la misma con la que se despeja el piso.
            -- Recalcularla en este SQL sería una segunda implementación, y el
            -- día que una cambie la pantalla mostraría un margen que el motor
            -- no usó para decidir nada.
            --
            -- (Sin backticks a propósito: esto viaja dentro de un template
            -- literal de JS y un backtick acá lo corta a la mitad.)
            --
            -- Viene NULL en las propuestas anteriores a la corrida que empezó
            -- a guardarlo. La pantalla muestra "—" y se llena solo en la
            -- próxima comparación.
            (p.entradas->>'margen_actual')::float8          as "margenActual",
            (p.entradas->>'margen_propuesto')::float8       as "margenPropuesto"
       ${cuerpo}
      order by
        -- Los pendientes primero: lo ya decidido no vuelve a la cola.
        (p.estado = 'pendiente') desc,
        abs(coalesce(p.precio_actual - p.referencia_competencia, 0)) / nullif(p.referencia_competencia, 0) desc nulls last
      limit $${limiteParam}`,
    params,
  );
}

/**
 * Los valores que existen para llenar los desplegables.
 *
 * SALEN DE LO QUE HAY EN PANTALLA, no de todo Sigma. Un filtro que ofrece 300
 * marcas de las cuales 280 no tienen ninguna fila que mostrar no es un filtro,
 * es una lista de decepciones.
 */
export async function getCatalogosPreciosTn(): Promise<CatalogosPreciosTn> {
  const corrida = await queryOne<{ id: number }>(ULTIMA_CORRIDA, []);
  if (!corrida) return { proveedores: [], marcas: [] };

  const sinFiltros: FiltrosPreciosTn = {
    grupo: null,
    proveedor: null,
    marca: null,
    busqueda: null,
  };
  const params: unknown[] = [corrida.id, DIFERENCIA_MINIMA_VISIBLE];
  const cuerpo = cuerpoDeConsulta(sinFiltros, params);

  const filas = await query<{ proveedor: string | null; marca: string | null }>(
    `select distinct a."proveedorNombre" as proveedor,
            coalesce(a.marca, a."attributes.marca") as marca
       ${cuerpo}`,
    params,
  );

  const unicos = (valores: (string | null)[]) =>
    [...new Set(valores.filter((v): v is string => !!v))].sort((a, b) =>
      a.localeCompare(b, "es"),
    );

  return {
    proveedores: unicos(filas.map((f) => f.proveedor)),
    marcas: unicos(filas.map((f) => f.marca)),
  };
}

/**
 * Aprobar o rechazar. Lo ÚNICO que esta aplicación escribe.
 *
 * Guarda quién y cuándo, y sólo toca filas que sigan `pendiente`: si dos
 * personas abren la pantalla a la vez, la segunda no pisa la decisión de la
 * primera sin enterarse -- devuelve 0 filas y la pantalla lo dice.
 */
export async function decidirPropuesta(
  id: number,
  decision: "aprobada" | "rechazada",
  quien: string,
): Promise<boolean> {
  const filas = await query<{ id: number }>(
    `update precios.propuesta
        set estado = $2, decidida_por = $3, decidida_en = now()
      where id = $1 and estado = 'pendiente'
      returning id`,
    [id, decision, quien],
  );
  return filas.length > 0;
}

/**
 * Autorizar en bloque LO QUE ESTÁ FILTRADO, y nada más.
 *
 * POR QUÉ NO HAY UN "APROBAR TODO" A SECAS. Porque la pantalla muestra 845
 * filas y nadie mira 845 filas. Un botón que aprueba todo lo que existe
 * convierte una decisión en un reflejo, y el día que una corrida salga rara
 * --un costo mal cargado, una fuente que devolvió precios de otro producto--
 * se aprueba la corrida rara entera de un click.
 *
 * Atado al filtro, el botón significa algo concreto y verificable: "todo lo de
 * esta marca, que acabo de mirar". El servidor vuelve a aplicar exactamente el
 * mismo `where` que armó la lista, en vez de recibir del navegador la lista de
 * IDs: si la pantalla de quien aprueba quedó vieja, lo que se aprueba sigue
 * siendo lo que el filtro describe y no lo que el navegador recordaba.
 *
 * Nunca toca:
 *   - lo que ya decidió otra persona (`estado = 'pendiente'` en el where);
 *   - lo que no tiene precio propuesto (no hay nada que escribir);
 *   - las filas de "no se puede competir sin perder", que no son un precio a
 *     corregir sino una decisión de si seguir vendiendo el producto. Esas se
 *     aprueban de a una, a propósito.
 */
export async function aprobarFiltradas(
  filtros: FiltrosPreciosTn,
  quien: string,
): Promise<number> {
  const corrida = await queryOne<{ id: number }>(ULTIMA_CORRIDA, []);
  if (!corrida) return 0;

  const params: unknown[] = [corrida.id, DIFERENCIA_MINIMA_VISIBLE];
  const cuerpo = cuerpoDeConsulta(filtros, params);
  params.push(quien);
  const quienParam = params.length;

  const filas = await query<{ id: number }>(
    `update precios.propuesta destino
        set estado = 'aprobada', decidida_por = $${quienParam}, decidida_en = now()
      where destino.id in (
              select p.id
              ${cuerpo}
                and p.estado = 'pendiente'
                and p.precio_propuesto is not null
                and ${CLASIFICACION} <> 'no_competible'
            )
        and destino.estado = 'pendiente'
      returning destino.id`,
    params,
  );
  return filas.length;
}

/**
 * Cuántas aprobaría el botón de arriba, para poder decirlo ANTES de hacerlo.
 *
 * Misma consulta, sin el `update`. Un botón que aprueba en bloque sin decir
 * cuántas está por aprobar es una trampa.
 */
export async function contarAprobables(filtros: FiltrosPreciosTn): Promise<{
  total: number;
  bajan: number;
  suben: number;
}> {
  const corrida = await queryOne<{ id: number }>(ULTIMA_CORRIDA, []);
  if (!corrida) return { total: 0, bajan: 0, suben: 0 };

  const params: unknown[] = [corrida.id, DIFERENCIA_MINIMA_VISIBLE];
  const cuerpo = cuerpoDeConsulta(filtros, params);

  const fila = await queryOne<{ total: number; bajan: number; suben: number }>(
    `select count(*)::int as total,
            count(*) filter (where p.accion = 'bajar')::int as bajan,
            count(*) filter (where p.accion = 'subir')::int as suben
       ${cuerpo}
        and p.estado = 'pendiente'
        and p.precio_propuesto is not null
        and ${CLASIFICACION} <> 'no_competible'`,
    params,
  );
  return fila ?? { total: 0, bajan: 0, suben: 0 };
}

/* -------------------------------------------------------------------------
   Cambios aplicados: qué se escribió de verdad en la tienda.
   ------------------------------------------------------------------------- */

/**
 * El historial de precios escritos, del más reciente al más viejo.
 *
 * SALE DE `precios.cambio`, QUE ES LA ÚNICA VERDAD SOBRE ESTO. Esa tabla la
 * escribe el comando `aplicar` en la misma transacción en la que cierra la
 * propuesta, y tiene un trigger que prohíbe `update` y `delete`: un registro de
 * auditoría que se puede editar no es un registro de auditoría. El precio
 * anterior queda guardado ahí, que es lo que permite volver atrás sin depender
 * de que Tienda Nube recuerde nada.
 *
 * El link a nuestra propia ficha sale de `bronze.tn_productos.canonical_url`.
 * Esa tabla está desactualizada para los PRECIOS --el error que originó medio
 * proyecto-- pero la dirección de un producto no cambia cuando cambia su
 * precio, que es la misma razón por la que se puede completar desde ahí la URL
 * de un competidor.
 */
export async function getCambiosPreciosTn(limite = 200): Promise<CambioPrecioTn[]> {
  return query<CambioPrecioTn>(
    `select c.id,
            c.sku,
            coalesce(a.descripcion, c.sku)          as descripcion,
            coalesce(a.marca, a."attributes.marca") as marca,
            c.precio_anterior::float8               as "precioAnterior",
            c.precio_nuevo::float8                  as "precioNuevo",
            case when c.precio_anterior > 0
                 then ((c.precio_nuevo - c.precio_anterior) / c.precio_anterior)::float8
            end                                     as variacion,
            c.aplicado_en                           as "aplicadoEn",
            p.decidida_por                          as "autorizadoPor",
            t.canonical_url                         as url,
            -- Si ya se deshizo, no se puede deshacer de nuevo. Se mira si
            -- existe una propuesta que revierta ESTE cambio y que siga viva
            -- (aprobada = en cola, aplicada = ya revertido).
            exists (
              select 1 from precios.propuesta r
               where r.revierte_cambio_id = c.id
                 and r.estado in ('aprobada', 'aplicada')
            )                                       as "yaSeDeshizo"
       from precios.cambio c
       left join precios.propuesta p       on p.id = c.propuesta_id
       left join bronze.sigma_articulos a  on a.id = c.sku
       left join bronze.tn_productos t     on t.id = c.producto_id
      order by c.aplicado_en desc
      limit $1`,
    [limite],
  );
}

/**
 * Deshacer un cambio: vuelve al precio anterior, que quedó guardado.
 *
 * NO ESCRIBE EN TIENDA NUBE, y no puede. Crea una PROPUESTA en sentido
 * contrario, ya aprobada, que escribe `precios aplicar` como cualquier otra.
 * Esa vuelta larga es el punto: le hace pasar por los mismos controles, que
 * resultan ser exactamente los que un "deshacer" necesita.
 *
 *   - Si alguien tocó ese precio a mano después del cambio, no se pisa: el
 *     precio de la tienda ya no coincide con el que dejamos, y `revisar()`
 *     lo rechaza con el motivo escrito.
 *   - Si el precio viejo quedó debajo del piso de HOY --que suele ser POR QUÉ
 *     se cambió-- tampoco se escribe, y queda dicho.
 *   - Y la vuelta atrás queda en `precios.cambio` como un cambio más, con su
 *     propio precio anterior. Se puede deshacer el deshacer.
 *
 * Devuelve el id de la propuesta creada, o null si ese cambio ya tenía una.
 */
export async function deshacerCambio(
  cambioId: number,
  quien: string,
): Promise<number | null> {
  const cambio = await queryOne<{
    id: number;
    sku: string;
    producto_id: string;
    variante_id: string;
    precio_anterior: string;
    precio_nuevo: string;
  }>(
    `select c.id, c.sku, c.producto_id, c.variante_id, c.precio_anterior, c.precio_nuevo
       from precios.cambio c
      where c.id = $1
        and not exists (
          select 1 from precios.propuesta r
           where r.revierte_cambio_id = c.id
             and r.estado in ('aprobada', 'aplicada')
        )`,
    [cambioId],
  );
  if (!cambio) return null;

  // Una corrida propia por cada deshacer. Las propuestas necesitan una y ésta
  // no viene del motor; además deja quién lo pidió, que es justo lo que
  // después hay que poder contestar.
  const corrida = await queryOne<{ id: number }>(
    `insert into precios.corrida (tipo, estado, terminada_en, detalle)
     values ('deshacer', 'ok', now(), jsonb_build_object('quien', $1::text, 'cambio_id', $2::bigint))
     returning id`,
    [quien, cambioId],
  );
  if (!corrida) return null;

  // `precio_actual` es lo que ESCRIBIMOS nosotros, no lo que haya hoy en la
  // tienda. Es a propósito: `aplicar` compara ese número contra el precio real
  // antes de escribir, y si no coinciden es porque alguien lo movió en el
  // medio -- y entonces deshacer borraría su corrección.
  const propuesta = await queryOne<{ id: number }>(
    `insert into precios.propuesta
         (corrida_id, sku, accion, precio_actual, precio_propuesto,
          motivos, entradas, estado, decidida_por, decidida_en, revierte_cambio_id)
     values ($1, $2,
             case when $3::numeric < $4::numeric then 'bajar' else 'subir' end,
             $4::numeric, $3::numeric,
             jsonb_build_array(
               format('deshacer el cambio #%s: volver de %s a %s', $5::text, $4::text, $3::text),
               'pedido a mano desde el tablero, no lo propuso el motor'),
             jsonb_build_object('producto_id', $6::bigint, 'variante_id', $7::bigint),
             'aprobada', $8::text, now(), $5::bigint)
     returning id`,
    [
      corrida.id,
      cambio.sku,
      cambio.precio_anterior,
      cambio.precio_nuevo,
      cambioId,
      cambio.producto_id,
      cambio.variante_id,
      quien,
    ],
  );
  return propuesta?.id ?? null;
}

/**
 * Autorizar una selección concreta, por id.
 *
 * ACÁ SÍ VIAJAN LOS IDs, y no es una contradicción con `aprobarFiltradas`.
 * Son dos gestos distintos: "todo lo de esta marca" es una descripción que el
 * servidor tiene que resolver contra la base de ahora, porque entre que se
 * dibujó la pantalla y se apretó el botón pueden haber entrado filas nuevas.
 * "Estas seis que tildé" es una lista, y resolverla de nuevo contra un filtro
 * aprobaría cosas que la persona nunca miró.
 *
 * El `estado = 'pendiente'` del where sigue siendo la red: si otra persona
 * decidió alguna en el medio, esa no se toca y el total que vuelve es menor que
 * lo pedido — que es justo lo que la pantalla tiene que poder decir.
 */
export async function aprobarPorIds(ids: number[], quien: string): Promise<number> {
  const limpios = [...new Set(ids)].filter((n) => Number.isInteger(n) && n > 0);
  if (!limpios.length) return 0;

  const filas = await query<{ id: number }>(
    `update precios.propuesta
        set estado = 'aprobada', decidida_por = $2, decidida_en = now()
      where id = any($1::bigint[])
        and estado = 'pendiente'
        and precio_propuesto is not null
      returning id`,
    [limpios, quien],
  );
  return filas.length;
}
