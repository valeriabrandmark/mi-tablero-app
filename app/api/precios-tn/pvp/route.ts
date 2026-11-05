import { NextResponse, type NextRequest } from "next/server";
import {
  enConstruccion,
  permisoDelUsuario,
  puedeEditar,
  puedeVer,
  puedeVerBorradores,
} from "@/lib/permisos";
import { aCsvPvp, leerCsvPvp } from "@/lib/pvp";
import { getCsvDeLote, getFilasParaPvp, getLotesPvp, guardarLotePvp } from "@/lib/queries-pvp";
import { authConfigurada } from "@/lib/supabase/env";
import { getUsuario } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * La planilla de PVP de las marcas que importamos.
 *
 * ---------------------------------------------------------------------------
 * GET  ?que=planilla   el CSV con lo que hay hoy, para editar encima
 * GET  ?que=historial  las cargas anteriores
 * GET  ?lote=N         vuelve a bajar el archivo de una carga, tal como vino
 * POST { nombre, csv } sube una planilla editada
 *
 * SUBIR UNA PLANILLA NO CAMBIA NINGÚN PRECIO. Guarda los PVP en
 * `precios.pvp`, y recién la próxima corrida del motor los convierte en
 * propuestas que alguien tiene que aprobar. Es a propósito: un archivo que al
 * soltarlo publica 242 precios es un archivo que nadie se anima a probar.
 * ---------------------------------------------------------------------------
 */

const LIMITE_BYTES = 2_000_000;

async function guardia(editar: boolean): Promise<{ error: NextResponse } | { quien: string }> {
  if (!authConfigurada) return { quien: "sin auth" };

  const usuario = await getUsuario();
  const permiso = permisoDelUsuario(usuario);
  if (!puedeVer(permiso, "/api/precios-tn")) {
    return { error: NextResponse.json({ error: "Sin permiso" }, { status: 403 }) };
  }
  if (enConstruccion("/precios-tn") && !puedeVerBorradores(permiso)) {
    return { error: NextResponse.json({ error: "En construcción" }, { status: 403 }) };
  }
  // BAJAR LA PLANILLA ES VER; SUBIRLA ES EDITAR. Quien tiene Precios TN en
  // modo "sólo ver" puede mirar qué precios hay, y no fijarlos.
  if (editar && !puedeEditar(permiso, "precios_tn")) {
    return {
      error: NextResponse.json(
        { error: "Tu usuario puede ver Precios TN, pero no cargar precios" },
        { status: 403 },
      ),
    };
  }
  return { quien: usuario?.email ?? "sin email" };
}

export async function GET(request: NextRequest) {
  const g = await guardia(false);
  if ("error" in g) return g.error;

  const params = request.nextUrl.searchParams;

  const lote = params.get("lote");
  if (lote) {
    const guardado = await getCsvDeLote(Number(lote));
    if (!guardado) return NextResponse.json({ error: "No existe esa carga" }, { status: 404 });
    return new NextResponse(guardado.csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": 'attachment; filename="' + guardado.nombre.replace(/"/g, "") + '"',
      },
    });
  }

  if (params.get("que") === "historial") {
    return NextResponse.json({ lotes: await getLotesPvp() });
  }

  const filas = await getFilasParaPvp();
  const sello = new Date().toISOString().slice(0, 10);
  return new NextResponse(aCsvPvp(filas), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="pvp-' + sello + '.csv"',
    },
  });
}

export async function POST(request: NextRequest) {
  const g = await guardia(true);
  if ("error" in g) return g.error;

  const cuerpo = await request.json().catch(() => null);
  const csv = typeof cuerpo?.csv === "string" ? cuerpo.csv : "";
  const nombre = typeof cuerpo?.nombre === "string" && cuerpo.nombre.trim()
    ? cuerpo.nombre.trim().slice(0, 200)
    : "pvp.csv";

  if (!csv) return NextResponse.json({ error: "No llegó ningún archivo" }, { status: 400 });
  if (csv.length > LIMITE_BYTES) {
    return NextResponse.json(
      { error: "El archivo es demasiado grande (más de 2 MB). ¿Seguro que es el CSV de PVP?" },
      { status: 413 },
    );
  }

  const { filas, errores, separador } = leerCsvPvp(csv);

  // NO SE GUARDA NADA SI NO SE ENTENDIÓ NADA. Un lote vacío en el historial
  // dice "se cargó" sobre una carga que no cambió un solo precio.
  if (!filas.length) {
    return NextResponse.json(
      {
        error: "No se pudo leer ninguna fila del archivo",
        errores: errores.slice(0, 50),
        separador,
      },
      { status: 400 },
    );
  }

  const { id, filas: guardadas } = await guardarLotePvp(nombre, csv, filas, g.quien);

  return NextResponse.json({
    ok: true,
    lote: id,
    guardadas,
    descartadas: errores.length,
    errores: errores.slice(0, 50),
    separador,
    // PARA QUE SE PUEDA VERIFICAR ANTES DE CORRER EL MOTOR: las primeras
    // filas como quedaron entendidas. Es la única forma de ver que una coma
    // decimal se leyó como coma y no como separador de miles.
    muestra: filas.slice(0, 5).map((f) => ({
      sku: f.sku,
      precio: f.precio,
      oferta: f.oferta,
    })),
  });
}
