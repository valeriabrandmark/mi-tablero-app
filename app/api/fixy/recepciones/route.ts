import { NextResponse, type NextRequest } from "next/server";
import { enTransaccion, queryOne } from "@/lib/db";
import {
  armarRecepcion,
  cajasPara,
  contactoDesdeEntorno,
  leerRenglonesManual,
  type RenglonRecepcion,
} from "@/lib/fixy";
import { fixyConfigurado, llamarFixy } from "@/lib/fixy-api";
import {
  enConstruccion,
  permisoDelUsuario,
  puedeEditar,
  puedeVer,
  puedeVerBorradores,
} from "@/lib/permisos";
import { getArticulosSigma, getRenglonesDePedido } from "@/lib/queries-fixy";
import { authConfigurada } from "@/lib/supabase/env";
import { getUsuario } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Pedido =
  | { origen: "digip"; pedido: string; fechaPactada: string }
  | { origen: "manual"; remito: string; fechaPactada: string; texto: string };

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

function error(mensaje: string, status: number, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ error: mensaje, ...extra }, { status });
}

/**
 * Avisa a FIXY que va a entrar mercadería: crea una orden de recepción en su
 * sistema (`generar-recepcion`) y la guarda en app.fixy_recepciones.
 *
 * Es la mitad "lo que mandamos" del control. Escribe en un sistema de afuera y
 * no tiene deshacer desde acá, así que pide permiso de EDITAR Stock, no sólo
 * de verlo.
 *
 * DOS ORIGENES:
 *   digip   un pedido de Tucumán con despacho a FIXY: los renglones salen de
 *           lo que Digip efectivamente preparó (unidades satisfechas).
 *   manual  lo demás, sobre todo las importaciones que llegan directo a FIXY:
 *           se pegan las líneas "SKU cantidad [cajas]".
 */
