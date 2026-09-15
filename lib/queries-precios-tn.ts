import { query, queryOne } from "@/lib/db";
import {
  DIFERENCIA_MINIMA_VISIBLE,
  GRUPOS_INFORMATIVOS,
  GRUPOS_INFORMATIVOS_SQL,
  type ClaveAlerta,
} from "@/lib/precios-tn";
import type {
  CambioPrecioTn,
  CatalogosCambiosTn,
  CatalogosPreciosTn,
  FiltrosCambiosTn,
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
 * El precio que la tienda tiene HOY, que no siempre es `precio_actual`.
 *
 * ---------------------------------------------------------------------------
 * `precio_actual` ES UNA FOTO DEL MOMENTO DE LA CORRIDA, y deja de ser cierta
 * en cuanto se escribe el precio.
 *
 * Se vio con doscientos precios cambiados de una vez: al día siguiente los
 * artículos seguían contados en "más baratos de lo necesario", porque la
 * clasificación comparaba contra el mercado el precio que tenían ANTES de que
 * se los corrigiera. La tarjeta decía que faltaba hacer algo que ya se había
 * hecho, y como la fila ya no estaba pendiente tampoco tenía casilla: quedaba
 * un renglón que se quejaba y no se dejaba resolver.
 *
 * Aplicada la propuesta, lo que la tienda tiene es `precio_propuesto` —el
 * comando de escritura lo verifica contra la tienda de verdad antes de cada
 * PUT y lo registra en `precios.cambio`, así que no es una suposición.
 *
 * SÓLO 'aplicada', y no 'aprobada'. Una aprobada todavía no se escribió: la
 * tienda sigue teniendo el precio viejo y clasificarla por el nuevo sería
 * mentir en la otra dirección.
 * ---------------------------------------------------------------------------
 */
const PRECIO_VIGENTE = `
  case when p.estado = 'aplicada' and p.precio_propuesto is not null
       then p.precio_propuesto
       else p.precio_actual
  end
`;

/**
 * El precio al que QUERÍAMOS llegar, que no siempre es el de la competencia.
 *
 * ---------------------------------------------------------------------------
 * "EN PRECIO" SE MIDE CONTRA EL OBJETIVO, NO CONTRA EL MERCADO PELADO.
 *
 * Mientras la agresividad fue 0 daban lo mismo: el objetivo ERA el precio del
 * competidor más barato. En cuanto se decide apuntar un poco por debajo para
 * diferenciarse, dejan de coincidir — y medir contra el mercado marcaría "más
 * barato de lo necesario" a todos los artículos que están EXACTAMENTE donde se
 * los puso a propósito.
 *
 * Sale de `entradas.objetivo`, que el motor guarda por propuesta: la
 * referencia menos la agresividad, ANTES de que lo recorten el piso, el
 * redondeo y el umbral. Guardado y no recalculado acá, porque la agresividad
 * puede cambiar mañana y una corrida vieja tiene que seguir explicándose con
 * la política que la produjo.
 *
 * El `coalesce` cubre las propuestas anteriores a que el motor empezara a
 * guardarlo: ahí el objetivo era la referencia, así que la cuenta sigue dando
 * lo mismo que antes.
 * ---------------------------------------------------------------------------
 */
const OBJETIVO = `
  coalesce((p.entradas->>'objetivo')::numeric, p.referencia_competencia)
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
    -- SIN STOCK VA ANTES QUE TODO LO QUE MIRA PRECIOS, porque el motor los
    -- descarta antes de mirar a la competencia: estas filas no tienen
    -- referencia, ni piso, ni nada contra que compararse.
    when p.accion = 'omitir' and p.motivos::text like '%sin stock vendible%'
      then 'sin_stock'
    when ${PRECIO_VIGENTE} < p.piso and p.referencia_competencia < p.piso
      then 'no_competible'
    when ${PRECIO_VIGENTE} < p.piso
      then 'bajo_piso'
    -- EN PRECIO VA ANTES QUE CAROS Y BARATOS, y el orden es la regla.
    --
    -- Estar 1 % arriba del mercado es estar en precio, no estar caro. Si esta
    -- rama fuera después, todo caería en "caros" o "baratos" según el signo de
    -- una diferencia que no significa nada, y las dos tarjetas dirían miles.
    --
    -- Va DESPUÉS de las dos de piso a propósito: vender por debajo del costo
    -- sigue siendo grave aunque estemos clavados con el mercado. Ahí el
    -- problema no es el precio de ellos, es el nuestro.
    when p.referencia_competencia is not null
         and ${OBJETIVO} > 0
         and abs(${PRECIO_VIGENTE} - ${OBJETIVO}) / ${OBJETIVO}
             < ${DIFERENCIA_MINIMA_VISIBLE}
      then 'en_precio'
    -- YA SE CORRIGIÓ Y AUN ASÍ NO ALCANZA, porque el piso no deja bajar más.
    --
    -- Va después de "en precio" a propósito: un artículo corregido que quedó
    -- pegado al mercado está en precio y punto, que es lo que se buscaba. Acá
    -- caen sólo los que siguen arriba con el piso ya tocando la competencia.
    --
    -- Y va antes de "caros" porque decir "más caros que la competencia"
    -- promete que se puede bajar. No se puede: bajar más es vender a pérdida.
    when p.estado = 'aplicada'
         and p.referencia_competencia is not null
         and p.piso is not null
         and ${PRECIO_VIGENTE} > p.referencia_competencia
         and p.referencia_competencia < p.piso
      then 'corregidos_sin_competir'
    -- CAROS Y BARATOS TAMBIEN CONTRA EL OBJETIVO, y no es opcional: si "en
    -- precio" midiera contra el objetivo y estas dos contra el mercado, un
    -- articulo clavado en el precio del competidor no caeria en NINGUNA de las
    -- tres --no esta en precio, no esta arriba del mercado, no esta abajo-- y
    -- desapareceria de la pantalla sin que nadie lo note.
    --
    -- Con agresividad en 0 dan exactamente lo mismo que antes, porque ahi el
    -- objetivo ES la referencia.
    when p.referencia_competencia is not null and ${PRECIO_VIGENTE} > ${OBJETIVO}
      then 'caros'
    when p.referencia_competencia is not null and ${PRECIO_VIGENTE} < ${OBJETIVO}
      then 'baratos'
    -- LA RED, Y ES LO QUE HACE QUE LAS TARJETAS SUMEN EL TOTAL.
    --
    -- Antes este case podia dar NULL, y las filas que caian ahi no aparecian en
    -- ninguna tarjeta ni en ningun lado: 2.387 de 3.788 articulos invisibles,
    -- y los numeros de la pantalla que no cerraban sin forma de averiguar por
    -- que. Con este else la clasificacion es total y eso no puede volver a
    -- pasar: un motivo de omision nuevo aparece en su tarjeta en vez de
    -- desaparecer.
    else 'no_evaluable'
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

/**
 * El link a NUESTRA ficha, para poder mirar el producto antes de autorizarlo.
 *
 * Quien aprueba una propuesta está mirando un renglón: un SKU, una descripción
 * de Sigma y dos números. Lo que NO ve es el producto — la foto, la variante,
 * cómo está escrito el título en la tienda, si la promo que tenemos puesta tiene
 * sentido con el precio nuevo. Es el mismo argumento por el que se guarda la URL
 * del competidor: una propuesta que no se puede verificar se aprueba a ciegas o
 * no se aprueba nunca. Si vale para la tienda de otro, vale para la nuestra.
 *
 * DOS FUENTES, Y LA DE ADELANTE ES LA FRESCA. `precios.precio_propio.url` la
 * copia el pipeline de `canonical_url` en cada corrida de `propios`, o sea antes
 * de cada comparación. `bronze.tn_productos` es una copia vieja —el error que
 * originó medio proyecto— pero la dirección de un producto no cambia cuando
 * cambia su precio, así que sirve de respaldo, igual que para las URLs de la
 * competencia.
 *
 * Hace falta que sean las dos: de los 834 artículos de la cola de hoy, bronze
 * tiene URL para 790. Los 44 que faltan son productos que se cargaron después de
 * la última sincronización de esa tabla, y son justamente los que uno más quiere
 * abrir antes de tocarles el precio.
 */
const URL_PROPIA = `coalesce(pp.url, t.canonical_url)`;

/**
 * Nuestra última foto de precios, para colgarle la URL y el producto_id.
 *
 * `distinct on (sku)` con el día más nuevo: la tabla guarda una fila por
 * variante y por día, y acá alcanza con la última de cada SKU.
 */
const FOTO_PROPIA = `
  left join lateral (
    select pr.url, pr.producto_id
      from precios.precio_propio pr
     where pr.sku = p.sku
     order by pr.dia desc, pr.id desc
     limit 1
  ) pp on true
  left join bronze.tn_productos t on t.id = pp.producto_id
`;

/** Cuántos hay en cada grupo, para las tarjetas de arriba. */
export async function getResumenPreciosTn(): Promise<ResumenPreciosTn> {
  const vacio: ResumenPreciosTn = {
    corridaId: null,
    corridaFecha: null,
    comparadoEn: null,
    grupos: {},
    pendientes: 0,
    porDecidir: 0,
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

  // LO QUE DE VERDAD ESPERA UNA DECISION.
  //
  // La solapa decia "Para revisar 3.735" y las seis tarjetas sumaban 1.401. El
  // contador estaba contando TODAS las pendientes -- incluidos 2.387 articulos
  // sin stock que el motor ni compara-- asi que prometia trabajo que no
  // existia. Lo que espera una decision es lo que tiene un cambio propuesto:
  // 510 en esa misma corrida.
  const porDecidir = await queryOne<{ total: number }>(
    `select count(*)::int as total
       from precios.propuesta
      where corrida_id = $1
        and estado = 'pendiente'
        and accion in ('subir', 'bajar')
        and precio_propuesto is not null`,
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
    porDecidir: porDecidir?.total ?? 0,
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
  if (filtros.competidor) {
    // SE MIRA `entradas`, QUE ES LA FOTO CON LA QUE EL MOTOR DECIDIÓ, y no
    // `precios.observacion` en vivo. Filtrar por "lo que se comparó contra
    // Juleriaque" tiene que devolver las filas cuya propuesta REALMENTE miró a
    // Juleriaque; una observación que llegó después no participó de esa
    // decisión y no tiene por qué aparecer acá.
    params.push(filtros.competidor);
    partes.push(
      `and exists (select 1 from jsonb_array_elements(p.entradas->'observaciones') e
                    where e->>'fuente' = $${params.length})`,
    );
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
  // LO QUE ESTÁ EN PRECIO NO ES COLA DE TRABAJO, PERO TAMPOCO ES INVISIBLE.
  //
  // ESTA CONSULTA YA NO ESCONDE NADA, y pasó por tres etapas.
  //
  // Primero los productos en precio se excluían con un `where` y no aparecían
  // en ningún lado: ni en la lista ni en el resumen. Después empezaron a
  // contarse en su tarjeta pero seguían fuera de la lista, salvo que se
  // hiciera clic.
  //
  // Ahora la pantalla abre con TODO a la vista y las tarjetas filtran al
  // tocarlas. El motivo de esconderlos era que una cola con trescientas filas
  // de 1 % de diferencia es ruido; el motivo de mostrarlos es que la pantalla
  // también se usa para mirar el catálogo, y ahí "¿dónde está este producto?"
  // no puede contestarse con "en ningún lado". Con las tarjetas a un clic, lo
  // segundo no cuesta lo primero.
  //
  // Lo que SÍ sigue excluyendo los grupos informativos es la aprobación en
  // bloque, más abajo: ahí no hay nada que aprobar y contarlos mentiría.
  // `some` y no `includes`: el filtro llega como `string | null` --lo valida
  // `leerFiltros` contra ALERTAS, pero el tipo no lo refleja-- y comparar es lo
  // que no obliga a un cast que taparía un valor inválido.
  return `
       from precios.propuesta p
       left join bronze.sigma_articulos a on a.id = p.sku
       ${FOTO_PROPIA}
      where p.corrida_id = $1
        and ${CLASIFICACION} is not null
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

  const params: unknown[] = [corrida.id];
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
            -- EL PRECIO QUE LA TIENDA TIENE HOY, no el de la foto. Si la fila
            -- se clasifica por uno y muestra otro, el renglón se contradice
            -- solo: diría "en precio" al lado de un número que no lo está.
            ${PRECIO_VIGENTE}::float8                      as "precioActual",
            p.precio_propuesto::float8                     as "precioPropuesto",
            p.piso::float8                                 as piso,
            p.referencia_competencia::float8               as "mejorCompetencia",
            -- La diferencia contra el mercado, que es lo que ordena la cola.
            case when p.referencia_competencia > 0
                 then ((${PRECIO_VIGENTE} - p.referencia_competencia)
                       / p.referencia_competencia)::float8
            end                                            as "difMercado",
            ${CLASIFICACION}                               as grupo,
            p.motivos                                      as motivos,
            -- Los competidores, con su precio y su LINK: quien aprueba tiene
            -- que poder abrir la ficha del otro y mirarla con sus propios ojos.
            ${COMPETIDORES}                                as competidores,
            (p.entradas->>'stock')::float8                 as stock,
            (p.entradas->>'costo')::float8                 as costo,
            -- EL DESGLOSE DEL COSTO, para el tooltip. Sale de entradas y no
            -- de bronze.costos_historicos en vivo, por lo mismo que los
            -- margenes: si llega una lista nueva, la pantalla tiene que seguir
            -- explicando el costo con el que el motor decidio, no con otro.
            -- (Sin backticks: template literal de JS.)
            (p.entradas->>'costo_teorico')::float8          as "costoTeorico",
            (p.entradas->>'costo_oferta_pct')::float8       as "ofertaPct",
            p.entradas->>'costo_mes'                        as "costoMes",
            p.entradas->>'costo_desde'                      as "costoDesde",
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
            (p.entradas->>'margen_propuesto')::float8       as "margenPropuesto",
            ${URL_PROPIA}                                  as url
       ${cuerpo}
      order by
        -- Los pendientes primero: lo ya decidido no vuelve a la cola.
        (p.estado = 'pendiente') desc,
        abs(coalesce(${PRECIO_VIGENTE} - p.referencia_competencia, 0))
          / nullif(p.referencia_competencia, 0) desc nulls last
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
  if (!corrida) return { proveedores: [], marcas: [], competidores: [] };

  const sinFiltros: FiltrosPreciosTn = {
    grupo: null,
    proveedor: null,
    marca: null,
    competidor: null,
    busqueda: null,
  };
  const params: unknown[] = [corrida.id];
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

  // LOS COMPETIDORES QUE CONTESTARON EN ESTA CORRIDA, no los configurados.
  //
  // Va en su propia consulta porque sale de desarmar un array de JSON y
  // mezclarlo con el `distinct` de arriba multiplicaría las filas por la
  // cantidad de observaciones de cada producto.
  //
  // Que una fuente activa NO aparezca en esta lista es información: quiere
  // decir que esta corrida no le sacó un solo precio.
  const fuentes = await query<{ fuente: string }>(
    `select distinct e->>'fuente' as fuente
       from precios.propuesta p,
            lateral jsonb_array_elements(p.entradas->'observaciones') e
      where p.corrida_id = $1
        and e->>'fuente' is not null`,
    [corrida.id],
  );

  return {
    proveedores: unicos(filas.map((f) => f.proveedor)),
    marcas: unicos(filas.map((f) => f.marca)),
    competidores: unicos(fuentes.map((f) => f.fuente)),
  };
}

