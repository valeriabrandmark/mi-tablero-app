import { pedirFotoDeOfertas } from "@/lib/ofertas-webapp";

/* ===========================================================================
   PEDIRLE A LA PLANILLA LA FOTO DEL MOMENTO

   Lo que se prueba acá no es el fetch: es CADA FORMA DE FALLAR. El texto que
   devuelve cada caso es lo único que va a decir qué hay que arreglar, y la
   mayoría de estas fallas van a pasar una sola vez --mientras se conecta-- en
   un lugar donde nadie puede ver un log.

   La peor de todas es la silenciosa: que la planilla conteste 200 con una
   página de error adentro y esto lo lea como "anduvo". Ahí la pantalla diría
   que tiene la foto del momento y tendría la de anoche.
   ========================================================================= */

const FALLOS: string[] = [];

function revisar(nombre: string, obtenido: unknown, esperado: unknown) {
  const ok = JSON.stringify(obtenido) === JSON.stringify(esperado);
  console.log(
    ok
      ? `OK  ${nombre}`
      : `MAL ${nombre}\n     esperado: ${JSON.stringify(esperado)}\n     obtenido: ${JSON.stringify(obtenido)}`,
  );
  if (!ok) FALLOS.push(nombre);
}

const ENTORNO = { url: "https://script.google.com/.../exec", token: "el-token" };

/** Un fetch de mentira que contesta lo que se le diga. */
function contesta(cuerpo: unknown, status = 200, comoTexto?: string): typeof fetch {
  return (async () =>
    new Response(comoTexto ?? JSON.stringify(cuerpo), {
      status,
      headers: { "Content-Type": "application/json" },
    })) as unknown as typeof fetch;
}

/** Un fetch que explota, como cuando no hay red o se acaba el tiempo. */
function explota(error: Error): typeof fetch {
  return (async () => {
    throw error;
  }) as unknown as typeof fetch;
}

/* --- SIN CONECTAR NO ES UNA FALLA ---------------------------------------- */

// Antes de cargar los secretos, el tablero no está roto: está sin atar. La
// pantalla lo dice distinto --sin alarma-- así que tiene que llegar distinto.
{
  const r = await pedirFotoDeOfertas(contesta({ ok: true }), {});
  revisar("sin secretos no se intenta", r, { estado: "sin_conectar" });
}
{
  const r = await pedirFotoDeOfertas(contesta({ ok: true }), { url: ENTORNO.url });
  revisar("con la URL pero sin token tampoco", r.estado, "sin_conectar");
}

/* --- LO QUE SALE BIEN ---------------------------------------------------- */

// La respuesta viene anidada: el script contesta `{ok, respuesta}` y adentro
// de `respuesta`, COMO TEXTO, lo que contestó la edge function.
{
  const r = await pedirFotoDeOfertas(
    contesta({ ok: true, respuesta: JSON.stringify({ ok: true, id: 7, filas: 11000 }) }),
    ENTORNO,
  );
  revisar("saca el id de la respuesta anidada", r, { estado: "ok", id: 7, filas: 11000 });
}

// SI LA RESPUESTA ANIDADA NO SE PUEDE LEER NO ES UNA FALLA: la fila ya se
// escribió del otro lado, y la pantalla la va a encontrar igual al recargar.
// Sólo se queda sin el id.
{
  const r = await pedirFotoDeOfertas(contesta({ ok: true, respuesta: "no es json" }), ENTORNO);
  revisar("sin poder leer el detalle, igual anduvo", r, { estado: "ok", id: null, filas: null });
}

/* --- LA FALLA SILENCIOSA ------------------------------------------------- */

// APPS SCRIPT CONTESTA 200 CON UNA PAGINA DE ERROR EN HTML cuando la
// implementación quedó vieja o pide iniciar sesión. Leído como "anduvo", la
// pantalla diría que tiene la foto del momento y tendría la de anoche.
{
  const r = await pedirFotoDeOfertas(
    contesta(null, 200, "<!DOCTYPE html><html>Se requiere autorización</html>"),
    ENTORNO,
  );
  revisar("un HTML con 200 no pasa por bueno", r.estado, "falla");
  revisar(
    "y dice dónde mirar",
    r.estado === "falla" && r.motivo.includes("versión vieja"),
    true,
  );
}

// El script también contesta 200 con `ok: false` adentro, a propósito.
{
  const r = await pedirFotoDeOfertas(contesta({ ok: false, error: "token invalido" }), ENTORNO);
  revisar("el token que no coincide se explica", r, {
    estado: "falla",
    motivo: "El token del tablero no coincide con el de la planilla.",
  });
}

{
  const r = await pedirFotoDeOfertas(
    contesta({ ok: false, error: 'La hoja "TABLERO" no tiene datos: se corta sin mandar nada.' }),
    ENTORNO,
  );
  revisar(
    "y el error de la hoja viaja tal cual",
    r.estado === "falla" && r.motivo.includes("no tiene datos"),
    true,
  );
}

/* --- LO QUE FALLA FUERTE ------------------------------------------------- */

{
  const r = await pedirFotoDeOfertas(contesta({ error: "nope" }, 500), ENTORNO);
  revisar("un HTTP feo se nombra", r, {
    estado: "falla",
    motivo: "La planilla contestó HTTP 500.",
  });
}

{
  const tiempo = new Error("se acabó");
  tiempo.name = "TimeoutError";
  const r = await pedirFotoDeOfertas(explota(tiempo), ENTORNO);
  revisar(
    "el tiempo agotado se dice como tiempo agotado",
    r.estado === "falla" && r.motivo.includes("no contestó en"),
    true,
  );
}

{
  const r = await pedirFotoDeOfertas(explota(new Error("getaddrinfo ENOTFOUND")), ENTORNO);
  revisar(
    "y un error de red llega con su texto",
    r.estado === "falla" && r.motivo.includes("ENOTFOUND"),
    true,
  );
}

console.log(FALLOS.length ? `\n${FALLOS.length} FALLARON: ${FALLOS.join(", ")}` : "\nTODO OK");
process.exit(FALLOS.length ? 1 : 0);
