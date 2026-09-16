import { NextResponse, type NextRequest } from "next/server";
import {
  enConstruccion,
  permisoDelUsuario,
  puedeEditar,
  puedeVer,
  puedeVerBorradores,
} from "@/lib/permisos";
import { TANDA_ESCRITURA } from "@/lib/precios-tn";
import { authConfigurada } from "@/lib/supabase/env";
import { getUsuario } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Disparar a mano los workflows del proyecto `precios`, desde el tablero.
 *
 * ---------------------------------------------------------------------------
 * EL PEDIDO ELIGE UNA LLAVE, NO UN ARCHIVO. Es la regla más importante de este
 * archivo, y sobrevivió a que el tablero también pueda escribir precios.
 *
 * `precios` tiene tres workflows y uno de ellos escribe en Tienda Nube. Si esta
 * ruta aceptara el nombre del workflow como parámetro, cualquier cosa que
 * llegue desde el navegador podría nombrar el que quiera — hoy, o el que se
 * agregue el año que viene sin que nadie se acuerde de esta ruta. Con un mapa
 * cerrado, lo único que se puede pedir es lo que está acá escrito.
 *
 * Y SÍ, AHORA SE PUEDE DISPARAR LA ESCRITURA DESDE LA WEB. Es un cambio
 * deliberado y tiene un costo que conviene decir en voz alta: antes una sesión
 * robada del tablero sólo podía aprobar, y para publicar hacía falta entrar a
 * GitHub. Ahora también puede pedir que se escriba.
 *
 * Lo que sigue protegiendo, que no es poco:
 *
 *   - sólo se escriben propuestas que el motor calculó y que una persona marcó
 *     como aprobadas; no hay forma de dictar un precio arbitrario desde acá;
 *   - `aplicar` vuelve a verificar cada una contra la tienda antes de tocarla
 *     (piso de hoy, precio no movido, variante publicada) y escribe 50 como
 *     máximo por corrida;
 *   - el workflow corre en el environment `produccion`, donde se pueden exigir
 *     revisores: con eso puesto, el dispatch queda esperando aprobación humana
 *     en GitHub aunque el pedido haya salido del tablero.
 *
 * Lo que se gana a cambio es que el ciclo termine donde empieza: autorizar y
 * escribir desde la misma pantalla. Un control que obliga a abrir GitHub cada
 * vez es un control que se termina dejando permanentemente abierto.
 * ---------------------------------------------------------------------------
 */
const REPO = "valeriabrandmark/precios";
const RAMA = "main";

/** Lo único que el navegador puede pedir. La llave no es el nombre del archivo. */
const WORKFLOWS = {
  comparar: { archivo: "competencia.yml", inputs: {} as Record<string, unknown> },
  escribir: {
    archivo: "aplicar.yml",
    // `confirmar: true` es lo que pone PRECIOS_APLICAR=si en el workflow. Sin
    // esto el job corre el simulacro y no escribe nada — que es su default.
    //
    // `tarea` VA EXPLÍCITA aunque el workflow tenga ese mismo valor por
    // omisión. Ese workflow ahora hace dos cosas —aplicar propuestas y corregir
    // precios tachados— y depender del default significa que el día que alguien
    // cambie cuál es, este botón empieza a hacer otra cosa sin que este archivo
    // se entere. Un mapa cerrado que deja un campo librado al default no es
    // cerrado.
    inputs: {
      tarea: "aplicar",
      confirmar: true,
      // El mismo número que muestra la pantalla. Ver `TANDA_ESCRITURA`: si
      // fueran dos constantes, el botón prometería una cantidad y el workflow
      // escribiría otra.
      limite: String(TANDA_ESCRITURA),
    } as Record<string, unknown>,
  },
} as const;

type Llave = keyof typeof WORKFLOWS;

function esLlave(v: unknown): v is Llave {
  return v === "comparar" || v === "escribir";
}

