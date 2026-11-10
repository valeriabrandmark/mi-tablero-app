/**
 * Las reglas del sugerido de Compras, como PARÁMETROS editables.
 *
 * ---------------------------------------------------------------------------
 * POR QUÉ EXISTE
 *
 * Las reglas vivían como constantes en lib/compras.ts y lib/stock.ts, así que
 * mover un número --"el tope de 90 días me queda corto para esta oferta"--
 * pedía un deploy. Ahora se guardan en `app.compras_parametros` y se editan
 * desde el panel de Compras. Las constantes de siempre siguen siendo el valor
 * POR DEFECTO: con la tabla vacía, todo da exactamente lo mismo que antes.
 *
 * ---------------------------------------------------------------------------
 * LA REGLA NUEVA: EL RITMO SOBRE LOS DÍAS QUE HUBO STOCK
 *
 * El pedido de compras (10/11/2026): "el se venden xx por día debería ser lo
 * vendido dividido en los días que TUVO STOCK DISPONIBLE, diferenciando
 * Tucumán de Full porque son stocks distintos". Con la ventana entera, 30
 * unidades vendidas en 3 días y después agotado dan 1 por día en vez de 10, y
 * el sugerido vuelve a pedir lo mismo que se compró la última vez.
 *
 * Los días con stock los calcula tablero_quo (stock_diario.py) en
 * `gold.dias_con_stock`, por depósito. Ver `ritmo_sobre_dias_con_stock`.
 *
 * ---------------------------------------------------------------------------
 * SÓLO NÚMEROS, Y SIEMPRE ADENTRO DE SU RANGO
 *
 * Los valores se interpolan en el SQL (igual que las constantes de antes), así
 * que NUNCA entra uno sin pasar por `normalizarParametros`: es un Number
 * finito, recortado a [min, max]. Un texto no puede llegar al SQL.
 */

import { DIAS_MINIMOS_DE_RITMO, PLAZO_REPOSICION_DIAS } from "@/lib/stock";

export type GrupoParametro = "ritmo" | "necesidad" | "oferta";

export type DefinicionParametro = {
  clave: ClaveParametro;
  grupo: GrupoParametro;
  label: string;
  /** Una oración: qué cambia en el sugerido al mover este número. */
  ayuda: string;
  unidad: "días" | "%" | "puntos" | "x" | "sí/no";
  porDefecto: number;
  min: number;
  max: number;
  /** Paso del input. Los enteros van de a 1. */
  paso: number;
};

export const CLAVES_PARAMETROS = [
  "ritmo_sobre_dias_con_stock",
  "dias_minimos_con_stock",
  "dias_minimos_de_ritmo",
  "plazo_reposicion_dias",
  "puntos_oferta_para_duplicar",
  "factor_oferta_max",
  "cobertura_maxima_compra_dias",
  "cobertura_sin_inflar_dias",
  "rentabilidad_compra_discreta",
  "veces_sobre_lo_habitual_para_inflar",
] as const;
export type ClaveParametro = (typeof CLAVES_PARAMETROS)[number];

export type ParametrosCompras = Record<ClaveParametro, number>;