/**
 * Aprobar o rechazar. Lo ÚNICO que esta aplicación escribe.
 *
 * Guarda quién y cuándo, y sólo toca filas que sigan `pendiente`: si dos
 * personas abren la pantalla a la vez, la segunda no pisa la decisión de la
 * primera sin enterarse -- devuelve 0 filas y la pantalla lo dice.
 */
/**
 * Guardar un precio a mano SIN decidir nada todavia.
 *
 * ---------------------------------------------------------------------------
 * POR QUE EXISTE, Y QUE ERROR ARREGLA.
 *
 * Antes el precio a mano no se guardaba en ningun lado: vivia en el estado del
 * componente y sólo llegaba a la base si se apretaba el botón "Autorizar" del
 * propio editor. Escribir el número y después autorizar por cualquier otro
 * camino —el botón de la fila, la casilla y "Autorizar seleccionadas", o
 * "Autorizar todo"— mandaba el pedido SIN precio, y se escribía en la tienda
 * el que había propuesto el motor.
 *
 * No fallaba nada y no había aviso: el número tecleado simplemente desaparecía.
 * En la base no quedó un solo caso con el motivo "escrito a mano", que es como
 * se comprobó.
 *
 * Ahora escribir el precio es un acto propio: queda en `precio_propuesto` con
 * la propuesta todavía pendiente, y a partir de ahí CUALQUIER camino de
 * aprobación escribe ese número, porque todos leen de la misma columna.
 * ---------------------------------------------------------------------------
 */
