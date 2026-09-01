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
  /** Lo que se llevó la pasarela de pago. Calculado con el arancel de cada medio. */
  comision: number;
  /** Fracción de comisión sobre venta c/IVA. `null` si no hubo venta. */
  comisionPct: number | null;
  /**
   * La parte de la tarifa que se queda Tienda Nube por la plataforma, separada
   * de la que se queda la pasarela. Pago Nube la bonifica; Nave la cobra
   * entera. No se suma a `comision`: las dos salen de partir la misma tarifa.
   */
  costoTransaccion: number;
  /** Venta s/IVA − costo − envío − comisión. */
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
   * La otra mitad de la misma tarifa: lo que cobra Tienda Nube por la
   * plataforma. Pago Nube lo bonifica (queda en 0), Nave lo cobra entero.
   * No es un costo aparte del de `comision` — es el mismo, partido en dos.
   */
  costoTransaccion: number;
  /**
   * Código del cupón que explica el descuento (`GANADOR100K`, el premio de un
   * sorteo). `null` cuando no hubo cupón — el descuento puede venir de una
   * promoción sin código.
   */
  cupon: string | null;
  /**
   * Pasarela cruda de la API (`pago-nube`, `nave`, `free`) y medio de pago
   * crudo (`credit_card`, `wallet`, `wire_transfer`). Explican de dónde sale
   * `comision`: el arancel se cobra por la combinación de las dos. `null` en
   * los pedidos viejos, cargados antes de que se guardara el medio de pago.
   */
  pasarela: string | null;
  metodoPago: string | null;
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
  /**
   * El canal contra sus costos fijos.
   *
   * `contribucion` es lo que deja la operación —venta s/IVA menos costo, envío,
   * comisión y costo por transacción— antes del abono del plan. `costosFijos`
   * es ese abono, prorrateado por día sobre el rango. La diferencia entre las
   * dos es el resultado real del canal.
   *
   * OJO: `costosFijos` NO responde a los filtros de proveedor, marca o SKU —el
   * plan se paga igual—, pero `contribucion` sí. Al filtrar se está comparando
   * una parte de la venta contra el costo fijo entero, y la pantalla lo avisa.
   */
  equilibrio: {
    contribucion: number;
    costosFijos: number;
    /** `false` = todavía no cargamos el abono, no que el plan sea gratis. */
    costosFijosCargados: boolean;
    /** Fracción de los costos fijos que cubre la contribución. */
    coberturaPct: number | null;
    /** Venta c/IVA necesaria para empatar, al margen de contribución actual. */
    ventaEquilibrio: number | null;
  };
  /**
   * Cuánto cuesta traer un cliente nuevo, y con qué compararlo.
   *
   * `gasto` es la inversión en marketing del rango (agencia, pauta,
   * influencers), prorrateada por día. NO sale de ninguna API: se carga a mano
   * en `bronze.gastos_marketing`, porque ni Tienda Nube ni Google Analytics
   * saben lo que se paga por la pauta.
   *
   * `contribucionPorNuevo` es el número contra el que hay que leer el `cac`:
   * si traer al cliente cuesta más que lo que deja, esa venta pierde plata. Y
   * con la recompra que tiene el canal —uno de cada treinta y un compradores
   * volvió— no hay una segunda compra que lo compense.
   */
  adquisicion: {
    gasto: number;
    /** `false` = no cargamos el gasto del período, no que haya sido cero. */
    gastoCargado: boolean;
    clientesNuevos: number;
    /** Costo de adquisición. `null` si falta el gasto o no hubo clientes. */
    cac: number | null;
    contribucionPorNuevo: number | null;
  };
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

/* -------------------------------------------------------------------------
   Stock (Operaciones)
   ------------------------------------------------------------------------- */

export type FiltrosStock = {
  proveedor?: string[];
  marca?: string[];
  sku?: string[];
  /** Sobre cuántos días se mide el ritmo de venta. Ver lib/stock.ts. */
  ventana?: number;
  /** Qué depósito se mira: `ambos`, `tucuman` o `full`. */
  deposito?: string;
  /** Deja sólo los artículos de un tramo de cobertura. */
  tramo?: string;
  /** Busca por SKU o por descripción. */
  buscar?: string;
};

