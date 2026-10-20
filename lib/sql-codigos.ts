/**
 * Buscar un artículo por LOS CODIGOS QUE NO SON NUESTROS, en cualquier tablero.
 *
 * ---------------------------------------------------------------------------
 * POR QUE HACE FALTA
 *
 * Los buscadores de los tableros miran el SKU y la descripción. Eso alcanza
 * cuando el dato que uno tiene en la mano es nuestro, pero muchas veces no lo
 * es: viene de un remito del proveedor, de su lista de precios, o de escanear
 * la caja. En todos esos casos el único número que hay es ajeno —el EAN, o el
 * código con el que el proveedor lo vende— y buscarlo no encontraba nada: la
 * pantalla contesta "sin datos" y parece que el artículo no existe.
 *
 * ---------------------------------------------------------------------------
 * SON DOS CODIGOS Y NO UNO, Y ESO SE APRENDIO TARDE
 *
 * Esto nació buscando sólo el EAN. El código del proveedor quedó afuera, y el
 * resultado fue un buscador que andaba A VECES: de los 7.722 artículos que
 * tienen código de compra cargado, escribirlo encontraba 1.938 —y por pura
 * casualidad, porque ese código era parte del EAN (1.654), del SKU (274) o de
 * la descripción (10)—. Los otros 5.801 no aparecían.
 *
 * Tres de cada cuatro veces no andaba, y cuando andaba no era por el motivo
 * que parecía. Eso es peor que no tenerlo: enseña a desconfiar del buscador
 * sin dar nunca una regla que explique cuándo creerle.
 *
 * ---------------------------------------------------------------------------
 * POR QUE UNA SUBCONSULTA Y NO UNA COLUMNA MAS
 *
 * Los dos códigos viven en `bronze.sigma_articulos`. Algunos tableros ya
 * tienen esa tabla unida (Stock, Compras) y otros consultan `gold.fact_ventas`,
 * que no los tiene (Mercado Libre, Ventas Mayoristas). Escrito de las dos
 * formas, el buscador se comportaría distinto según la pantalla sin que nadie
 * lo decida.
 *
 * Con la subconsulta es UNA sola forma para todos: son ~8.300 artículos, y
 * Postgres la resuelve una vez y la usa como semi-join.
 */

/**
 * La condición que agrega "…o alguno de sus códigos ajenos coincide".
 *
 * ---------------------------------------------------------------------------
 * EL EAN PIDE UN DIGITO Y EL CODIGO DEL PROVEEDOR NO
 *
 * Un EAN es sólo números, así que buscar "shampoo" no puede coincidir con
 * ninguno y esa parte se omite. El código del proveedor NO es así: de los
 * 7.722 cargados, 2.560 mezclan letras y números y 30 no tienen un solo
 * dígito. Aplicarle el mismo corte dejaría sin buscar justo a los que no se
 * pueden encontrar de ninguna otra forma.
 *
 * Por eso esta función ya no devuelve `null` nunca: siempre hay algo que
 * buscar. Lo que se ahorra con un término sin dígitos es la mitad de la
 * condición, no la consulta.
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
export function clausulaCodigosDelProveedor(
  colSku: string,
  termino: string,
  i: number,
): string {
  // EL CODIGO CON EL QUE EL PROVEEDOR LO VENDE. Va siempre: puede tener letras.
  const partes = [`nullif(trim("codigoCompra"), '') ilike $${i}`];

  // El EAN sólo si hay con qué. Ver arriba.
  if (/\d/.test(termino)) {
    partes.push(`nullif(trim("eanUnidad"), '') ilike $${i}`);
  }

  return (
    `${colSku} in (select trim(id) from bronze.sigma_articulos` +
    ` where ${partes.join(" or ")})`
  );
}

/**
 * El buscador completo de un tablero de artículos: SKU, descripción, código
 * del proveedor y EAN.
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
  const partes = [
    `${colSku} ilike $${i}`,
    `${colProducto} ilike $${i}`,
    clausulaCodigosDelProveedor(colSku, termino, i),
  ];
  return `(${partes.join(" or ")})`;
}
