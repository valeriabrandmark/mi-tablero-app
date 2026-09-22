/**
 * Buscar dentro de las opciones de un filtro.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ESTO NO VIVE ADENTRO DEL COMPONENTE
 *
 * Es la única parte del selector que se puede equivocar en silencio. Que el
 * desplegable se abra y se cierre se ve; que "bu" no encuentre "Bubba" no se
 * ve hasta que alguien jura que una marca no está cargada. Acá abajo es una
 * función pura que se puede probar sin navegador, y `pruebas/coincide.mts` la
 * prueba con los casos reales del tablero.
 */

/**
 * El texto listo para comparar: sin mayúsculas, sin acentos y sin espacios de
 * más.
 *
 * LOS ACENTOS SE SACAN DE LOS DOS LADOS. Nadie escribe "Nestlé" con el acento
 * cuando está apurado filtrando, y "nestle" tiene que encontrarlo igual. Al
 * revés también: si la marca está cargada sin acento, escribirla con acento
 * tiene que andar.
 *
 * `NFD` parte cada letra acentuada en letra + marca, y el reemplazo se lleva
 * las marcas. Es el mismo rodeo que usa `nombreArchivo` en lib/compras.ts.
 */
export function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * Si una opción entra en lo que se está escribiendo.
 *
 * SE BUSCA EN CUALQUIER PARTE y no solo al principio. Los proveedores están
 * cargados con la razón social completa ("IMPROM S.A.", "DISTRIBUIDORA NOA
 * S.R.L."), así que quien busca "noa" espera encontrarla aunque no sea la
 * primera palabra. Con búsqueda por prefijo habría que acordarse de cómo
 * arranca cada nombre, que es justo lo que se quiere evitar.
 *
 * SE MIRA EL TEXTO VISIBLE Y TAMBIEN EL VALOR. Hay filtros donde no son lo
 * mismo —el de Empresa muestra "Quo Marketing" y por abajo guarda "0001"— y
 * ahí los dos son formas legítimas de buscar: quien conoce el código lo
 * escribe, quien conoce el nombre escribe el nombre.
 *
 * El término vacío deja pasar todo: mientras no se escribió nada, la lista es
 * la lista completa.
 */
export function coincide(
  valor: string,
  texto: string,
  termino: string,
): boolean {
  const buscado = normalizar(termino);
  if (!buscado) return true;
  return (
    normalizar(texto).includes(buscado) || normalizar(valor).includes(buscado)
  );
}

/**
 * A partir de cuántas opciones aparece el buscador.
 *
 * Con cinco marcas, un campo de texto encima de la lista es una cosa más que
 * leer para algo que se resuelve mirando. El número sale de la pantalla: en el
 * desplegable entran unas ocho opciones sin scrollear, así que el buscador
 * aparece justo cuando empieza a haber algo que no se ve.
 */
export const MINIMO_PARA_BUSCAR = 8;
