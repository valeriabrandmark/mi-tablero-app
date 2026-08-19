/**
 * Todos los filtros del tablero son de selección múltiple: el valor es una
 * LISTA. Lista vacía (o ausente) significa "sin filtrar", no "ninguno".
 */
export type Filtros = {
  vendedor?: string[];
  empresa?: string[];
  mes?: string[];
  /** Vía `fact_ventas_flete` -> `reporte_logistica`, igual que el slicer del .pbit. */
  provincia?: string[];
  // Filtros cruzados: salen de hacer click en un gráfico o en una tabla.
  // No tienen selector propio; se limpian con su chip o con "Limpiar".
  proveedor?: string[];
  cliente?: string[];
  sku?: string[];
  comprobante?: string[];
};

/** Dimensiones que solo existen como filtro cruzado (sin selector arriba). */
export const CRUZADOS = ["proveedor", "cliente", "sku", "comprobante"] as const;
export type Cruzado = (typeof CRUZADOS)[number];

export type FilaArticulo = {
  sku: string | null;
  producto: string | null;
  cantidad: number;
  ofertaPct: number | null;
  precioPromedio: number | null;
  costoPromedio: number | null;
  facturacion: number;
  rentabilidadPct: number | null;
};

export type FilaComprobanteVenta = {
  comprobante: string | null;
  fecha: string | null;
  cliente: string | null;
  unidades: number;
  facturacion: number;
};

export type RentabilidadCliente = {
  label: string;
  valor: number;
  facturacion: number;
};

export type Kpis = {
  facturacionNeta: number;
  costoMercaderia: number;
  unidades: number;
  clientesConCompra: number;
  cantidadPedidos: number;
  margenTotal: number;
  margenAjustado: number;
  rentabilidadAjustadaPct: number | null;
  ticketPromedio: number | null;
  pctTop10Clientes: number | null;
  fleteTotalReal: number;
  fleteEstimadoFiltrado: number;
};

export type PuntoProveedor = { label: string; total: number };

export type MargenProveedor = {
  label: string;
  margenPct: number;
  unidades: number;
};

/** Fila lista para recharts: `{ fecha, "Juan": 12345, "Ana": 6789 }` */
export type PuntoDiaVendedor = { fecha: string } & Record<string, number | string>;

export type SerieDiaria = {
  vendedores: string[];
  data: PuntoDiaVendedor[];
};

export type OpcionesFiltro = {
  vendedores: string[];
  empresas: string[];
  meses: string[];
  provincias: string[];
};

// --- Logística --------------------------------------------------------------

/** Espeja el parámetro `ParamFlete[Modo]` del modelo de Power BI. */
export type ModoFlete = "sin" | "real" | "real-estimado";

export type FiltrosLogistica = {
  vendedor?: string[];
  empresa?: string[];
  mes?: string[];
  transporte?: string[];
  provincia?: string[];
  /** Filtro cruzado: sale de hacer click en un proveedor de un gráfico. */
  proveedor?: string[];
  /** 'real' | 'estimado' — espeja el slicer "Estado flete". */
  estadoFlete?: string[];
  /**
   * NO es un filtro sino un modo de cálculo: elige qué flete se descuenta del
   * margen. Por eso sigue siendo de opción única.
   */
  modoFlete?: ModoFlete;
};

export type KpisLogistica = {
  cantidadEnvios: number;
  kgTotales: number;
  fleteTotal: number;
  fleteRealFiltrado: number;
  fleteEstimadoFiltrado: number;
  pctLineasFleteReal: number | null;
  pctFleteSobreFacturacion: number | null;
  facturacionNeta: number;
  costoPorKg: number | null;
  margenAjustado: number;
  rentabilidadAjustadaPct: number | null;
};

export type PuntoEtiqueta = { label: string; valor: number };

export type FilaComprobante = {
  comprobante: string | null;
  nroOrden: string | null;
  cliente: string | null;
  provincia: string | null;
  fecha: string | null;
  facturacion: number;
  flete: number;
  pctFlete: number | null;
};

