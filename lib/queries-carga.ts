import { enTransaccion, query } from "@/lib/db";
import {
  TABLAS,
  validar,
  type ClaveMarcaCarga,
  type ClaveTabla,
  type Fila,
  type LineaCanje,
  type ProductoManual,
} from "@/lib/marketing-carga";
import type { ClaveMarca } from "@/lib/marketing-demo";
import type {
  ColaboracionPlanilla,
  EnvioPlanilla,
  GastoPlanilla,
  Planilla,
  PresupuestoPlanilla,
} from "@/lib/marketing-planilla";

/**
 * Lectura y escritura de Marketing → Carga (tablas en
 * migraciones/marketing_carga.sql).
 *
 * Toda escritura deja una fila en bronze.mkt_cambios con cómo estaba antes y
 * cómo quedó: así cualquier cosa se puede editar o borrar sin perder nada.
 *
 * Los nombres de tabla y columna salen SIEMPRE de `TABLAS` (lib/marketing-
 * carga.ts), nunca de lo que manda el navegador: así no se puede inyectar SQL
 * por el nombre de un campo.
 */

export class ErrorCarga extends Error {}

/**
 * Los clientes de SIGMA que en realidad son canjes. Su "venta" es mercadería
 * entregada a influencers: no es venta, es costo de marketing. Se reconocen
 * por el nombre (CANJE DIAPER GENIE, CANJES HOLA TOYS, CANJES UNIBRANCO...).
 */
export const SQL_ES_CANJE = (alias = "") => `upper(coalesce(${alias}cliente, '')) like 'CANJE%'`;

const SQL_MARCA_CANJE = `case
  when upper(cliente) like '%DIAPER%' then 'diaper_genie'
  when upper(cliente) like '%HOLA%' then 'hola_toys'
  when upper(cliente) like '%LITTER%' then 'litter_genie'
  when upper(cliente) like '%UNIBRAN%' then 'unibrandco'
end`;

// ---------------------------------------------------------------------------
// Lectura
// ---------------------------------------------------------------------------

/** Las líneas de SIGMA de los clientes de canje, con a qué colaboración están asignadas. */
export async function leerCanjesSigma(desde?: string, hasta?: string): Promise<LineaCanje[]> {
  const filtros = [SQL_ES_CANJE("fv.")];
  const params: unknown[] = [];
  if (desde) {
    params.push(desde);
    filtros.push(`fv.fecha >= $${params.length}::date`);
  }
  if (hasta) {
    params.push(hasta);
    filtros.push(`fv.fecha <= $${params.length}::date`);
  }
  const filas = await query<{
    comprobante: string; fecha: string; marca: ClaveMarcaCarga; sku: string; producto: string;
    cantidad: string; costo: string; colaboracion_id: string | null;
  }>(
    `select fv.comprobante, fv.fecha::text as fecha, ${SQL_MARCA_CANJE.replace(/cliente/g, "fv.cliente")} as marca,
            fv.sku, fv.producto, fv.cantidad,
            coalesce(fv.costo_unitario, 0) * fv.cantidad as costo, c.colaboracion_id
       from gold.fact_ventas fv
       left join bronze.mkt_colab_canjes c on c.comprobante = fv.comprobante
      where ${filtros.join(" and ")}
      order by fv.fecha desc, fv.comprobante`,
    params,
  );
  return filas.map((f) => ({
    comprobante: f.comprobante,
    fecha: f.fecha,
    marca: f.marca,
    sku: f.sku,
    producto: f.producto,
    cantidad: Number(f.cantidad),
    costo: Number(f.costo),
    colaboracion_id: f.colaboracion_id === null ? null : Number(f.colaboracion_id),
  }));
}

