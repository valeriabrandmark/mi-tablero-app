import {
  ATRIBUTO_TEMA,
  CLAVE_TEMA,
  ETIQUETA,
  TEMA_POR_DEFECTO,
  atributosDeTema,
  otroTema,
  temaGuardado,
} from "@/lib/tema";
import { readFileSync, readdirSync } from "node:fs";

/* ===========================================================================
   EL TEMA DEL TABLERO

   Lo que se prueba no es que el claro se vea lindo --eso se mira-- sino las
   tres cosas que, si se rompen, rompen la pantalla ENTERA y no un panel:

   1. QUE UN VALOR RARO NO DEJE EL `<html>` EN UN TEMA QUE EL CSS NO DEFINE.
      Lo que sale de `localStorage` es texto que pudo escribir cualquiera: una
      version vieja del tablero, otra pestaña, la consola. Si eso llegara tal
      cual al atributo, el CSS no encontraria ninguna regla y la pantalla
      quedaria a medio pintar, sin fondo y sin colores.

   2. QUE EL OSCURO NO ESCRIBA ATRIBUTO. Es el default del CSS. Dejandolo sin
      atributo, un navegador que bloquee el script del layout muestra el
      tablero de siempre en vez de nada.

   3. QUE EL SCRIPT DEL LAYOUT Y ESTE MODULO DIGAN LA MISMA PALABRA. El script
      corre antes de que exista ningun modulo, asi que repite la clave y el
      atributo escritos a mano. Si alguien renombra la constante y no el
      script, el tema deja de aplicarse ANTES del pintado y vuelve el fogonazo
      -- que es exactamente lo que el script existe para evitar, y nadie lo va
      a notar leyendo el diff.
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

/* --- 1. LO QUE SALE DE localStorage NO SE CREE --------------------------- */

revisar("el claro guardado se respeta", temaGuardado("claro"), "claro");
revisar("el oscuro tambien", temaGuardado("oscuro"), "oscuro");

revisar("sin nada guardado, el default", temaGuardado(null), "oscuro");
revisar("undefined igual", temaGuardado(undefined), "oscuro");
revisar("texto vacio igual", temaGuardado(""), "oscuro");
revisar("un valor inventado cae en el default", temaGuardado("fucsia"), "oscuro");
revisar("y uno de otra version tambien", temaGuardado("light"), "oscuro");

// Ni un objeto ni un numero rompen: `localStorage` devuelve texto, pero esta
// funcion tambien la puede llamar otra cosa.
revisar("un numero no rompe", temaGuardado(1), "oscuro");
revisar("un objeto tampoco", temaGuardado({ tema: "claro" }), "oscuro");
revisar("case sensitive a proposito", temaGuardado("Claro"), "oscuro");

revisar("el default es el oscuro", TEMA_POR_DEFECTO, "oscuro");

/* --- 2. QUE SE ESCRIBE EN EL <html> -------------------------------------- */

revisar("el claro escribe el atributo", atributosDeTema("claro"), {
  atributo: "claro",
  colorScheme: "light",
});

// LA PRUEBA DEL PUNTO 2. Si alguien hace que el oscuro escriba
// `data-tema="oscuro"`, el CSS sigue andando -- pero un navegador sin
// JavaScript deja de ver el tema de siempre.
revisar("el oscuro NO escribe atributo", atributosDeTema("oscuro"), {
  atributo: null,
  colorScheme: "dark",
});

/* --- EL BOTON QUE ALTERNA ------------------------------------------------ */

revisar("de oscuro se va a claro", otroTema("oscuro"), "claro");
revisar("y de claro a oscuro", otroTema("claro"), "oscuro");
revisar("alternar dos veces vuelve al mismo", otroTema(otroTema("claro")), "claro");

revisar("las dos etiquetas existen", [ETIQUETA.oscuro, ETIQUETA.claro], [
  "Oscuro",
  "Claro",
]);

/* --- 3. EL SCRIPT DEL LAYOUT DICE LO MISMO QUE ESTE MODULO --------------- */

const layout = readFileSync("app/layout.tsx", "utf8");

