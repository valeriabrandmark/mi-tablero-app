import { NextResponse, type NextRequest } from "next/server";
import { enTransaccion } from "@/lib/db";
import { MENSAJE_LLAVE, llaveScriptGoogle } from "@/lib/llave-marketing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GOOGLE ADS → TABLERO DE MARCA.
 *
 *   POST  { cuenta: { id, nombre, moneda }, desde, hasta, filas: [...] }
 *         → bronze.google_ads_diario (migraciones/marketing_google_ads.sql)
 *
 * LA LLAMA UN SCRIPT DE GOOGLE ADS (apps-script/google-ads-tablero.js), no un
 * navegador: no hay sesión, la llave es un token compartido en el header.
 * Sirve MKT_GOOGLE_ADS_TOKEN y, si no está, el de la planilla de Marketing
 * (MKT_PLANILLA_TOKEN), que ya está cargado en Vercel y la planilla dejó de
 * usar. Está en RUTAS_CON_LLAVE_PROPIA, así que esta ruta niega TODO si el
 * token no coincide o no hay ninguno configurado.
 *
 * POR QUÉ UN SCRIPT Y NO LA API DE GOOGLE ADS: la API pide un "token de
 * desarrollador" que Google aprueba a mano (días, formularios), más OAuth. El
 * script corre adentro de la cuenta con los permisos de quien lo pega.
 *
 * Cada envío REEMPLAZA los días [desde, hasta] de esa cuenta: el script manda
 * siempre los últimos 30 días, porque las conversiones se atribuyen tarde.
 */

const LIMITE_BYTES = 5_000_000;
const ISO = /^\d{4}-\d{2}-\d{2}$/;


type FilaEntrada = {
  fecha?: unknown;
  campana_id?: unknown;
  campana?: unknown;
  costo?: unknown;
  clics?: unknown;
  impresiones?: unknown;
  conversiones?: unknown;
  valor?: unknown;
};

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};
const txt = (v: unknown, max = 200) => (v === null || v === undefined ? "" : String(v).trim().slice(0, max));

export async function POST(request: NextRequest) {
  const t = llaveScriptGoogle(request);
  if (t !== "ok") {
    return NextResponse.json(
      {
        ok: false,
        error: t,
        mensaje: MENSAJE_LLAVE[t],
      },
      { status: t === "sin_configurar" ? 503 : 401 },
    );
  }

  const texto = await request.text();
  if (texto.length > LIMITE_BYTES) return NextResponse.json({ ok: false, mensaje: "Demasiados datos" }, { status: 413 });
  let b: { cuenta?: { id?: unknown; nombre?: unknown; moneda?: unknown }; desde?: unknown; hasta?: unknown; filas?: unknown };
  try {
    b = JSON.parse(texto);
  } catch {
    return NextResponse.json({ ok: false, mensaje: "No es JSON" }, { status: 400 });
  }

  const cuentaId = txt(b.cuenta?.id, 20).replace(/-/g, "");
  const desde = txt(b.desde, 10);
  const hasta = txt(b.hasta, 10);
  if (!/^\d{6,12}$/.test(cuentaId) || !ISO.test(desde) || !ISO.test(hasta) || desde > hasta || !Array.isArray(b.filas)) {
    return NextResponse.json({ ok: false, mensaje: "Faltan cuenta.id, desde, hasta o filas" }, { status: 400 });
  }
  const moneda = (txt(b.cuenta?.moneda, 3) || "ARS").toUpperCase();
  const nombre = txt(b.cuenta?.nombre, 120) || null;

  const filas = (b.filas as FilaEntrada[])
    .map((f) => ({
      fecha: txt(f.fecha, 10),
      campanaId: txt(f.campana_id, 30),
      campana: txt(f.campana, 200) || null,
      costo: num(f.costo),
      clics: Math.round(num(f.clics)),
      impresiones: Math.round(num(f.impresiones)),
      conversiones: num(f.conversiones),
      valor: num(f.valor),
    }))
    // Un día fuera del rango declarado no se guarda: se borraría mal la próxima vez.
    .filter((f) => ISO.test(f.fecha) && f.fecha >= desde && f.fecha <= hasta && f.campanaId);

  try {
    await enTransaccion(async (q) => {
      await q(`delete from bronze.google_ads_diario where cuenta_id = $1 and fecha between $2::date and $3::date`, [
        cuentaId,
        desde,
        hasta,
      ]);
      // De a 500 filas por insert: 30 días × decenas de campañas entra en pocos.
      for (let i = 0; i < filas.length; i += 500) {
        const lote = filas.slice(i, i + 500);
        const valores: unknown[] = [];
        const marcas = lote.map((f, j) => {
          valores.push(f.fecha, cuentaId, nombre, moneda, f.campanaId, f.campana, f.costo, f.clics, f.impresiones, f.conversiones, f.valor);
          const o = j * 11;
          return `($${o + 1}::date, $${o + 2}, $${o + 3}, $${o + 4}, $${o + 5}, $${o + 6}, $${o + 7}, $${o + 8}, $${o + 9}, $${o + 10}, $${o + 11})`;
        });
        await q(
          `insert into bronze.google_ads_diario
             (fecha, cuenta_id, cuenta_nombre, moneda, campana_id, campana, costo, clics, impresiones, conversiones, valor_conversiones)
           values ${marcas.join(", ")}
           on conflict (fecha, cuenta_id, campana_id) do update set
             cuenta_nombre = excluded.cuenta_nombre, moneda = excluded.moneda, campana = excluded.campana,
             costo = excluded.costo, clics = excluded.clics, impresiones = excluded.impresiones,
             conversiones = excluded.conversiones, valor_conversiones = excluded.valor_conversiones, recibido_en = now()`,
          valores,
        );
      }
    });
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    console.error("[api/marketing/google-ads] POST", e);
    return NextResponse.json(
      {
        ok: false,
        mensaje: /google_ads_diario/.test(m) && /does not exist|no existe/.test(m)
          ? "Falta correr migraciones/marketing_google_ads.sql en Supabase."
          : m,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    cuenta: cuentaId,
    desde,
    hasta,
    filas: filas.length,
    costo: Math.round(filas.reduce((s, f) => s + f.costo, 0)),
  });
}
