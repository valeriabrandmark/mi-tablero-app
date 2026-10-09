/**
 * Los links que llevan de una fila del tablero a la pantalla de Mercado Libre
 * donde se contesta.
 *
 * POR QUÉ ESTÁN TODOS ACÁ Y NO DESPARRAMADOS EN LOS COMPONENTES
 *
 * Porque **ninguno de estos patrones está documentado por Mercado Libre**.
 * Se buscó y lo único que hay publicado es la API, que trabaja con ids y no
 * con enlaces. Los de abajo salen de cómo arma las URLs el panel de vendedor,
 * y eso es exactamente la clase de cosa que ML cambia sin avisar.
 *
 * Juntos en un archivo, el día que uno deje de andar se arregla en un lugar y
 * hay una prueba que dice qué tiene que devolver. Desparramados por los
 * componentes, se arreglan tres y queda el cuarto.
 *
 * CADA FUNCIÓN DICE SI ESTÁ CONFIRMADA O NO. Un link roto es peor que no
 * tener link: manda a la persona a una página en blanco en vez de dejarla
 * buscar por su cuenta. Los que no están confirmados se marcan abajo y hay
 * que verificarlos abriendo uno de verdad.
 */

/**
 * El sitio del vendedor. MLA es Argentina, que es la única cuenta que hay
 * hoy, pero el `site_id` viene en cada reclamo así que se deja parametrizado:
 * el día que haya una cuenta de otro país, los links no se rehacen.
 */
const DOMINIOS: Record<string, string> = {
  MLA: "mercadolibre.com.ar",
  MLU: "mercadolibre.com.uy",
  MLC: "mercadolibre.cl",
  MLB: "mercadolivre.com.br",
  MLM: "mercadolibre.com.mx",
};

const SITIO_POR_DEFECTO = "MLA";

export function dominio(sitio?: string | null): string {
  return DOMINIOS[sitio ?? SITIO_POR_DEFECTO] ?? DOMINIOS[SITIO_POR_DEFECTO];
}

/**
 * La venta, en el panel de vendedor. **Sin confirmar.**
 *
 * Es la pantalla desde la que se llega a todo lo demás de esa orden, así que
 * cuando no hay un link más preciso se cae acá.
 */
export function enlaceVenta(orden?: string | null, sitio?: string | null): string | null {
  if (!orden) return null;
  return `https://${dominio(sitio)}/ventas/${orden}/detalle`;
}

/**
 * La conversación post-venta. **Sin confirmar.**
 *
 * Va por PACK y no por orden, igual que la API: el pack agrupa las compras de
 * un mismo carrito. `ml_mensajes_orden` guarda la orden porque es lo que cruza
 * con las ventas, así que el que llama tiene que pasar el pack si lo tiene y
 * la orden si no —que es lo correcto cuando la compra fue de un solo
 * artículo, porque ahí el pack ES la orden.
 */
export function enlaceMensajes(
  packOrOrden?: string | null,
  sitio?: string | null,
): string | null {
  if (!packOrOrden) return null;
  return `https://${dominio(sitio)}/mensajes/${packOrOrden}`;
}

/**
 * El reclamo. **Sin confirmar, y es el que más importa verificar.**
 *
 * La API no publica una URL de reclamo. Lo que sí existe es la sección
 * Posventa → Reclamos del panel de vendedor, y desde la venta se llega al
 * reclamo en un clic. Por eso, mientras no esté confirmado, este link lleva a
 * LA VENTA y no a una URL de reclamo inventada: una pantalla de más es
 * molesto, una página en blanco es inservible.
 */
export function enlaceReclamo(
  orden?: string | null,
  sitio?: string | null,
): string | null {
  return enlaceVenta(orden, sitio);
}

/**
 * La publicación. **Este sí es confiable.**
 *
 * `https://articulo.<dominio>/MLA-123456789` redirige a la publicación real.
 * El guión después del prefijo del país no es decorativo: sin él la URL no
 * resuelve. Los ids vienen de la API como `MLA123456789`, todo junto.
 */
export function enlacePublicacion(
  itemId?: string | null,
  sitio?: string | null,
): string | null {
  if (!itemId) return null;
  const limpio = itemId.trim().toUpperCase();
  // Dos letras de país + una M, y después los números. Si no tiene esa forma
  // no se arma el link: mejor sin link que mandando a una página inexistente.
  const partes = /^([A-Z]{3})(\d+)$/.exec(limpio);
  if (!partes) return null;
  return `https://articulo.${dominio(sitio)}/${partes[1]}-${partes[2]}`;
}

/**
 * Las preguntas de una publicación, para contestarlas.
 *
 * Caen en la publicación misma: ahí están las preguntas y el cuadro para
 * responder, y es la única URL de este archivo que no depende del panel de
 * vendedor.
 */
export function enlacePregunta(
  itemId?: string | null,
  sitio?: string | null,
): string | null {
  return enlacePublicacion(itemId, sitio);
}