export async function POST(request: NextRequest) {
  let usuario: string | null = null;
  if (authConfigurada) {
    const quien = await getUsuario();
    const permiso = permisoDelUsuario(quien);
    if (!puedeVer(permiso, "/api/fixy/recepciones") || !puedeEditar(permiso, "stock", quien?.email)) {
      return error("Sin permiso para avisar ingresos a FIXY", 403);
    }
    if (enConstruccion("/stock/fixy") && !puedeVerBorradores(permiso)) {
      return error("En construcción", 403);
    }
    usuario = quien?.email ?? null;
  }

  if (!fixyConfigurado()) {
    return error("Falta FIXY_API_TOKEN: el tablero todavía no está conectado a FIXY.", 503);
  }
  const { contacto, faltantes } = contactoDesdeEntorno(process.env);
  if (!contacto) {
    return error(`Faltan los datos del remitente: ${faltantes.join(", ")}.`, 503);
  }

  const cuerpo = (await request.json().catch(() => null)) as Pedido | null;
  if (!cuerpo || !FECHA.test(cuerpo.fechaPactada ?? "")) {
    return error("Pedido inválido: falta la fecha pactada (AAAA-MM-DD).", 400);
  }

  // ---- Los renglones ------------------------------------------------------
  let remito: string;
  let pedidoDigip: string | null = null;
  let renglones: RenglonRecepcion[];

  if (cuerpo.origen === "digip") {
    pedidoDigip = String(cuerpo.pedido ?? "").trim();
    if (!pedidoDigip) return error("Falta el pedido de Digip.", 400);
    remito = pedidoDigip;
    const filas = await getRenglonesDePedido(pedidoDigip);
    if (!filas.length) return error("Ese pedido no tiene artículos preparados para FIXY.", 404);
    renglones = filas.map((f) => {
      const cantidad = Number(f.cantidad);
      return {
        sku: f.sku,
        descripcion: f.descripcion ?? f.sku,
        cantidad,
        cajas: cajasPara(cantidad, f.unidades_por_bulto == null ? null : Number(f.unidades_por_bulto)),
      };
    });
  } else if (cuerpo.origen === "manual") {
    remito = String(cuerpo.remito ?? "").trim().slice(0, 60);
    if (!remito) return error("Falta el remito.", 400);
    const { renglones: leidos, errores } = leerRenglonesManual(String(cuerpo.texto ?? ""));
    if (errores.length) return error("Hay líneas que no se pueden leer.", 400, { errores });
    if (!leidos.length) return error("No hay artículos.", 400);

    const sigma = new Map(
      (await getArticulosSigma(leidos.map((r) => r.sku))).map((a) => [a.sku.toUpperCase(), a]),
    );
    // Un SKU que Sigma no conoce casi siempre es un error de tipeo, y FIXY lo
    // daría de alta como artículo nuevo: se frena acá.
    const desconocidos = leidos.filter((r) => !sigma.has(r.sku)).map((r) => r.sku);
    if (desconocidos.length) {
      return error(`SKU que no están en Sigma: ${desconocidos.join(", ")}.`, 400);
    }
    renglones = leidos.map((r) => {
      const a = sigma.get(r.sku)!;
      return {
        sku: a.sku,
        descripcion: a.descripcion ?? a.sku,
        cantidad: r.cantidad,
        cajas: r.cajas ?? cajasPara(r.cantidad, a.unidades_por_bulto == null ? null : Number(a.unidades_por_bulto)),
      };
    });
  } else {
    return error("Origen inválido.", 400);
  }

  // ---- Un envío se avisa una sola vez ------------------------------------
  const ya = await queryOne<{ id: number }>(
    `select id from app.fixy_recepciones where remito = $1 or pedido_digip = $2`,
    [remito, pedidoDigip],
  );
  if (ya) return error(`El remito ${remito} ya se avisó a FIXY.`, 409);

  // ---- A FIXY -------------------------------------------------------------
  const payload = armarRecepcion({ remito, fechaPactada: cuerpo.fechaPactada, contacto, renglones });
  const respuesta = await llamarFixy("generar-recepcion", payload);

  if (respuesta.tipo === "rechazo") {
    return error("FIXY rechazó la recepción.", 422, { detalle: respuesta.texto.slice(0, 1000) });
  }

  const unidades = renglones.reduce((s, r) => s + r.cantidad, 0);
  try {
    const id = await enTransaccion(async (ejecutar) => {
      const [fila] = await ejecutar<{ id: number }>(
        `insert into app.fixy_recepciones
           (usuario, remito, origen, pedido_digip, fecha_pactada, renglones,
            unidades, resultado, respuesta, payload)
         values ($1, $2, $3, $4, $5::date, $6, $7, $8, $9, $10::jsonb)
         returning id`,
        [
          usuario, remito, cuerpo.origen, pedidoDigip, cuerpo.fechaPactada,
          renglones.length, unidades, respuesta.tipo,
          respuesta.texto.slice(0, 2000), JSON.stringify(payload),
        ],
      );
      for (const r of renglones) {
        await ejecutar(
          `insert into app.fixy_recepciones_items (recepcion_id, sku, descripcion, cajas, cantidad)
           values ($1, $2, $3, $4, $5)`,
          [fila.id, r.sku, r.descripcion, r.cajas, r.cantidad],
        );
      }
      return fila.id;
    });
    return NextResponse.json({ id, resultado: respuesta.tipo, remito, renglones: renglones.length, unidades });
  } catch (e) {
    // FIXY ya la tiene (o puede tenerla) y acá no quedó: hay que decirlo
    // claro, porque reintentar la duplicaría en FIXY.
    console.error("[/api/fixy/recepciones] FIXY contestó pero no se pudo guardar", remito, e);
    return error(
      `FIXY recibió el aviso del remito ${remito}, pero no se pudo guardar en el tablero. ` +
        "No lo reintentes: avisá para cargarlo a mano.",
      500,
    );
  }
}
