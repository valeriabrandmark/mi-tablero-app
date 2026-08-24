import { unstable_cache } from "next/cache";

/**
 * Caché de las consultas del tablero.
 *
 * POR QUE
 * Las rutas de la API están en `force-dynamic`: cada visita ejecuta el juego
 * completo de consultas. Con una sola persona mirando eso está bien; con cinco
 * mirando lo mismo al mismo tiempo, es cinco veces el trabajo para devolver
 * números idénticos. El 24/08 el tablero saturó el disco de Supabase con uso
 * normal, y el orquestador estuvo doce corridas seguidas en rojo por eso.
 *
 * Con esto, todas las visitas dentro de la misma ventana comparten UNA sola
 * ejecución. Diez personas pasan a costar lo que costaba una.
 *
 * POR QUE 60 SEGUNDOS
 * El orquestador escribe una vez por hora. Cachear un minuto es invisible para
 * quien mira —el dato ya venía de hasta una hora atrás— y corta de raíz el
 * problema de la concurrencia. Subirlo más no ganaría casi nada: lo que hace
 * la diferencia es que varias visitas simultáneas se junten en una.
 *
 * CUIDADO: SOLO PARA DATOS QUE NO DEPENDEN DE QUIEN MIRA
 * La clave del caché son los ARGUMENTOS de la función, no el usuario. Hoy eso
 * es correcto porque el permiso se chequea en la ruta antes de llamar acá, y
 * con los mismos filtros todos los que tienen permiso ven lo mismo.
 *
 * El día que una consulta devuelva datos distintos según el usuario —el
 * comentario de app/api/objetivos/route.ts ya avisa que va a pasar cuando cada
 * vendedor vea solo lo suyo— NO se puede envolver acá sin meter el usuario en
 * la clave. Si no, una persona ve los números de otra.
 */
const SEGUNDOS = 60;

export function cacheado<A extends unknown[], R>(
  clave: string,
  fn: (...args: A) => Promise<R>,
): (...args: A) => Promise<R> {
  return unstable_cache(fn, [clave], { revalidate: SEGUNDOS, tags: ["tablero"] });
}
