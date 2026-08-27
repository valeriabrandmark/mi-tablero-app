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
  /**
   * Texto libre del buscador. Va contra nombre de cliente, SKU y descripción
   * del artículo, todo a la vez.
   *
   * No es una lista como el resto: es UN término, y el usuario no elige contra
   * qué columna busca — pega lo que tiene a mano y el buscador se arregla.
   *
   * OJO que no es lo mismo que los filtros `cliente` y `sku`, que son cruzados
   * (salen de un click) y comparan por valor EXACTO. Este compara por contenido.
   */
  buscar?: string;
};

/** Dimensiones que solo existen como filtro cruzado (sin selector arriba). */
export const CRUZADOS = ["proveedor", "cliente", "sku", "comprobante"] as const;
export type Cruzado = (typeof CRUZADOS)[number];

export type FilaArticulo = {
  sku: string | null;
  producto: string | null;
  cantidad: number;
  /**
   * El descuento que se le hizo AL CLIENTE en la venta (línea + general +
   * financiero, combinados por `modelo.py`). No tiene nada que ver con las dos
   * ofertas de abajo, que son del Excel de costos; los nombres se parecen y son
   * tres cosas distintas.
   */
  ofertaPct: number | null;
  /** Columna J del Excel de costos: el descuento que da el proveedor. */
  ofertaProveedorPct: number | null;
  /** Columna K del Excel de costos: el descuento que ponemos nosotros. */
  ofertaPropiaPct: number | null;
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
  /** Null cuando la facturación del cliente neteó a cero: no hay % que calcular. */
  valor: number | null;
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
  /** Null cuando la facturación del proveedor neteó a cero. */
  margenPct: number | null;
  unidades: number;
};

/** Fila lista para recharts: `{ fecha, "Juan": 12345, "Ana": 6789 }` */
export type PuntoDiaVendedor = { fecha: string } & Record<
  string,
  number | string
>;

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

export type PuntoEtiqueta = {
  label: string;
  valor: number;
  /**
   * Segunda serie, para las barras apiladas. Solo la usa el gráfico por hora de
   * Mercado Libre, donde `valor` es lo vendido y `valor2` lo cancelado; los dos
   * montos son ajenos entre sí, así que apilarlos da lo transaccionado.
   */
  valor2?: number;
};

