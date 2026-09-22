/**
 * Pedirle al orquestador que corra ahora, desde el tablero.
 *
 * ---------------------------------------------------------------------------
 * POR QUE PASA POR LA BASE Y NO POR LA API DE GITHUB
 *
 * El botón de Precios TN dispara su workflow con un token de GitHub guardado en
 * Vercel (`GITHUB_TOKEN_PRECIOS`). Acá no hace falta, y no ponerlo es mejor por
 * tres motivos:
 *
 *   1. YA EXISTE QUIEN SABE HACERLO. `ops.despertar_orquestador` vive en la
 *      base desde que el scheduler de GitHub dejó al tablero ocho horas sin
 *      actualizar el 27/08. Lee el token de Vault y le pega a la API. Un
 *      segundo camino sería un segundo token que rotar, y dos lugares donde
 *      mirar cuando el disparo falle.
 *
 *   2. LA ESPERA SALE GRATIS Y ES LA CORRECTA. La función no corre si el
 *      pipeline terminó hace menos de `umbral_minutos`, y mide eso contra
 *      `ops.estado`, o sea contra CUANDO SE ACTUALIZARON LOS DATOS. Así la
 *      espera cuenta cualquier corrida —la automática de la hora o la que pidió
 *      otra persona hace tres minutos— y no sólo los botonazos de quien está
 *      mirando. Apretar el botón con datos de hace dos minutos no tiene sentido
 *      aunque nadie haya apretado nada antes.
 *
 *   3. NO HAY QUE CARGAR NADA EN VERCEL. La app ya se conecta con el rol
 *      `postgres`, que es el dueño de la función.
 *
 * Lo que se pierde es la barra de avance paso a paso que sí tiene Precios TN:
 * sin la API de GitHub no sabemos en qué paso va. A cambio, el final que
 * reporta esta pantalla es mejor: no "el workflow terminó" sino "los datos que
 * estás mirando cambiaron", que es lo único que le importa a quien apretó.
 */

/**
 * Cuántos minutos tienen que haber pasado desde la última actualización para
 * que el botón pida una corrida nueva.
 *
 * 15 y no 60 porque no es un tope de gasto sino un "esto ya está fresco": el
 * pipeline corre solo cada hora, tarda ~2 minutos y el repo es público, así que
 * las corridas de Actions no se pagan. Lo que se evita es la cola de corridas
 * que deja un botón apretado por cinco personas a la vez — y eso ya lo resuelve
 * el `concurrency` del workflow, así que esto es el cinturón del cinturón.
 */
export const ESPERA_MINUTOS = 15;

/**
 * La ruta del botón. Vive acá y no escrita a mano en cada lado porque la usan
 * tres archivos que no se conocen entre sí —la pantalla que la llama, la regla
 * de permiso de `permisos.ts` y esta descripción— y separarlos en silencio
 * dejaría el botón pidiendo una ruta que nadie autoriza.
 *
 * El archivo que la sirve es `app/api/actualizar/route.ts`; eso sí es la
 * carpeta y no se puede importar.
 */
export const RUTA_ACTUALIZAR = "/api/actualizar";

/**
 * Qué contestó `ops.despertar_orquestador`.
 *
 * - `disparado`: pidió una corrida.
 * - `al_dia`:    no hacía falta, los datos son más nuevos que la espera.
 * - `error`:     no pudo (hoy sólo pasa si falta el token en Vault).
 */
export type ResultadoDespertador = "disparado" | "al_dia" | "error";

/**
 * Traduce el texto que devuelve la función de Postgres.
 *
 * SE MIRA EL PREFIJO Y NO EL TEXTO ENTERO. La función devuelve tres formas
 * ('DISPARADO: hacia N min que no corria', 'ok: corrio hace N min',
 * 'ERROR: ...') y lo único estable ahí es con qué empieza: los números y la
 * redacción pueden cambiar sin que nadie se acuerde de este archivo.
 *
 * Y CUALQUIER COSA RARA ES 'error', no 'al_dia'. Si algún día la función
 * contesta algo que no reconocemos, decir "ya está al día" sería inventar una
 * buena noticia: la pantalla mostraría datos viejos con cara de frescos. Un
 * error se ve, se pregunta y se arregla.
 */
export function interpretarDespertador(texto: string | null | undefined): ResultadoDespertador {
  const limpio = (texto ?? "").trim();
  if (limpio.startsWith("DISPARADO")) return "disparado";
  if (limpio.startsWith("ok:")) return "al_dia";
  return "error";
}

/** Cuánto hace, en palabras. `null` si nunca corrió. */
export function haceCuanto(minutos: number | null): string {
  if (minutos === null) return "nunca";
  if (minutos < 1) return "recién";
  if (minutos < 60) return `hace ${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `hace ${horas} h ${minutos % 60} min`;
  const dias = Math.floor(horas / 24);
  return dias === 1 ? "hace 1 día" : `hace ${dias} días`;
}

/** Lo que la pantalla recibe de `/api/actualizar`. */
export type EstadoActualizacion = {
  /** Cambia cuando el pipeline escribe algo. Es la misma que usa la caché. */
  version: string | null;
  /** Minutos desde la última actualización de datos. `null` si nunca corrió. */
  minutos: number | null;
  /** Después de cuántos minutos el botón vuelve a pedir una corrida. */
  esperaMinutos: number;
};
