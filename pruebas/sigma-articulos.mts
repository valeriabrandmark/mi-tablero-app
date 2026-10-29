import { articulosDeLaRespuesta, pedirArticulosASigma } from "@/lib/sigma-articulos";

/* ===========================================================================
   PEDIRLE EL MAESTRO A SIGMA EN EL MOMENTO

   Lo que se prueba acá no es el fetch: es CADA FORMA DE FALLAR, y sobre todo
   que ninguna termine en "listo" con un maestro incompleto.

   Porque el costo teórico es el denominador de todos los márgenes del tablero.
   Si esto devolviera 200 con una lista vacía --o con los artículos
   desactivados adentro-- el botón aplicaría 8.240 costos en cero y el margen
   de todo se iría al 100 %. No se vería donde se aprieta: se vería semanas
   después como números raros que nadie sabe explicar.

   La falla que motivó el módulo fue la silenciosa al revés: el 29/10/2026 se
   usó la copia de 23 horas antes y la pantalla no lo dijo. Así que lo que NO
   puede pasar es que un `falla` salga sin motivo legible.
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

const ENTORNO = {
  cliente: "sigma.example.com",
  alias: "alias",
  id: "007",
  token: "el-token",
};

const UNO = {
  id: "AL01013",
  proveedorNombre: "ALGABO S. A.",
  descripcion: "Algabo Baby hisopos",
  costoTeorico: 765.5,
  desactivado: "false",
};

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

// Antes de cargar las variables en Vercel esto no está roto: está sin atar, y
// la pantalla lo dice distinto --sin alarma de que Sigma se cayó.
{
  const r = await pedirArticulosASigma(contesta([UNO]), {});
  revisar("sin variables no se intenta", r, { estado: "sin_conectar" });
}
{
  const r = await pedirArticulosASigma(contesta([UNO]), { ...ENTORNO, token: undefined });
  revisar("sin token tampoco", r.estado, "sin_conectar");
}

/* --- LO QUE SALE BIEN ---------------------------------------------------- */

{
  const r = await pedirArticulosASigma(contesta([UNO]), ENTORNO);
  revisar("trae el artículo", r, {
    estado: "ok",
    articulos: [
      {
        sku: "AL01013",
        proveedor: "ALGABO S. A.",
        descripcion: "Algabo Baby hisopos",
        costoTeorico: 765.5,
      },
    ],
  });
}

// SE PIDE AL MISMO LUGAR QUE sigma.py. Si las dos pidieran a URLs distintas, el
// botón y el orquestador podrían costear con maestros distintos.
{
  let pedida = "";
  let token = "";
  const espia = (async (u: string, o: RequestInit) => {
    pedida = String(u);
    token = (o.headers as Record<string, string>)["X-Auth-Token"];
    return new Response(JSON.stringify([UNO]));
  }) as unknown as typeof fetch;
  await pedirArticulosASigma(espia, ENTORNO);
  revisar(
    "la URL es la de la API v10",
    pedida,
    "https://sigma.example.com/alias/007/sigma/api/v10/ExportArticulos",
  );
  revisar("y el token va en el header", token, "el-token");
}

/* --- EL MAESTRO VACIO NO PASA POR BUENO ---------------------------------- */

// LA PEOR DE TODAS. Con cero artículos el snapshot diría que los 8.240 se
// quedan sin costo teórico, y aplicado dejaría el tablero entero en cero. Es
// una falla, no un maestro sin artículos.
{
  const r = await pedirArticulosASigma(contesta([]), ENTORNO);
  revisar("una lista vacía es falla", r.estado, "falla");
  revisar(
    "y dice cuántas filas vinieron",
    r.estado === "falla" && r.motivo.includes("0 filas"),
    true,
  );
}

// Lo mismo si vienen filas pero ninguna sirve: un maestro entero desactivado
// es tan sospechoso como uno vacío, y el efecto de aplicarlo es idéntico.
{
  const r = await pedirArticulosASigma(
    contesta([{ ...UNO, desactivado: "true" }, { id: "", costoTeorico: 1 }]),
    ENTORNO,
  );
  revisar("filas que no dejan ningún artículo activo, también", r.estado, "falla");
}

/* --- LO QUE FALLA, FALLA CON MOTIVO ------------------------------------- */

// 429 Y 403 SON SATURACION y se nombran aparte: no hay nada que corregir, hay
// que esperar. sigma.py los reintenta hasta tres minutos; acá hay alguien
// esperando la pantalla, así que se le dice que vuelva a apretar.
for (const status of [429, 403]) {
  const r = await pedirArticulosASigma(contesta(null, status, "nope"), ENTORNO);
  revisar(`${status} se explica como saturación`, r.estado === "falla" && r.motivo.includes("saturado"), true);
  revisar(`${status} dice qué hacer`, r.estado === "falla" && r.motivo.includes("de nuevo"), true);
}