export type FilaStock = {
  sku: string;
  producto: string | null;
  proveedor: string | null;
  marca: string | null;
  /** Depósito de Tucumán (Digip), unidades disponibles. */
  tuc: number;
  /** Depósito de Mercado Libre (Full), unidades disponibles. */
  full: number;
  total: number;
  /** Costo neto del último mes con costo cargado. `0` si no hay. */
  costo: number;
  valor: number;
  /** Unidades vendidas en la ventana elegida, por canal. */
  uds: number;
  udsMeli: number;
  udsTn: number;
  udsMayorista: number;
  /** Unidades por día. `0` si no vendió. */
  ritmoDiario: number;
  /** Días que dura el stock al ritmo actual. `null` si no vendió. */
  cobertura: number | null;
  /** Unidades por encima de la cobertura objetivo, y su costo. */
  excesoU: number;
  exceso: number;
  /** Unidades que faltan para cubrir objetivo + reposición. */
  sugerido: number;
  ultimaVenta: string | null;
  /** Última factura de compra que incluye este SKU. Ver `comprasHasta`. */
  ultimaCompra: string | null;
  /**
   * Días que las unidades llevan en el depósito de Mercado Libre, promedio
   * ponderado por unidad. `null` si el SKU no tiene stock en Full o si todavía
   * no se calculó. SÓLO aplica a Full: en Tucumán no hay historia de
   * movimientos con la que reconstruirlo.
   */
  diasEnFull: number | null;
  /** Unidades en Full que llevan más de 120 días, y lo que valen a costo. */
  uMas120: number;
  valorMas120: number;
};

export type KpisStock = {
  skus: number;
  unidades: number;
  valor: number;
  /** Sin una venta en la ventana. */
  skusSinVenta: number;
  valorSinVenta: number;
  /** Se agotan antes de que llegue una reposición pedida hoy. */
  skusQuiebre: number;
  /** Unidades en Full con más de 120 días encima, y su costo. */
  uMas120: number;
  valorMas120: number;
  /** Plata por encima de la cobertura objetivo. */
  exceso: number;
  skusSinCosto: number;
};

export type TramoStock = {
  tramo: string;
  skus: number;
  unidades: number;
  valor: number;
};

export type ProveedorStock = {
  proveedor: string;
  skus: number;
  valor: number;
  exceso: number;
};

export type DashboardStock = {
  kpis: KpisStock;
  tramos: TramoStock[];
  proveedores: ProveedorStock[];
  filas: FilaStock[];
  recortada: boolean;
  ventana: number;
  deposito: string;
  /**
   * Fecha de la última foto de antigüedad. `null` mientras el paso del
   * orquestador no haya corrido: la pantalla lo dice en vez de mostrar ceros
   * que se leerían como "no hay mercadería vieja".
   */
  antiguedadAl: string | null;
  /**
   * Fecha de la última compra cargada en la base. Se muestra en pantalla porque
   * la columna "Última compra" es un piso, no la verdad: pasada esta fecha no
   * hay comprobantes cargados y la fecha de un artículo puede ser vieja sólo
   * por eso.
   */
  comprasHasta: string | null;
  generadoEn: string;
};

/* -------------------------------------------------------------------------
   Antigüedad de stock (Operaciones -> Stock -> Antigüedad)
   ------------------------------------------------------------------------- */

export type FiltrosAntiguedad = {
  proveedor?: string[];
  marca?: string[];
  sku?: string[];
  /** Deja los artículos con alguna unidad en ese tramo de antigüedad en Full. */
  tramo?: string;
  /** Deja los artículos con alguna unidad en ese tramo de vencimiento. */
  vencimiento?: string;
  buscar?: string;
};

