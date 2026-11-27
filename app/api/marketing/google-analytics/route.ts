import { NextResponse, type NextRequest } from "next/server";
import { enTransaccion } from "@/lib/db";
import { MENSAJE_LLAVE, llaveScriptGoogle } from "@/lib/llave-marketing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GOOGLE ANALYTICS 4 → TABLERO DE MARCA.
 *
 *   POST { propiedad, marca, desde, hasta, filas: [{ fecha, canal, sesiones,
 *          usuarios, usuarios_nuevos, sesiones_comprometidas, compras, ingresos }] }
 *        → bronze.ga4_diario (migraciones/marketing_google_analytics.sql)
 *
 * LA LLAMA UN APPS SCRIPT (apps-script/google-analytics-tablero.gs) que corre
 * con el usuario de Ana, que tiene acceso a las propiedades. No hace falta
 * cuenta de servicio (la del orquestador nunca se pudo habilitar: la política
 * de la organización no deja crear claves). Misma llave que Google Ads.
 *
 * Cada envío REEMPLAZA los días [desde, hasta] de esa propiedad: GA4 termina
 * de procesar un día hasta 48 h después, así que el script reenvía la ventana.
 */

const LIMITE_BYTES = 5_000_000;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const MARCAS = ["diaper_genie", "hola_toys", "unibrandco", "litter_genie"];

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};
const txt = (v: unknown, max = 120) => (v === null || v === undefined ? "" : String(v).trim().slice(0, max));

export async function POST(request: NextRequest) {
  const t = llaveScriptGoogle(request);
  if (t !== "ok") {
    return NextResponse.json({ ok: false, error: t, mensaje: MENSAJE_LLAVE[t] }, { status: t === "sin_configurar" ? 503 : 401 });
  }
  const texto = await request.text();
  if (texto.length > LIMITE_BYTES) return NextResponse.json({ ok: false, mensaje: "Demasiados datos" }, { status: 413 });
  let b: { propiedad?: unknown; marca?: unknown; desde?: unknown; hasta?: unknown; filas?: unknown };
  try {
    b = JSON.parse(texto);
  } catch {
    return NextResponse.json({ ok: false, mensaje: "No es JSON" }, { status: 400 });
  }
  const propiedad = txt(b.propiedad, 20).replace(/^properties\//, "");
  const marca = txt(b.marca, 20);
  const desde = txt(b.desde, 10);
  const hasta = txt(b.hasta, 10);
  if (!/^\d{5,15}$/.test(propiedad) || !MARCAS.includes(marca) || !ISO.test(desde) || !ISO.test(hasta) || desde > hasta || !Array.isArray(b.filas)) {
    return NextResponse.json({ ok: false, mensaje: "Faltan propiedad, marca, desde, hasta o filas" }, { status: 400 });
  }

  type Entrada = Record<string, unknown>;
  // GA4 manda la fecha como 20261127; se acepta también 2026-11-27.
  const fecha = (v: unknown) => {
    const s = txt(v, 10);
    return /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : s;
  };
  const filas = (b.filas as Entrada[])
    .map((f) => ({
      fecha: fecha(f.fecha),
      canal: txt(f.canal) || "(sin dato)",
      sesiones: Math.round(num(f.sesiones)),
      usuarios: Math.round(num(f.usuarios)),
      nuevos: Math.round(num(f.usuarios_nuevos)),
      comprometidas: Math.round(num(f.sesiones_comprometidas)),
      compras: num(f.compras),
      ingresos: num(f.ingresos),
    }))
    .filter((f) => ISO.test(f.fecha) && f.fecha >= desde && f.fecha <= hasta);

  try {
    await enTransaccion(async (q) => {
      await q(`delete from bronze.ga4_diario where propiedad = $1 and fecha between $2::date and $3::date`, [propiedad, desde, hasta]);
      for (let i = 0; i < filas.length; i += 500) {
        const lote = filas.slice(i, i + 500);
        const valores: unknown[] = [];
        const marcas = lote.map((f, j) => {
          valores.push(f.fecha, propiedad, marca, f.canal, f.sesiones, f.usuarios, f.nuevos, f.comprometidas, f.compras, f.ingresos);
          const o = j * 10;
          return `($${o + 1}::date, $${o + 2}, $${o + 3}, $${o + 4}, $${o + 5}, $${o + 6}, $${o + 7}, $${o + 8}, $${o + 9}, $${o + 10})`;
        });
        await q(
          `insert into bronze.ga4_diario
             (fecha, propiedad, marca, canal, sesiones, usuarios, usuarios_nuevos, sesiones_comprometidas, compras, ingresos)
           values ${marcas.join(", ")}
           on conflict (fecha, propiedad, canal) do update set
             marca = excluded.marca, sesiones = excluded.sesiones, usuarios = excluded.usuarios,
             usuarios_nuevos = excluded.usuarios_nuevos, sesiones_comprometidas = excluded.sesiones_comprometidas,
             compras = excluded.compras, ingresos = excluded.ingresos, recibido_en = now()`,
          valores,
        );
      }
    });
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    console.error("[api/marketing/google-analytics] POST", e);
    return NextResponse.json(
      {
        ok: false,
        mensaje: /ga4_diario/.test(m) && /does not exist|no existe/.test(m)
          ? "Falta correr migraciones/marketing_google_analytics.sql en Supabase."
          : m,
      },
      { status: 500 },
    );
  }
  return NextResponse.json({
    ok: true,
    propiedad,
    marca,
    desde,
    hasta,
    filas: filas.length,
    sesiones: filas.reduce((s, f) => s + f.sesiones, 0),
  });
}