export type OpcionesLogistica = {
  vendedores: string[];
  empresas: string[];
  meses: string[];
  transportes: string[];
  provincias: string[];
};

export type DashboardLogistica = {
  kpis: KpisLogistica;
  unidadesPorProveedor: PuntoEtiqueta[];
  margenPorProveedor: PuntoEtiqueta[];
  fletePorProveedor: PuntoEtiqueta[];
  /** Denominadores de las tortas: totales SIN el filtro cruzado de proveedor. */
  totalesProveedor: { unidades: number; flete: number };
  pctFletePorProvincia: PuntoEtiqueta[];
  comprobantes: FilaComprobante[];
  generadoEn: string;
};

// --- Cuentas Corrientes -----------------------------------------------------

export type FiltrosCuentas = {
  vendedor?: string[];
  empresa?: string[];
  categoria?: string[];
};

export type KpisCuentas = {
  deudaTotal: number;
  deudaVencida: number;
  pctCarteraVencida: number | null;
  clientesEnRiesgo: number;
  clientesTotales: number;
  clientesActivos60d: number;
  clientesInactivos60d: number;
  clientesVencidosQueCompran: number;
};

export type FilaCliente = {
  razonSocial: string;
  categoria: string | null;
  vendedor: string | null;
  saldoTotal: number;
  saldoVencido: number;
  atrasoMax: number | null;
};

export type OpcionesCuentas = {
  vendedores: string[];
  empresas: string[];
  categorias: string[];
};

export type DashboardCuentas = {
  kpis: KpisCuentas;
  clientes: FilaCliente[];
  deudaPorCategoria: PuntoEtiqueta[];
  clientesPorCategoria: PuntoEtiqueta[];
  aging: PuntoEtiqueta[];
  historial: PuntoEtiqueta[];
  cancelacionesPorVendedor: PuntoEtiqueta[];
  generadoEn: string;
};

export type DashboardVentasMayoristas = {
  kpis: Kpis;
  facturacionPorProveedor: PuntoProveedor[];
  /** Denominador de la torta: total de TODOS los proveedores, sin el filtro cruzado. */
  facturacionTotalProveedores: number;
  margenPorProveedor: MargenProveedor[];
  rentabilidadPorCliente: RentabilidadCliente[];
  articulos: FilaArticulo[];
  comprobantes: FilaComprobanteVenta[];
  serieDiaria: SerieDiaria;
  generadoEn: string;
};

// --- Página "Objetivos" ------------------------------------------------------

/**
 * Cómo se mide el avance de un grupo. Existe porque un objetivo en pesos y uno
 * en unidades no se pueden sumar entre sí: todo lo que agrega objetivos tiene
 * que agrupar por esto primero.
 */
export type Metrica = "unidades" | "facturacion" | "clientes";

export const METRICAS = ["unidades", "facturacion", "clientes"] as const;

export type FiltrosObjetivos = {
  /** Lo fija la ruta (`/objetivos/[vendedor]`), no un selector. */
  vendedor: string;
  mes?: string[];
  /** Filtro cruzado: sale de hacer click en una barra. */
  grupo?: string[];
};

/** Totales de una métrica. Nunca se mezclan dos métricas en un mismo total. */
export type ResumenMetrica = {
  metrica: Metrica;
  objetivo: number;
  vendido: number;
  /** Fracción (0.13 = 13 %). Null si el objetivo del recorte es 0. */
  avancePct: number | null;
  /** Cuántos pares vendedor×grupo llegaron al objetivo, sobre el total. */
  cumplidos: number;
  pares: number;
};

/** Una línea de avance. `grupo` o `vendedor` son null cuando la fila agrega. */
export type FilaObjetivo = {
  grupo: string | null;
  vendedor: string | null;
  metrica: Metrica;
  objetivo: number;
  vendido: number;
  avancePct: number | null;
  faltan: number;
};

/** Un comprobante del vendedor dentro del recorte elegido. */
export type FilaComprobanteObjetivo = {
  comprobante: string | null;
  fecha: string | null;
  cliente: string | null;
  empresa: string | null;
  unidades: number;
  facturacion: number;
};

