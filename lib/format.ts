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
 * Formateador que le corresponde a cada métrica de objetivos. Existe para que
 * un objetivo de facturación no se muestre como "45.000.000" pelado ni uno de
 * unidades con signo de pesos.
 */
export function fmtMetrica(metrica: Metrica): (n: number | null | undefined) => string {
  return metrica === "facturacion" ? fmtMoneda : fmtNumero;
}
