/**
 * Pruebas del botón "Actualizar ahora". Sin base, sin red, sin navegador.
 *
 * POR QUÉ EXISTE. El botón decide qué mostrar según un TEXTO que devuelve una
 * función de Postgres que vive en el otro repo (`ops.despertar_orquestador`, en
 * tablero_quo/despertador.sql). Eso es un contrato entre dos repos que nadie
 * compila junto: el día que alguien reescriba ese mensaje, acá no falla nada
 * —compila igual— y el botón empieza a mentir en silencio.
 *
 * Lo que se fija acá es que sólo se mire EL PREFIJO (las tres formas que la
 * función puede devolver) y, sobre todo, que lo desconocido caiga en `error` y
 * no en `al_dia`: contestar "ya está al día" sin saberlo es inventar una buena
 * noticia y dejar la pantalla mostrando datos viejos con cara de frescos.
 *
 *     node --experimental-strip-types --import ./pruebas/registrar.mjs pruebas/actualizar.mts
 */

import { haceCuanto, interpretarDespertador } from "@/lib/actualizar";

const FALLOS: string[] = [];

function revisar(nombre: string, obtenido: unknown, esperado: unknown) {
  const ok = JSON.stringify(obtenido) === JSON.stringify(esperado);
  console.log(
    ok ? `OK  ${nombre}` : `MAL ${nombre}\n     esperado: ${esperado}\n     obtenido: ${obtenido}`,
  );
  if (!ok) FALLOS.push(nombre);
}

// --- Las tres respuestas que la función devuelve hoy ------------------------
//
// Copiadas tal cual de despertador.sql. Si alguna vez dejan de coincidir, esta
// prueba es la que lo va a decir.

revisar(
  "disparó una corrida",
  interpretarDespertador("DISPARADO: hacia 43 min que no corria"),
  "disparado",
);
revisar(
  "no hacía falta",
  interpretarDespertador("ok: corrio hace 3 min"),
  "al_dia",
);
revisar(
  "falta el token en Vault",
  interpretarDespertador("ERROR: falta el token en Vault"),
  "error",
);

// --- Lo que no se reconoce es un error, NUNCA un "ya está al día" -----------

revisar("un mensaje nuevo que nadie previó", interpretarDespertador("che, se cayó github"), "error");
revisar("la función no devolvió nada", interpretarDespertador(null), "error");
revisar("ni cadena vacía", interpretarDespertador(""), "error");
revisar("'OK' en mayúsculas no es el 'ok:' de la función",
  interpretarDespertador("OK todo bien"), "error");

// El texto llega de la base con espacios de más si alguien toca el `format`.
revisar("con espacios alrededor", interpretarDespertador("  DISPARADO: hacia 90 min  "), "disparado");

// --- El cartel de "cuándo se actualizó" -------------------------------------

revisar("nunca corrió", haceCuanto(null), "nunca");
revisar("recién", haceCuanto(0), "recién");
revisar("un rato", haceCuanto(7), "hace 7 min");
revisar("casi una hora", haceCuanto(59), "hace 59 min");
revisar("una hora justa", haceCuanto(60), "hace 1 h 0 min");
revisar("varias horas", haceCuanto(200), "hace 3 h 20 min");
revisar("un día", haceCuanto(60 * 25), "hace 1 día");
revisar("varios días", haceCuanto(60 * 24 * 3), "hace 3 días");

console.log(FALLOS.length ? `\n${FALLOS.length} FALLARON: ${FALLOS.join(", ")}` : "\nTODO OK");
process.exit(FALLOS.length ? 1 : 0);