revisar(
  "el script usa la misma clave de localStorage",
  layout.includes(`'${CLAVE_TEMA}'`),
  true,
);
revisar(
  "y escribe el mismo atributo",
  layout.includes(`dataset.${ATRIBUTO_TEMA}='claro'`),
  true,
);
revisar(
  "y pone el color-scheme claro",
  layout.includes("colorScheme='light'"),
  true,
);
// Que siga envuelto en try/catch: en modo incognito `localStorage` TIRA al
// leerlo, y un error ahi -- en un script sincrono del <head> -- corta el
// pintado de la pagina entera.
revisar("el script atrapa el error de localStorage", layout.includes("catch(e){}"), true);

/* --- EL CSS DEFINE LOS DOS TEMAS ----------------------------------------- */

const css = readFileSync("app/globals.css", "utf8");

revisar(
  "el CSS tiene el bloque del tema claro",
  css.includes(`html[data-${ATRIBUTO_TEMA}="claro"]`),
  true,
);

// CADA VARIABLE DEL OSCURO TIENE SU VERSION CLARA. Es la prueba que agarra el
// caso de agregar un color nuevo al tablero y olvidarse del claro: esa
// variable se quedaria con el valor del oscuro --un color pensado para fondo
// casi negro-- y sobre el crema quedaria invisible. No se veria como un error:
// se veria como una linea que no esta.
const variablesDe = (bloque: string): string[] =>
  [...bloque.matchAll(/--color-[a-z0-9-]+/g)].map((m) => m[0]).sort();

const bloqueOscuro = css.slice(css.indexOf("@theme"), css.indexOf("MODO CLARO"));
const inicioClaro = css.indexOf(`html[data-${ATRIBUTO_TEMA}="claro"] {`);
const bloqueClaro = css.slice(inicioClaro, css.indexOf("}", inicioClaro));

const enOscuro = variablesDe(bloqueOscuro).filter((v) => !v.startsWith("--color-bg-"));
const enClaro = variablesDe(bloqueClaro);
const sinVersionClara = enOscuro.filter((v) => !enClaro.includes(v));

revisar("ninguna variable de color se quedo sin version clara", sinVersionClara, []);
revisar("y el claro no inventa variables que el oscuro no tenga",
  enClaro.filter((v) => !enOscuro.includes(v)), []);

/* --- NINGUN AVISO SE QUEDA INVISIBLE SOBRE EL CREMA ---------------------- */

// EL BUG DEL 12/11/2026. El tablero usa ~120 `text-amber-300`, `text-rose-300`,
// `text-emerald-300` para los avisos. Son tonos 100-400 de Tailwind, elegidos
// para brillar sobre casi negro, y sobre el crema desaparecen: el panel de
// fechas de Marketing quedo con el titulo y las dos fechas ilegibles, amarillo
// claro sobre amarillo claro.
//
// El CSS los remapea dentro del tema claro. Esta prueba es lo que hace que ese
// remapeo no se despegue solo: recorre los componentes, junta cada tono claro
// que se este usando de verdad y falla si alguno no esta cubierto. Una pantalla
// nueva que estrene `text-amber-500` rompe acá y no en la cara de quien la abra.

function archivos(dir: string): string[] {
  const salida: string[] = [];
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    const camino = `${dir}/${entrada.name}`;
    if (entrada.isDirectory()) salida.push(...archivos(camino));
    else if (/\.tsx?$/.test(entrada.name)) salida.push(camino);
  }
  return salida;
}

const TONO_CLARO = /\btext-(amber|rose|emerald|sky|yellow|red|orange|green|blue|violet|cyan|pink|teal|indigo|purple|lime|fuchsia|neutral|slate|zinc|gray|stone)-(50|100|200|300|400)\b/g;

const usados = new Set<string>();
for (const archivo of [...archivos("components"), ...archivos("app")]) {
  for (const m of readFileSync(archivo, "utf8").matchAll(TONO_CLARO)) usados.add(m[0]);
}

// Que la prueba sirva de algo: si el grep no encuentra nada es que el patron se
// rompio, no que el tablero dejo de usar colores.
revisar("hay tonos claros que cubrir", usados.size > 5, true);

const sinCubrir = [...usados].filter((clase) => !css.includes(`.${clase},`) && !css.includes(`.${clase})`));
revisar("ningun tono claro quedo sin remapear en el tema claro", sinCubrir.sort(), []);

console.log(
  FALLOS.length ? `\n${FALLOS.length} FALLARON: ${FALLOS.join(", ")}` : "\nTODO OK",
);
process.exit(FALLOS.length ? 1 : 0);