/** Un punto del timeline de facturación. */
export type PuntoFacturacion = { fecha: string; total: number };

export type OpcionesObjetivos = {
  meses: string[];
  grupos: string[];
};

/**
 * Deuda del vendedor, de `cuentas_corrientes_scoring`. Es una FOTO al momento
 * de la última carga, no un acumulado del mes: no cambia al mover el filtro de
 * mes comercial. Por eso viaja con su `fechaCarga`.
 */
export type VencidoVendedor = {
  deudaTotal: number;
  deudaVencida: number;
  /** Fracción (0.43 = 43 %). Null si el vendedor no tiene deuda cargada. */
  pctVencida: number | null;
  clientes: number;
  fechaCarga: string | null;
};

export type DashboardObjetivos = {
  resumen: ResumenMetrica[];
  /** Null si el vendedor todavía no tiene código de SIGMA. */
  vencido: VencidoVendedor | null;
  porGrupo: FilaObjetivo[];
  serieFacturacion: PuntoFacturacion[];
  comprobantes: FilaComprobanteObjetivo[];
  generadoEn: string;
};

// --- Venta minorista: Mercado Libre -----------------------------------------

export type FiltrosMeli = {
  /**
   * Rango de fechas (`YYYY-MM-DD`), inclusivo en las dos puntas. Es el filtro
   * principal de la sección, en vez del mes comercial: en Mercado Libre se mira
   * el día, y el mes comercial del 6 al 5 no significa nada para este canal.
   */
  desde?: string;
  hasta?: string;
  proveedor?: string[];
  marca?: string[];
  /** Filtro cruzado: sale de hacer click en una fila del ranking de artículos. */
  sku?: string[];
  /** Solo en la pestaña Alertas: nivel de alerta (ver `NIVELES_ALERTA`). */
  alerta?: string[];
};

/** Una hora del día (0-23) con lo que se vendió en ella. */
export type PuntoHora = { hora: number; ordenes: number; venta: number };

/**
 * El mismo recorte corrido hacia atrás, para comparar. Si mirás hoy, es ayer;
 * si mirás una semana, es la semana anterior.
 */
export type ComparacionMeli = {
  desde: string;
  hasta: string;
  /**
   * Hasta qué hora se midió el último día del período anterior (`HH:MM:SS`), o
   * null si se midió entero.
   *
   * Tiene valor solo cuando el recorte actual llega hasta hoy, que es cuando
   * está a medio pasar: comparar "hoy hasta las 16" contra "ayer entero" es
   * comparar diez horas contra veinticuatro. La pantalla lo dice, porque un
   * porcentaje sin saber sobre qué se midió no se puede interpretar.
   */
  hastaHora: string | null;
  ventaCiva: number;
  unidades: number;
  ordenes: number;
  rentabilidad: number;
  margenPct: number | null;
};

/** El recorte que se está mirando, resuelto en el servidor. */
export type RangoMeli = { desde: string; hasta: string; dias: number };

/**
 * Todos los importes son de la LÍNEA ya multiplicada por cantidad. Ver la tabla
 * de granos en lib/meli.ts: `comision` viene por unidad y `envio` por línea, así
 * que sumarlos de más o de menos es el error fácil de esta página.
 */
export type KpisMeli = {
  ventaCiva: number;
  ventaSiva: number;
  unidades: number;
  ordenes: number;
  lineas: number;
  costo: number;
  comision: number;
  envio: number;
  /** Venta s/IVA − costo − comisión − envío. */
  rentabilidad: number;
  /** Fracción. Denominador VENTA C/IVA, como la pestaña "Tablero" de la planilla. */
  margenPct: number | null;
  /** IIBB + Imp. Cheque + Imp. Municipal sobre la venta s/IVA. */
  impuestos: number;
  rentabilidadNeta: number;
  /** Fracción. Denominador VENTA S/IVA, como la pestaña "Alertas". */
  margenNetoPct: number | null;
  /** Comisión sobre venta s/IVA, en fracción. */
  pctComision: number | null;
  ticketPromedio: number | null;
};

