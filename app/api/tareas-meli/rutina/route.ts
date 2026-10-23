import { NextResponse, type NextRequest } from "next/server";
import { permisoDelUsuario, puedeEditar, puedeVer } from "@/lib/permisos";
import { desmarcarRutina, getRutinaMeli, marcarRutina } from "@/lib/queries-rutina-meli";
import {
  ESTADOS_RUTINA,
  FERIADO,
  esFecha,
  hoyAR,
  lunesDe,
  sumarDias,
  tareaRutina,
  vecesEnDia,
} from "@/lib/rutina-meli";
import { authConfigurada } from "@/lib/supabase/env";
import { getUsuario } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** La planilla de una semana. `?semana=YYYY-MM-DD` es cualquier día de ella. */
export async function GET(request: NextRequest) {
  if (authConfigurada) {
    const permiso = permisoDelUsuario(await getUsuario());
    if (!puedeVer(permiso, "/api/tareas-meli")) {
      return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
    }
  }

  const pedido = request.nextUrl.searchParams.get("semana");
  const lunes = lunesDe(esFecha(pedido) ? pedido : hoyAR());

  try {
    return NextResponse.json(await getRutinaMeli(lunes));
  } catch (error) {
    console.error("[api/tareas-meli/rutina] GET", error);
    return NextResponse.json({ error: "No se pudo leer la rutina" }, { status: 500 });
  }
}

/**
 * Cuántos días para atrás se puede corregir la planilla. En papel se podía
 * completar el viernes lo del lunes; más de dos semanas ya no es anotar lo que
 * se hizo sino reescribir la medición.
 */
const DIAS_PARA_CORREGIR = 14;

const MAX_NOTA = 200;

/**
 * Marcar o vaciar un casillero.
 *
 *   { fecha, tarea, vez, estado, nota }   marca (pisa lo que hubiera)
 *   { fecha, tarea, vez, estado: null }   lo vuelve a vacío
 *
 * Se valida que el casillero EXISTA según las reglas de lib/rutina-meli.ts: un
 * tilde en un día que no corresponde sumaría al cumplimiento algo que nadie
 * tenía que hacer.
 */
export async function PUT(request: Request) {
  let usuario = "local";
  if (authConfigurada) {
    const u = await getUsuario();
    if (!puedeEditar(permisoDelUsuario(u), "meli", u?.email)) {
      return NextResponse.json(
        { error: "Sólo el responsable de Mercado Libre puede completar la rutina" },
        { status: 403 },
      );
    }
    usuario = u?.email ?? u?.id ?? "";
    if (!usuario) return NextResponse.json({ error: "Sin usuario" }, { status: 403 });
  }

  let b: Record<string, unknown>;
  try {
    b = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }

  const fecha = b.fecha;
  const vez = typeof b.vez === "number" ? b.vez : 1;
  const tarea = typeof b.tarea === "string" ? b.tarea : "";
  if (!esFecha(fecha)) return NextResponse.json({ error: "Fecha inválida" }, { status: 400 });

  const hoy = hoyAR();
  if (fecha > hoy) {
    return NextResponse.json({ error: "No se puede marcar un día que todavía no llegó" }, { status: 400 });
  }
  if (fecha < sumarDias(hoy, -DIAS_PARA_CORREGIR)) {
    return NextResponse.json(
      { error: `Sólo se pueden corregir los últimos ${DIAS_PARA_CORREGIR} días` },
      { status: 400 },
    );
  }

  const t = tareaRutina(tarea);
  const valida = tarea === FERIADO ? vez === 1 : t != null && vez >= 1 && vez <= vecesEnDia(t, fecha);
  if (!valida) {
    return NextResponse.json({ error: "Esa tarea no corresponde ese día" }, { status: 400 });
  }

  try {
    if (b.estado == null) {
      await desmarcarRutina({ fecha, tarea, vez });
      return NextResponse.json({ ok: true });
    }
    const estado = ESTADOS_RUTINA.find((e) => e === b.estado);
    if (!estado) return NextResponse.json({ error: "Estado inválido" }, { status: 400 });

    const nota =
      typeof b.nota === "string" && b.nota.trim() ? b.nota.trim().slice(0, MAX_NOTA) : null;
    await marcarRutina({ fecha, tarea, vez, estado, nota, usuario });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[api/tareas-meli/rutina] PUT", error);
    const sinTabla = error instanceof Error && /tareas_meli_rutina/.test(error.message);
    return NextResponse.json(
      {
        error: sinTabla
          ? "Falta crear la tabla de la rutina en la base (migraciones/tareas_meli_rutina.sql)."
          : "No se pudo guardar",
      },
      { status: 500 },
    );
  }
}
