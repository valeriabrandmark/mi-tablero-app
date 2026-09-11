import { NextResponse } from "next/server";
import { enConstruccion, permisoDelUsuario, puedeVer, puedeVerBorradores } from "@/lib/permisos";
import { authConfigurada } from "@/lib/supabase/env";
import { getUsuario } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Disparar a mano la comparación de precios, desde el tablero.
 *
 * ---------------------------------------------------------------------------
 * EL WORKFLOW ESTÁ ESCRITO ACÁ Y NO LLEGA EN EL PEDIDO. Es la regla más
 * importante de este archivo.
 *
 * El proyecto `precios` tiene tres workflows y uno de ellos --`aplicar.yml`--
 * escribe precios en Tienda Nube. Si esta ruta aceptara el nombre del workflow
 * como parámetro, cualquiera que consiguiera una sesión del tablero podría
 * pedirle que dispare la escritura de precios: el tablero se convertiría en el
 * camino corto para saltear la aprobación humana, que es justo lo que todo
 * este diseño evita.
 *
 * Con el nombre fijo, lo peor que puede hacer una sesión robada es pedirle a
 * un runner que lea precios públicos de la competencia. Molesto, no grave.
 *
 * Por lo mismo el token (`GITHUB_TOKEN_PRECIOS`) tiene que ser fine-grained,
 * del repo `precios` únicamente, y con permiso de Actions y nada más. El
 * candado del nombre fijo y el del alcance del token protegen de lo mismo por
 * dos caminos distintos; tener los dos es barato.
 * ---------------------------------------------------------------------------
 */
const REPO = "valeriabrandmark/precios";
const WORKFLOW = "competencia.yml";
const RAMA = "main";

const API = `https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}`;

type CorridaGitHub = {
  estado: "en_cola" | "corriendo" | "termino" | "fallo" | "sin_datos";
  arrancada: string | null;
  log: string | null;
};

function cabeceras(token: string) {
  return {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${token}`,
    "x-github-api-version": "2022-11-28",
  };
}

/** Cómo salió (o cómo va) la última corrida de comparación. */
async function ultimaCorrida(token: string): Promise<CorridaGitHub> {
  const r = await fetch(`${API}/runs?per_page=1`, {
    headers: cabeceras(token),
    cache: "no-store",
  });
  if (!r.ok) return { estado: "sin_datos", arrancada: null, log: null };

  const run = (await r.json())?.workflow_runs?.[0];
  if (!run) return { estado: "sin_datos", arrancada: null, log: null };

  // `status` es queued | in_progress | completed; cuando está completo lo que
  // importa es `conclusion`. Se traducen acá para que la pantalla no tenga que
  // conocer el vocabulario de GitHub.
  const estado: CorridaGitHub["estado"] =
    run.status === "queued" || run.status === "waiting"
      ? "en_cola"
      : run.status === "in_progress"
        ? "corriendo"
        : run.conclusion === "success"
          ? "termino"
          : "fallo";

  return { estado, arrancada: run.run_started_at ?? run.created_at ?? null, log: run.html_url ?? null };
}

async function autorizar() {
  if (!authConfigurada) return null;
  const permiso = permisoDelUsuario(await getUsuario());
  if (!puedeVer(permiso, "/api/precios-tn")) {
    return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  }
  if (enConstruccion("/precios-tn") && !puedeVerBorradores(permiso)) {
    return NextResponse.json({ error: "En construcción" }, { status: 403 });
  }
  return null;
}

/** El estado, para que el botón pueda decir "corriendo" en vez de no decir nada. */
export async function GET() {
  const rechazo = await autorizar();
  if (rechazo) return rechazo;

  const token = process.env.GITHUB_TOKEN_PRECIOS;
  if (!token) return NextResponse.json({ disponible: false, estado: "sin_datos" });

  return NextResponse.json({ disponible: true, ...(await ultimaCorrida(token)) });
}

/** Dispara la comparación. */
export async function POST() {
  const rechazo = await autorizar();
  if (rechazo) return rechazo;

  const token = process.env.GITHUB_TOKEN_PRECIOS;
  if (!token) {
    return NextResponse.json(
      { error: "Falta GITHUB_TOKEN_PRECIOS en el entorno: el botón no puede disparar nada." },
      { status: 503 },
    );
  }

  // NO ENCOLAR UNA SEGUNDA CORRIDA SOBRE UNA QUE YA ESTÁ. El workflow tiene su
  // propia `concurrency`, así que no correrían dos a la vez; lo que evita esto
  // es la cola de veinte corridas que deja un botón clickeado veinte veces, y
  // que después le pega veinte veces seguidas a los sitios de la competencia.
  // Esos sitios no nos deben nada.
  const actual = await ultimaCorrida(token);
  if (actual.estado === "corriendo" || actual.estado === "en_cola") {
    return NextResponse.json(
      { ok: true, yaCorria: true, ...actual },
      { status: 200 },
    );
  }

  const r = await fetch(`${API}/dispatches`, {
    method: "POST",
    headers: { ...cabeceras(token), "content-type": "application/json" },
    body: JSON.stringify({ ref: RAMA }),
  });

  if (!r.ok) {
    // El cuerpo del error de GitHub dice cosas útiles ("Resource not
    // accessible by personal access token" = falta el permiso de Actions).
    // Se pasa tal cual: un "no se pudo" a secas obliga a adivinar.
    const detalle = await r.text().catch(() => "");
    return NextResponse.json(
      { error: `GitHub contestó ${r.status}. ${detalle.slice(0, 300)}` },
      { status: 502 },
    );
  }

  // El dispatch contesta 204 sin cuerpo y la corrida tarda unos segundos en
  // aparecer en la API. No se consulta el estado acá: daría "sin_datos" y la
  // pantalla mostraría que no pasó nada justo después de que sí pasó.
  return NextResponse.json({ ok: true, yaCorria: false, estado: "en_cola" });
}