/** Un punto del timeline: venta y rentabilidad del día, para leerlas juntas. */
export type PuntoDiaMeli = { fecha: string; venta: number; rentabilidad: number };

/** Una fila de cualquier ranking (proveedor, marca). */
export type RankingMeli = {
  label: string;
  venta: number;
  unidades: number;
  rentabilidad: number;
  /** Fracción, sobre venta c/IVA. */
  margenPct: number | null;
};

export type ArticuloMeli = {
  sku: string | null;
  producto: string | null;
  proveedor: string | null;
  marca: string | null;
  unidades: number;
  ventaCiva: number;
  ventaSiva: number;
  costo: number;
  comision: number;
  envio: number;
  rentabilidad: number;
  margenPct: number | null;
};

export type OpcionesMeli = {
  proveedores: string[];
  marcas: string[];
  /** Primer y último día con ventas, para acotar los selectores de fecha. */
  primeraVenta: string | null;
  ultimaVenta: string | null;
};

export type DashboardMeli = {
  kpis: KpisMeli;
  rango: RangoMeli;
  /** Null si el período anterior cae antes del primer día con datos. */
  comparacion: ComparacionMeli | null;
  porDia: PuntoDiaMeli[];
  /** Las 24 horas, siempre completas: una hora sin ventas es un dato. */
  porHora: PuntoHora[];
  porProveedor: RankingMeli[];
  porMarca: RankingMeli[];
  /** Los SKUs que más plata dejaron, que no son los que más vendieron. */
  topRentabilidad: ArticuloMeli[];
  articulos: ArticuloMeli[];
  /** Denominador de la torta: venta de TODOS los proveedores, sin filtro cruzado. */
  ventaTotalProveedores: number;
  /** Último día con ventas cargadas: avisa si el dato viene atrasado. */
  ultimaVenta: string | null;
  generadoEn: string;
};

// --- Venta minorista: Mercado Libre / Alertas --------------------------------

/** Una venta individual con su rentabilidad desagregada, como la planilla. */
export type FilaAlertaMeli = {
  nivel: string;
  fecha: string | null;
  nroOrden: string | null;
  sku: string | null;
  producto: string | null;
  proveedor: string | null;
  marca: string | null;
  cantidad: number;
  ventaCiva: number;
  ventaSiva: number;
  costoUnitario: number | null;
  costo: number;
  comision: number;
  envio: number;
  rentabilidad: number;
  margenPct: number | null;
  iibb: number;
  cheque: number;
  municipal: number;
  rentabilidadNeta: number;
  margenNetoPct: number | null;
  accion: string;
};

/** Cuánto pesa cada nivel de alerta en el recorte elegido. */
export type ResumenAlerta = {
  nivel: string;
  lineas: number;
  ventaSiva: number;
  rentabilidadNeta: number;
};

export type DashboardAlertasMeli = {
  resumen: ResumenAlerta[];
  /** Total de líneas del recorte, para saber sobre qué se está mirando. */
  lineasTotales: number;
  filas: FilaAlertaMeli[];
  /** `true` si `filas` quedó recortada por el tope de la consulta. */
  recortada: boolean;
  generadoEn: string;
};

// --- Venta minorista: Tienda Nube -------------------------------------------
//
// Tipos propios y no los de Mercado Libre aunque varios se parezcan: en Tienda
// Nube no hay comisión, y los pedidos y los clientes son entidades que ahí
// significan algo (treinta pedidos con nombre y apellido) y en Mercado Libre no
// (33.000 apodos irrepetibles). Compartir el tipo obligaría a llenar campos que
// en un canal no existen.

export type FiltrosTiendaNube = {
  /** Rango de fechas (`YYYY-MM-DD`), inclusivo en las dos puntas. */
  desde?: string;
  hasta?: string;
  proveedor?: string[];
  marca?: string[];
  /** Filtro cruzado: sale de hacer click en una fila de artículos. */
  sku?: string[];
  /** Filtro cruzado: sale de hacer click en un cliente o en un pedido. */
  cliente?: string[];
};