const apiDe = (llave: Llave) =>
  `https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOWS[llave].archivo}`;

type CorridaGitHub = {
  estado: "en_cola" | "corriendo" | "termino" | "fallo" | "sin_datos";
  arrancada: string | null;
  log: string | null;
  /** Avance real: pasos terminados sobre pasos totales del job. */
  paso: number;
  pasos: number;
  /** Qué está haciendo ahora, en castellano de la pantalla. */
  haciendo: string | null;
};

/**
 * El avance sale de los PASOS DEL JOB, no de un cronómetro.
 *
 * La tentación era una barra que avanza sola contra una duración estimada. No
 * sirve por dos motivos y los dos se vieron acá: las corridas tardan entre 6 y
 * 18 minutos según cuántas fuentes haya y cuánto tarden en contestar, así que
 * la estimación estaría mal casi siempre; y una barra que llega al 100 % y se
 * queda ahí es peor que ninguna barra, porque enseña a no creerle.
 *
 * GitHub ya cuenta los pasos y dice cuál está corriendo. Eso es avance de
 * verdad: cuando dice "bajando precios de la competencia" es porque lo está
 * haciendo. Que un paso dure más que otro se ve raro en una barra, pero es
 * cierto, y preferimos una barra honesta que se demora a una que miente.
 *
 * Los pasos de andamiaje --checkout, instalar Python-- no se cuentan: son
 * segundos y ensucian la proporción. Se cuentan los del trabajo real.
 */
const ANDAMIAJE = /^(set up job|complete job|post |run actions\/|instalar dependencias)/i;

/** El nombre del paso como lo va a leer una persona, no como lo escribió el YAML. */
function enCastellano(nombre: string): string {
  const limpio = nombre.trim();
  const mapa: Record<string, string> = {
    "Diagnostico del catalogo": "Revisando el catálogo",
    "Leer nuestros precios de Tienda Nube": "Leyendo nuestros precios",
    "Bajar precios de la competencia": "Bajando precios de la competencia",
    "Proponer precios": "Calculando las propuestas",
    Simulacro: "Simulacro (no escribe nada)",
    Aplicar: "Escribiendo en Tienda Nube",
  };
  return mapa[limpio] ?? limpio;
}

/** Los pasos del job, para poder decir en qué anda. */
async function avanceDe(
  token: string,
  runId: number,
): Promise<Pick<CorridaGitHub, "paso" | "pasos" | "haciendo">> {
  const vacio = { paso: 0, pasos: 0, haciendo: null };
  const r = await fetch(`https://api.github.com/repos/${REPO}/actions/runs/${runId}/jobs`, {
    headers: cabeceras(token),
    cache: "no-store",
  });
  if (!r.ok) return vacio;

  const job = (await r.json())?.jobs?.[0];
  const pasos: { name: string; status: string; conclusion: string | null }[] = (
    job?.steps ?? []
  ).filter((p: { name: string }) => !ANDAMIAJE.test(p.name ?? ""));
  if (!pasos.length) return vacio;

  const terminados = pasos.filter((p) => p.status === "completed").length;
  const enCurso = pasos.find((p) => p.status === "in_progress");
  return {
    paso: terminados,
    pasos: pasos.length,
    haciendo: enCurso ? enCastellano(enCurso.name) : null,
  };
}

