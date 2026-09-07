/**
 * Reglas de negocio de la página "Ventas Mayoristas".
 * Viven en su propio módulo (sin importar `pg`) para poder usarlas también
 * desde componentes del browser.
 */

/** Filtro fijo de la página: no es un selector, es parte de su definición. */
export const CANAL_MAYORISTA = "Mayorista";

/**
 * Vendedores que entran en la página de Ventas Mayoristas.
 *
 * Es una lista BLANCA, igual que el filtro de página del tablero de Power BI
 * (`vendedor IN ('PABLO','RAMON','SILVIO')`). Así quedan afuera de una todos
 * los valores de `vendedor` que no son vendedores reales — AGENCIA, BTL,
 * TRADE, PROYECTOS ESPECIALES — y también los canales que no son fuerza de
 * venta mayorista: CASA CENTRAL, MELI, VENDEDOR WEB, IGNACIO, IVANA.
 *
 * Para sumar o sacar un vendedor alcanza con tocar esta lista: aplica a las
 * consultas y a los selectores, porque todas pasan por `whereBase()` en
 * lib/queries.ts.
 */
export const VENDEDORES_INCLUIDOS = ["PABLO", "RAMON", "SILVIO"];

/**
 * Mínimo de unidades para que un proveedor entre al ranking de margen.
 * Sin este corte aparecen márgenes de 100% falsos por falta de dato de costo
 * (por ejemplo "AGENCIA PROVEEDORES").
 */
export const MIN_UNIDADES_MARGEN = 20;

/**
 * Vendedores que tienen página de objetivos propia.
 *
 * Es una lista aparte de `VENDEDORES_INCLUIDOS` a propósito: RICARDO todavía no
 * tiene ninguna venta en `gold.fact_ventas`, así que no puede entrar a las
 * consultas de Ventas Mayoristas, pero sí necesita su tablero (con el objetivo
 * cargado y 0 de avance) para cuando empiece a facturar.
 *
 * El orden es el del tablero de Data Studio y define el orden del nav.
 */
export const VENDEDORES_OBJETIVOS = ["SILVIO", "RAMON", "PABLO", "RICARDO"] as const;

export type VendedorObjetivos = (typeof VENDEDORES_OBJETIVOS)[number];

/** `SILVIO` -> `silvio`, para la URL. */
export function slugVendedor(vendedor: string): string {
  return vendedor.toLowerCase();
}

/** `silvio` -> `SILVIO`, o null si no es un vendedor con página propia. */
export function vendedorDesdeSlug(slug: string): VendedorObjetivos | null {
  return VENDEDORES_OBJETIVOS.find((v) => slugVendedor(v) === slug.toLowerCase()) ?? null;
}

/**
 * El mes comercial no es el mes calendario: va del día 6 de un mes al día 5 del
 * siguiente. Verificado contra los cuatro meses que hay en `gold.fact_ventas`
 * (2026-05 arranca el 06/05 y termina el 05/06, y así).
 */
export const DIA_INICIO_MES_COMERCIAL = 6;

/**
 * Meses comerciales que NO cerraron el día 5.
 *
 * Pasa cuando la lista de costos nueva llega tarde o se decide estirar el mes:
 * el cierre se corre unos días para que esas ventas sigan costeándose con la
 * lista vieja. El valor es el ÚLTIMO DÍA que pertenece a ese mes, inclusive.
 *
 * ESTA TABLA ESTÁ DUPLICADA EN EL ORQUESTADOR (`CIERRES_EXCEPCION` en
 * modelo.py) Y LAS DOS TIENEN QUE DECIR LO MISMO. No es un descuido: allá
 * decide con qué costo se valoriza cada venta —y queda escrito en la columna
 * `mes_comercial` de `gold.fact_ventas`—, acá decide qué rango de fechas
 * muestra el filtro "Mes comercial". Si discrepan, el filtro trae un día de
 * más o de menos que lo que los datos tienen etiquetado, y los totales de la
 * pantalla no coinciden con los del mes.
 *
 * Se copia y no se lee de la base porque son dos repos que se despliegan por
 * separado: una consulta más por página para un dato que cambia una vez cada
 * varios meses no se paga.
 */
export const CIERRES_MES_COMERCIAL: Record<string, string> = {
  // Agosto cerró el 06/09 y no el 05/09. Septiembre arranca el 07/09.
  "2026-08": "2026-09-06",
};

/**
 * Mes comercial vigente, en el mismo formato `YYYY-MM` que `fact_ventas`.
 *
 * La fecha se lee en hora argentina y no en la del servidor: en Vercel el
 * servidor corre en UTC, y sin esto, entre las 21 y las 24 de Argentina el
 * tablero adelantaría el día — que justo en el cambio de mes comercial daría
 * el mes equivocado.
 */
