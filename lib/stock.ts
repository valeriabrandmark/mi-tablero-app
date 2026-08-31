/**
 * Reglas del tablero de Stock.
 *
 * ---------------------------------------------------------------------------
 * DE DÓNDE SALE ESTO
 *
 * Reemplaza la planilla `Stock_ QUO SALES.xlsx` con la que se deciden las
 * recompras: 45 hojas y 8.099 filas, armadas pegando a mano exportaciones de
 * Sigma, de Digip y de Mercado Libre. Todo eso ya se carga solo en la base, así
 * que acá se rehacen las mismas cuentas sobre los datos que ya están.
 *
 * TRES COSAS SE HACEN DISTINTO, y las tres son a propósito:
 *
 * 1. LA PLANILLA LLAMA "STOCK MAX" A UN RITMO DE VENTA. En `BD Stock MAX 08-26`
 *    la columna se calcula como `=(Cantidad/4)*1`: es el promedio mensual de
 *    los últimos cuatro meses, no un tope de compra. El nombre invita a leerlo
 *    al revés. Acá se llama `ritmoDiario` y se dice sobre qué ventana se midió.
 *
 * 2. LA MISMA CUENTA DABA DISTINTO EN TRES HOJAS. `Tablero` divide por 30 días,
 *    `A,B y C` por 60 y contra una foto de nueve meses atrás, `TableroOfertas`
 *    por 60 contra la de agosto. Acá hay UNA definición y la ventana se elige
 *    en pantalla, así que el número siempre dice de dónde viene.
 *
 * 3. UN SKU DE CONSUMO INTERNO SE COMÍA EL 80 % DEL TOTAL. `CI123` figura con
 *    4.999 unidades a $450.000 de costo — $2.249 millones, contra $558 millones
 *    de todo el resto junto. Ver `PROVEEDORES_NO_MERCADERIA`.
 */

/**
 * Cuántos días de venta se quiere tener en stock. Definido por el negocio.
 *
 * Es UN número y no dos porque la planilla usaba 30 en una hoja y 60 en otra,
 * y eso no es un matiz: cambia si un artículo aparece sobrado o faltante.
 */
export const COBERTURA_OBJETIVO_DIAS = 30;

/**
 * Cuánto tarda la mercadería desde que se compra hasta que está en el depósito.
 *
 * Promedio: depende del proveedor y todavía no tenemos el plazo de cada uno.
 * Cuando se carguen los reales, esto pasa a ser el valor por defecto de los que
 * falten en vez de la regla para todos.
 */
export const PLAZO_REPOSICION_DIAS = 10;

/**
 * Sobre cuántos días se mide el ritmo de venta.
 *
 * 120 por defecto porque es lo que venía usando la planilla —promedio de los
 * últimos cuatro meses—, así los números arrancan siendo comparables con lo que
 * ya se venía mirando. Las ventanas cortas reaccionan antes a un cambio de
 * demanda; las largas aguantan mejor un mes raro.
 */
export const VENTANAS_RITMO = [30, 60, 90, 120] as const;
export type VentanaRitmo = (typeof VENTANAS_RITMO)[number];
export const VENTANA_POR_DEFECTO: VentanaRitmo = 120;

/**
 * Proveedores cuyos artículos NO son mercadería y quedan afuera de todo.
 *
 * Es una lista negra corta y explícita, como `VENDEDORES_INCLUIDOS` en
 * mayoristas. Saca 27 SKU, pero uno solo —`CI123 · CONSUMO INTERNO`, 4.999
 * unidades a $450.000— vale $2.249 millones contra $558 millones de todo el
 * resto del depósito. Con él adentro, cualquier total de plata inmovilizada
 * está multiplicado por cinco y no hay forma de darse cuenta mirando.
 *
 * NO alcanza con filtrar por descripción: "CONSUMO INTERNO" es un texto libre y
 * mañana puede escribirse distinto. El proveedor es un campo del maestro.
 */
export const PROVEEDORES_NO_MERCADERIA = ["AGENCIA PROVEEDORES", "PROVEEDOR INICIAL"];

/**
 * Los dos depósitos, y la opción de mirarlos juntos.
 *
 * EL FILTRO CAMBIA EL STOCK, NO LA DEMANDA. Al elegir "Full", la cobertura pasa
 * a decir cuántos días de venta cubre lo que hay en Mercado Libre — pero contra
 * la venta de TODOS los canales, no sólo la de Meli. Es a propósito: no existe
 * en los datos un mapa depósito → canal (Tienda Nube y mayorista salen los dos
 * de Tucumán), así que inventarlo daría un número que parece más preciso de lo
 * que es.
 */
export const DEPOSITOS = [
  { clave: "ambos", label: "Los dos" },
  { clave: "tucuman", label: "Tucumán" },
  { clave: "full", label: "Meli Full" },
] as const;

export type ClaveDeposito = (typeof DEPOSITOS)[number]["clave"];
export const DEPOSITO_POR_DEFECTO: ClaveDeposito = "ambos";

/**
 * Tramos de cobertura. NO son cortes redondos: cada uno es una decisión
 * distinta, y por eso los bordes son los dos números del negocio.
 *
 *   quiebre    se agota antes de que llegue una reposición pedida hoy
 *   ajustado   alcanza para reponer, pero no llega al objetivo
 *   objetivo   la zona donde se quiere estar
 *   sobra      más del doble del objetivo: plata quieta, todavía sin drama
 *   excedido   más de cuatro meses: es el candidato a liquidar
 *   sin_venta  no vendió una unidad en toda la ventana
 */
export const TRAMOS_COBERTURA = [
  { clave: "quiebre", label: "Quiebre", desc: `Menos de ${PLAZO_REPOSICION_DIAS} días` },
  { clave: "ajustado", label: "Ajustado", desc: `${PLAZO_REPOSICION_DIAS} a ${COBERTURA_OBJETIVO_DIAS} días` },
  { clave: "objetivo", label: "En objetivo", desc: `${COBERTURA_OBJETIVO_DIAS} a 60 días` },
  { clave: "sobra", label: "De sobra", desc: "60 a 120 días" },
  { clave: "excedido", label: "Excedido", desc: "Más de 120 días" },
  { clave: "sin_venta", label: "Sin venta", desc: "Ninguna en la ventana" },
] as const;

export type ClaveTramoCobertura = (typeof TRAMOS_COBERTURA)[number]["clave"];

/**
 * En qué tramo cae un artículo.
 *
 * `null` es "no vendió en la ventana", que NO es lo mismo que una cobertura
 * enorme: puede ser un artículo recién ingresado que todavía no tuvo su primera
 * venta. Mezclarlos haría que un producto nuevo aparezca como candidato a
 * liquidar el día que llega.
 */
export function tramoCobertura(dias: number | null): ClaveTramoCobertura {
  if (dias == null) return "sin_venta";
  if (dias < PLAZO_REPOSICION_DIAS) return "quiebre";
  if (dias < COBERTURA_OBJETIVO_DIAS) return "ajustado";
  if (dias < 60) return "objetivo";
  if (dias <= 120) return "sobra";
  return "excedido";
}
