import { unstable_cache } from "next/cache";
import { queryOne } from "@/lib/db";

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
 * Con esto, todas las visitas comparten UNA sola ejecución. Diez personas pasan
 * a costar lo que costaba una.
 *
 * ---------------------------------------------------------------------------
 * LA CLAVE LLEVA LA VERSION DE LOS DATOS, Y ESO ES TODO EL DISEÑO
 *
 * Antes esto cacheaba 60 segundos a secas. Funcionaba, pero se quedaba corto
 * por los dos lados a la vez.
 *
 * CORTO PARA ARRIBA: los tableros leen tablas que sólo cambian cuando corre el
 * pipeline, una vez por hora. Entre corrida y corrida el resultado de una
 * consulta es literalmente el mismo, así que una persona navegando volvía a
 * pagar los tres segundos cada minuto sin ninguna razón.
 *
 * CORTO PARA ABAJO: si alguien fuerza una actualización, un TTL de 60 segundos
 * le muestra datos viejos justo cuando acaba de pedir los nuevos. El botón
 * parecería no funcionar.
 *
 * Por eso la clave lleva CUANDO TERMINO EL PIPELINE por última vez. Mientras no
 * corra, todos comparten la misma entrada; apenas corre, la clave cambia sola y
 * la próxima consulta lee la base. No hay invalidación que mantener, ni TTL que
 * adivinar, ni ventana en la que se puedan ver datos viejos.
 *
 * ---------------------------------------------------------------------------
 * CUIDADO: SOLO PARA DATOS QUE NO DEPENDEN DE QUIEN MIRA
 *
 * La clave son los ARGUMENTOS de la función, no el usuario. Hoy eso es correcto
 * porque el permiso se chequea en la ruta ANTES de llamar acá, y con los mismos
 * filtros todos los que tienen permiso ven lo mismo.
 *
 * El día que una consulta devuelva datos distintos según el usuario, NO se
 * puede envolver acá sin meter el usuario en la clave. Si no, una persona ve
 * los números de otra.
 *
 * Por lo mismo quedan AFUERA a propósito las consultas de Precios TN y las de
 * las órdenes de compra: ahí escribe la aplicación, y el dato tiene que cambiar
 * en el momento en que alguien aprueba o manda algo, no cuando corra el
 * pipeline. Y `getArticulosParaOrden` tampoco, porque es el precio que viaja al
 * ERP: eso se lee fresco siempre.
 */

/**
 * Cuánto puede vivir una entrada aunque la versión no cambie.
 *
 * NO es el tiempo que los datos pueden quedar viejos --de eso se encarga la
 * versión-- sino cada cuánto se limpia una entrada que nadie va a volver a
 * pedir: la de un filtro raro de una corrida de hace tres horas. Por eso es
 * holgado; con el TTL de 60 segundos de antes, el trabajo se repetía por reloj.
 */
const VIDA_SEGUNDOS = 15 * 60;

/**
 * Cuándo terminó bien el pipeline por última vez, como texto para la clave.
 *
 * Sale de `ops.estado`, la MISMA fila que mira `ops.despertar_orquestador` para
 * decidir si hay que disparar una corrida. Es una consulta de una fila sobre una
 * tabla de tres: ~1 ms, y ahorra varias de tres segundos.
 *
 * Si falla o no hay nada, devuelve "sin-version" y la caché sigue funcionando:
 * todas las respuestas comparten esa clave igual, y lo peor que pasa es que una
 * entrada viva hasta que VIDA_SEGUNDOS la limpie. Preferible a tirar la
 * pantalla abajo porque no se pudo leer un timestamp.
 */
async function versionDeDatos(): Promise<string> {
  try {
    const fila = await queryOne<{ v: string | null }>(
      "select to_char(actualizado, 'YYYYMMDDHH24MISS') as v " +
        "from ops.estado where clave = 'pasos'",
    );
    return fila?.v ?? "sin-version";
  } catch {
    return "sin-version";
  }
}

export function cacheado<A extends unknown[], R>(
  clave: string,
  fn: (...args: A) => Promise<R>,
): (...args: A) => Promise<R> {
  // El envoltorio se arma en cada llamada y no una vez al importar el módulo,
  // porque la versión es parte de la clave y cambia cuando corre el pipeline.
  // Armado una sola vez, la clave quedaría congelada en la versión que había
  // cuando arrancó la lambda.
  return async (...args: A): Promise<R> => {
    const version = await versionDeDatos();
    return unstable_cache(fn, [clave, version], {
      revalidate: VIDA_SEGUNDOS,
      tags: ["tablero"],
    })(...args);
  };
}