export async function guardarPrecioManual(
  id: number,
  precio: number,
  quien: string,
): Promise<boolean> {
  const filas = await query<{ id: number }>(
    `update precios.propuesta
        set precio_propuesto = $2::numeric,
            -- El coalesce no es de adorno: en jsonb, null || algo da null.
            -- Sin el, una propuesta sin motivos perderia el rastro de que
            -- alguien le puso el precio a mano, que es justo lo que hay que
            -- poder contestar despues.
            --
            -- (Sin backticks: esto viaja dentro de un template literal de JS
            -- y uno solo lo corta a la mitad. Ya paso tres veces en este
            -- archivo, incluida la vez que escribi este comentario.)
            motivos = coalesce(motivos, '[]'::jsonb) || to_jsonb(
              'precio escrito a mano por ' || $3::text ||
              ': el motor proponia ' || coalesce(precio_propuesto::text, 'nada')
            )
      where id = $1
        and estado = 'pendiente'
        -- EL PISO NO SE PUEDE PERFORAR NI A MANO. Ver el comentario largo en
        -- decidirPropuesta, mas abajo: mismo control, misma razon.
        and ($2::numeric >= piso or piso is null)
      returning id`,
    [id, precio, quien],
  );
  return filas.length > 0;
}

export async function decidirPropuesta(
  id: number,
  decision: "aprobada" | "rechazada",
  quien: string,
  precioManual?: number | null,
): Promise<boolean> {
  if (decision === "rechazada" || precioManual == null) {
    const filas = await query<{ id: number }>(
      `update precios.propuesta
          set estado = $2, decidida_por = $3, decidida_en = now()
        where id = $1 and estado = 'pendiente'
        returning id`,
      [id, decision, quien],
    );
    return filas.length > 0;
  }

  const filas = await query<{ id: number }>(
    `update precios.propuesta
        set estado = 'aprobada',
            decidida_por = $3,
            decidida_en = now(),
            precio_propuesto = $2::numeric,
            motivos = coalesce(motivos, '[]'::jsonb) || to_jsonb(
              'precio escrito a mano por ' || $3::text ||
              ': el motor proponia ' || coalesce(precio_propuesto::text, 'nada')
            )
      where id = $1
        and estado = 'pendiente'
        -- EL PISO NO SE PUEDE PERFORAR NI A MANO, Y SE VERIFICA ACA.
        --
        -- Es la unica regla dura del sistema: no vender por debajo del costo
        -- con IVA, pasarela e impuestos y el margen minimo. Un campo de texto
        -- libre en una pantalla es exactamente por donde se saltea una regla
        -- asi, y confiar en que el navegador valide no sirve: el navegador es
        -- de quien escribe.
        --
        -- Si la condicion no se cumple no se actualiza ninguna fila y la ruta
        -- contesta que no se pudo, que es lo mismo que pasa si otra persona ya
        -- la decidio. El comando de aplicar vuelve a mirar el piso contra el
        -- costo de HOY antes de escribir, asi que son dos puertas y no una.
        and ($2::numeric >= piso or piso is null)
      returning id`,
    [id, precioManual, quien],
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

  const params: unknown[] = [corrida.id];
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
                -- Los grupos informativos no se aprueban en bloque aunque se
                -- los esté mirando. Los que están en precio son de accion
                -- "mantener": escribirlos pondría el mismo número que ya está
                -- y el comando de aplicar los vetaría uno por uno. Los
                -- corregidos sin competir ya se escribieron, así que no hay
                -- nada que aprobar. Un botón que dice "23 autorizadas" y
                -- después no escribe ninguna enseña a desconfiar del contador.
                --
                -- (Sin backticks: esto viaja dentro de un template literal de
                -- JS y uno solo lo corta a la mitad. Ya pasó en este archivo.)
                and ${CLASIFICACION} not in (${GRUPOS_INFORMATIVOS_SQL})
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

  const params: unknown[] = [corrida.id];
  const cuerpo = cuerpoDeConsulta(filtros, params);

  const fila = await queryOne<{ total: number; bajan: number; suben: number }>(
    `select count(*)::int as total,
            count(*) filter (where p.accion = 'bajar')::int as bajan,
            count(*) filter (where p.accion = 'subir')::int as suben
       ${cuerpo}
        and p.estado = 'pendiente'
        and p.precio_propuesto is not null
        and ${CLASIFICACION} <> 'no_competible'
        and ${CLASIFICACION} not in (${GRUPOS_INFORMATIVOS_SQL})`,
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
/**
 * El cuerpo del historial: de donde salen las filas y que filtro se aplica.
 *
 * Se arma una sola vez porque lo usan cuatro consultas --la lista, el conteo,
 * los desplegables y el deshacer en bloque-- y tienen que coincidir. Si el
 * bloque de "deshacer todo lo filtrado" resolviera un conjunto distinto del que
 * la pantalla muestra, desharia cambios que nadie vio.
 */
function cuerpoDeCambios(filtros: FiltrosCambiosTn, params: unknown[]): string {
  const partes: string[] = [];

  if (filtros.proveedor) {
    params.push(filtros.proveedor);
    partes.push(`and a."proveedorNombre" = $${params.length}`);
  }
  if (filtros.marca) {
    params.push(filtros.marca);
    partes.push(`and coalesce(a.marca, a."attributes.marca") = $${params.length}`);
  }
  if (filtros.busqueda) {
    params.push(`%${filtros.busqueda}%`);
    partes.push(`and (c.sku ilike $${params.length} or a.descripcion ilike $${params.length})`);
  }
  // LAS FECHAS SE COMPARAN EN LA ZONA DE ARGENTINA, no en UTC. Un cambio
  // escrito a las 22:30 de Buenos Aires es del dia siguiente en UTC, y filtrar
  // "hoy" lo dejaria afuera -- justo el mas reciente, que es el que se busca.
  if (filtros.desde) {
    params.push(filtros.desde);
    partes.push(
      `and (c.aplicado_en at time zone 'America/Argentina/Buenos_Aires')::date >= $${params.length}::date`,
    );
  }
  if (filtros.hasta) {
    params.push(filtros.hasta);
    partes.push(
      `and (c.aplicado_en at time zone 'America/Argentina/Buenos_Aires')::date <= $${params.length}::date`,
    );
  }

  return `
       from precios.cambio c
       left join precios.propuesta p       on p.id = c.propuesta_id
       left join bronze.sigma_articulos a  on a.id = c.sku
       left join bronze.tn_productos t     on t.id = c.producto_id
       left join lateral (
           select url from precios.precio_propio
            where variante_id = c.variante_id and url is not null
            order by capturado_en desc limit 1
       ) pp on true
      where true
        ${partes.join("\n        ")}`;
}

/** Cuantos cambios hay en total con este filtro, para poder decirlo. */
export async function contarCambiosPreciosTn(filtros: FiltrosCambiosTn): Promise<number> {
  const params: unknown[] = [];
  const cuerpo = cuerpoDeCambios(filtros, params);
  const fila = await queryOne<{ total: number }>(
    `select count(*)::int as total ${cuerpo}`,
    params,
  );
  return fila?.total ?? 0;
}

/** Proveedores y marcas que existen EN EL HISTORIAL, no en el catalogo entero. */
export async function getCatalogosCambiosTn(): Promise<CatalogosCambiosTn> {
  const sinFiltros: FiltrosCambiosTn = {
    proveedor: null,
    marca: null,
    busqueda: null,
    desde: null,
    hasta: null,
  };
  const params: unknown[] = [];
  const cuerpo = cuerpoDeCambios(sinFiltros, params);
  const filas = await query<{ proveedor: string | null; marca: string | null }>(
    `select distinct a."proveedorNombre" as proveedor,
            coalesce(a.marca, a."attributes.marca") as marca
       ${cuerpo}`,
    params,
  );
  const unicos = (valores: (string | null)[]) =>
    [...new Set(valores.filter((v): v is string => !!v))].sort((a, b) => a.localeCompare(b, "es"));

  return {
    proveedores: unicos(filas.map((f) => f.proveedor)),
    marcas: unicos(filas.map((f) => f.marca)),
  };
}

export async function getCambiosPreciosTn(
  filtros: FiltrosCambiosTn,
  limite = 100,
): Promise<CambioPrecioTn[]> {
  const params: unknown[] = [];
  const cuerpo = cuerpoDeCambios(filtros, params);
  params.push(limite);
  const limiteParam = params.length;

  return query<CambioPrecioTn>(
    `select c.id,
            c.sku,
            coalesce(a.descripcion, c.sku)          as descripcion,
            coalesce(a.marca, a."attributes.marca") as marca,
            a."proveedorNombre"                     as proveedor,
            c.precio_anterior::float8               as "precioAnterior",
            c.precio_nuevo::float8                  as "precioNuevo",
            case when c.precio_anterior > 0
                 then ((c.precio_nuevo - c.precio_anterior) / c.precio_anterior)::float8
            end                                     as variacion,
            c.aplicado_en                           as "aplicadoEn",
            p.decidida_por                          as "autorizadoPor",
            -- LA MISMA FUENTE QUE LA COLA, Y POR EL MISMO MOTIVO.
            --
            -- bronze.tn_productos esta desactualizada y no cubre todo: 19 de
            -- los 308 cambios no tienen fila ahi, y esos aparecian como texto
            -- plano mientras el resto era link. precios.precio_propio guarda
            -- la url de la ficha en cada lectura de la tienda y los cubre a
            -- todos.
            --
            -- Se deja tn_productos como respaldo: no cuesta nada y cubre el
            -- caso de una variante que todavia no paso por una lectura.
            --
            -- (Sin backticks acá: template literal de JS.)
            coalesce(pp.url, t.canonical_url)       as url,
            -- CON QUÉ RENTABILIDAD QUEDÓ. Sale del margen que calculó el
            -- MOTOR, no de una cuenta hecha en este SQL: sacar el IVA, restar
            -- pasarela e impuestos vive en dominio/margen.py y es la misma
            -- cuenta con la que se despeja el piso. Reimplementarla acá sería
            -- una segunda versión, y el día que una cambie el historial
            -- mostraría un margen que nadie usó para decidir.
            --
            -- SÓLO SI EL PRECIO ESCRITO ES EL QUE EL MOTOR PROPUSO. Con un
            -- precio puesto a mano --o un deshacer-- ese margen se calculó
            -- para otro número, y mostrarlo sería peor que no mostrar nada.
            case when p.precio_propuesto = c.precio_nuevo
                 then (p.entradas->>'margen_propuesto')::float8
            end                                     as margen,
            -- Si ya se deshizo, no se puede deshacer de nuevo. Se mira si
            -- existe una propuesta que revierta ESTE cambio y que siga viva
            -- (aprobada = en cola, aplicada = ya revertido).
            exists (
              select 1 from precios.propuesta r
               where r.revierte_cambio_id = c.id
                 and r.estado in ('aprobada', 'aplicada')
            )                                       as "yaSeDeshizo"
       ${cuerpo}
      order by c.aplicado_en desc
      limit $${limiteParam}`,
    params,
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
 * Deshacer VARIOS cambios de una vez.
 *
 * ---------------------------------------------------------------------------
 * UNA SOLA CORRIDA PARA TODO EL LOTE, y no una por cambio.
 *
 * `deshacerCambio` abre una corrida propia cada vez, que está bien para un
 * botón: deja registrado quién pidió esa vuelta y cuándo. Repetirlo doscientas
 * veces llenaría `precios.corrida` de filas de una propuesta cada una, y el
 * historial de corridas dejaría de servir para ver qué pasó.
 *
 * Acá el lote ES el gesto: una persona miró una lista y dijo "estos". Una
 * corrida con los ids adentro cuenta eso mejor que doscientas sueltas.
 *
 * NO ESCRIBE EN TIENDA NUBE, igual que el de a uno: deja propuestas aprobadas
 * en sentido contrario, que `precios aplicar` escribe después pasando por los
 * mismos controles — incluido el que impide pisar una corrección hecha a mano.
 * Por eso "deshacer 200" no es una operación peligrosa: es 200 pedidos que se
 * van a verificar uno por uno antes de tocar nada.
 * ---------------------------------------------------------------------------
 */
export async function deshacerCambios(
  ids: number[],
  quien: string,
): Promise<number> {
  if (!ids.length) return 0;

  const corrida = await queryOne<{ id: number }>(
    `insert into precios.corrida (tipo, estado, terminada_en, detalle)
     values ('deshacer', 'ok', now(),
             jsonb_build_object('quien', $1::text, 'cambios', $2::bigint[]))
     returning id`,
    [quien, ids],
  );
  if (!corrida) return 0;

  // UN SOLO INSERT CON UN SELECT ADENTRO, y no un bucle de inserts.
  //
  // El filtro de "ya tiene vuelta pedida" y la inserción tienen que mirar el
  // mismo estado: entre un select y un insert separados, dos personas pidiendo
  // la misma vuelta a la vez meterían dos propuestas para el mismo cambio.
  const filas = await query<{ id: number }>(
    `insert into precios.propuesta
         (corrida_id, sku, accion, precio_actual, precio_propuesto,
          motivos, entradas, estado, decidida_por, decidida_en, revierte_cambio_id)
     select $1,
            c.sku,
            case when c.precio_anterior < c.precio_nuevo then 'bajar' else 'subir' end,
            c.precio_nuevo,
            c.precio_anterior,
            jsonb_build_array(
              format('deshacer el cambio #%s: volver de %s a %s',
                     c.id::text, c.precio_nuevo::text, c.precio_anterior::text),
              'pedido a mano desde el tablero, en bloque; no lo propuso el motor'),
            jsonb_build_object('producto_id', c.producto_id, 'variante_id', c.variante_id),
            'aprobada',
            $2::text,
            now(),
            c.id
       from precios.cambio c
      where c.id = any($3::bigint[])
        and c.producto_id is not null
        and c.variante_id is not null
        and not exists (
          select 1 from precios.propuesta r
           where r.revierte_cambio_id = c.id
             and r.estado in ('aprobada', 'aplicada')
        )
     returning id`,
    [corrida.id, quien, ids],
  );
  return filas.length;
}

/**
 * Los ids de cambio que cumplen un filtro y todavía se pueden deshacer.
 *
 * SE RESUELVE EN EL SERVIDOR, igual que "autorizar todo lo filtrado". Si el
 * navegador mandara los ids que tiene en pantalla, estaría deshaciendo lo que
 * su lista recordaba — que puede ser de antes del último cambio.
 */
export async function idsDeCambiosFiltrados(filtros: FiltrosCambiosTn): Promise<number[]> {
  const params: unknown[] = [];
  const cuerpo = cuerpoDeCambios(filtros, params);
  const filas = await query<{ id: number }>(
    `select c.id ${cuerpo}
        and c.producto_id is not null
        and c.variante_id is not null
        and not exists (
          select 1 from precios.propuesta r
           where r.revierte_cambio_id = c.id
             and r.estado in ('aprobada', 'aplicada')
        )
      order by c.aplicado_en desc`,
    params,
  );
  return filas.map((f) => f.id);
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
