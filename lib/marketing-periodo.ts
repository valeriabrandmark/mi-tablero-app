import { limitesMesComercial, mesComercialActual } from "@/lib/constantes";
import { hoyArgentina, mesComercialComoRango, sumarDias, type Rango } from "@/lib/rangos";

/**
 * EL PERÍODO DEL TABLERO DE MARCA.
 *
 * Las metas del acuerdo de rol son MENSUALES ("$17MM/mes", "$2MM/mes", "4
 * influencers por mes"). Cuando se mira otro período, todo lo que es meta o
 * presupuesto se ajusta por `factor`: siete días son ~7/30 de la meta del mes.
 *
 * Y lo que se mira "en curso" (el período incluye hoy) se proyecta al final
 * del período con el ritmo de lo que va; un período cerrado no se proyecta,
 * se mira lo que fue.
 *
 * Sin `pg`: lo usan el servidor (para pedir los datos) y el navegador (para
 * dibujar el filtro y calcular ritmos).
 */

export type Periodo = {
  desde: string;
  hasta: string;
  hoy: string;
  /** Días del período, puntas incluidas. */
  dias: number;
  /** Días ya transcurridos dentro del período (hasta hoy). */
  transcurridos: number;
  /** El período incluye hoy: lo que va se proyecta al final. */
  enCurso: boolean;
  /** Cuánto del mes representan estos días. Un mes entero (calendario o comercial) es 1. */
  factor: number;
  etiqueta: string;
};

const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function diasEntre(desde: string, hasta: string): number {
  return Math.round((Date.parse(`${hasta}T12:00:00Z`) - Date.parse(`${desde}T12:00:00Z`)) / 86_400_000) + 1;
}

function finDeMes(fecha: string): string {
  const [a, m] = fecha.split("-").map(Number);
  return new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
}

/** El mes calendario de una fecha. */
export function mesCalendario(fecha: string): Rango {
  return { desde: `${fecha.slice(0, 7)}-01`, hasta: finDeMes(fecha) };
}

function fechaCorta(iso: string): string {
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a.slice(2)}`;
}

function etiquetaDe(r: Rango): string {
  const cal = mesCalendario(r.desde);
  if (r.desde === cal.desde && r.hasta === cal.hasta) {
    const [a, m] = r.desde.split("-");
    return `${MESES[Number(m) - 1]} ${a}`.replace(/^./, (c) => c.toUpperCase());
  }
  const [a, m] = r.desde.split("-").map(Number);
  // ¿Es un mes comercial? Se prueba con el que arranca en ese mes y con el anterior.
  for (const mes of [`${a}-${String(m).padStart(2, "0")}`, `${m === 1 ? a - 1 : a}-${String(m === 1 ? 12 : m - 1).padStart(2, "0")}`]) {
    const lim = limitesMesComercial(mes);
    if (lim.desde === r.desde && lim.hasta === r.hasta) {
      const [aa, mm] = mes.split("-");
      return `Mes comercial ${MESES[Number(mm) - 1]} ${aa}`;
    }
  }
  return r.desde === r.hasta ? fechaCorta(r.desde) : `${fechaCorta(r.desde)} al ${fechaCorta(r.hasta)}`;
}

/**
 * Arma el período a partir de lo que vino en la URL. Sin fechas, o con fechas
 * inválidas, es el MES CALENDARIO EN CURSO: así están escritas las metas.
 */
export function resolverPeriodo(desde?: string | null, hasta?: string | null, hoy = hoyArgentina()): Periodo {
  let r: Rango = mesCalendario(hoy);
  if (desde && hasta && ISO.test(desde) && ISO.test(hasta)) {
    r = desde <= hasta ? { desde, hasta } : { desde: hasta, hasta: desde };
  }
  // Más de un año no se pide: Meta limita la ventana y las consultas se ponen pesadas.
  if (diasEntre(r.desde, r.hasta) > 366) r = { desde: sumarDias(r.hasta, -365), hasta: r.hasta };

  const dias = diasEntre(r.desde, r.hasta);
  const enCurso = r.desde <= hoy && hoy <= r.hasta;
  const transcurridos = r.desde > hoy ? 0 : enCurso ? diasEntre(r.desde, hoy) : dias;
  const cal = mesCalendario(r.desde);
  const esMesEntero =
    (r.desde === cal.desde && r.hasta === cal.hasta) || /^Mes comercial/.test(etiquetaDe(r));
  return {
    ...r,
    hoy,
    dias,
    transcurridos,
    enCurso,
    factor: esMesEntero ? 1 : dias / diasEntre(cal.desde, cal.hasta),
    etiqueta: etiquetaDe(r),
  };
}

/** El último día con datos: hoy si el período está en curso, si no su cierre. */
export function hastaConDatos(p: Periodo): string {
  return p.enCurso ? p.hoy : p.hasta < p.hoy ? p.hasta : p.hoy;
}

/** Lo que va, llevado al final del período con el mismo ritmo. Un período cerrado no se proyecta. */
export function proyectar(valor: number, p: Periodo): number {
  if (!p.enCurso || p.transcurridos === 0) return valor;
  return (valor / p.transcurridos) * p.dias;
}

/** Qué parte del período ya pasó: el ritmo esperado de gasto y de venta. */
export function avance(p: Periodo): number {
  return p.dias ? p.transcurridos / p.dias : 1;
}

/** Fecha `YYYY-MM-DD` de cada día transcurrido del período. */
export function diasDelPeriodo(p: Periodo): string[] {
  return Array.from({ length: p.transcurridos }, (_, i) => sumarDias(p.desde, i));
}

export type Atajo = { label: string; rango: (hoy: string) => Rango };

function mesAnterior(hoy: string): Rango {
  return mesCalendario(sumarDias(`${hoy.slice(0, 7)}-01`, -1));
}

function mesComercialAnterior(hoy: string): Rango {
  const actual = mesComercialActual(new Date(`${hoy}T12:00:00Z`));
  const [a, m] = actual.split("-").map(Number);
  const ant = m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, "0")}`;
  return limitesMesComercial(ant);
}