/** Todo lo de la pantalla de carga. */
export async function leerCarga() {
  const [influencers, colaboraciones, productos, canjes, envios, gastos, presupuesto, contenido, lineas] = await Promise.all([
    query(`select *, ultimo_contacto::text as ultimo_contacto from bronze.mkt_influencers order by lower(nombre)`),
    query(
      `select c.*, c.fecha::text as fecha, c.fecha_pago::text as fecha_pago,
              c.publicacion_prevista::text as publicacion_prevista, c.publicacion_real::text as publicacion_real,
              i.nombre as influencer, i.instagram
         from bronze.mkt_colaboraciones c join bronze.mkt_influencers i on i.id = c.influencer_id
        order by c.fecha desc, c.id desc`,
    ),
    query(`select *, fecha_entrega::text as fecha_entrega from bronze.mkt_colab_productos order by colaboracion_id, id`),
    query<{ comprobante: string; colaboracion_id: string }>(`select comprobante, colaboracion_id from bronze.mkt_colab_canjes`),
    query(`select e.*, e.fecha::text as fecha, e.recibido::text as recibido from bronze.mkt_envios e order by e.fecha desc nulls last, e.id desc`),
    query(`select g.*, g.fecha::text as fecha, g.fecha_pago::text as fecha_pago from bronze.mkt_gastos g order by g.fecha desc nulls last, g.id desc`),
    query(`select * from bronze.mkt_presupuesto order by mes desc, marca`),
    query(`select x.*, x.fecha::text as fecha from bronze.mkt_contenido x order by x.fecha desc nulls last, x.id desc`),
    leerCanjesSigma(),
  ]);
  return { influencers, colaboraciones, productos, canjes, envios, gastos, presupuesto, contenido, lineasSigma: lineas };
}

export async function leerHistorial(tabla: ClaveTabla, id: number) {
  return query(
    `select accion, antes, despues, usuario, en from bronze.mkt_cambios
      where tabla = $1 and registro_id = $2 order by en desc limit 50`,
    [tabla, id],
  );
}

// ---------------------------------------------------------------------------
// Escritura
// ---------------------------------------------------------------------------

type Ejecutar = <R extends Record<string, unknown>>(text: string, params?: unknown[]) => Promise<R[]>;

/** Lo que llega del formulario, convertido al tipo de cada columna. */
function limpiar(tabla: ClaveTabla, d: Fila): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const c of TABLAS[tabla].campos) {
    let v = d[c.clave];
    if (typeof v === "string") v = v.trim();
    if (v === "" || v === undefined) v = null;
    if (v !== null && (c.tipo === "monto" || c.tipo === "numero" || c.tipo === "influencer" || c.tipo === "colaboracion")) {
      v = Number(v);
      if (c.tipo !== "monto") v = Math.round(v as number);
    }
    if (v !== null && c.tipo === "marcas") v = Array.isArray(v) ? v : [v];
    if (c.clave === "cupon" && typeof v === "string") v = v.toUpperCase();
    if (c.clave === "instagram" && typeof v === "string") v = "@" + v.replace(/^@+/, "");
    out[c.clave] = v;
  }
  return out;
}

async function proximoCodigo(q: Ejecutar, tabla: string, prefijo: string, digitos: number) {
  const [f] = await q<{ n: string | null }>(
    `select max(nullif(regexp_replace(codigo, '\\D', '', 'g'), '')::int) as n from ${tabla} where codigo like $1`,
    [`${prefijo}%`],
  );
  return prefijo + String(Number(f?.n ?? 0) + 1).padStart(digitos, "0");
}

function errorAmigable(e: unknown): never {
  const m = e instanceof Error ? e.message : String(e);
  if (/mkt_influencers_nombre/.test(m)) throw new ErrorCarga("Ya hay un influencer con ese nombre");
  if (/mkt_influencers_instagram/.test(m)) throw new ErrorCarga("Ya hay un influencer con ese @");
  if (/mkt_presupuesto_mes_marca_key/.test(m)) throw new ErrorCarga("Ya hay presupuesto para ese mes y marca: editalo en vez de cargar otro");
  if (/mkt_colab_canjes_pkey/.test(m)) throw new ErrorCarga("Ese comprobante ya está asignado a otra colaboración");
  if (/does not exist|no existe/.test(m) && /mkt_/.test(m)) throw new ErrorCarga("Falta correr migraciones/marketing_carga.sql en Supabase");
  throw e;
}

export type Extra = { productos?: ProductoManual[]; comprobantes?: string[] };

