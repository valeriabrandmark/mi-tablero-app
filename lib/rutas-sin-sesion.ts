/**
 * Qué rutas atraviesan la barrera de sesión, y por qué cada una.
 *
 * ---------------------------------------------------------------------------
 * VIVE ACA Y NO EN `proxy.ts` POR EL MISMO MOTIVO QUE `lib/permisos.ts`: es
 * una regla, no plomería de middleware. Acá no se importa nada de Next, así
 * que se puede probar con `node` sin levantar el servidor -- y esta regla es
 * de las que hay que poder probar, porque equivocarse es abrir el tablero.
 */

/** Rutas accesibles sin sesión: no hay nada que proteger detrás. */
export const RUTAS_PUBLICAS = [
  "/login",
  "/auth-no-configurada",
  "/recuperar",
  // El canje del link del mail: llega SIN sesión, esa es la idea.
  "/auth/confirmar",
  // Se llega con la sesión de recuperación, pero también hay que poder entrar
  // sin ella para mostrar el cartel de "este link ya no sirve".
  "/nueva-contrasena",
];

/**
 * Rutas que NO llevan sesión porque traen su propia llave.
 *
 * NO SON PUBLICAS Y POR ESO ESTAN APARTE. Las de arriba se abren sin nada.
 * Estas se rechazan igual que cualquier otra, sólo que el que decide es la
 * ruta --comparando un token compartido-- y no esta barrera.
 *
 * POR QUE HIZO FALTA. `/api/precios-tn/planilla` la llama un Apps Script
 * desde la planilla de markup. Un Apps Script corre en Google, sin cookie del
 * tablero, así que la barrera lo frenaba con "No autenticado" ANTES de que la
 * ruta pudiera mirar su token.
 *
 * Desde afuera eso se veía como un token mal puesto, y se cambió tres veces
 * un token que estaba bien: el navegador SI pasaba --tiene la sesión-- así
 * que la MISMA URL contestaba una cosa desde el navegador y otra desde el
 * script. Lo que se podía mirar nunca era lo que fallaba.
 *
 * AGREGAR ALGO ACA ES SACARLE LA SESION A UNA RUTA. Sólo va si la ruta
 * verifica su propia llave y niega cuando falta -- incluso cuando la variable
 * del token no está configurada, que es cuando hay que negar todo y no dejar
 * pasar todo.
 *
 * SE COMPARAN ENTERAS, no por prefijo: con `startsWith` cualquier cosa
 * colgada abajo entraría gratis.
 */
export const RUTAS_CON_LLAVE_PROPIA = [
  "/api/precios-tn/planilla",
  // La planilla de Marketing (apps-script/planilla-marketing.gs) manda su foto
  // y pide la venta por cupón con MKT_PLANILLA_TOKEN. Verifica su llave y
  // niega todo si la variable no está cargada.
  "/api/marketing/planilla",
];

/** Si esta ruta puede contestar sin que haya una sesión. */
export function esPublica(pathname: string): boolean {
  return (
    RUTAS_PUBLICAS.some((r) => pathname === r || pathname.startsWith(`${r}/`)) ||
    RUTAS_CON_LLAVE_PROPIA.includes(pathname)
  );
}
