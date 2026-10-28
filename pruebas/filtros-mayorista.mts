/**
 * El viaje de los filtros de Ventas Mayoristas por la URL. Sin base.
 *
 * POR QUÉ EXISTE. `lib/filtros.ts` es la única definición de estos filtros
 * justamente porque antes cada lado los enumeraba por su cuenta: el navegador
 * armaba la URL con una lista y la ruta de API la leía con otra. Agregar un
 * filtro en un lado y olvidarlo en el otro no daba ningún error --el filtro se
 * aplicaba "a medias" y el tablero contestaba números sin filtrar--. Eso ya
 * pasó con cliente, sku y comprobante.
 *
 * El tipo `ClavesFaltantes` de ese archivo cubre la mitad del problema: rompe el
 * build si una clave de `Filtros` no está en ninguna de las dos listas. Lo que
 * no puede ver es si la clave SOBREVIVE la ida y vuelta, que es lo de acá.
 *
 *     node --experimental-strip-types --import ./pruebas/registrar.mjs pruebas/filtros-mayorista.mts
 */

import {
  aQueryString,
  desdeSearchParams,
  alternar,
  CLAVES_FILTRO,
  LARGO_MAX_BUSQUEDA,
} from "@/lib/filtros";
import type { Filtros } from "@/lib/types";

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

const ida = (f: Filtros) => desdeSearchParams(new URLSearchParams(aQueryString(f)));

/* --- TODA CLAVE DE LISTA SOBREVIVE LA IDA Y VUELTA ----------------------- */

// Se recorre `CLAVES_FILTRO` en vez de escribirlas a mano: así una clave nueva
// entra a esta prueba sola, sin que haya que acordarse de sumarla acá --que es
// exactamente el olvido que esta prueba busca atrapar.
for (const clave of CLAVES_FILTRO) {
  revisar(`${clave} vuelve igual`, ida({ [clave]: ["UNO"] })[clave], ["UNO"]);
  revisar(`${clave} con varios valores`, ida({ [clave]: ["A", "B", "C"] })[clave], [
    "A",
    "B",
    "C",
  ]);
}

// Y todas juntas, que es como viajan de verdad.
{
  const todo = Object.fromEntries(CLAVES_FILTRO.map((c) => [c, [`val-${c}`]])) as Filtros;
  revisar("todas a la vez", ida(todo), todo);
}

/* --- LOS VALORES CON COMAS NO SE PARTEN ---------------------------------- */

// POR ESTO CADA VALOR VA COMO UN PARAMETRO REPETIDO y no separado por comas:
// las razones sociales las traen siempre ("ALGABO S. A."), y cualquier
// separador partiría un cliente al medio y lo dejaría sin encontrar nada.
{
  const f: Filtros = { cliente: ["QUISPE, ANGEL BENITO", "ALGABO S. A."] };
  revisar("un valor con comas llega entero", ida(f).cliente, f.cliente);
}
{
  const f: Filtros = { proveedor: ["ROYERDORE DE JUAN OSVALDO BRUSCO E HIJOS S R L"] };
  revisar("y uno largo también", ida(f).proveedor, f.proveedor);
}

/* --- MARCA: LAS GRAFIAS RARAS VIAJAN TAL CUAL ---------------------------- */

// La marca se normaliza al comparar contra la base (ver `whereBase`), NO al
// viajar: lo que se eligió es lo que vuelve. Si la URL la pasara a mayúsculas,
// el valor dejaría de coincidir con la opción tildada en el desplegable y el
// filtro se vería vacío estando puesto.
{
  const f: Filtros = { marca: ["47 street", "Algabo Baby"] };
  revisar("la marca conserva mayúsculas y minúsculas", ida(f).marca, f.marca);
}

/* --- VACIO ES "SIN FILTRAR", Y ES UN SOLO CASO --------------------------- */

// `undefined` y no lista vacía: así "sin filtrar" no son dos estados distintos
// que cada consulta tenga que distinguir.
revisar("sin nada no aparece la clave", ida({}), {});
revisar("una lista vacía no sobrevive", ida({ marca: [] }).marca, undefined);
revisar("un valor vacío se descarta", ida({ marca: [""] }).marca, undefined);
revisar("el vacío se cae y el bueno queda", ida({ marca: ["", "NUK"] }).marca, ["NUK"]);

/* --- EL BUSCADOR, QUE NO ES UNA LISTA ------------------------------------ */

revisar("el término libre vuelve igual", ida({ buscar: "oral b" }).buscar, "oral b");
revisar("se le sacan los espacios", ida({ buscar: "  oral b  " }).buscar, "oral b");
revisar("un término vacío no viaja", ida({ buscar: "   " }).buscar, undefined);
{
  const largo = "x".repeat(LARGO_MAX_BUSQUEDA + 50);
  revisar(
    "y se corta en el tope",
    ida({ buscar: largo }).buscar?.length,
    LARGO_MAX_BUSQUEDA,
  );
}

/* --- ALTERNAR: EL CLICK EN UN GRAFICO ------------------------------------ */

revisar("sumar el primero", alternar(undefined, "ALGABO"), ["ALGABO"]);
revisar("sumar otro", alternar(["ALGABO"], "GLAM"), ["ALGABO", "GLAM"]);
revisar("volver a clickear lo saca", alternar(["ALGABO", "GLAM"], "ALGABO"), ["GLAM"]);
// Sacar el último deja `undefined` y no `[]`, para que el filtro desaparezca de
// la URL en vez de quedar como un parámetro vacío que no filtra nada.
revisar("sacar el último deja sin filtro", alternar(["ALGABO"], "ALGABO"), undefined);

console.log(FALLOS.length ? `\n${FALLOS.length} FALLARON: ${FALLOS.join(", ")}` : "\nTODO OK");
process.exit(FALLOS.length ? 1 : 0);
