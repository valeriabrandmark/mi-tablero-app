import { NextResponse } from "next/server";
import {
  ESPERA_MINUTOS,
  interpretarDespertador,
  type EstadoActualizacion,
  type ResultadoDespertador,
} from "@/lib/actualizar";
import { queryOne } from "@/lib/db";
import { permisoDelUsuario, puedeVer } from "@/lib/permisos";
import { authConfigurada } from "@/lib/supabase/env";
import { getUsuario } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * "Actualizar ahora": pedirle al pipeline que traiga datos frescos.
 *
 * El GET dice cuándo se actualizó por última vez; el POST pide la corrida. El
 * porqué de que esto pase por la base y no por la API de GitHub está en
 * `lib/actualizar.ts`.
 *
 * ---------------------------------------------------------------------------
 * QUIEN PUEDE APRETARLO: CUALQUIERA QUE VEA ALGUN TABLERO
 *
 * No se pide permiso de edición y es a propósito. Esto no escribe nada ni
 * cambia lo que nadie ve: pide que los números que ya se están mirando estén
 * al día. Un usuario de sólo lectura que ve un dato de hace tres horas tiene
 * exactamente el mismo problema que uno que puede editar.
 *
 * Lo que sí se exige es sesión con algún módulo. Y el costo de apretarlo está
 * acotado por arriba por dos cosas independientes: la espera de
 * `ESPERA_MINUTOS` que aplica la función de la base, y el `concurrency` del
 * workflow, que no deja correr dos orquestadores a la vez.
 */

/** Sesión con al menos un módulo. Devuelve la respuesta de rechazo, o `null`. */
async function autorizar() {
  if (!authConfigurada) return null;
  const permiso = permisoDelUsuario(await getUsuario());
  // Se pregunta por una pantalla cualquiera del tablero en vez de agregar
  // `/api/actualizar` al catálogo de módulos: esta ruta no es de ningún módulo
  // --sirve a todos por igual-- y `RUTAS_COMUNES` la deja pasar.
  if (!puedeVer(permiso, "/api/actualizar")) {
    return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  }
  return null;
}

/**
 * Cuándo terminó un paso del pipeline por última vez.
 *
 * Es LA MISMA FILA que mira `lib/cache.ts` para armar la clave de la caché y
 * que mira `ops.despertar_orquestador` para decidir si dispara. Que las tres
 * cosas lean lo mismo es lo que hace que el botón no pueda mentir: cuando
 * `version` cambia, la caché ya quedó invalidada y la próxima consulta lee la
 * base. Si cada una tuviera su propia señal, el botón podría decir "listo" con
 * la pantalla todavía sirviendo la respuesta cacheada de antes.
 */
async function leerEstado(): Promise<EstadoActualizacion> {
  const fila = await queryOne<{ version: string | null; minutos: number | null }>(
    `select to_char(actualizado, 'YYYYMMDDHH24MISS') as version,
            floor(extract(epoch from (now() - actualizado)) / 60)::int as minutos
       from ops.estado where clave = 'pasos'`,
  );
  return {
    version: fila?.version ?? null,
    minutos: fila?.minutos ?? null,
    esperaMinutos: ESPERA_MINUTOS,
  };
}

/** Cuándo se actualizó por última vez, para el cartel y para esperar el cambio. */
export async function GET() {
  const rechazo = await autorizar();
  if (rechazo) return rechazo;

  try {
    return NextResponse.json(await leerEstado());
  } catch (error) {
    console.error("[api/actualizar] GET", error);
    return NextResponse.json({ error: "No se pudo leer el estado" }, { status: 500 });
  }
}

/** Pide una corrida del orquestador, si hace falta. */
export async function POST() {
  const rechazo = await autorizar();
  if (rechazo) return rechazo;

  try {
    // El estado se lee ANTES de disparar. La pantalla necesita saber con qué
    // versión arrancó para poder darse cuenta de cuándo cambió, y leerla
    // después sería leer una versión que el pipeline ya podría haber movido:
    // el botón se quedaría esperando un cambio que ya pasó.
    const antes = await leerEstado();

    const fila = await queryOne<{ resultado: string | null }>(
      "select ops.despertar_orquestador($1) as resultado",
      [ESPERA_MINUTOS],
    );
    const resultado: ResultadoDespertador = interpretarDespertador(fila?.resultado);

    if (resultado === "error") {
      // El texto crudo de la función dice qué pasó ("falta el secreto
      // github_token_orquestador en Vault"), y ese es justo el dato que hace
      // falta para arreglarlo. Se pasa tal cual: un "no se pudo" a secas obliga
      // a entrar a la base a adivinar.
      console.error("[api/actualizar] la base contestó:", fila?.resultado);
      return NextResponse.json(
        {
          error:
            "La base no pudo pedir la corrida. " +
            (fila?.resultado ?? "No contestó nada."),
        },
        { status: 502 },
      );
    }

    return NextResponse.json({ resultado, ...antes });
  } catch (error) {
    // El caso más probable acá es que el rol de la app no tenga permiso para
    // ejecutar la función (es `security definer` y tiene `revoke ... from
    // public`). Hoy la app se conecta como `postgres`, que es su dueño.
    const mensaje = error instanceof Error ? error.message : "Error desconocido";
    console.error("[api/actualizar] POST", error);
    return NextResponse.json({ error: mensaje }, { status: 500 });
  }
}