/** Alta o cambio. Devuelve el id. */
export async function guardar(tabla: ClaveTabla, id: number | null, datos: Fila, usuario: string | null, extra: Extra = {}) {
  const errores = validar(tabla, datos, tabla === "colaboraciones" ? extra : undefined, id === null);
  if (errores.length) throw new ErrorCarga(errores.join(" · "));
  const def = TABLAS[tabla];
  const fila = limpiar(tabla, datos);

  try {
    return await enTransaccion(async (q) => {
      let antes: Record<string, unknown> | null = null;
      if (id) {
        [antes] = (await q(`select * from ${def.tabla} where id = $1 for update`, [id])) as Record<string, unknown>[];
        if (!antes) throw new ErrorCarga("No existe el registro");
      }
      const cols = Object.keys(fila);
      let nuevoId: number;
      if (id) {
        const sets = cols.map((c, i) => `${c} = $${i + 1}`);
        const params = cols.map((c) => fila[c]);
        if (tabla !== "contenido") {
          sets.push(`actualizado_por = $${params.length + 1}`, `actualizado_en = now()`);
          params.push(usuario);
        }
        params.push(id);
        await q(`update ${def.tabla} set ${sets.join(", ")} where id = $${params.length}`, params);
        nuevoId = id;
      } else {
        const extraCols: string[] = [];
        const params = cols.map((c) => fila[c]);
        if (tabla === "colaboraciones") {
          extraCols.push("codigo");
          params.push(await proximoCodigo(q, def.tabla, "COL-", 4));
        }
        if (tabla === "influencers") {
          extraCols.push("codigo");
          params.push(await proximoCodigo(q, def.tabla, "INF-", 3));
        }
        if (tabla === "presupuesto") {
          extraCols.push("actualizado_por");
        } else {
          extraCols.push("creado_por");
        }
        params.push(usuario);
        const todas = [...cols, ...extraCols];
        const [r] = await q<{ id: string }>(
          `insert into ${def.tabla} (${todas.join(", ")}) values (${todas.map((_, i) => `$${i + 1}`).join(", ")}) returning id`,
          params,
        );
        nuevoId = Number(r.id);
      }

      if (tabla === "colaboraciones") {
        // Productos a mano: se reemplazan por los que vienen.
        if (extra.productos) {
          await q(`delete from bronze.mkt_colab_productos where colaboracion_id = $1`, [nuevoId]);
          for (const p of extra.productos) {
            await q(
              `insert into bronze.mkt_colab_productos (colaboracion_id, fecha_entrega, sku, producto, cantidad, costo_unitario, pvp_unitario)
               values ($1, $2, $3, $4, $5, $6, $7)`,
              [nuevoId, p.fecha_entrega || null, p.sku || null, p.producto, Number(p.cantidad) || 1,
                p.costo_unitario === null || (p.costo_unitario as unknown) === "" ? null : Number(p.costo_unitario),
                p.pvp_unitario === null || (p.pvp_unitario as unknown) === "" ? null : Number(p.pvp_unitario)],
            );
          }
        }
        // Comprobantes de SIGMA: los de esta colaboración son exactamente los que vienen.
        if (extra.comprobantes) {
          await q(`delete from bronze.mkt_colab_canjes where colaboracion_id = $1 and not (comprobante = any($2::text[]))`, [
            nuevoId,
            extra.comprobantes,
          ]);
          for (const comp of extra.comprobantes) {
            await q(
              `insert into bronze.mkt_colab_canjes (comprobante, colaboracion_id, asignado_por) values ($1, $2, $3)
               on conflict (comprobante) do update set colaboracion_id = excluded.colaboracion_id
                 where bronze.mkt_colab_canjes.colaboracion_id = excluded.colaboracion_id`,
              [comp, nuevoId, usuario],
            );
            const [ok] = await q<{ colaboracion_id: string }>(
              `select colaboracion_id from bronze.mkt_colab_canjes where comprobante = $1`,
              [comp],
            );
            if (Number(ok?.colaboracion_id) !== nuevoId) throw new ErrorCarga(`El comprobante ${comp} ya está asignado a otra colaboración`);
          }
        }
      }

      const [despues] = (await q(`select * from ${def.tabla} where id = $1`, [nuevoId])) as Record<string, unknown>[];
      await q(
        `insert into bronze.mkt_cambios (tabla, registro_id, accion, antes, despues, usuario) values ($1, $2, $3, $4, $5, $6)`,
        [tabla, nuevoId, id ? "cambio" : "alta", antes ? JSON.stringify(antes) : null,
          JSON.stringify({ ...despues, ...(tabla === "colaboraciones" ? extra : {}) }), usuario],
      );
      return nuevoId;
    });
  } catch (e) {
    if (e instanceof ErrorCarga) throw e;
    errorAmigable(e);
  }
}