export type FilaAntiguedad = {
  sku: string;
  producto: string | null;
  proveedor: string | null;
  marca: string | null;
  /** Unidades en Full aptas para vender, y las que no. */
  aptas: number;
  noAptas: number;
  /** Unidades en ubicaciones activas de Tucumán, sin apartar para pedidos. */
  tuc: number;
  total: number;
  costo: number;
  valor: number;
  /**
   * Días que las unidades llevan en Full, promedio ponderado por unidad.
   * `null` si el SKU no está en Full o si la foto todavía no se calculó.
   */
  diasEnFull: number | null;
  /** Unidades sobre las que se pudo medir la antigüedad. */
  uMedidas: number;
  /** Unidades en Full con más de 120 días, y lo que valen a costo. */
  uMas120: number;
  valorMas120: number;
  /**
   * `true` si el libro de operaciones no explicaba todas las unidades del
   * inventario. Las que sobran se cuentan como viejas —el lado conservador—,
   * así que la antigüedad de ese SKU es un piso.
   */
  parcial: boolean;
  /** Unidades de Tucumán con la fecha de vencimiento ya pasada. */
  uVencido: number;
  valorVencido: number;
  /** Unidades que vencen dentro del plazo de alarma. */
  uPorVencer: number;
  valorPorVencer: number;
  /** El próximo vencimiento que todavía no pasó. */
  proxVto: string | null;
  diasAVencer: number | null;
  /** Unidades vendidas en la ventana, y cuándo fue la última venta. */
  uds: number;
  ultimaVenta: string | null;
  /** Días hasta agotar el stock al ritmo de la ventana. `null` si no vendió. */
  diasAgotar: number | null;
};

export type KpisAntiguedad = {
  skus: number;
  uFull: number;
  uTucuman: number;
  valor: number;
  /** Unidades en Full que Mercado Libre no deja vender (perdidas, retiros). */
  noAptas: number;
  uMas120: number;
  valorMas120: number;
  uVencido: number;
  valorVencido: number;
  uPorVencer: number;
  valorPorVencer: number;
  /** Antigüedad promedio en Full, ponderada por unidad. `null` sin foto. */
  diasPromedio: number | null;
  /** SKU cuya antigüedad es un piso porque el libro no cerraba. */
  skusParciales: number;
};

export type TramoAntiguedad = { tramo: string; unidades: number; valor: number };
export type TramoVencimiento = { tramo: string; unidades: number; valor: number };

export type DashboardAntiguedad = {
  kpis: KpisAntiguedad;
  antiguedad: TramoAntiguedad[];
  vencimiento: TramoVencimiento[];
  filas: FilaAntiguedad[];
  recortada: boolean;
  ventanaVentas: number;
  diasPorVencer: number;
  /** Fecha de la última foto de antigüedad. `null` si todavía no corrió. */
  antiguedadAl: string | null;
  /**
   * Cuántos SKU trae esa foto. Puede ser 0 con fecha cargada: el paso calcula
   * por inventario de Mercado Libre y el enlace con nuestro código es otro
   * momento. La pantalla usa los dos datos para decir cuál de las dos cosas
   * falta, en vez de mostrar ceros.
   */
  antiguedadSkus: number;
  /**
   * Cuántos SKU con stock en Full HABRÍA que cubrir. Si son más que
   * `antiguedadSkus`, la diferencia son los inventarios que Mercado Libre no
   * contestó ese día — y esos SKU muestran un guión, que sin esta cuenta se
   * leería como "no está en Full" en vez de "no se pudo medir".
   */
  antiguedadSkusFull: number;
  generadoEn: string;
};

/* -------------------------------------------------------------------------
   Compras (Operaciones -> Stock -> Compras)
   ------------------------------------------------------------------------- */

export type FiltrosCompras = {
  proveedor?: string[];
  marca?: string[];
  /** Sobre cuántos días se mide el ritmo de venta. Ver lib/stock.ts. */
  ventana?: number;
  /** Mes comercial del que sale la oferta del proveedor (`YYYY-MM`). */
  mes?: string;
  /** `true` para ver también los artículos que el cálculo no pidió comprar. */
  todos?: boolean;
  buscar?: string;
};