function cabeceras(token: string) {
  return {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${token}`,
    "x-github-api-version": "2022-11-28",
  };
}

/** Cómo salió (o cómo va) la última corrida de ese workflow. */
async function ultimaCorrida(token: string, llave: Llave): Promise<CorridaGitHub> {
  const sinDatos: CorridaGitHub = {
    estado: "sin_datos",
    arrancada: null,
    log: null,
    paso: 0,
    pasos: 0,
    haciendo: null,
  };

  const r = await fetch(`${apiDe(llave)}/runs?per_page=1`, {
    headers: cabeceras(token),
    cache: "no-store",
  });
  if (!r.ok) return sinDatos;

  const run = (await r.json())?.workflow_runs?.[0];
  if (!run) return sinDatos;

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

  // Los pasos sólo se piden MIENTRAS CORRE: es una consulta más a la API de
  // GitHub, y de una corrida terminada no dicen nada que la pantalla use.
  const avance =
    estado === "corriendo" ? await avanceDe(token, run.id) : { paso: 0, pasos: 0, haciendo: null };

  return {
    estado,
    arrancada: run.run_started_at ?? run.created_at ?? null,
    log: run.html_url ?? null,
    ...avance,
  };
}

/**
 * `conEdicion` distingue mirar de hacer. El GET pregunta cómo viene la corrida
 * —eso lo puede ver cualquiera que tenga el módulo— y el POST la dispara, que
 * es lanzar un workflow y generar propuestas nuevas: eso ya es editar.
 */
async function autorizar(conEdicion = false) {
  if (!authConfigurada) return null;
  const permiso = permisoDelUsuario(await getUsuario());
  if (!puedeVer(permiso, "/api/precios-tn")) {
    return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  }
  if (enConstruccion("/precios-tn") && !puedeVerBorradores(permiso)) {
    return NextResponse.json({ error: "En construcción" }, { status: 403 });
  }
  if (conEdicion && !puedeEditar(permiso, "precios_tn")) {
    return NextResponse.json(
      { error: "Tu usuario puede ver Precios TN, pero no correr la comparación" },
      { status: 403 },
    );
  }
  return null;
}

/** El estado, para que los botones puedan decir "corriendo" en vez de nada. */
export async function GET(request: NextRequest) {
  const rechazo = await autorizar();
  if (rechazo) return rechazo;

  const token = process.env.GITHUB_TOKEN_PRECIOS;
  if (!token) return NextResponse.json({ disponible: false, estado: "sin_datos" });

  const crudo = request.nextUrl.searchParams.get("que");
  const llave: Llave = esLlave(crudo) ? crudo : "comparar";
  return NextResponse.json({
    disponible: true,
    que: llave,
    ...(await ultimaCorrida(token, llave)),
  });
}

/** Dispara uno de los dos workflows. */
export async function POST(request: NextRequest) {
  const rechazo = await autorizar(true);
  if (rechazo) return rechazo;

  const token = process.env.GITHUB_TOKEN_PRECIOS;
  if (!token) {
    return NextResponse.json(
      { error: "Falta GITHUB_TOKEN_PRECIOS en el entorno: el botón no puede disparar nada." },
      { status: 503 },
    );
  }

  const cuerpo = await request.json().catch(() => null);
  const llave: Llave = esLlave(cuerpo?.que) ? cuerpo.que : "comparar";

  // NO ENCOLAR UNA SEGUNDA CORRIDA SOBRE UNA QUE YA ESTÁ.
  //
  // Cada workflow ya tiene su `concurrency`, así que no correrían dos a la vez.
  // Lo que evita esto es la cola que deja un botón clickeado veinte veces: en
  // `comparar`, veinte bajadas seguidas contra sitios que no nos deben nada; en
  // `escribir`, veinte corridas pisándose sobre las mismas propuestas.
  const actual = await ultimaCorrida(token, llave);
  if (actual.estado === "corriendo" || actual.estado === "en_cola") {
    return NextResponse.json({ ok: true, yaCorria: true, que: llave, ...actual });
  }

  const r = await fetch(`${apiDe(llave)}/dispatches`, {
    method: "POST",
    headers: { ...cabeceras(token), "content-type": "application/json" },
    body: JSON.stringify({ ref: RAMA, inputs: WORKFLOWS[llave].inputs }),
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
  return NextResponse.json({
    ok: true,
    yaCorria: false,
    que: llave,
    estado: "en_cola",
    paso: 0,
    pasos: 0,
    haciendo: null,
  });
}
