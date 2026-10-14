import type { Metrica } from "@/lib/types";

const money = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const int = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 });

// DOS decimales, no uno. En este tablero los márgenes se mueven en décimas:
// la diferencia entre 7,45 % y 7,54 % se redondeaba al mismo "7,5 %" y dos
// artículos que hay que tratar distinto se leían iguales. Con dos decimales
// también se distingue un margen chico pero positivo de uno en cero.
const porcentaje = new Intl.NumberFormat("es-AR", {
  style: "percent",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** `$ 1.234.567` */
export function fmtMoneda(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return money.format(n).replace(/^ARS\s?/, "$ ");
}

/** Versión compacta para ejes de gráficos: `$ 1,2 M` / `$ 340 k` */
export function fmtMonedaCorta(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `$ ${int.format(n / 1_000_000)} M`;
  if (abs >= 1_000) return `$ ${int.format(n / 1_000)} k`;
  return `$ ${int.format(n)}`;
}

/** `1.234` */
export function fmtNumero(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return int.format(n);
}

/** Recibe una fracción (0.32) y devuelve `32,00 %` */
export function fmtPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return porcentaje.format(n);
}

const MESES = [
  "ene", "feb", "mar", "abr", "may", "jun",
  "jul", "ago", "sep", "oct", "nov", "dic",
];

/** `2026-08` -> `ago 2026` (mes_comercial viene como 'yyyy-MM') */
export function fmtMes(mesComercial: string): string {
  const [anio, mes] = mesComercial.split("-");
  const nombre = MESES[Number(mes) - 1];
  return nombre ? `${nombre} ${anio}` : mesComercial;
}

/** `05/08` para ejes de fecha (los datos vienen como 'YYYY-MM-DD') */
export function fmtFechaCorta(iso: string): string {
  const [, m, d] = iso.split("-");
  return m && d ? `${d}/${m}` : iso;
}

/**
 * `05/08/26` para fechas de tabla, donde el año SÍ hace falta.
 *
 * Es una función aparte y no un parámetro de `fmtFechaCorta` porque los dos
 * usos son distintos: en un eje de días el año es ruido —todas las barras son
 * del mismo mes—, pero en una columna como "Última compra" un `05/08` pelado
 * no distingue entre hace un mes y hace tres años, que es justo lo que uno
 * quiere saber antes de reponer.
 */
export function fmtFechaCortaConAnio(iso: string): string {
  const [a, m, d] = iso.split("-");
  return a && m && d ? `${d}/${m}/${a.slice(-2)}` : iso;
}

/**
 * Formateador que le corresponde a cada métrica de objetivos. Existe para que
 * un objetivo de facturación no se muestre como "45.000.000" pelado ni uno de
 * unidades con signo de pesos.
 */
export function fmtMetrica(metrica: Metrica): (n: number | null | undefined) => string {
  return metrica === "facturacion" ? fmtMoneda : fmtNumero;
}

/**
 * Promedio móvil centrado, para la línea de tendencia de los gráficos diarios.
 *
 * ---------------------------------------------------------------------------
 * NO TOCA UN SOLO DATO
 *
 * Devuelve una serie NUEVA al lado de la real. La línea diaria sigue siendo la
 * de siempre, con sus picos y sus domingos en cero; esta otra existe sólo para
 * poder leer hacia dónde va sin seguir el serrucho punto por punto.
 *
 * Es la diferencia con agrupar por semana, que también limpia el gráfico pero
 * cambia lo que cada punto SIGNIFICA: un total semanal no es un valor diario.
 *
 * ---------------------------------------------------------------------------
 * CENTRADO Y NO HACIA ATRAS
 *
 * El promedio de los 3 días anteriores, el día y los 3 siguientes. Un promedio
 * hacia atrás --el de los últimos 7-- corre la curva media semana a la derecha:
 * el pico de un lunes aparecería el jueves, y sobre un gráfico que se usa para
 * ubicar CUANDO pasó algo, eso es peor que no tener la línea.
 *
 * EN LAS PUNTAS SE PROMEDIA CON LO QUE HAY. Los primeros y los últimos días no
 * tienen ventana completa; se usa la parte que existe en vez de dejarlos en
 * `null`, que cortaría la línea justo donde se está mirando el dato más nuevo.
 * La contra es que las puntas son menos suaves, y se ve: es honesto que así
 * sea, porque ahí hay menos información.
 */
export function promedioMovil<T>(
  datos: T[],
  valor: (d: T) => number,
  ventana = 7,
): number[] {
  const lado = Math.floor(ventana / 2);
  return datos.map((_, i) => {
    const desde = Math.max(0, i - lado);
    const hasta = Math.min(datos.length - 1, i + lado);
    let suma = 0;
    for (let j = desde; j <= hasta; j++) suma += valor(datos[j]) || 0;
    return suma / (hasta - desde + 1);
  });
}

/**
 * Desde cuántos puntos vale la pena mostrar la tendencia.
 *
 * Con menos, la línea diaria ya se lee sola y una tendencia sobre cinco puntos
 * no es una tendencia: es la misma línea un poco más redonda, ocupando lugar.
 */
export const PUNTOS_PARA_TENDENCIA = 14;
