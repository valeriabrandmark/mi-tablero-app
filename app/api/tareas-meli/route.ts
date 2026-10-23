import { NextResponse } from "next/server";
import { permisoDelUsuario, puedeEditar, puedeVer } from "@/lib/permisos";
import {
  getDashboardTareasMeli,
  guardarRespuestaDescarte,
} from "@/lib/queries-tareas-meli";
import { MOTIVOS_DESESTIMAR, respuestaDe } from "@/lib/tareas-meli";
import { authConfigurada } from "@/lib/supabase/env";
import { getUsuario } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** La bandeja de "Mis tareas": las alertas de hoy con su última respuesta. */
export async function GET() {
  if (authConfigurada) {
    const permiso = permisoDelUsuario(await getUsuario());
    if (!puedeVer(permiso, "/api/tareas-meli")) {
      return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
    }
  }

  try {
    return NextResponse.json(await getDashboardTareasMeli());
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : "Error desconocido";
    console.error("[api/tareas-meli] GET", error);
    return NextResponse.json({ error: mensaje }, { status: 500 });
  }
}

/** Largo máximo de la nota. Es una devolución, no un informe. */
const MAX_NOTA = 1000;

/**
 * Contestar una alerta.
 *
 * NO TOCA MERCADO LIBRE. Guarda qué decidió la persona y nada más: el retiro
 * se arma en Mercado Libre, como siempre. Lo que cambia es que queda escrito
 * que se armó, quién y sobre cuántas unidades.
 *
 * El usuario sale de la sesión y nunca del cuerpo del pedido: si viajara desde
 * el navegador, cualquiera podría firmar una respuesta con el mail de otro.
 */
export async function POST(request: Request) {
  let usuario = "local";
  if (authConfigurada) {
    const u = await getUsuario();
    const permiso = permisoDelUsuario(u);
    if (!puedeEditar(permiso, "meli", u?.email)) {
      return NextResponse.json(
        { error: "Sólo el responsable de Mercado Libre puede contestar las alertas" },
        { status: 403 },
      );
    }
    usuario = u?.email ?? u?.id ?? "";
    if (!usuario) {
      return NextResponse.json({ error: "Sin usuario" }, { status: 403 });
    }
  }

  let cuerpo: Record<string, unknown>;
  try {
    cuerpo = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }

  const sku = typeof cuerpo.sku === "string" ? cuerpo.sku.trim() : "";
  const respuesta = respuestaDe(typeof cuerpo.respuesta === "string" ? cuerpo.respuesta : "");
  if (!sku || !respuesta) {
    return NextResponse.json({ error: "Falta el SKU o la respuesta" }, { status: 400 });
  }

  // El motivo se valida contra la lista: es lo que se va a contar, y un texto
  // inventado sería una categoría más que no suma con ninguna.
  const motivo = MOTIVOS_DESESTIMAR.find((m) => m === cuerpo.motivo) ?? null;
  if (respuesta.pideMotivo && !motivo) {
    return NextResponse.json({ error: "Para desestimar hay que elegir un motivo" }, { status: 400 });
  }

  const nota =
    typeof cuerpo.nota === "string" && cuerpo.nota.trim()
      ? cuerpo.nota.trim().slice(0, MAX_NOTA)
      : null;

  try {
    const resultado = await guardarRespuestaDescarte({
      sku,
      respuesta: respuesta.clave,
      dias: respuesta.dias,
      motivo: respuesta.pideMotivo ? motivo : null,
      nota,
      usuario,
    });
    if (resultado === "ya-no-aplica") {
      return NextResponse.json(
        { error: "Este artículo ya no está en riesgo: la alerta se cerró sola. Recargá la pantalla." },
        { status: 409 },
      );
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[api/tareas-meli] POST", error);
    // El caso esperable: la migración todavía no se aplicó.
    const sinTabla =
      error instanceof Error && /tareas_meli_respuestas/.test(error.message);
    return NextResponse.json(
      {
        error: sinTabla
          ? "Falta crear la tabla de respuestas en la base (migraciones/tareas_meli.sql)."
          : "No se pudo guardar la respuesta",
      },
      { status: 500 },
    );
  }
}