export const ATAJOS: Atajo[] = [
  { label: "Mes actual", rango: (hoy) => mesCalendario(hoy) },
  { label: "Mes anterior", rango: mesAnterior },
  { label: "Mes comercial", rango: (hoy) => mesComercialComoRango(hoy) },
  { label: "Mes comercial anterior", rango: mesComercialAnterior },
  { label: "7 días", rango: (hoy) => ({ desde: sumarDias(hoy, -6), hasta: hoy }) },
  { label: "30 días", rango: (hoy) => ({ desde: sumarDias(hoy, -29), hasta: hoy }) },
  { label: "90 días", rango: (hoy) => ({ desde: sumarDias(hoy, -89), hasta: hoy }) },
];

/**
 * EL PERÍODO CON QUE SE COMPARA: el mes anterior si se mira un mes (calendario
 * o comercial), y si no, la misma cantidad de días justo antes.
 *
 * Si el período está en curso, se corta A LA MISMA ALTURA: el 13 de noviembre
 * se compara con el 1 al 13 de octubre, no con octubre entero. Se logra
 * armándolo con un `hoy` en esa fecha, así `hastaConDatos` y `proyectar`
 * funcionan igual que en el período actual.
 */
export function periodoAnterior(p: Periodo): Periodo {
  const cal = mesCalendario(p.desde);
  let r: Rango;
  if (p.desde === cal.desde && p.hasta === cal.hasta) {
    r = mesCalendario(sumarDias(p.desde, -1));
  } else if (/^Mes comercial/.test(p.etiqueta)) {
    const [a, m] = p.desde.split("-").map(Number);
    const candidatos = [`${a}-${String(m).padStart(2, "0")}`, `${m === 1 ? a - 1 : a}-${String(m === 1 ? 12 : m - 1).padStart(2, "0")}`];
    const mes = candidatos.find((x) => limitesMesComercial(x).desde === p.desde) ?? candidatos[0];
    const [aa, mm] = mes.split("-").map(Number);
    r = limitesMesComercial(mm === 1 ? `${aa - 1}-12` : `${aa}-${String(mm - 1).padStart(2, "0")}`);
  } else {
    r = { desde: sumarDias(p.desde, -p.dias), hasta: sumarDias(p.desde, -1) };
  }
  const corte = p.transcurridos === 0 ? sumarDias(r.desde, -1) : p.enCurso ? sumarDias(r.desde, p.transcurridos - 1) : r.hasta;
  return resolverPeriodo(r.desde, r.hasta, corte < r.hasta ? corte : r.hasta);
}
