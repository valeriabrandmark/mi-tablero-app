/**
 * Reglas de "Elasticidad de precios" (Mercado Libre).
 *
 * ---------------------------------------------------------------------------
 * LA BANDA SE DEDUCE DE LA VENTA. NO HAY NINGUNA LISTA.
 *
 * La primera versión de esta pantalla pedía una tabla de asignación —qué
 * artículo va en qué banda cada semana— y un cuadrado latino que rotara los
 * grupos. Estaba de más: **cada venta ya trae su precio y su costo**, así que
 * el margen con el que se vendió se calcula solo, y con el margen se sabe en
 * qué banda cayó. Quien decide el precio es el sistema de precios; acá sólo se
 * observa el resultado.
 *
 * Eso además arregla un problema que la versión con lista tenía escondido: si
 * el precio asignado no se cargaba, o se cargaba tarde, o el repricer lo movía,
 * la lista decía una cosa y la realidad otra — y el tablero le hubiera creído a
 * la lista.
 *
 * ---------------------------------------------------------------------------
 * QUÉ ES EL %MARGEN, EXACTAMENTE
 *
 *     (precio bruto − IVA − costo neto − comisión ML neta − envío neto)
 *     ────────────────────────────────────────────────────────────────
 *                          precio bruto
 *
 * El denominador es el precio **con IVA**, que es el mismo criterio que usa el
 * resto de la sección (ver `DENOMINADOR` en `lib/meli.ts`). Que las dos
 * pantallas midan sobre la misma base no es cosmético: es lo que permite
 * comparar un número de acá con uno del tablero sin traducir nada.
 *
 * Verificado contra 9.900 líneas de 30 días: mediana 25,0 %, p10 10,0 % y
 * p90 34,4 %. O sea que las tres bandas del experimento no son arbitrarias —
 * están puestas justo donde vive la distribución real.
 */

/**
 * Las cinco bandas, ordenadas de menor a mayor margen.
 *
 * TRES SON LAS DEL EXPERIMENTO Y DOS SON LOS BORDES, y los bordes están a
 * propósito: el 17 % de las líneas cae fuera del rango 10-35 % (817 por debajo
 * y 843 por encima sobre 9.900). Sin estas dos, esas ventas desaparecerían del
 * tablero y los totales no cerrarían contra el resto de la sección — que es
 * exactamente el tipo de diferencia que después nadie puede explicar.
 */
export const BANDAS = [
  { clave: "<10", label: "Menos de 10 %", min: -Infinity, max: 0.1, delExperimento: false },
  { clave: "10-18", label: "10 a 18 %", min: 0.1, max: 0.18, delExperimento: true },
  { clave: "18-25", label: "18 a 25 %", min: 0.18, max: 0.25, delExperimento: true },
  { clave: "25-35", label: "25 a 35 %", min: 0.25, max: 0.35, delExperimento: true },
  { clave: ">35", label: "Más de 35 %", min: 0.35, max: Infinity, delExperimento: false },
] as const;

export type ClaveBanda = (typeof BANDAS)[number]["clave"];

/** Las tres que el experimento compara. */
export const BANDAS_EXPERIMENTO = BANDAS.filter((b) => b.delExperimento);

export function labelBanda(clave: string): string {
  return BANDAS.find((b) => b.clave === clave)?.label ?? clave;
}

/**
 * En qué banda cae un margen. Los cortes son cerrados abajo y abiertos arriba
 * (18 % entra en "18 a 25", no en "10 a 18"), igual que en el SQL que arma los
 * totales: si los dos lados cortaran distinto, una venta justo en el borde
 * aparecería en una banda en el gráfico y en otra en la tabla.
 */
export function bandaDeMargen(pct: number | null): ClaveBanda | null {
  if (pct == null || !Number.isFinite(pct)) return null;
  return (BANDAS.find((b) => pct >= b.min && pct < b.max)?.clave ?? ">35") as ClaveBanda;
}

/**
 * Cuánto puede estar por debajo del mejor margen una banda para que se la siga
 * considerando empatada.
 *
 * NO ES UN NÚMERO ESTADÍSTICO, es una preferencia del negocio, y por eso está
 * declarado acá arriba y no escondido en una fórmula.
 *
 * Entre dos bandas que dejan lo mismo conviene la de **margen más alto**,
 * porque vende menos unidades para ganar la misma plata: el stock dura más y no
 * se quiebra tan rápido. Con el ejemplo del negocio: vender 50 unidades al 10 %
 * y vender 20 al 30 % no son equivalentes aunque den el mismo total.
 *
 * Subirlo empuja a vender más caro; bajarlo, a vender más barato. Con 0 el
 * criterio vuelve a ser el máximo pelado.
 */
export const EMPATE_TECNICO = 0.1;

/**
 * La banda que más dejó, o `null` si hay menos de dos con ventas.
 *
 * Con una sola banda no hay comparación posible: el "mejor" sería el único.
 *
 * Entre las que quedan dentro de `EMPATE_TECNICO` del mejor margen, gana la de
 * margen más alto. `BANDAS` está ordenada de menor a mayor, así que "la última
 * que empata" es ésa.
 *
 * Ojo con el signo: si el mejor margen es NEGATIVO —el artículo pierde plata en
 * todas las bandas—, un umbral multiplicativo se daría vuelta y elegiría la
 * peor. Por eso el piso se calcula sobre el valor absoluto.
 */
