/**
 * Cómo se muestra una selección múltiple cuando hay MUCHO elegido.
 *
 * Vive acá y no adentro del componente para poder probarlo: son las dos
 * decisiones que hacen que un filtro de 350 marcas siga siendo legible, y las
 * dos se equivocan en silencio --una lista de 349 chips, o un botón que dice
 * "349 elegidos"-- sin que nada falle.
 */

/**
 * SI CONVIENE DAR VUELTA LA PRESENTACION: mostrar "todas menos X" en vez de
 * listar lo elegido.
 *
 * El desplegable tiene dos zonas: arriba lo excepcional, con su cruz, y abajo
 * la lista sobre la que se sigue trabajando. Mientras hay pocas elegidas eso
 * funciona --arriba las 3 marcas elegidas, abajo las 347 que faltan--, pero
 * apenas se usa "Seleccionar todo" se da vuelta: arriba quedarían 349 chips,
 * que es una pared, y abajo una sola opción.
 *
 * Pasada la mitad, lo excepcional es lo que está AFUERA. Entonces arriba van
 * las excluidas y abajo las elegidas, que es sobre las que se va a seguir
 * sacando. El corte en la mitad no es arbitrario: garantiza que la zona de
 * chips sea siempre la más corta de las dos, sin importar cuántas opciones
 * haya.
 *
 * `total > 1` porque con una sola opción dar vuelta no significa nada y deja
 * la lista de abajo vacía.
 */
export function invertirSeleccion(elegidos: number, total: number): boolean {
  return total > 1 && elegidos > total / 2;
}

/**
 * El texto del botón cerrado. Tiene que distinguir CUATRO estados que para la
 * consulta son dos, y por eso no alcanza con contar:
 *
 *   nada elegido      -> "Todos".  No hay filtro.
 *   todo elegido      -> "Todos (350)". Devuelve lo mismo que el anterior,
 *                        pero el próximo click saca una y ahí sí cambia. Si
 *                        los dos dijeran "Todos" no habría forma de saber si
 *                        destildar una va a hacer algo.
 *   casi todo elegido -> "Todos menos Braun" / "Todos menos 3". Es como lo
 *                        piensa quien lo armó, y "347 elegidos" no lo es.
 *   poco elegido      -> el nombre, o cuántas.
 */
export function resumenSeleccion({
  elegidos,
  excluidos,
  total,
  todos,
  nombre,
}: {
  elegidos: string[];
  excluidos: string[];
  total: number;
  todos: string;
  nombre: (valor: string) => string;
}): string {
  if (elegidos.length === 0) return todos;
  if (elegidos.length >= total) return `${todos} (${total})`;

  if (invertirSeleccion(elegidos.length, total)) {
    // Con una sola afuera se dice CUAL. Es el caso más común de todos --elegir
    // todo y sacar una-- y "Todos menos 1" obliga a abrir el desplegable para
    // saber cuál es justo cuando el nombre entra holgado.
    return excluidos.length === 1
      ? `${todos} menos ${nombre(excluidos[0])}`
      : `${todos} menos ${excluidos.length}`;
  }

  return elegidos.length === 1
    ? nombre(elegidos[0])
    : `${elegidos.length} elegidos`;
}
