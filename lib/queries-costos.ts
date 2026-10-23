import { enTransaccion, query, queryOne } from "@/lib/db";
import { mesComercialActual } from "@/lib/constantes";
import { armarSnapshot, type ArticuloParaCostear, type Snapshot } from "@/lib/costos-snapshot";
import { leerOfertas, type OfertasDeLaPlanilla } from "@/lib/ofertas-planilla";

/**
 * Los costos, actualizados desde el tablero en vez de desde un Excel.
 *
 * ---------------------------------------------------------------------------
 * LAS DOS MITADES YA ESTABAN
 *
 * El costo teórico lo sincroniza el orquestador desde Sigma por API, y las
 * ofertas las manda el Apps Script del Consolidador a `bronze.ofertas_crudo`.
 * Lo único que faltaba era juntarlas y escribirlas, que es lo que hay acá.
 *
 * ---------------------------------------------------------------------------
 * LO QUE ESCRIBE, Y LO QUE NO PUEDE OLVIDARSE DE ESCRIBIR
 *
 * Aplicar un tramo son TRES escrituras en una transacción:
 *
 *   1. `costos_historicos`  los números, marcados `origen = 'tablero'`.
 *   2. `costos_tramos`      la nota de qué cambió y quién lo aplicó.
 *   3. `ops.estado`         la anotación que le dice a modelo.py desde cuándo
 *                           recalcular gold.
 *
 * LA TERCERA ES LA QUE SE OLVIDA. Sin ella los costos quedan bien en
 * `costos_historicos` y mal en todas las pantallas: `gold.fact_ventas` guarda
 * el margen ya calculado, y nadie vuelve a tocarlo hasta que alguien lo pide.
 * Es exactamente lo que hace `anotar_para_reconstruir` en costos.py.
 */

/** La clave de la anotación. Tiene que decir lo mismo que en costos.py. */
const CLAVE_RECONSTRUIR = "costos_reconstruir_desde";

/** De dónde salieron las filas que escribe esta pantalla. Ver costos.py. */
const ORIGEN = "tablero";

export type FotoDeOfertas = {
  /** Cuándo la mandó la planilla, en hora de Buenos Aires. */
  recibida: string;
  filas: number;
};

export type Preparado = {
  snapshot: Snapshot;
  ofertas: OfertasDeLaPlanilla;
  foto: FotoDeOfertas | null;
  /** El mes comercial al que va a parar el tramo. */
  mes: string;
  /** Desde cuándo rige. Hoy: es cuando se supo. */
  vigenteDesde: string;
  /** El tramo que rige ahora mismo, para decir contra qué se compara. */
  tramoVigente: { mes: string; vigenteDesde: string; nota: string | null } | null;
};

/**
 * Arma la foto SIN escribir nada.
 *
 * Es lo que mira la pantalla antes de aplicar. Se calcula entero del lado del
 * servidor --y no a medias acá y a medias en el navegador-- para que lo que se
 * ve sea exactamente lo que se va a escribir.
 */
export async function prepararCostos(ahora: Date = new Date()): Promise<Preparado> {
  const cruda = await queryOne<{ filas: unknown; recibido: string; filas_n: number }>(
    `select filas,
            to_char(recibido at time zone 'America/Argentina/Buenos_Aires',
                    'DD/MM/YYYY HH24:MI') as recibido,
            filas_n
       from bronze.ofertas_crudo
      order by id desc
      limit 1`,
  );

  const ofertas = leerOfertas(cruda?.filas ?? null);
  if (!cruda) {
    ofertas.problemas.push(
      "Todavía no llegó ninguna foto del Consolidador de Ofertas. " +
        'En la planilla: menú "Tablero" → "Mandar las ofertas ahora".',
    );
  }

  // LOS QUE SE COSTEAN: los activos del maestro. Un artículo desactivado no se
  // compra ni se vende, así que darle un costo nuevo es escribir filas que
  // ninguna pantalla va a leer.
  const articulos = await query<{
    sku: string;
    proveedor: string | null;
    descripcion: string | null;
    costo_teorico: string | null;
  }>(
    `select trim(id) as sku, "proveedorNombre" as proveedor, descripcion,
            "costoTeorico" as costo_teorico
       from bronze.sigma_articulos
      where coalesce(desactivado, 'false') = 'false'
        and nullif(trim(id), '') is not null
      order by 1`,
  );

  const mes = mesComercialActual(ahora);
  const vigenteDesde = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(ahora);

  // EL COSTO CONTRA EL QUE SE MIDE EL SALTO: el que rige hoy, por SKU. Es el
  // mismo criterio que usan las pantallas (`ULTIMO_COSTO_VIGENTE`), así que
  // "cambia" quiere decir lo mismo acá que allá.
  const actuales = await query<{ sku: string; costo_real: string }>(
    `select distinct on (sku) sku, costo_real
       from bronze.costos_historicos
      where costo_real > 0 and vigente_desde <= current_date
      order by sku, mes_comercial desc, vigente_desde desc`,
  );
  const costoActual = new Map(actuales.map((f) => [f.sku, Number(f.costo_real)]));

  const tramo = await queryOne<{ mes: string; vigente: string; nota: string | null }>(
    `select ch.mes_comercial as mes,
            to_char(ch.vigente_desde, 'DD/MM/YYYY') as vigente,
            ct.nota
       from bronze.costos_historicos ch
       left join bronze.costos_tramos ct
         on ct.mes_comercial = ch.mes_comercial
        and ct.vigente_desde = ch.vigente_desde
      where ch.vigente_desde <= current_date
      order by ch.mes_comercial desc, ch.vigente_desde desc
      limit 1`,
  );

  return {
    snapshot: armarSnapshot(
      articulos.map(
        (a): ArticuloParaCostear => ({
          sku: a.sku,
          proveedor: a.proveedor,
          descripcion: a.descripcion,
          costoTeorico: a.costo_teorico == null ? null : Number(a.costo_teorico),
        }),
      ),
      ofertas,
      costoActual,
    ),
    ofertas,
    foto: cruda ? { recibida: cruda.recibido, filas: Number(cruda.filas_n) } : null,
    mes,
    vigenteDesde,
    tramoVigente: tramo
      ? { mes: tramo.mes, vigenteDesde: tramo.vigente, nota: tramo.nota }
      : null,
  };
}

