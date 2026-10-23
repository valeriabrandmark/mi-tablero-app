import { enTransaccion, query, queryOne } from "@/lib/db";
import { mesComercialActual } from "@/lib/constantes";
import { armarSnapshot, type ArticuloParaCostear, type Snapshot } from "@/lib/costos-snapshot";
import { leerOfertas, type OfertasDeLaPlanilla } from "@/lib/ofertas-planilla";
import type { CaratulaCostos, FilaDeArchivo } from "@/lib/exportar-costos";

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
  /** Las fotos ya guardadas, para poder bajarlas. */
  tramos: TramoGuardado[];
};

/**
 * LOS QUE SE COSTEAN: los activos del maestro. Un artículo desactivado no se
 * compra ni se vende, así que darle un costo nuevo es escribir filas que
 * ninguna pantalla va a leer.
 *
 * Sale a función aparte porque la leen dos: la foto que se muestra y el
 * archivo que se baja. Con el SQL copiado en los dos, el día que cambie el
 * filtro va a cambiar en uno solo.
 */
async function leerArticulos(): Promise<ArticuloParaCostear[]> {
  const filas = await query<{
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
  return filas.map((a) => ({
    sku: a.sku,
    proveedor: a.proveedor,
    descripcion: a.descripcion,
    costoTeorico: a.costo_teorico == null ? null : Number(a.costo_teorico),
  }));
}

/**
 * EL COSTO CONTRA EL QUE SE MIDE EL SALTO: el que rige hoy, por SKU. Es el
 * mismo criterio que usan las pantallas (`ULTIMO_COSTO_VIGENTE`), así que
 * "cambia" quiere decir lo mismo acá que allá.
 */
async function leerCostoActual(): Promise<Map<string, number>> {
  const filas = await query<{ sku: string; costo_real: string }>(
    `select distinct on (sku) sku, costo_real
       from bronze.costos_historicos
      where costo_real > 0 and vigente_desde <= current_date
      order by sku, mes_comercial desc, vigente_desde desc`,
  );
  return new Map(filas.map((f) => [f.sku, Number(f.costo_real)]));
}

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

  const articulos = await leerArticulos();

  const tramos = await listarTramos(12);

  const mes = mesComercialActual(ahora);
  const vigenteDesde = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(ahora);

  const costoActual = await leerCostoActual();

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
    snapshot: armarSnapshot(articulos, ofertas, costoActual),
    ofertas,
    foto: cruda ? { recibida: cruda.recibido, filas: Number(cruda.filas_n) } : null,
    mes,
    vigenteDesde,
    tramoVigente: tramo
      ? { mes: tramo.mes, vigenteDesde: tramo.vigente, nota: tramo.nota }
      : null,
    tramos,
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

/* ===========================================================================
   LAS FOTOS GUARDADAS
   ===========================================================================

   El respaldo ya existía y nadie lo veía. `costos_historicos` guarda cada
   tramo entero --hay catorce desde mayo-- y desde que existe la columna
   `origen` nada los borra: costos.py sólo limpia lo suyo. Lo que faltaba era
   poder mirarlos y bajarlos.

   Un tramo se identifica por las tres cosas juntas: mes comercial, desde
   cuándo rige y de dónde salió. El origen hace falta porque un mismo día puede
   tener un tramo del Excel y otro del tablero, y son dos fotos distintas.
   ========================================================================= */

export type TramoGuardado = {
  mes: string;
  vigenteDesde: string;
  /** En DD/MM/YYYY, para mostrar. */
  vigenteDesdeTexto: string;
  origen: string;
  articulos: number;
  /** Cuántos de esos tienen costo. El resto son testers y exhibidores. */
  conCosto: number;
  nota: string | null;
  aplicadoPor: string | null;
  aplicadoEn: string | null;
  cambian: number | null;
  sinCostoTeorico: number | null;
  faltantes: number | null;
  conOferta: number | null;
  /** El que rige hoy. Es el que se mira primero. */
  vigente: boolean;
};

/** Las fotos guardadas, de la más nueva a la más vieja. */
export async function listarTramos(limite = 24): Promise<TramoGuardado[]> {
  const filas = await query<{
    mes: string;
    vigente_desde: string;
    vigente_texto: string;
    origen: string;
    articulos: string;
    con_costo: string;
    nota: string | null;
    aplicado_por: string | null;
    aplicado_en: string | null;
    cambian: number | null;
    sin_costo_teorico: number | null;
    faltantes: number | null;
    con_oferta: number | null;
  }>(
    `select h.mes_comercial as mes,
            to_char(h.vigente_desde, 'YYYY-MM-DD') as vigente_desde,
            to_char(h.vigente_desde, 'DD/MM/YYYY') as vigente_texto,
            h.origen,
            count(*) as articulos,
            count(*) filter (where h.costo_real > 0) as con_costo,
            min(ct.nota) as nota,
            min(ct.aplicado_por) as aplicado_por,
            to_char(min(ct.aplicado_en)
                      at time zone 'America/Argentina/Buenos_Aires',
                    'DD/MM/YYYY HH24:MI') as aplicado_en,
            min(ct.cambian) as cambian,
            min(ct.sin_costo_teorico) as sin_costo_teorico,
            min(ct.faltantes) as faltantes,
            min(ct.con_oferta) as con_oferta
       from bronze.costos_historicos h
       -- SOLO LOS TRAMOS DEL TABLERO TIENEN FILA ACA. Que un tramo del Excel
       -- no la tenga también dice algo: salió del camino viejo, sin nota.
       left join bronze.costos_tramos ct
         on ct.mes_comercial = h.mes_comercial
        and ct.vigente_desde = h.vigente_desde
        and h.origen = 'tablero'
      group by h.mes_comercial, h.vigente_desde, h.origen
      order by h.mes_comercial desc, h.vigente_desde desc, h.origen
      limit $1`,
    [limite],
  );

  // CUAL RIGE HOY: el más nuevo que ya empezó. Es el mismo criterio que usan
  // las pantallas, así que lo que dice acá es lo que se está usando allá.
  const hoy = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const vigente = filas.find((f) => f.vigente_desde <= hoy);

  return filas.map((f) => ({
    mes: f.mes,
    vigenteDesde: f.vigente_desde,
    vigenteDesdeTexto: f.vigente_texto,
    origen: f.origen,
    articulos: Number(f.articulos),
    conCosto: Number(f.con_costo),
    nota: f.nota,
    aplicadoPor: f.aplicado_por,
    aplicadoEn: f.aplicado_en,
    cambian: f.cambian,
    sinCostoTeorico: f.sin_costo_teorico,
    faltantes: f.faltantes,
    conOferta: f.con_oferta,
    vigente: f === vigente,
  }));
}

/**
 * Las filas de un tramo, con el costo que regía ANTES de él.
 *
 * El "antes" se busca con un lateral por SKU, apoyado en el índice
 * `costos_historicos_sku_mes_vig`, que es exactamente (sku, mes, vigente).
 * Se saltean los costos en cero a propósito: es lo mismo que hacen las
 * consultas que leen costos, así que "el costo anterior" quiere decir acá lo
 * mismo que en las pantallas --el último que de verdad regía-- y no "la última
 * fila escrita", que puede ser un cero que nadie usó nunca.
 */
export async function filasDeTramo(
  mes: string,
  vigenteDesde: string,
  origen: string,
): Promise<FilaDeArchivo[]> {
  const filas = await query<{
    sku: string;
    proveedor: string | null;
    descripcion: string | null;
    costo_teorico: string | null;
    oferta_pct: string | null;
    desc_propio_pct: string | null;
    costo_real: string | null;
    antes: string | null;
  }>(
    `select h.sku,
            a."proveedorNombre" as proveedor,
            a.descripcion,
            h.costo_teorico, h.oferta_pct, h.desc_propio_pct, h.costo_real,
            prev.costo_real as antes
       from bronze.costos_historicos h
       -- EL NOMBRE ES EL DE HOY, no el de entonces: el maestro no guarda
       -- historia de descripciones. Los números sí son los del tramo.
       left join bronze.sigma_articulos a on trim(a.id) = h.sku
       left join lateral (
            select p.costo_real
              from bronze.costos_historicos p
             where p.sku = h.sku
               and p.costo_real > 0
               and (p.mes_comercial, p.vigente_desde)
                 < (h.mes_comercial, h.vigente_desde)
             order by p.mes_comercial desc, p.vigente_desde desc
             limit 1
       ) prev on true
      where h.mes_comercial = $1
        and h.vigente_desde = $2::date
        and h.origen = $3
      order by h.sku`,
    [mes, vigenteDesde, origen],
  );

  return filas.map((f) => ({
    sku: f.sku,
    proveedor: f.proveedor,
    descripcion: f.descripcion,
    costoTeorico: Number(f.costo_teorico ?? 0),
    ofertaPct: Number(f.oferta_pct ?? 0),
    descPropioPct: Number(f.desc_propio_pct ?? 0),
    costoReal: Number(f.costo_real ?? 0),
    antes: f.antes == null ? null : Number(f.antes),
  }));
}

/** YYYY-MM-DD a DD/MM/YYYY. En el archivo la fecha se lee, no se ordena. */
function textoDeFecha(iso: string): string {
  const [a, m, d] = iso.split("-");
  return d ? `${d}/${m}/${a}` : iso;
}

/** La carátula de un tramo guardado, para el archivo. */
export function caratulaDeTramo(t: TramoGuardado): CaratulaCostos {
  const partes: string[] = [`${t.articulos} artículos`, `${t.conCosto} con costo`];
  if (t.conOferta != null) partes.push(`${t.conOferta} con oferta`);
  if (t.cambian != null) partes.push(`${t.cambian} cambiaron`);
  if (t.faltantes != null) partes.push(`${t.faltantes} sin oferta en la planilla`);
  if (t.sinCostoTeorico) partes.push(`${t.sinCostoTeorico} sin costo teórico`);

  return {
    mes: t.mes,
    vigenteDesde: t.vigenteDesdeTexto,
    origen: t.origen,
    nota: t.nota,
    aplicadoPor: t.aplicadoPor,
    aplicadoEn: t.aplicadoEn,
    contadores: partes.join(" · "),
  };
}

/**
 * La foto de AHORA, todavía sin aplicar, lista para bajar.
 *
 * Es el caso que más se usa: mirar ocho mil filas en Excel antes de apretar el
 * botón. Ordenar por diferencia, filtrar un proveedor, buscar un SKU -- cosas
 * que en una pantalla no se hacen y en una planilla sí.
 *
 * Vuelve a leer el maestro en vez de recibir la foto del navegador, por lo
 * mismo que el POST: lo que se baja tiene que ser lo que hay en la base.
 */
export async function fotoParaArchivo(
  ahora: Date = new Date(),
): Promise<{ caratula: CaratulaCostos; filas: FilaDeArchivo[]; mes: string; vigenteDesde: string }> {
  const preparado = await prepararCostos(ahora);
  const { snapshot, mes, vigenteDesde } = preparado;

  const [articulos, costoActual] = await Promise.all([leerArticulos(), leerCostoActual()]);
  const porSku = new Map(articulos.map((a) => [a.sku, a]));

  const partes = [
    `${snapshot.filas.length} artículos`,
    `${snapshot.conOferta} con oferta`,
    `${snapshot.cambian} cambian`,
    `${snapshot.faltantes.length} sin oferta en la planilla`,
  ];
  if (snapshot.sinCostoTeorico.length) {
    partes.push(`${snapshot.sinCostoTeorico.length} sin costo teórico`);
  }
  // DE CUANDO ES LA FOTO DE OFERTAS. Es lo primero que hay que mirar si los
  // números no son los esperados: la planilla puede haberse editado después.
  if (preparado.foto) partes.push(`ofertas recibidas el ${preparado.foto.recibida}`);

  return {
    mes,
    vigenteDesde,
    caratula: {
      mes,
      vigenteDesde: textoDeFecha(vigenteDesde),
      origen: "tablero",
      // TODAVIA NO SE APLICO, y el archivo tiene que decirlo: si no, bajado
      // hoy y abierto el mes que viene se lee como un tramo que rigió.
      nota: "SIN APLICAR todavía: es la foto de cómo quedarían los costos.",
      aplicadoPor: null,
      aplicadoEn: null,
      contadores: partes.join(" · "),
    },
    filas: snapshot.filas.map((f): FilaDeArchivo => {
      const a = porSku.get(f.sku);
      return {
        sku: f.sku,
        proveedor: a?.proveedor ?? null,
        descripcion: a?.descripcion ?? null,
        costoTeorico: f.costoTeorico,
        ofertaPct: f.ofertaPct,
        descPropioPct: f.descPropioPct,
        costoReal: f.costoReal,
        antes: costoActual.get(f.sku) ?? null,
      };
    }),
  };
}