export function mejorBanda(
  porBanda: Partial<Record<string, number | null>>,
): ClaveBanda | null {
  const conVentas = BANDAS.filter((b) => porBanda[b.clave] != null);
  if (conVentas.length < 2) return null;

  const tope = Math.max(...conVentas.map((b) => porBanda[b.clave]!));
  const piso = tope - Math.abs(tope) * EMPATE_TECNICO;
  const empatadas = conVentas.filter((b) => porBanda[b.clave]! >= piso);
  return empatadas[empatadas.length - 1].clave;
}

/**
 * Unidades mínimas —en todo el período— para leer a UN artículo solo.
 *
 * DE DÓNDE SALE: la mediana de los artículos con venta es 0,58 unidades por
 * semana, y el 58 % vende menos de una. Con esos números, la diferencia entre
 * un margen del 12 % y uno del 30 % en un artículo puntual es indistinguible
 * del ruido: entre vender 0 y vender 1 no hay señal, hay azar.
 *
 * Debajo de este piso el artículo cuenta para el total de su banda —que sí
 * tiene miles de unidades— pero su "mejor banda" no se puede leer sola.
 */
export const UDS_MINIMAS_SKU = 15;

/**
 * Qué le falta al tablero para tener algo que mostrar. Sin esto, una pantalla
 * vacía se lee como "no vendimos nada", que es una conclusión falsa y grave.
 */
export const PASOS_PREVIOS = [
  {
    clave: "pulso",
    titulo: "El pulso tiene que estar corriendo",
    detalle:
      "`ml_pulso.py` mira el estado de cada publicación en cada corrida del " +
      "orquestador y guarda desde cuándo está quebrada. Es lo único que no se " +
      "puede reconstruir hacia atrás: las horas que no se miraron se pierden.",
  },
  {
    clave: "ventas",
    titulo: "Y tiene que haber ventas en el período elegido",
    detalle:
      "La banda de cada venta sale de su propio margen, así que sin ventas no " +
      "hay nada que clasificar. Probá abriendo el rango de fechas.",
  },
] as const;


// --- Las semanas del experimento --------------------------------------------

/**
 * Cuándo arrancó el experimento y cuántas semanas dura.
 *
 * Los tramos se DERIVAN de estos dos números en vez de estar escritos uno por
 * uno. Si el experimento se estira a cuatro o cinco semanas, se cambia
 * `SEMANAS` y no hay que tocar ni el SQL ni las columnas de la tabla — que es
 * exactamente el tipo de cambio que si no termina hecho a medias en un lado.
 */
export const EXPERIMENTO_INICIO = "2026-08-18";
export const EXPERIMENTO_SEMANAS = 3;

export type SemanaExperimento = {
  numero: number;
  /** Inclusive. */
  desde: string;
  /**
   * EXCLUSIVO: el día `hasta` ya pertenece a la semana siguiente.
   *
   * Es lo que hace que "del 18-08 al 25-08" y "del 25-08 al 01-09" no cuenten
   * dos veces las ventas del 25. Cada semana tiene exactamente 7 días y ninguna
   * venta cae en dos.
   */
  hasta: string;
  label: string;
};

/** Corre una fecha `YYYY-MM-DD` N días. Igual que `sumarDias` de rangos.ts,
 *  repetido acá para que este módulo no importe nada (lo usa el navegador). */
function correr(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** `2026-08-18` -> `18/08` */
export function diaMes(fecha: string): string {
  const [, m, d] = fecha.split("-");
  return `${d}/${m}`;
}

export const SEMANAS: SemanaExperimento[] = Array.from(
  { length: EXPERIMENTO_SEMANAS },
  (_, i) => {
    const desde = correr(EXPERIMENTO_INICIO, i * 7);
    const hasta = correr(EXPERIMENTO_INICIO, (i + 1) * 7);
    return {
      numero: i + 1,
      desde,
      hasta,
      // El label dice las dos puntas tal como se piensan ("del 18/08 al
      // 25/08"), aunque el 25 no cuente para esta semana. La tabla explica el
      // corte una vez, abajo, en vez de inventar una notación que nadie usa.
      label: `${diaMes(desde)} al ${diaMes(hasta)}`,
    };
  },
);

/** El primer día que ya NO entra en el experimento. */
export const EXPERIMENTO_FIN = correr(EXPERIMENTO_INICIO, EXPERIMENTO_SEMANAS * 7);

/** En qué semana cae una fecha, o `null` si está fuera del experimento. */
export function semanaDe(fecha: string): number | null {
  return SEMANAS.find((s) => fecha >= s.desde && fecha < s.hasta)?.numero ?? null;
}

/**
 * Qué semanas ya empezaron. Las que no, se muestran igual pero vacías y
 * marcadas: una columna que falta se lee como "no la medimos", y una que dice
 * "todavía no empezó" dice la verdad.
 */
export function semanaEmpezada(s: SemanaExperimento, hoy: string): boolean {
  return hoy >= s.desde;
}