export function mesComercialActual(ahora: Date = new Date()): string {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(ahora);

  const valor = (tipo: Intl.DateTimeFormatPartTypes) =>
    Number(partes.find((p) => p.type === tipo)?.value ?? 0);

  const anio = valor("year");
  const mes = valor("month");
  const dia = valor("day");

  // Antes del 6 todavía estamos cerrando el mes comercial anterior.
  const desplazado = dia >= DIA_INICIO_MES_COMERCIAL ? mes : mes - 1;
  const anioFinal = desplazado === 0 ? anio - 1 : anio;
  const mesFinal = desplazado === 0 ? 12 : desplazado;

  const estandar = `${anioFinal}-${String(mesFinal).padStart(2, "0")}`;
  const fecha = `${anio}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
  return conCierreMovido(estandar, fecha);
}

/** `2026-08` más o menos N meses. */
function correrMes(mes: string, pasos: number): string {
  const [anio, m] = mes.split("-").map(Number);
  const total = anio * 12 + (m - 1) + pasos;
  return `${String(Math.floor(total / 12)).padStart(4, "0")}-${String((total % 12) + 1).padStart(2, "0")}`;
}

/**
 * Corrige el mes cuando un cierre se movió. Misma lógica que `mes_comercial`
 * en modelo.py, y por eso los dos casos: un mes que se estira se queda con
 * días del siguiente, y uno que se acorta se los cede.
 */
function conCierreMovido(mes: string, fecha: string): string {
  const anterior = correrMes(mes, -1);
  const finAnterior = CIERRES_MES_COMERCIAL[anterior];
  if (finAnterior && fecha <= finAnterior) return anterior;

  const fin = CIERRES_MES_COMERCIAL[mes];
  if (fin && fecha > fin) return correrMes(mes, 1);

  return mes;
}

/**
 * El primer y el último día de un mes comercial, respetando los cierres
 * movidos. `2026-08` normalmente es 06/08 a 05/09.
 */
export function limitesMesComercial(mes: string): { desde: string; hasta: string } {
  const dd = String(DIA_INICIO_MES_COMERCIAL).padStart(2, "0");

  // El arranque es el día siguiente al cierre del mes anterior cuando ése se
  // movió; si no, el 6 de siempre.
  const finAnterior = CIERRES_MES_COMERCIAL[correrMes(mes, -1)];
  const desde = finAnterior ? diaSiguiente(finAnterior) : `${mes}-${dd}`;

  // Y el cierre es el propio, o el día antes del 6 del mes que viene.
  const fin = CIERRES_MES_COMERCIAL[mes];
  const hasta = fin ?? diaAnterior(`${correrMes(mes, 1)}-${dd}`);

  return { desde, hasta };
}

function correrDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

const diaSiguiente = (fecha: string) => correrDias(fecha, 1);
const diaAnterior = (fecha: string) => correrDias(fecha, -1);

/**
 * Código de vendedor en SIGMA para cada vendedor del tablero.
 *
 * Hace falta porque las tablas de cuentas corrientes (`cuentas_corrientes_scoring`
 * y `..._aging`) guardan el vendedor como CÓDIGO, mientras que `gold.fact_ventas`
 * lo guarda como NOMBRE. Sin este mapeo la deuda se le atribuiría al vendedor
 * equivocado, o a ninguno.
 *
 * Sale de cruzar `bronze.sigma_ventas` con `gold.fact_ventas` por comprobante y
 * SKU; el cruce es 1 a 1 y sin ambigüedad. El mapeo completo es 001 CASA CENTRAL,
 * 002 AGENCIA, 004 IGNACIO, 005 IVANA, 006 SILVIO, 007 RAMON, 008 PABLO,
 * 009 MELI, 011 TRADE, 012 BTL, 013 PROYECTOS ESPECIALES, WEB VENDEDOR WEB.
 *
 * RICARDO todavía no tiene código porque nunca facturó: cuando lo haga, hay que
 * agregarlo acá o su deuda no va a aparecer.
 */
export const CODIGO_SIGMA: Record<VendedorObjetivos, string | null> = {
  SILVIO: "006",
  RAMON: "007",
  PABLO: "008",
  RICARDO: null,
};

/** Código de SIGMA de un vendedor, o null si todavía no tiene. */
export function codigoSigmaDe(vendedor: string): string | null {
  const clave = VENDEDORES_OBJETIVOS.find((v) => v === vendedor);
  return clave ? CODIGO_SIGMA[clave] : null;
}

/**
 * Nombre de cada empresa de SIGMA.
 *
 * Las tablas de cuentas corrientes guardan el CÓDIGO ('0001'), mientras que
 * `gold.fact_ventas` ya trae el nombre resuelto desde `modelo.py`. Sin este
 * mapeo el filtro de Cuentas Corrientes mostraba cuatro números sin nombre.
 *
 * La grafía es la misma que usa `gold.fact_ventas`, para que la misma empresa
 * se lea igual en todos los tableros.
 */
export const EMPRESAS: Record<string, string> = {
  "0001": "Quo Marketing SRL",
  "0002": "Noa Comercial SRL",
  "0003": "Presupuesto QUO",
  "0004": "Presupuesto Noa",
};

/** `'0001'` -> `'Quo Marketing SRL'`. Devuelve el código si no está mapeado. */
export function nombreEmpresa(codigo: string): string {
  return EMPRESAS[codigo] ?? codigo;
}