/** Todos los importes son de la LÍNEA, ya multiplicada por cantidad. */
export type KpisTiendaNube = {
  ventaCiva: number;
  ventaSiva: number;
  unidades: number;
  pedidos: number;
  lineas: number;
  clientes: number;
  costo: number;
  /** Lo que paga LA TIENDA por el flete (`shipping_cost_owner`), no el comprador. */
  envio: number;
  /** Venta s/IVA − costo − envío. Sin comisión: Tienda Nube no la informa. */
  rentabilidad: number;
  /** Fracción, sobre venta c/IVA. */
  margenPct: number | null;
  /** IIBB + Imp. Cheque + Imp. Municipal sobre la venta s/IVA. */
  impuestos: number;
  rentabilidadNeta: number;
  margenNetoPct: number | null;
  ticketPromedio: number | null;
};

/** El mismo recorte corrido hacia atrás, para comparar. */
export type ComparacionTiendaNube = {
  desde: string;
  hasta: string;
  ventaCiva: number;
  unidades: number;
  pedidos: number;
  rentabilidad: number;
  margenPct: number | null;
};

export type PuntoDiaTiendaNube = { fecha: string; venta: number; rentabilidad: number };

/** Una fila de cualquier ranking por dimensión (proveedor, marca). */
export type RankingTiendaNube = {
  label: string;
  venta: number;
  unidades: number;
  rentabilidad: number;
  margenPct: number | null;
};

export type ArticuloTiendaNube = {
  sku: string | null;
  producto: string | null;
  proveedor: string | null;
  marca: string | null;
  unidades: number;
  ventaCiva: number;
  ventaSiva: number;
  costo: number;
  envio: number;
  rentabilidad: number;
  margenPct: number | null;
};

/**
 * Un cliente con su historia. `pedidos` cuenta los del recorte elegido;
 * `primera` y `ultima` son sus fechas dentro de ese recorte.
 */
export type ClienteTiendaNube = {
  cliente: string;
  pedidos: number;
  unidades: number;
  ventaCiva: number;
  rentabilidad: number;
  margenPct: number | null;
  primera: string | null;
  ultima: string | null;
};

/**
 * Un pedido, entero. Existe porque en este canal se puede: son treinta en cuatro
 * meses, así que la venta individual es una unidad de análisis real y no un
 * volcado de base.
 */
export type PedidoTiendaNube = {
  nroOrden: string | null;
  fecha: string | null;
  cliente: string | null;
  lineas: number;
  unidades: number;
  ventaCiva: number;
  ventaSiva: number;
  costo: number;
  envio: number;
  rentabilidad: number;
  margenPct: number | null;
  rentabilidadNeta: number;
  margenNetoPct: number | null;
};

export type OpcionesTiendaNube = {
  proveedores: string[];
  marcas: string[];
  /** Primer y último día con ventas, para acotar los selectores de fecha. */
  primeraVenta: string | null;
  ultimaVenta: string | null;
};

export type DashboardTiendaNube = {
  kpis: KpisTiendaNube;
  rango: RangoMeli;
  /** Null si el período anterior no tiene ninguna venta con qué comparar. */
  comparacion: ComparacionTiendaNube | null;
  porDia: PuntoDiaTiendaNube[];
  porProveedor: RankingTiendaNube[];
  // No hay `porMarca`: el panel de rentabilidad por marca se saco de este
  // tablero. La marca sigue estando como FILTRO y como columna de la tabla de
  // articulos, que es donde se la mira en un canal de 50 lineas.
  topRentabilidad: ArticuloTiendaNube[];
  articulos: ArticuloTiendaNube[];
  clientes: ClienteTiendaNube[];
  pedidos: PedidoTiendaNube[];
  /** `true` si `pedidos` quedó recortada por el tope de la consulta. */
  pedidosRecortados: boolean;
  /** Denominador de la torta: venta de TODOS los proveedores, sin filtro cruzado. */
  ventaTotalProveedores: number;
  /** Último día con ventas cargadas: avisa si el dato viene atrasado. */
  ultimaVenta: string | null;
  generadoEn: string;
};
