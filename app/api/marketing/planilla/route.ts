import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { query } from "@/lib/db";
import { normalizarPlanilla } from "@/lib/marketing-planilla";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Una planilla de marketing de un año entero son unos cientos de KB. */
const LIMITE_BYTES = 5_000_000;

/**
 * La planilla de Marketing (Google Sheets) habla con el tablero por acá.
 *
 *   POST  foto entera de la planilla → bronze.mkt_planilla
 *   GET   venta por cupón (Tienda Nube) para escribir el resultado de cada
 *         colaboración de vuelta en la planilla
 *
 * LA LLAMA UN APPS SCRIPT, NO UN NAVEGADOR: no hay sesión del tablero, así que
 * la llave es un token compartido (MKT_PLANILLA_TOKEN) en el header, igual que
 * /api/precios-tn/planilla. Está en RUTAS_CON_LLAVE_PROPIA para que el proxy
 * la deje llegar, y por eso esta ruta niega TODO si el token no coincide o si
 * la variable no está cargada.
 */
function tokenValido(request: NextRequest): "ok" | "sin_configurar" | "invalido" {
  const esperado = process.env.MKT_PLANILLA_TOKEN;
  if (!esperado) return "sin_configurar";
  const cabecera = request.headers.get("authorization") ?? "";
  const recibido = cabecera.startsWith("Bearer ") ? cabecera.slice(7) : "";
  if (!recibido) return "invalido";
  // Hash y comparación en tiempo constante: no filtra ni el largo ni el prefijo.
  const a = createHash("sha256").update(recibido).digest();
  const b = createHash("sha256").update(esperado).digest();
  return timingSafeEqual(a, b) ? "ok" : "invalido";
}

function rechazo(estado: "sin_configurar" | "invalido") {
  // Se distingue "el servidor no tiene token" de "el token está mal": cuando
  // no hay token se rechaza todo igual, y decirlo ahorra una tarde buscando un
  // token que estaba bien (ver la nota en /api/precios-tn/planilla).
  return NextResponse.json(
    {
      ok: false,
      error: estado,
      mensaje:
        estado === "sin_configurar"
          ? "El tablero no tiene MKT_PLANILLA_TOKEN. Si ya lo cargaste en Vercel, falta un Redeploy."
          : "El token de la planilla no coincide con MKT_PLANILLA_TOKEN del tablero.",
    },
    { status: estado === "sin_configurar" ? 503 : 401 },
  );
}

export async function POST(request: NextRequest) {
  const t = tokenValido(request);
  if (t !== "ok") return rechazo(t);

  const texto = await request.text();
  if (texto.length > LIMITE_BYTES) {
    return NextResponse.json({ ok: false, mensaje: "La planilla pesa demasiado" }, { status: 413 });
  }
  let crudo: unknown;
  try {
    crudo = JSON.parse(texto);
  } catch {
    return NextResponse.json({ ok: false, mensaje: "No es JSON" }, { status: 400 });
  }

  // Se normaliza ANTES de guardar sólo para contar y avisar: lo que se guarda
  // es la foto cruda, así un cambio en la normalización no obliga a reenviar.
  const ahora = new Date().toISOString();
  const p = normalizarPlanilla(crudo, ahora);
  const filas = p.colaboraciones.length + p.gastos.length + p.presupuesto.length + p.envios.length;

  try {
    await query(
      `insert into bronze.mkt_planilla (datos, filas, origen) values ($1::jsonb, $2, $3)`,
      [texto, filas, request.headers.get("x-planilla") ?? null],
    );
    // Se guardan las últimas 60 fotos: alcanza para ver qué cambió.
    await query(
      `delete from bronze.mkt_planilla where id not in (select id from bronze.mkt_planilla order by recibido_en desc limit 60)`,
    );
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    console.error("[api/marketing/planilla] POST", e);
    return NextResponse.json(
      {
        ok: false,
        mensaje: /mkt_planilla/.test(m) && /does not exist|no existe/.test(m)
          ? "Falta correr migraciones/marketing_planilla.sql en Supabase."
          : m,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    recibido: ahora,
    colaboraciones: p.colaboraciones.length,
    gastos: p.gastos.length,
    presupuesto: p.presupuesto.length,
    envios: p.envios.length,
    influencers: p.influencers,
  });
}

/**
 * Venta por cupón, de toda la historia: pedidos pagados con ese cupón y su
 * total con IVA. Las tres tiendas importadas (bronze.mkt_tn_pedidos) y la de
 * Unibrandco por API (gold.fact_ventas, canal Tienda Nube).
 */
export async function GET(request: NextRequest) {
  const t = tokenValido(request);
  if (t !== "ok") return rechazo(t);
  try {
    const [importadas, unibrandco] = await Promise.all([
      query<{ marca: string; cupon: string; pedidos: string; venta: string; primero: string; ultimo: string }>(
        `select marca, upper(cupon) as cupon, count(*) as pedidos, sum(total) as venta,
                min(fecha)::date::text as primero, max(fecha)::date::text as ultimo
           from bronze.mkt_tn_pedidos
          where es_venta and cupon is not null and cupon <> ''
          group by 1, 2`,
      ).catch(() => []),
      query<{ cupon: string; pedidos: string; venta: string; primero: string; ultimo: string }>(
        `select upper(cupon) as cupon, count(distinct nro_orden) as pedidos, sum(total_linea) as venta,
                min(fecha)::text as primero, max(fecha)::text as ultimo
           from gold.fact_ventas
          where canal = 'Tienda Nube' and cupon is not null and cupon <> ''
          group by 1`,
      ).catch(() => []),
    ]);
    const cupones = [
      ...importadas.map((r) => ({ ...r, pedidos: Number(r.pedidos), venta: Number(r.venta) })),
      ...unibrandco.map((r) => ({ marca: "unibrandco", ...r, pedidos: Number(r.pedidos), venta: Number(r.venta) })),
    ];
    return NextResponse.json({ ok: true, cupones });
  } catch (e) {
    return NextResponse.json({ ok: false, mensaje: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
