export type Filtros = {
  vendedor?: string;
  empresa?: string;
  mes?: string;
  /** Vía `fact_ventas_flete` -> `reporte_logistica`, igual que el slicer del .pbit. */
  provincia?: string;
  // Filtros cruzados: salen de hacer click en un gráfico o en una tabla.
  // No tienen selector propio; se limpian con su chip o con "Limpiar".
  proveedor?: string;
  cliente?: string;
  sku?: string;
  comprobante?: string;
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
  vendedor?: string;
  empresa?: string;
  mes?: string;
  transporte?: string;
  provincia?: string;
  /** Filtro cruzado: sale de hacer click en un proveedor de un gráfico. */
  proveedor?: string;
  /** 'real' | 'estimado' — espeja el slicer "Estado flete". */
  estadoFlete?: string;
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
  vendedor?: string;
  empresa?: string;
  categoria?: string;
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
  mes?: string;
  /** Filtro cruzado: sale de hacer click en una barra. */
  grupo?: string;
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
