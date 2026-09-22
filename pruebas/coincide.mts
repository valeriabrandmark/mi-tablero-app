/**
 * Pruebas del buscador de los filtros. Sin base, sin red, sin navegador.
 *
 * POR QUE EXISTE. Que el desplegable se abra y se cierre se ve al primer
 * click. Que "bu" no encuentre "Bubba" NO se ve: la lista aparece vacía y se
 * lee como "esa marca no está cargada", que es otra cosa y manda a buscar un
 * problema donde no lo hay. Los casos de acá son los de la pantalla real --las
 * marcas y proveedores tal como están cargados en Sigma-- y son los que
 * avisarían si alguien cambia el `includes` por un `startsWith` o se lleva
 * puesta la normalización de acentos.
 *
 *     node --experimental-strip-types --import ./pruebas/registrar.mjs pruebas/coincide.mts
 */

import { coincide, normalizar } from "@/lib/coincide";

const FALLOS: string[] = [];

function revisar(nombre: string, obtenido: unknown, esperado: unknown) {
  const ok = JSON.stringify(obtenido) === JSON.stringify(esperado);
  console.log(
    ok ? `OK  ${nombre}` : `MAL ${nombre}\n     esperado: ${esperado}\n     obtenido: ${obtenido}`,
  );
  if (!ok) FALLOS.push(nombre);
}

/** Como lo usa el selector: valor y texto visible son lo mismo. */
const marca = (m: string, termino: string) => coincide(m, m, termino);

// --- El caso que lo pidió ---------------------------------------------------
//
// "bu" tiene que traer las dos marcas parecidas juntas, que es justo por lo que
// scrollear no alcanzaba: están a dos renglones y hay que leerlas con cuidado.

revisar("bu encuentra Bubba", marca("BUBBA", "bu"), true);
revisar("bu encuentra Buba", marca("Buba", "bu"), true);
revisar("bu NO encuentra Nestle", marca("NESTLE", "bu"), false);

// --- Mayúsculas ------------------------------------------------------------
//
// El maestro de Sigma tiene las marcas en mayúscula y nadie las escribe así.

revisar("se escribe en minúscula", marca("BUBBA", "bubba"), true);
revisar("se escribe en mayúscula", marca("Bubba", "BUBBA"), true);
revisar("mezclado", marca("BuBbA", "bUbBa"), true);

// --- Acentos, de los dos lados ---------------------------------------------
//
// Nadie pone el acento cuando está filtrando apurado. Y al revés: si la marca
// quedó cargada sin acento, escribirla con acento tiene que andar igual.

revisar("sin acento encuentra con acento", marca("Nestlé", "nestle"), true);
revisar("con acento encuentra sin acento", marca("NESTLE", "nestlé"), true);
revisar("la ñ se puede escribir como n", marca("NOÑO", "nono"), true);

// --- En cualquier parte, no solo al principio -------------------------------
//
// Los proveedores están con la razón social completa. Quien busca "noa" no
// tiene por qué acordarse de que el nombre arranca con "DISTRIBUIDORA".

revisar("por el medio", marca("DISTRIBUIDORA NOA S.R.L.", "noa"), true);
revisar("por el final", marca("IMPROM S.A.", "s.a."), true);
revisar("por el principio", marca("IMPROM S.A.", "impro"), true);

// --- Espacios ---------------------------------------------------------------

revisar("espacios alrededor del término", marca("BUBBA", "  bu  "), true);
revisar("un espacio adentro sí cuenta", marca("MERCADOLIBRE", "mercado libre"), false);

// --- El término vacío no filtra nada ----------------------------------------
//
// Mientras no se escribió nada, la lista es la lista completa. Si esto diera
// false el desplegable aparecería vacío hasta escribir la primera letra.

revisar("término vacío", marca("BUBBA", ""), true);
revisar("solo espacios", marca("BUBBA", "   "), true);

// --- Valor y texto visible, cuando no son lo mismo --------------------------
//
// El filtro de Empresa muestra "Quo Marketing" y guarda "0001". Las dos son
// formas legítimas de buscar: quien conoce el código escribe el código.

revisar("busca por el texto visible", coincide("0001", "Quo Marketing", "marketing"), true);
revisar("busca por el valor de abajo", coincide("0001", "Quo Marketing", "0001"), true);
revisar("ninguno de los dos", coincide("0001", "Quo Marketing", "noa"), false);

// --- `normalizar` a secas ---------------------------------------------------

revisar("normalizar saca acentos y mayúsculas", normalizar("  Nestlé  "), "nestle");
revisar("normalizar no rompe lo que ya está limpio", normalizar("bubba"), "bubba");

console.log(FALLOS.length ? `\n${FALLOS.length} FALLARON: ${FALLOS.join(", ")}` : "\nTODO OK");
process.exit(FALLOS.length ? 1 : 0);