export type FilaComprobante = {
  comprobante: string | null;
  nroOrden: string | null;
  cliente: string | null;
  provincia: string | null;
  fecha: string | null;
  facturacion: number;
  flete: number;
  pctFlete: number | null;
  /** Renglones con la factura del transportista ya cargada. */
  lineasReales: string;
  /** Renglones del comprobante. Si no coincide con `lineasReales`, hay mezcla. */
  lineasTotales: string;
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

/**
 * El mes anterior, para comparar. `hasta` dice hasta qué día se lo midió: tiene
 * valor cuando el mes elegido es el que está corriendo —y por lo tanto está a
 * medio pasar—, y es null cuando los dos meses están cerrados.
 */
export type ComparacionMayorista = {
  mes: string;
  hasta: string | null;
  facturacionNeta: number;
  costoMercaderia: number;
  unidades: number;
  clientesConCompra: number;
  cantidadPedidos: number;
  margenAjustado: number;
  rentabilidadAjustadaPct: number | null;
};

export type DashboardVentasMayoristas = {
  /** En qué modo se calculó el margen de esta respuesta. */
  conFlete: boolean;
  kpis: Kpis;
  facturacionPorProveedor: PuntoProveedor[];
  /** Denominador de la torta: total de TODOS los proveedores, sin el filtro cruzado. */
  facturacionTotalProveedores: number;
  margenPorProveedor: MargenProveedor[];
  rentabilidadPorCliente: RentabilidadCliente[];
  articulos: FilaArticulo[];
  comprobantes: FilaComprobanteVenta[];
  serieDiaria: SerieDiaria;
  /** Null si no hay un solo mes elegido: sin eso no hay "mes anterior". */
  comparacion: ComparacionMayorista | null;
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
  /**
   * Filtro cruzado: sale de hacer click en una fila de la tabla de
   * comprobantes. Recorta las VENTAS del vendedor a ese cliente, pero NO el
   * objetivo: el objetivo del mes es el mismo tenga uno o veinte clientes. Por
   * eso el avance sigue midiéndose contra la meta entera y la pantalla lo dice.
   */
  cliente?: string[];
};

/** Totales de una métrica. Nunca se mezclan dos métricas en un mismo total. */
export type ResumenMetrica = {
  metrica: Metrica;
  objetivo: number;
  /** Todo lo vendido, excedentes incluidos. */
  vendido: number;
  /**
   * Lo vendido que cuenta para el objetivo: cada grupo topeado en su meta.
   * Es el numerador de `avancePct` — pasarse en un grupo no compensa otro.
   */
  vendidoComputable: number;
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
  /**
   * Filtro cruzado: sale de hacer click en una barra del gráfico por hora.
   * Son horas del día (0-23) en hora ARGENTINA, como texto porque viajan por
   * la URL igual que el resto de los filtros.
   */
  hora?: string[];
  /** Solo en la pestaña Alertas: nivel de alerta (ver `NIVELES_ALERTA`). */
  alerta?: string[];
  /**
   * Texto libre del buscador. Va contra número de orden, número de venta
   * (el del paquete), SKU y descripción del artículo, todo a la vez.
   *
   * No es una lista como el resto: es UN término, y el usuario no elige contra
   * qué columna busca — pega lo que tiene a mano y el buscador se arregla.
   */
  buscar?: string;
};

/**
 * Una hora del día (0-23) con lo que pasó en ella.
 *
 * `venta` y `cancelado` son montos distintos y NO se solapan: lo cancelado
 * nunca entró a `gold.fact_ventas`. Sumarlos da lo transaccionado en esa hora.
 */
export type PuntoHora = {
  hora: number;
  ordenes: number;
  venta: number;
  cancelado: number;
  ordenesCanceladas: number;
};

/**
 * La última orden que entró a la base. Sirve para ver el atraso del pipeline
 * contra el reloj de quien está mirando la pantalla.
 */
export type UltimaCargaMeli = {
  /** El número de orden de Mercado Libre, para poder buscarla allá. */
  nroOrden: string;
  /** `YYYY-MM-DD HH:MM` ya en hora argentina, listo para mostrar. */
  local: string;
  /** El mismo instante en UTC, para calcular "hace cuánto" en el navegador. */
  iso: string;
};

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
export type PuntoDiaMeli = {
  fecha: string;
  venta: number;
  rentabilidad: number;
};

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

/**
 * Una LÍNEA de venta: el mismo artículo, pero de una orden concreta.
 *
 * Es lo que muestra la tabla de artículos. `ArticuloMeli` a secas —sin número de
 * orden— sigue siendo lo que muestra el top por rentabilidad, que agrupa todas
 * las ventas de un SKU y por lo tanto no tiene UNA orden que mostrar.
 */
export type LineaVentaMeli = ArticuloMeli & {
  /** El número de orden de Mercado Libre, para ir a buscarla allá. */
  nroOrden: string | null;
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
  // No hay `porMarca`: el panel de rentabilidad por marca se sacó. La marca
  // sigue estando como FILTRO y como columna de la tabla de artículos.
  /** Los SKUs que más plata dejaron, que no son los que más vendieron. */
  topRentabilidad: ArticuloMeli[];
  articulos: LineaVentaMeli[];
  /** Denominador de la torta: venta de TODOS los proveedores, sin filtro cruzado. */
  ventaTotalProveedores: number;
  /** La última orden cargada: es la medida real del atraso del tablero. */
  ultimaCarga: UltimaCargaMeli | null;
  /** Lo que se canceló en el mismo recorte. No entra en ningún KPI de venta. */
  cancelaciones: CancelacionesMeli;
  generadoEn: string;
};

/** Un SKU con lo que se le canceló en el recorte. */
export type FilaCancelacionMeli = {
  sku: string | null;
  producto: string | null;
  proveedor: string | null;
  marca: string | null;
  /**
   * El número de orden. Antes acá iba `ordenes` (cuántas órdenes tenía ese SKU),
   * pero desde que hay una fila por orden y SKU esa cuenta valdría siempre 1.
   * El total de órdenes distintas sigue estando en `CancelacionesMeli.ordenes`.
   */
  nroOrden: string | null;
  unidades: number;
  /** Monto c/IVA que se habría facturado. No hay costo ni margen: no fue venta. */
  monto: number;
};

/**
 * Las cancelaciones del recorte.
 *
 * NO salen de `gold.fact_ventas` sino de `bronze.ml_ventas`: una cancelación no
 * es una venta y no tiene que estar en la tabla de ventas. Meterla ahí con una
 * marquita obligaría a que cada consulta del sistema se acuerde de excluirla, y
 * el día que una se olvide el número queda mal sin que nadie lo note.
 *
 * Por eso tampoco afecta a ningún KPI de venta: se mira aparte, que es lo que es.
 */
export type CancelacionesMeli = {
  /** Órdenes DISTINTAS, no la suma de las filas: una orden puede tener varios SKU. */
  ordenes: number;
  unidades: number;
  monto: number;
  filas: FilaCancelacionMeli[];
  /** `true` si `filas` quedó recortada por el tope de la consulta. */
  recortada: boolean;
};

// --- Venta minorista: Mercado Libre / Alertas --------------------------------

/** Una venta individual con su rentabilidad desagregada, como la planilla. */
export type FilaAlertaMeli = {
  nivel: string;
  /**
   * La orden tuvo una devolución PARCIAL: el cliente devolvió algo y se quedó
   * con el resto. Cuenta como venta —por eso está en esta tabla— pero por el
   * importe COMPLETO, sin descontar lo devuelto, porque la API de Mercado Libre
   * no informa ese monto en la orden. O sea que su rentabilidad está algo
   * sobreestimada, y por eso la fila se marca.
   */
  parcial: boolean;
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

export type PuntoDiaTiendaNube = {
  fecha: string;
  venta: number;
  rentabilidad: number;
};

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
  /**
   * Lo que se resignó en este pedido, CON IVA. Ya viene descontado de
   * `ventaCiva`: está acá para poder ver cuánto se bonificó, no para restarlo
   * de nuevo.
   */
  descuento: number;
  /** Lo que se llevó la pasarela de pago en este pedido. Ya está restado de la rentabilidad. */
  comision: number;
  /**
   * Código del cupón que explica el descuento (`GANADOR100K`, el premio de un
   * sorteo). `null` cuando no hubo cupón — el descuento puede venir de una
   * promoción sin código.
   */
  cupon: string | null;
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

// --- Venta minorista: Mercado Libre / Stock Full ------------------------------

export type FiltrosStockFull = {
  proveedor?: string[];
  marca?: string[];
  sku?: string[];
  /** "Sin vender hace más de N días". El que nunca vendió entra siempre. */
  minDias?: number;
};

export type KpisStockFull = {
  skus: number;
  /** Unidades que Mercado Libre puede vender. */
  disponible: number;
  /** En el depósito pero NO vendibles: dañadas, en revisión, reservadas. */
  noDisponible: number;
  valorizacion: number;
  /** SKUs sin vender hace más de `UMBRAL_PARADO` días, o que nunca vendieron. */
  skusParados: number;
  valorizacionParada: number;
  /** Unidades vendidas en los últimos 30 días, para saber si el stock rota. */
  uds30: number;
};

export type TramoStockFull = {
  proveedor: string;
  tramo: string;
  skus: number;
  disponible: number;
  valorizacion: number;
};

export type FilaStockFull = {
  sku: string | null;
  producto: string | null;
  proveedor: string | null;
  marca: string | null;
  disponible: number;
  noDisponible: number;
  ultimaVenta: string | null;
  /** Null = nunca vendió desde que hay datos (06/05), que no es "hace mucho". */
  diasSinVenta: number | null;
  uds30: number;
  valorizacion: number;
};

export type DashboardStockFull = {
  kpis: KpisStockFull;
  /** Cuántos SKU llevan más de N días sin vender. Acumulativos, no excluyentes. */
  umbrales: Record<number, number>;
  tramos: TramoStockFull[];
  filas: FilaStockFull[];
  recortada: boolean;
  /**
   * Desde cuándo hay foto diaria del stock, o null si todavía no hay ninguna.
   * Lo usa la pantalla para decir a partir de cuándo va a poder mostrar "días
   * continuos con stock", que es la métrica que esto todavía NO es.
   */
  historiaDesde: string | null;
  generadoEn: string;
};

// --- Elasticidad de precios (Mercado Libre) ---------------------------------

export type FiltrosElasticidad = {
  /** El período a mirar. La banda de cada venta sale de la venta misma. */
  desde: string;
  hasta: string;
  proveedor?: string[];
  marca?: string[];
  sku?: string[];
  /** Bandas elegidas al hacer click en un gráfico. Filtra TODO el tablero. */
  banda?: string[];
  /** Sólo los artículos con volumen suficiente para leerse solos. */
  soloConfiables?: boolean;
};

/** El total de una banda de %margen. */
export type ResumenBanda = {
  banda: string;
  /** `false` en los dos bordes (<10 % y >35 %), que no son del experimento. */
  delExperimento: boolean;
  skus: number;
  lineas: number;
  unidades: number;
  facturacion: number;
  margen: number;
  /** Margen del conjunto: pesos sobre facturación, no promedio de porcentajes. */
  margenPct: number | null;
  /** El criterio de desempate: cuánto dejó cada unidad movida. */
  margenPorUnidad: number | null;
};

export type FilaElasticidad = {
  sku: string;
  producto: string | null;
  marca: string | null;
  proveedor: string | null;
  unidades: number;
  margen: number;
  unidadesPorBanda: Record<string, number>;
  margenPorBanda: Record<string, number>;
  /** El %margen con el que se vendió en cada banda. */
  margenPctPorBanda: Record<string, number | null>;
  /**
   * Facturación por banda. No se muestra, pero sin ella la fila de totales no
   * podría promediar los porcentajes como corresponde: el %margen del conjunto
   * es margen total sobre facturación total, no el promedio de los porcentajes
   * de cada artículo.
   */
  facturacionPorBanda: Record<string, number>;
  facturacion: number;
  /** La banda que más dejó, o null si vendió en menos de dos. */
  mejor: string | null;
  /** `true` si tiene volumen propio para leerse sin el agregado. */
  confiable: boolean;
  /** Días del período en que no se pudo comprar. Sólo cuenta los días mirados. */
  diasSinStock: number;
};

/** Un día en que un artículo no se pudo comprar en ningún momento. */
export type DiaSinStock = { sku: string; dia: string };

export type KpisElasticidad = {
  skus: number;
  unidades: number;
  facturacion: number;
  margen: number;
  margenPct: number | null;
  /** Fracción de las unidades que cayó dentro de las tres bandas del experimento. */
  dentroDelRango: number | null;
  /** Días del período en que el pulso corrió al menos una vez. */
  diasMirados: number;
  /** Cuántos artículos quebraron stock al menos un día. */
  skusQuebrados: number;

  /**
   * En cuántos ARTÍCULOS ganó cada banda, contando sólo los que vendieron en
   * dos o más bandas.
   *
   * Es el titular bueno, y no el agregado. Comparar el margen total de la banda
   * 25-35 contra el de la 10-18 mezcla artículos distintos: los que sostienen
   * un margen alto son otros productos, no los mismos más caros. Esta cuenta
   * compara a cada artículo CONSIGO MISMO, que es lo único que aísla el efecto
   * del precio.
   */
  votosPorBanda: Record<string, number>;
  /** Artículos que vendieron en dos o más bandas (los únicos comparables). */
  comparables: number;
  /** De ésos, los que además tienen volumen para leerse solos. */
  comparablesConVolumen: number;
};

export type DashboardElasticidad = {
  hayDatos: boolean;
  falta: string | null;
  desde: string;
  hasta: string;
  kpis: KpisElasticidad;
  bandas: ResumenBanda[];
  articulos: FilaElasticidad[];
  diasSinStock: DiaSinStock[];
  recortada: boolean;
  generadoEn: string;
};

// --- Resultados por semana (elasticidad) ------------------------------------

/** Lo que un artículo hizo en una semana. */
export type CeldaSemana = {
  unidades: number;
  margen: number;
  /** No se muestra; es el denominador para promediar el %margen. */
  facturacion: number;
  /** Días de esa semana en que no se pudo comprar. Sólo cuenta los medidos. */
  diasSinStock: number;
};

export type FilaResultado = {
  sku: string;
  producto: string | null;
  marca: string | null;
  proveedor: string | null;
  /** Una entrada por semana del experimento, siempre las mismas claves. */
  semanas: Record<number, CeldaSemana>;
  unidades: number;
  margen: number;
  facturacion: number;
};

export type ResumenSemana = {
  numero: number;
  desde: string;
  hasta: string;
  label: string;
  skus: number;
  unidades: number;
  facturacion: number;
  margen: number;
  margenPct: number | null;
  /**
   * Días de la semana en que el pulso corrió. Es lo que hace legible la
   * semana 1: la historia de stock arrancó el 21/08, así que sus primeros días
   * no se midieron y sus quiebres no se pueden conocer.
   */
  diasMirados: number;
  skusQuebrados: number;
};

export type DashboardResultados = {
  semanas: ResumenSemana[];
  articulos: FilaResultado[];
  recortada: boolean;
  generadoEn: string;
};