/**
 * Escribe el tramo. Las tres escrituras, en una transacción.
 *
 * REEMPLAZA EL TRAMO DEL MISMO DIA si ya existe: aplicar dos veces el mismo
 * día es corregirse, no duplicar. Y toca SOLO las filas `origen = 'tablero'`,
 * por lo mismo que costos.py toca sólo las suyas.
 */
export async function aplicarCostos(datos: {
  preparado: Preparado;
  nota: string;
  usuario: string | null;
}): Promise<{ filas: number }> {
  const { snapshot, mes, vigenteDesde } = datos.preparado;

  const skus = snapshot.filas.map((f) => f.sku);
  const teoricos = snapshot.filas.map((f) => f.costoTeorico);
  const ofertas = snapshot.filas.map((f) => f.ofertaPct);
  const propios = snapshot.filas.map((f) => f.descPropioPct);
  const reales = snapshot.filas.map((f) => f.costoReal);

  await enTransaccion(async (ejecutar) => {
    await ejecutar(
      `delete from bronze.costos_historicos
        where origen = $1 and mes_comercial = $2 and vigente_desde = $3::date`,
      [ORIGEN, mes, vigenteDesde],
    );

    // `unnest` y no una fila por INSERT: son 8.300 artículos, y 8.300 viajes a
    // la base tardan minutos con la pantalla esperando.
    await ejecutar(
      `insert into bronze.costos_historicos
         (sku, mes_comercial, vigente_desde, costo_teorico, oferta_pct,
          desc_propio_pct, costo_real, origen)
       select s, $2, $3::date, t, o, p, r, $1
         from unnest($4::text[], $5::float8[], $6::float8[], $7::float8[], $8::float8[])
              as x(s, t, o, p, r)`,
      [ORIGEN, mes, vigenteDesde, skus, teoricos, ofertas, propios, reales],
    );

    await ejecutar(
      `insert into bronze.costos_tramos
         (mes_comercial, vigente_desde, nota, aplicado_por,
          articulos, con_oferta, faltantes, cambian, sin_costo_teorico)
       values ($1, $2::date, $3, $4, $5, $6, $7, $8, $9)
       on conflict (mes_comercial, vigente_desde) do update
          set nota = excluded.nota,
              aplicado_por = excluded.aplicado_por,
              aplicado_en = now(),
              articulos = excluded.articulos,
              con_oferta = excluded.con_oferta,
              faltantes = excluded.faltantes,
              cambian = excluded.cambian,
              sin_costo_teorico = excluded.sin_costo_teorico`,
      [
        mes,
        vigenteDesde,
        datos.nota.trim().slice(0, 500) || null,
        datos.usuario,
        snapshot.filas.length,
        snapshot.conOferta,
        snapshot.faltantes.length,
        snapshot.cambian,
        snapshot.sinCostoTeorico.length,
      ],
    );

    // LA ANOTACION PARA GOLD. Ver arriba: sin esto los márgenes quedan viejos.
    // Se guarda la MAS VIEJA de las pendientes, igual que costos.py: si ya
    // había una sin consumir, pisarla con una más nueva dejaría días sin
    // recalcular.
    await ejecutar(
      `insert into ops.estado (clave, valor, actualizado)
       values ($1, to_jsonb($2::text), now())
       on conflict (clave) do update
          set valor = to_jsonb(least(
                nullif(ops.estado.valor #>> '{}', '')::date, $2::date)::text),
              actualizado = now()`,
      [CLAVE_RECONSTRUIR, vigenteDesde],
    );
  });

  return { filas: snapshot.filas.length };
}
