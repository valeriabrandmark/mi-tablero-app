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

import {
  cambioDesdeElPedido,
  faltanMinutos,
  haceCuanto,
  interpretarDespertador,
  type EstadoActualizacion,
} from "@/lib/actualizar";

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

// --- La cuenta regresiva de "cuándo puedo volver a pedir" -------------------
//
// El caso que la hizo falta: se edita la planilla del sell in, se sube con el
// menú y se aprieta "Actualizar ahora". Si el pipeline corrió hace 4 minutos la
// función de la base no dispara nada y contesta "ok:", que es verdad y a la vez
// la respuesta equivocada --los descuentos nuevos no están--. Lo único útil que
// se puede decir ahí es EN CUANTO se va a poder, y para eso tiene que bajar
// solo.

const est = (minutos: number | null): EstadoActualizacion => ({
  version: "20260923073208",
  minutos,
  esperaMinutos: 15,
  sellInPendiente: false,
  corrida: "20260923073500",
});

revisar("recién corrió: falta toda la espera", faltanMinutos(est(0)), 15);
revisar("corrió hace 4: faltan 11", faltanMinutos(est(4)), 11);
revisar("corrió hace 14: falta 1", faltanMinutos(est(14)), 1);
revisar("justo en el borde: ya se puede", faltanMinutos(est(15)), 0);
// Nunca negativo: con el pipeline parado hace horas, "faltan -180 min" sería
// un cartel roto en la pantalla.
revisar("hace mucho que no corre", faltanMinutos(est(200)), 0);

// Ante la duda se deja pedir: hacer esperar por algo que no se sabe es peor que
// una corrida de más, que además la función de la base vuelve a filtrar.
revisar("nunca corrió", faltanMinutos(est(null)), 0);
revisar("todavía no llegó el estado", faltanMinutos(null), 0);


// --- LAS DOS SEÑALES: "llego algo" contra "termino" ------------------------
//
// EL CASO QUE LAS HIZO FALTA. `version` cambia con CADA paso que termina, así
// que sube apenas el pipeline arranca. Medido el 02/11: la corrida empezó
// 23:59:33, el primer paso escribió a los 29 segundos y la corrida terminó
// 00:07:22. El botón decía "Listo: datos nuevos" a los 30 segundos de una
// corrida de ocho minutos, con el catálogo de Mercado Libre y la reposición de
// Full todavía sin traer, y quien lo leía daba por terminada una corrida que
// recién empezaba.

const ahora = (version: string | null, corrida: string | null): EstadoActualizacion => ({
  version,
  minutos: 0,
  esperaMinutos: 15,
  sellInPendiente: false,
  corrida,
});

const alPedir = { version: "V1", corrida: "C1" };

revisar("sin cambios no pasa nada", cambioDesdeElPedido(ahora("V1", "C1"), alPedir), "nada");
revisar(
  "un paso escribió: llegó algo, pero no terminó",
  cambioDesdeElPedido(ahora("V2", "C1"), alPedir),
  "llego_algo",
);
revisar(
  "cambió la marca de fin: terminó",
  cambioDesdeElPedido(ahora("V2", "C2"), alPedir),
  "termino",
);

// EL FINAL GANA SOBRE TODO. Si la corrida terminó no importa qué pasó con
// `version` -- puede que el último paso no escribiera nada porque no había
// nada nuevo que traer, y aun así la corrida terminó.
revisar(
  "terminó sin que cambiara la versión",
  cambioDesdeElPedido(ahora("V1", "C2"), alPedir),
  "termino",
);

// --- UN ORQUESTADOR QUE TODAVIA NO ESCRIBE LA MARCA ------------------------
//
// Es el estado del mundo entre desplegar el tablero y mergear el cambio del
// otro repo. Sin este caso, el botón esperaría los 25 minutos de su paciencia
// un final que nadie va a escribir, y los dos repos tendrían que salir juntos.

const sinMarca = { version: "V1", corrida: null };

revisar(
  "sin marca de fin, una versión nueva es el final",
  cambioDesdeElPedido(ahora("V2", null), sinMarca),
  "termino",
);
revisar(
  "y sin cambios sigue siendo nada",
  cambioDesdeElPedido(ahora("V1", null), sinMarca),
  "nada",
);

// LA PRIMERA CORRIDA DESPUES DE DESPLEGAR EL ORQUESTADOR: al apretar no había
// marca, y la corrida escribe la primera. Tiene que leerse como el final que
// es, no como "llegó algo".
revisar(
  "la primera marca de la historia es un final",
  cambioDesdeElPedido(ahora("V2", "C1"), sinMarca),
  "termino",
);

console.log(FALLOS.length ? `\n${FALLOS.length} FALLARON: ${FALLOS.join(", ")}` : "\nTODO OK");
process.exit(FALLOS.length ? 1 : 0);