export type FilaCompra = {
  sku: string;
  producto: string | null;
  proveedor: string | null;
  marca: string | null;
  /** Cuántas unidades trae un bulto. `1` cuando el artículo no se compra así. */
  unidadesPorBulto: number;
  tuc: number;
  full: number;
  total: number;
  /** Costo neto con el que se valoriza el stock que ya está. */
  costo: number;
  valor: number;
  /** Costo de lista del mes elegido: sobre éste se aplica el descuento. */
  costoLista: number;
  /**
   * El sell in VIGENTE del proveedor en el mes elegido, EN PUNTOS (15 = 15 %).
   * Es el único que puede ir a FDESCU1. Sale de `bronze.sell_in`, que se carga
   * desde la planilla de Google. `null` mientras no esté cargado — que no es lo
   * mismo que 0.
   */
  sellInPct: number | null;
  /**
   * El sell in CALCULADO a partir de nuestras compras
   * (`costos_historicos.oferta_pct`), con el que se valoriza el costo real.
   *
   * SE MUESTRA COMO REFERENCIA Y NO VIAJA AL ARCHIVO. No es lo que el proveedor
   * tiene vigente: mandarlo en una orden de compra sería pedir con un descuento
   * inventado.
   */
  ofertaCalculadaPct: number | null;
  /** Unidades vendidas en la ventana del ritmo. */
  uds: number;
  ritmoDiario: number;
  cobertura: number | null;
  /** Unidades que faltan para cubrir objetivo + reposición. */
  sugerido: number;
  /** Unidades vendidas en los últimos 3 meses, y qué rentabilidad dejaron. */
  udsRentabilidad: number;
  rentabilidad: number | null;
  /**
   * Lo mismo pero del MES CALENDARIO pasado. Va aparte de la ventana móvil
   * porque son dos preguntas: cómo viene rindiendo el artículo, y a cuánto se
   * vendió el mes que acaba de cerrar — que es contra lo que se mira si la
   * oferta que el proveedor ofrece ahora conviene.
   */
  udsMesPasado: number;
  rentMesPasado: number | null;
  /**
   * Si ese SKU aparece en un renglón de compra del mes pasado.
   *
   * `false` NO alcanza para decir "no se compró": de los 173 comprobantes de
   * agosto, 14 traen el detalle de renglones. Por eso viene al lado
   * `proveedorComproMesPasado`, que sale de la cabecera y no del detalle.
   */
  compradoMesPasado: boolean;
  /** Si hubo alguna compra a ese proveedor el mes pasado, por cabecera. */
  proveedorComproMesPasado: boolean;
  /**
   * Los últimos seis meses de descuento, del más nuevo al más viejo. Para poder
   * decir si la oferta de este mes es buena o si es la de siempre.
   *
   * Vienen los dos por separado y la pantalla muestra uno: el del proveedor
   * cuando esté cargado, el calculado con nuestras compras mientras tanto. El
   * título de la columna dice cuál de los dos se está viendo.
   */
  histSellIn: { mes: string; pct: number }[];
  histCalculado: { mes: string; pct: number }[];
  ultimaVenta: string | null;
  ultimaCompra: string | null;
};

export type DashboardCompras = {
  filas: FilaCompra[];
  recortada: boolean;
  ventana: number;
  /** El mes calendario pasado (`YYYY-MM`), que es de donde salen las columnas
   * de rentabilidad y de compra del mes pasado. Lo calcula el servidor para que
   * la pantalla no lo vuelva a deducir y los dos puedan discrepar un día 1. */
  mesPasado: string;
  /** Mes del que sale el sell in, y los que hay para elegir. */
  mes: string;
  meses: string[];
  /**
   * Cuántos artículos tiene el sell in de ese mes. `0` es "todavía no se
   * cargó", y la pantalla lo dice en vez de mostrar todos los descuentos en
   * cero como si el proveedor no diera ninguno.
   */
  sellInCargado: number;
  comprasHasta: string | null;
  generadoEn: string;
};
