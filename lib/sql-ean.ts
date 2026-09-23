/**
 * Buscar un artículo por su código de barras, en cualquier tablero.
 *
 * ---------------------------------------------------------------------------
 * POR QUE HACE FALTA
 *
 * Los buscadores de los tableros miran el SKU y la descripción. Eso alcanza
 * cuando el dato que uno tiene en la mano es nuestro, pero muchas veces no lo
 * es: viene de un remito del proveedor, de una lista de precios, o de escanear
 * la caja. En todos esos casos el único número que hay es el EAN, y buscarlo
 * no encontraba nada — la pantalla contesta "sin datos" y parece que el
 * artículo no existe.
 *
 * ---------------------------------------------------------------------------
 * POR QUE UNA SUBCONSULTA Y NO UNA COLUMNA MAS
 *
 * El EAN vive en `bronze.sigma_articulos`. Algunos tableros ya tienen esa
 * tabla unida (Stock, Compras) y otros consultan `gold.fact_ventas`, que no
 * tiene EAN (Mercado Libre, Ventas Mayoristas). Escrito de las dos formas, el
 * buscador se comportaría distinto según la pantalla sin que nadie lo decida.
 *
 * Con la subconsulta es UNA sola forma para todos: son 8.265 artículos, y
 * Postgres la resuelve una vez y la usa como semi-join.
 */

/**
 * La condición que agrega "…o su EAN coincide" a un buscador.
 *
 * Devuelve `null` cuando el término NO TIENE NINGUN DIGITO, y eso no es una
 * optimización menor: un EAN es sólo números, así que buscar "shampoo" no
 * puede coincidir con ninguno. Sin el corte, cada búsqueda por texto pagaría
 * un recorrido del maestro para no encontrar nada.
 *
 * La comparación es por CONTENIDO y no exacta, igual que la del SKU y la de la
 * descripción: es común pegar sólo los últimos dígitos, o que el número venga
 * con un espacio de más.
 *
 * @param colSku  cómo se llama la columna de SKU en esa consulta (`sku`,
 *                `fv.sku`, `p.sku`…).
 * @param termino el texto que se está buscando, sin los `%`.
 * @param i       el número de parámetro donde ya está `%termino%`. Se reusa el
 *                mismo que el SKU y la descripción: es el mismo texto.
 */
export function clausulaEan(
  colSku: string,
  termino: string,
  i: number,
): string | null {
  if (!/\d/.test(termino)) return null;
  return (
    `${colSku} in (select trim(id) from bronze.sigma_articulos` +
    ` where nullif(trim("eanUnidad"), '') ilike $${i})`
  );
}

/**
 * El buscador completo de un tablero de artículos: SKU, descripción y EAN.
 *
 * Los tres tableros de stock y el de Compras lo arman igual, así que vive acá
 * una sola vez. `colProducto` cambia de nombre entre pantallas (`producto`,
 * `descripcion`), por eso se pasa.
 */
export function buscadorDeArticulo(
  termino: string,
  i: number,
  colSku = "sku",
  colProducto = "producto",
): string {
  const partes = [`${colSku} ilike $${i}`, `${colProducto} ilike $${i}`];
  const ean = clausulaEan(colSku, termino, i);
  if (ean) partes.push(ean);
  return `(${partes.join(" or ")})`;
}
