/**
 * EL TEMA DEL TABLERO: oscuro (el de siempre) o claro.
 *
 * ---------------------------------------------------------------------------
 * EL OSCURO SIGUE SIENDO EL DEFAULT, Y NO SE MIRA EL DEL SISTEMA
 *
 * Es tentador arrancar con `prefers-color-scheme` y respetar lo que cada uno
 * tenga en su máquina. No se hace, por dos razones.
 *
 * La primera es que todo el mundo hoy ve el tablero en oscuro. Mirar el
 * sistema haría que, el día del deploy, a quien tenga Windows en claro --que
 * es lo que viene de fábrica-- le cambie la pantalla entera sin haber tocado
 * nada. Un cambio así se lee como "se rompió algo", no como "hay una función
 * nueva".
 *
 * La segunda es que el tablero se mira de a dos personas sobre la misma
 * pantalla y se comparan capturas. Que el tema dependa de la configuración de
 * cada máquina hace que dos capturas del mismo panel no se parezcan.
 *
 * Así que el claro se elige a mano, una vez, y queda.
 *
 * ---------------------------------------------------------------------------
 * SE GUARDA EN EL NAVEGADOR Y NO EN LA BASE
 *
 * Es una preferencia de cómo se ve, no un dato del negocio: no necesita viajar
 * entre máquinas ni auditarse. En `localStorage` se aplica ANTES del primer
 * pintado --ver el script del layout-- y eso es lo que evita el fogonazo
 * oscuro al entrar con el tema claro puesto. Guardándolo en la base habría que
 * esperar una consulta, y el fogonazo sería inevitable.
 */
export type Tema = "oscuro" | "claro";

export const TEMA_POR_DEFECTO: Tema = "oscuro";

/** La clave en `localStorage`. La repite el script del layout, que no importa. */
export const CLAVE_TEMA = "tablero-tema";

/** El atributo que se escribe en `<html>`. Lo lee el CSS. */
export const ATRIBUTO_TEMA = "tema";

export const ETIQUETA: Record<Tema, string> = {
  oscuro: "Oscuro",
  claro: "Claro",
};

/**
 * El tema que corresponde a lo que haya guardado, con el default para todo lo
 * demás.
 *
 * ACEPTA CUALQUIER COSA porque lo que viene de `localStorage` es texto que
 * puede haber escrito cualquiera: una versión vieja del tablero, otra pestaña,
 * la consola. Un valor que no conocemos cae en el default en vez de dejar el
 * `<html>` con un tema que el CSS no define, que se vería como una pantalla a
 * medio pintar.
 */
export function temaGuardado(valor: unknown): Tema {
  return valor === "claro" || valor === "oscuro" ? valor : TEMA_POR_DEFECTO;
}

/** El otro, para el botón que alterna. */
export function otroTema(tema: Tema): Tema {
  return tema === "claro" ? "oscuro" : "claro";
}

/**
 * Lo que hay que escribir en `<html>` para ese tema.
 *
 * El oscuro NO pone el atributo: es el default del CSS, y dejarlo sin atributo
 * hace que un navegador que no corrió el script --o que lo bloqueó-- muestre
 * el tema de siempre en vez de nada.
 *
 * `colorScheme` va junto porque es lo que pinta los controles nativos: los
 * `select`, las barras de scroll y el calendario del campo de fecha. Sin eso,
 * en claro, el desplegable de un filtro sigue abriéndose negro.
 */
export function atributosDeTema(tema: Tema): {
  atributo: string | null;
  colorScheme: "light" | "dark";
} {
  return tema === "claro"
    ? { atributo: "claro", colorScheme: "light" }
    : { atributo: null, colorScheme: "dark" };
}
