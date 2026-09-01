/**
 * Reglas de la pantalla de Antigüedad de stock.
 *
 * ---------------------------------------------------------------------------
 * SON DOS PREGUNTAS DISTINTAS, Y CADA DEPÓSITO CONTESTA UNA SOLA.
 *
 *   Mercado Libre Full  ->  hace cuánto que la mercadería está parada
 *   Tucumán (Digip)     ->  cuándo se vence
 *
 * No es una decisión de diseño sino lo que hay: Mercado Libre no informa el
 * vencimiento de lo que guarda, y Digip no guarda la historia de movimientos
 * con la que se podría reconstruir hace cuánto entró cada unidad. Mostrar las
 * dos columnas para los dos depósitos daría dos columnas vacías que se leerían
 * como "no hay problema".
 *
 * LA ANTIGÜEDAD DE FULL NO ES LA DE MERCADO LIBRE. La calcula ml_antiguedad.py
 * en tablero_quo reconstruyendo el libro de operaciones del inventario por
 * FIFO, porque la API no tiene el campo. El cargo por almacenamiento prolongado
 * que factura Mercado Libre usa un umbral QUE DEPENDE DE LA CATEGORÍA —un
 * perfume puede entrar a los 60 días y una crema a los 120— y ese umbral no
 * viene por API. Acá el corte es 120 para todos.
 */

/** A partir de cuántos días una unidad cuenta como vieja. Ver arriba: es un piso. */
export const DIAS_ANTIGUEDAD_ALERTA = 120;

/**
 * Los tramos de antigüedad en Full, en el mismo orden y con los mismos cortes
 * con los que ml_antiguedad.py guarda las columnas. `columna` es literalmente
 * el nombre en `bronze.ml_stock_antiguedad`: escrito en un solo lado, no puede
 * quedar la etiqueta de un tramo sobre las unidades de otro.
 */
export const TRAMOS_ANTIGUEDAD = [
  { clave: "0_30", label: "0 a 30 días", columna: "u_0_30" },
  { clave: "31_60", label: "31 a 60 días", columna: "u_31_60" },
  { clave: "61_90", label: "61 a 90 días", columna: "u_61_90" },
  { clave: "91_120", label: "91 a 120 días", columna: "u_91_120" },
  { clave: "mas_120", label: `Más de ${DIAS_ANTIGUEDAD_ALERTA} días`, columna: "u_mas_120" },
] as const;

export type ClaveTramoAntiguedad = (typeof TRAMOS_ANTIGUEDAD)[number]["clave"];

/**
 * Los tramos de vencimiento en Tucumán.
 *
 * "Vencido" primero y aparte porque no es un tramo más: esa mercadería ya no se
 * puede vender, y Digip la saca de `stock.disponible` —lo que explica, unidad
 * por unidad, la diferencia entre lo que hay en las ubicaciones y lo que el
 * sistema declara disponible.
 *
 * "Sin fecha" es un tramo y no un cero: son 108 unidades hoy, y esconderlas
 * haría que los tramos no sumen el total sin que nada lo explique.
 */
export const TRAMOS_VENCIMIENTO = [
  { clave: "vencido", label: "Vencido", desc: "La fecha ya pasó", accionable: true },
  { clave: "30", label: "Vence este mes", desc: "Dentro de 30 días", accionable: true },
  { clave: "90", label: "31 a 90 días", desc: "El trimestre", accionable: true },
  { clave: "180", label: "91 a 180 días", desc: "El semestre", accionable: true },
  { clave: "mas_180", label: "Más de 180 días", desc: "Sin apuro", accionable: false },
  { clave: "sin_dato", label: "Sin fecha", desc: "Digip no la informa", accionable: false },
] as const;

/**
 * `accionable` es lo que se grafica, y NO es una preferencia estética.
 *
 * El 92 % de la mercadería vence a más de 180 días: dibujada junto a lo que
 * vence este mes, esa barra se lleva toda la escala y las tres que exigen una
 * decisión quedan pegadas al piso, indistinguibles de cero. El gráfico muestra
 * lo que se puede decidir esta semana; la leyenda de abajo sigue teniendo los
 * seis tramos con sus unidades, así que nada queda escondido.
 */

export type ClaveTramoVencimiento = (typeof TRAMOS_VENCIMIENTO)[number]["clave"];

/** Ventana fija del ritmo de venta de esta pantalla, como la de Mercado Libre. */
export const VENTANA_VENTAS_DIAS = 30;

/** A cuántos días de vencer se enciende la alarma. */
export const DIAS_POR_VENCER_ALERTA = 90;