{
  const r = await pedirArticulosASigma(contesta(null, 500, "boom"), ENTORNO);
  revisar("un HTTP feo se nombra", r, {
    estado: "falla",
    motivo: "Sigma contestó HTTP 500.",
  });
}

// 200 CON UNA PAGINA DE HTML ADENTRO, que es como contesta un proxy o un login.
{
  const r = await pedirArticulosASigma(
    contesta(null, 200, "<!DOCTYPE html><html>Acceso denegado</html>"),
    ENTORNO,
  );
  revisar("un HTML con 200 no pasa por bueno", r.estado, "falla");
  revisar("y se dice que no es JSON", r.estado === "falla" && r.motivo.includes("no es JSON"), true);
}

// JSON válido que no es una lista: `{"error": "..."}` es lo típico.
{
  const r = await pedirArticulosASigma(contesta({ error: "token vencido" }), ENTORNO);
  revisar("un objeto en vez de una lista es falla", r.estado, "falla");
  revisar(
    "y se dice que no vino una lista",
    r.estado === "falla" && r.motivo.includes("lista de artículos"),
    true,
  );
}

{
  const tiempo = new Error("se acabó");
  tiempo.name = "TimeoutError";
  const r = await pedirArticulosASigma(explota(tiempo), ENTORNO);
  revisar(
    "el tiempo agotado se dice como tiempo agotado",
    r.estado === "falla" && r.motivo.includes("no contestó en"),
    true,
  );
}

{
  const r = await pedirArticulosASigma(explota(new Error("getaddrinfo ENOTFOUND")), ENTORNO);
  revisar(
    "y un error de red llega con su texto",
    r.estado === "falla" && r.motivo.includes("ENOTFOUND"),
    true,
  );
}

/* --- EL RECORTE, QUE TIENE QUE SER EL MISMO QUE EL DE LA COPIA ----------- */

// La consulta a `bronze.sigma_articulos` deja los activos con código y ordena
// por SKU. Si este camino dejara otros artículos, el costo dependería de si
// Sigma contestó -- y eso sería peor que la copia vieja.
{
  const lista = articulosDeLaRespuesta([
    { id: "ZZ", costoTeorico: 1, desactivado: "false" },
    { id: "AA", costoTeorico: 2, desactivado: "false" },
    { id: "MM", costoTeorico: 3, desactivado: "false" },
  ]);
  revisar("sale ordenado por SKU", lista.map((a) => a.sku), ["AA", "MM", "ZZ"]);
}
{
  const lista = articulosDeLaRespuesta([
    { id: "A", desactivado: "false" },
    { id: "B", desactivado: "true" },
    { id: "C", desactivado: true },
    { id: "D" },
    { id: "  ", desactivado: "false" },
    { id: null, desactivado: "false" },
    null,
    "no es un objeto",
  ]);
  // `desactivado` se acepta como texto y como booleano: en la copia quedó como
  // texto, pero eso lo hizo pandas al guardar, no necesariamente la API.
  revisar("deja los activos con código", lista.map((a) => a.sku), ["A", "D"]);
}

// SIN COSTO TEORICO ES null, NO CERO. Son 1.166 artículos (29/10/2026) y la
// diferencia es la que decide si la pantalla avisa "se queda sin costo" o
// escribe un cero como si fuera un precio.
{
  const lista = articulosDeLaRespuesta([
    { id: "A", costoTeorico: 0, desactivado: "false" },
    { id: "B", desactivado: "false" },
    { id: "C", costoTeorico: null, desactivado: "false" },
    { id: "D", costoTeorico: "", desactivado: "false" },
    { id: "E", costoTeorico: "1.234,5", desactivado: "false" },
  ]);
  const por = new Map(lista.map((a) => [a.sku, a.costoTeorico]));
  revisar("un cero explícito es cero", por.get("A"), 0);
  revisar("sin la clave es null", por.get("B"), null);
  revisar("null es null", por.get("C"), null);
  revisar("vacío es null", por.get("D"), null);
  // Un número que no se puede leer queda en null y no en NaN: NaN se propaga a
  // costo_real y la fila entera queda inservible sin que nada falle.
  revisar("lo que no es número es null, no NaN", por.get("E"), null);
}

{
  const lista = articulosDeLaRespuesta([{ id: "  A  ", descripcion: "  x  ", desactivado: "false" }]);
  revisar("se le sacan los espacios al código", lista[0]!.sku, "A");
  revisar("y a la descripción", lista[0]!.descripcion, "x");
}

revisar("algo que no es una lista no rompe", articulosDeLaRespuesta({ error: 1 }), []);
revisar("ni null", articulosDeLaRespuesta(null), []);

console.log(FALLOS.length ? `\n${FALLOS.length} FALLARON: ${FALLOS.join(", ")}` : "\nTODO OK");
process.exit(FALLOS.length ? 1 : 0);