export const DEFINICIONES_PARAMETROS: readonly DefinicionParametro[] = [
  {
    clave: "ritmo_sobre_dias_con_stock",
    grupo: "ritmo",
    label: "Medir el ritmo sólo sobre los días con stock",
    ayuda:
      "Divide lo vendido por los días que hubo stock, Tucumán y Full por separado, " +
      "en vez de por la ventana entera. Un artículo que se agotó rápido deja de " +
      "parecer lento.",
    unidad: "sí/no",
    porDefecto: 1,
    min: 0,
    max: 1,
    paso: 1,
  },
  {
    clave: "dias_minimos_con_stock",
    grupo: "ritmo",
    label: "Mínimo de días con stock para medir el ritmo",
    ayuda:
      "Con pocos días, una venta grande parece un ritmo. Si se vendieron 12 en 2 " +
      "días y el mínimo es 7, el ritmo se toma como 12/7 = 1,7 por día y no 6.",
    unidad: "días",
    porDefecto: 7,
    min: 1,
    max: 60,
    paso: 1,
  },
  {
    clave: "dias_minimos_de_ritmo",
    grupo: "ritmo",
    label: "Mínimo de días para un artículo nuevo (regla de la ventana)",
    ayuda:
      "Sólo cuando el ritmo NO se mide sobre días con stock, o el artículo todavía " +
      "no tiene esa cuenta: el ritmo se mide desde la primera venta, nunca sobre " +
      "menos de estos días.",
    unidad: "días",
    porDefecto: DIAS_MINIMOS_DE_RITMO,
    min: 1,
    max: 60,
    paso: 1,
  },
  {
    clave: "plazo_reposicion_dias",
    grupo: "necesidad",
    label: "Plazo de reposición",
    ayuda:
      "Lo que tarda la mercadería en llegar. Se suma a la cobertura elegida: lo " +
      "que se vende mientras viaja también hay que comprarlo.",
    unidad: "días",
    porDefecto: PLAZO_REPOSICION_DIAS,
    min: 0,
    max: 90,
    paso: 1,
  },
  {
    clave: "puntos_oferta_para_duplicar",
    grupo: "oferta",
    label: "Puntos de descuento sobre lo habitual que duplican la compra",
    ayuda:
      "Con 30, un sell in de 40 % sobre un habitual de 10 % sugiere el doble. " +
      "Entre medio, proporcional.",
    unidad: "puntos",
    porDefecto: 30,
    min: 1,
    max: 100,
    paso: 1,
  },
  {
    clave: "factor_oferta_max",
    grupo: "oferta",
    label: "Multiplicador máximo por oferta",
    ayuda: "Por buena que sea la oferta, no se sugiere más que esto por la necesidad.",
    unidad: "x",
    porDefecto: 2,
    min: 1,
    max: 5,
    paso: 0.1,
  },
  {
    clave: "cobertura_maxima_compra_dias",
    grupo: "oferta",
    label: "Techo de cobertura de una compra",
    ayuda:
      "El sugerido nunca pasa de estos días de venta (salvo que se elija comprar " +
      "para más días a mano).",
    unidad: "días",
    porDefecto: 90,
    min: 30,
    max: 365,
    paso: 1,
  },
  {
    clave: "cobertura_sin_inflar_dias",
    grupo: "oferta",
    label: "Cobertura a partir de la cual una oferta no infla nada",
    ayuda: "Si ya hay más de estos días de stock, la oferta no es oportunidad: es plata quieta.",
    unidad: "días",
    porDefecto: 120,
    min: 30,
    max: 365,
    paso: 1,
  },
  {
    clave: "rentabilidad_compra_discreta",
    grupo: "oferta",
    label: "Rentabilidad mínima para comprar de más por oferta",
    ayuda:
      "Por debajo de esta rentabilidad (3 meses, todos los canales) una oferta no " +
      "agranda la compra, salvo un descuento nuevo (ver la regla de abajo).",
    unidad: "%",
    porDefecto: 15,
    min: -100,
    max: 100,
    paso: 0.5,
  },
  {
    clave: "veces_sobre_lo_habitual_para_inflar",
    grupo: "oferta",
    label: "Veces sobre el descuento habitual que salva a un artículo de baja rentabilidad",
    ayuda:
      "Un descuento que es esta cantidad de veces el habitual cuenta como nuevo, y " +
      "se compra de más aunque la rentabilidad sea baja.",
    unidad: "x",
    porDefecto: 2,
    min: 1,
    max: 10,
    paso: 0.1,
  },
];

const POR_CLAVE = new Map(DEFINICIONES_PARAMETROS.map((d) => [d.clave, d]));

export function definicionDe(clave: ClaveParametro): DefinicionParametro {
  const d = POR_CLAVE.get(clave);
  if (!d) throw new Error(`Parámetro desconocido: ${clave}`);
  return d;
}

export function esClaveParametro(v: unknown): v is ClaveParametro {
  return typeof v === "string" && POR_CLAVE.has(v as ClaveParametro);
}

/** Los valores de siempre: lo que da el sugerido con la tabla vacía. */
export function parametrosPorDefecto(): ParametrosCompras {
  return Object.fromEntries(
    DEFINICIONES_PARAMETROS.map((d) => [d.clave, d.porDefecto]),
  ) as ParametrosCompras;
}

/**
 * Un valor válido para esa clave, o `null` si no se puede leer como número.
 *
 * Se RECORTA al rango en vez de rechazar: viene de un input numérico, y un 400
 * por escribir 400 en un campo de 0 a 365 es peor que guardar 365. Los
 * enteros se redondean; el sí/no queda en 0 o 1.
 */
export function valorValido(clave: ClaveParametro, crudo: unknown): number | null {
  const d = definicionDe(clave);
  const n = typeof crudo === "boolean" ? (crudo ? 1 : 0) : Number(crudo);
  if (crudo === null || crudo === "" || !Number.isFinite(n)) return null;
  const recortado = Math.min(Math.max(n, d.min), d.max);
  if (d.unidad === "sí/no") return recortado >= 0.5 ? 1 : 0;
  // Redondeo al paso, y después a 4 decimales para no guardar 1.9000000000000001.
  const alPaso = Math.round(recortado / d.paso) * d.paso;
  return Math.round(alPaso * 10_000) / 10_000;
}

/**
 * Lo guardado encima de los valores por defecto. Lo que falta, lo que no se
 * reconoce o lo que no es número cae al defecto: una fila rota en la tabla no
 * puede tirar la pantalla de Compras.
 */
export function normalizarParametros(
  guardados: Partial<Record<string, unknown>> | null | undefined,
): ParametrosCompras {
  const p = parametrosPorDefecto();
  for (const [k, v] of Object.entries(guardados ?? {})) {
    if (!esClaveParametro(k)) continue;
    const ok = valorValido(k, v);
    if (ok != null) p[k] = ok;
  }
  return p;
}

/** Qué claves difieren del valor por defecto. Para marcar en el panel. */
export function cambiadosDelDefecto(p: ParametrosCompras): ClaveParametro[] {
  return DEFINICIONES_PARAMETROS.filter((d) => p[d.clave] !== d.porDefecto).map(
    (d) => d.clave,
  );
}