export async function borrar(tabla: ClaveTabla, id: number, usuario: string | null) {
  const def = TABLAS[tabla];
  try {
    await enTransaccion(async (q) => {
      const [antes] = (await q(`select * from ${def.tabla} where id = $1`, [id])) as Record<string, unknown>[];
      if (!antes) throw new ErrorCarga("No existe el registro");
      if (tabla === "influencers") {
        const [n] = await q<{ n: string }>(`select count(*) as n from bronze.mkt_colaboraciones where influencer_id = $1`, [id]);
        if (Number(n.n)) throw new ErrorCarga("No se puede borrar: tiene colaboraciones cargadas");
      }
      // Lo que se va a ir en cascada también queda en el historial.
      let dependientes: Record<string, unknown> = {};
      if (tabla === "colaboraciones") {
        dependientes = {
          productos: await q(`select * from bronze.mkt_colab_productos where colaboracion_id = $1`, [id]),
          comprobantes: await q(`select * from bronze.mkt_colab_canjes where colaboracion_id = $1`, [id]),
          contenido: await q(`select * from bronze.mkt_contenido where colaboracion_id = $1`, [id]),
        };
      }
      await q(`delete from ${def.tabla} where id = $1`, [id]);
      await q(
        `insert into bronze.mkt_cambios (tabla, registro_id, accion, antes, usuario) values ($1, $2, 'baja', $3, $4)`,
        [tabla, id, JSON.stringify({ ...antes, ...dependientes }), usuario],
      );
    });
  } catch (e) {
    if (e instanceof ErrorCarga) throw e;
    errorAmigable(e);
  }
}

// ---------------------------------------------------------------------------
// Para el Tablero de Marca
// ---------------------------------------------------------------------------

const n0 = (v: unknown) => (v === null || v === undefined || v === "" ? 0 : Number(v) || 0);
const nNull = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
const tx = (v: unknown) => (v === null || v === undefined || v === "" ? null : String(v));

/**
 * Lo cargado en Marketing → Carga, con la forma que ya entiende el tablero
 * (la misma que tenía la planilla de Sheets).
 *
 * COSTO DE UNA COLABORACIÓN = honorarios + IVA + canje + envíos + otros.
 * El canje es lo que SIGMA dice que costó la mercadería de los comprobantes
 * asignados; si no tiene ninguno, la suma de los productos cargados a mano
 * (así quedaron las colaboraciones que vinieron de las planillas viejas).
 *
 * Los comprobantes de canje de SIGMA SIN ASIGNAR también son gasto de la
 * marca: entran como un gasto "Canje sin asignar (SIGMA)" en Influencers,
 * para que no desaparezcan del tablero mientras nadie los ata a un influencer.
 */
export async function leerPlanillaCarga(): Promise<{ datos: Planilla | null; motivo?: string }> {
  try {
    const d = await leerCarga();
    const porComp = new Map<string, number>();
    for (const l of d.lineasSigma) porComp.set(l.comprobante, (porComp.get(l.comprobante) ?? 0) + l.costo);

    const marcaOk = (m: unknown): m is ClaveMarca => typeof m === "string" && ["diaper_genie", "hola_toys", "unibrandco", "litter_genie"].includes(m);

    const colaboraciones: ColaboracionPlanilla[] = [];
    for (const c of d.colaboraciones as Fila[]) {
      if (!marcaOk(c.marca)) continue;
      const id = Number(c.id);
      const comps = d.canjes.filter((x) => Number(x.colaboracion_id) === id);
      const prods = (d.productos as Fila[]).filter((p) => Number(p.colaboracion_id) === id);
      const costoCanje = comps.length
        ? comps.reduce((s, x) => s + (porComp.get(x.comprobante) ?? 0), 0)
        : prods.reduce((s, p) => s + n0(p.costo_unitario) * n0(p.cantidad), 0);
      const valorCanjePvp = prods.reduce((s, p) => s + n0(p.pvp_unitario) * n0(p.cantidad), 0);
      const costoEnvio = (d.envios as Fila[]).filter((e) => Number(e.colaboracion_id) === id).reduce((s, e) => s + n0(e.costo), 0);
      const honorarios = n0(c.honorarios);
      const iva = n0(c.iva_honorarios);
      const otros = n0(c.otros_costos);
      colaboraciones.push({
        id: String(c.codigo),
        marca: c.marca,
        fecha: tx(c.fecha),
        influencer: String(c.influencer),
        instagram: tx(c.instagram),
        modalidad: tx(c.modalidad),
        formato: tx(c.formato),
        campana: tx(c.campana),
        honorarios,
        ivaHonorarios: iva,
        costoCanje,
        valorCanjePvp,
        costoEnvio,
        otrosCostos: otros,
        costoTotal: honorarios + iva + costoCanje + costoEnvio + otros,
        estado: tx(c.estado),
        estadoPago: tx(c.estado_pago),
        publicacion: tx(c.publicacion_real) ?? tx(c.publicacion_prevista),
        link: tx(c.link),
        cupon: tx(c.cupon)?.toUpperCase() ?? null,
        alcance: nNull(c.alcance),
        interacciones: nNull(c.interacciones),
      });
    }

    const gastos: GastoPlanilla[] = [];
    for (const g of d.gastos as Fila[]) {
      if (!marcaOk(g.marca)) continue;
      gastos.push({
        fecha: tx(g.fecha),
        mes: tx(g.mes) ?? tx(g.fecha)?.slice(0, 7) ?? null,
        marca: g.marca,
        concepto: String(g.concepto),
        proveedor: tx(g.proveedor),
        total: n0(g.monto) + n0(g.iva),
        estadoPago: tx(g.estado_pago),
      });
    }
    // Canjes de SIGMA sin colaboración: un gasto por comprobante.
    const libres = new Map<string, GastoPlanilla>();
    for (const l of d.lineasSigma) {
      if (l.colaboracion_id !== null || !marcaOk(l.marca)) continue;
      const g = libres.get(l.comprobante) ?? {
        fecha: l.fecha, mes: l.fecha.slice(0, 7), marca: l.marca, concepto: "Canje sin asignar (SIGMA)",
        proveedor: `Comprobante ${l.comprobante}`, total: 0, estadoPago: null,
      };
      g.total += l.costo;
      libres.set(l.comprobante, g);
    }
    gastos.push(...libres.values());

    const envios: EnvioPlanilla[] = (d.envios as Fila[]).map((e) => {
      const colab = (d.colaboraciones as Fila[]).find((c) => Number(c.id) === Number(e.colaboracion_id));
      return {
        idColaboracion: colab ? String(colab.codigo) : null,
        fecha: tx(e.fecha),
        marca: marcaOk(e.marca) ? e.marca : null,
        tipo: tx(e.tipo),
        costo: n0(e.costo),
        estado: tx(e.estado),
      };
    });
    // Envíos que no son de una colaboración (muestras, prensa...) son gasto de Contenido.
    for (const e of d.envios as Fila[]) {
      if (e.colaboracion_id || !marcaOk(e.marca) || !n0(e.costo)) continue;
      gastos.push({
        fecha: tx(e.fecha), mes: tx(e.fecha)?.slice(0, 7) ?? null, marca: e.marca,
        concepto: `Envío ${tx(e.tipo) ?? ""}`.trim(), proveedor: tx(e.transporte), total: n0(e.costo), estadoPago: null,
      });
    }

    const presupuesto: PresupuestoPlanilla[] = (d.presupuesto as Fila[])
      .filter((p) => marcaOk(p.marca) && n0(p.monto))
      .map((p) => ({ mes: String(p.mes), marca: p.marca as ClaveMarca, monto: n0(p.monto) }));

    return {
      datos: {
        recibidoEn: new Date().toISOString(),
        colaboraciones,
        gastos,
        presupuesto,
        envios,
        influencers: d.influencers.length,
      },
    };
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    if (/mkt_(influencers|colaboraciones|colab_|envios|gastos|presupuesto|contenido)/.test(m) && /does not exist|no existe/.test(m)) {
      return { datos: null, motivo: "Falta correr migraciones/marketing_carga.sql" };
    }
    if (/Faltan variables de entorno de la base/.test(m)) return { datos: null, motivo: "Sin conexión a la base" };
    return { datos: null, motivo: m };
  }
}
