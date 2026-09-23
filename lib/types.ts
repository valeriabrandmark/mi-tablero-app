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

/**
 * Un punto del historial mensual de cuentas corrientes, con el DÍA del que es
 * la foto.
 *
 * La fecha no es decoración: cada barra es una foto de un día suelto —la más
 * nueva de ese mes— y no el cierre del mes. El mes en curso se fotografía con
 * lo que haya hasta hoy, así que sin la fecha a la vista una barra más baja se
 * lee como "bajó la mora" cuando puede ser "todavía no terminó el mes".
 */
export type PuntoHistorial = PuntoEtiqueta & { fecha: string | null };

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
  /** Los comprobantes vencidos, UNO POR UNO. Ver la nota en queries-cuentas.ts. */
  comprobantesVencidos: ComprobanteVencido[];
  historial: PuntoHistorial[];
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
  /**
   * Texto libre. Va contra el nombre del cliente Y el número de comprobante a
   * la vez, porque quien busca tiene uno de los dos a mano y no quiere elegir
   * contra cuál compara. Recorta las VENTAS, igual que `cliente`.
   */
  buscar?: string;
};

/**
 * Un comprobante impago cuyo vencimiento ya pasó.
 *
 * Sale de `bronze.cuentas_corrientes_aging`, que es UNA FOTO al momento de la
 * carga y no un acumulado del mes: por eso esta tabla no se mueve con el
 * selector de mes, igual que la tarjeta de vencido de arriba.
 */
export type ComprobanteVencido = {
  comprobante: string | null;
  /** Del comprobante, no del vencimiento. */
  fecha: string | null;
  vencimiento: string | null;
  cliente: string | null;
  empresa: string | null;
  /** Código de SIGMA (006, 007…). Lo muestra Cuentas Corrientes, que mezcla
   *  vendedores; en la página de un vendedor sería una columna de un solo valor. */
  vendedor: string | null;
  /** Lo que decía el comprobante. */
  total: number;
  /** Lo que queda debiendo: el total menos lo que se haya pagado a cuenta. */
  adeuda: number;
  diasVencido: number;
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
  /**
   * Los SKU que componen el grupo, ya unidos con " + ". Null en los grupos que
   * no se miden por SKU (los de empresa), donde el nombre ya lo dice todo.
   */
  skus: string | null;
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
  /** Los comprobantes que están detrás de ese número, uno por uno. */
  comprobantesVencidos: ComprobanteVencido[];
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
  /**
   * Los tres descuentos, iguales que en Ventas Mayoristas. Ver
   * `lib/sql-descuentos.ts`: se parecen y son cosas distintas.
   *
   *   ofertaProveedorPct  lo que EL PROVEEDOR nos descontó (columna J del Excel)
   *   ofertaPropiaPct     lo que ponemos NOSOTROS encima (columna K)
   *
   * NO está el descuento AL CLIENTE que sí tiene Mayorista: ese sale de la
   * factura de Sigma y las ventas de ML y TN no lo traen. Ver sql-descuentos.
   *
   * `null` es "sin dato", que no es lo mismo que 0.
   */
  ofertaProveedorPct: number | null;
  ofertaPropiaPct: number | null;
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
  /**
   * Los tres descuentos, iguales que en Ventas Mayoristas. Ver
   * `lib/sql-descuentos.ts`: se parecen y son cosas distintas.
   *
   *   ofertaProveedorPct  lo que EL PROVEEDOR nos descontó (columna J del Excel)
   *   ofertaPropiaPct     lo que ponemos NOSOTROS encima (columna K)
   *
   * NO está el descuento AL CLIENTE que sí tiene Mayorista: ese sale de la
   * factura de Sigma y las ventas de ML y TN no lo traen. Ver sql-descuentos.
   *
   * `null` es "sin dato", que no es lo mismo que 0.
   */
  ofertaProveedorPct: number | null;
  ofertaPropiaPct: number | null;
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
  /**
   * Los tres descuentos, iguales que en Ventas Mayoristas. Ver
   * `lib/sql-descuentos.ts`: se parecen y son cosas distintas.
   *
   *   ofertaProveedorPct  lo que EL PROVEEDOR nos descontó (columna J del Excel)
   *   ofertaPropiaPct     lo que ponemos NOSOTROS encima (columna K)
   *
   * NO está el descuento AL CLIENTE que sí tiene Mayorista: ese sale de la
   * factura de Sigma y las ventas de ML y TN no lo traen. Ver sql-descuentos.
   *
   * `null` es "sin dato", que no es lo mismo que 0.
   */
  ofertaProveedorPct: number | null;
  ofertaPropiaPct: number | null;
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
  /** Filtro cruzado: sale de hacer click en una barra del gráfico de tramos. */
  tramo?: string;
  /** "Sin vender hace más de N días". El que nunca vendió entra siempre. */
  minDias?: number;
};

export type KpisStockFull = {
  skus: number;
  /** Unidades que Mercado Libre puede vender. */
  disponible: number;
  /**
   * En el depósito pero NO vendibles: dañadas, en revisión, reservadas.
   *
   * CUENTA TAMBIÉN LOS ARTÍCULOS QUE ESTÁN ENTEROS ASÍ, que es lo que la hacía
   * mentir: el resto de la pantalla mira sólo stock vendible, y con ese corte
   * un artículo con cero disponibles y tres trabadas no existía. Eran 87 de
   * 120 unidades, el 72 %.
   */
  noDisponible: number;
  valorizacion: number;
  /**
   * Lo mismo que `valorizacion` pero A COSTO NETO: el teórico con la oferta del
   * proveedor ya descontada.
   *
   * Son dos preguntas distintas y por eso están las dos. A precio de venta dice
   * cuánto se dejaría de facturar; a costo, cuánta plata NUESTRA está parada
   * ahí. Para decidir si conviene retirar mercadería de Full manda la segunda.
   */
  valorizacionCosto: number;
  /** Lo trabado, valorizado a costo. */
  valorizacionCostoNoDisponible: number;
  /** SKUs sin vender hace más de `UMBRAL_PARADO` días, o que nunca vendieron. */
  skusParados: number;
  valorizacionParada: number;
  /** Unidades vendidas en los últimos 30 días, para saber si el stock rota. */
  uds30: number;
};

/** Un artículo con unidades que Mercado Libre no puede vender. */
export type FilaNoDisponible = {
  sku: string | null;
  producto: string | null;
  proveedor: string | null;
  marca: string | null;
  noDisponible: number;
  /** Las que SÍ se pueden vender. En 0 está el peor caso: nada vendible. */
  disponible: number;
  valorizacionCosto: number;
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
  /** Los artículos detrás de la tarjeta de "No disponible". */
  noDisponible: FilaNoDisponible[];
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
  /**
   * Empresa del grupo a la que pertenece el proveedor ("NOA COMERCIAL" o
   * "QUO MKT"). Sale de `bronze.proveedores_grupo`, con QUO MKT por defecto.
   */
  grupo?: string[];
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
  /**
   * Empresa del grupo a la que pertenece el proveedor ("NOA COMERCIAL" o
   * "QUO MKT"). Sale de `bronze.proveedores_grupo`, igual que en Stock y en
   * Compras.
   */
  grupo?: string[];
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

export type TramoAntiguedad = {
  tramo: string;
  unidades: number;
  valor: number;
};
export type TramoVencimiento = {
  tramo: string;
  unidades: number;
  valor: number;
};

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
  /**
   * Empresa del grupo a la que pertenece el proveedor ("NOA COMERCIAL" o
   * "QUO MKT"). Sale de `bronze.proveedores_grupo`, con QUO MKT por defecto.
   */
  grupo?: string[];
  /** Sobre cuántos días se mide el ritmo de venta. Ver lib/stock.ts. */
  ventana?: number;
  /**
   * Para cuántos días de venta se quiere comprar en ESTA orden.
   *
   * No confundir con `ventana`, que se le parece y es lo contrario:
   * `ventana` mira para atrás (sobre cuántos días se midió lo que se vende),
   * `cobertura` mira para adelante (cuántos días se quiere tener cubiertos).
   */
  cobertura?: number;
  /** Mes comercial del que sale la oferta del proveedor (`YYYY-MM`). */
  mes?: string;
  /**
   * Qué recortes se le aplican a la tabla. Sin nada, están todos los
   * artículos; cada uno que se marca saca filas. Ver `RecorteCompras`.
   */
  recortes?: RecorteCompras[];
  buscar?: string;
};

/**
 * QUE GRUPOS DE ARTICULOS SE MUESTRAN. Se eligen de una lista con checkboxes,
 * como cualquier otro filtro del tablero.
 *
 *   (ninguno)      todos los del filtro de proveedor / marca / grupo.
 *   sugerido       los que el cálculo pide reponer.
 *   oferta         los que tienen sell in vigente este mes.
 *   discontinuos   los que el proveedor está dando de baja (DF o DD). No se
 *                  sugieren nunca, pero se compran a liquidación.
 *   sin_ventas     los que no vendieron nada en la ventana: los recién dados
 *                  de alta y los que dejaron de moverse. Son los que el
 *                  cálculo no puede juzgar, y sin esta opción habría que
 *                  buscarlos entre miles de filas.
 *
 * SE SUMAN, NO SE CRUZAN. Marcar "hay que comprar" y después "con oferta del
 * mes" muestra los de los dos grupos, no los que cumplen las dos cosas.
 *
 * Estaban en `and` y era al revés de lo que dice el gesto: agregar una casilla
 * DEJABA MENOS filas que antes de marcarla, porque pasaba a pedir la
 * intersección. Marcar algo tiene que agregar artículos.
 *
 * ANTES ERAN DOS BOTONES SUELTOS en dos lugares distintos de la pantalla
 * --"sólo los que hay que comprar" entre los filtros y "dejar sólo con oferta"
 * abajo, en la fila de acciones de la orden-- así que lo que estaba aplicado
 * había que reconstruirlo mirando dos cosas que no se veían al mismo tiempo.
 */
export type RecorteCompras =
  | "sugerido"
  | "oferta"
  | "discontinuos"
  | "sin_ventas";

export type FilaCompra = {
  sku: string;
  producto: string | null;
  proveedor: string | null;
  /**
   * La empresa del grupo a la que pertenece el proveedor: "NOA COMERCIAL" o
   * "QUO MKT". Es la que EMITE la orden, así que va en el encabezado del Excel
   * que se le manda: una OC de un proveedor de NOA no la firma Quo.
   */
  grupo: string | null;
  marca: string | null;
  /**
   * EL CÓDIGO CON EL QUE EL PROVEEDOR LO VENDE (`sigma_articulos.codigoCompra`)
   * y el EAN de la unidad. No son nuestros: existen para el Excel que se le
   * manda al proveedor por mail, donde nuestro SKU no le dice nada. Al archivo
   * de Sigma NO van: esa grilla se importa contra nuestro maestro.
   *
   * `null` cuando el maestro no los tiene cargados: hoy 572 artículos sin
   * código de compra y 340 sin EAN, de 8.244. De esos 572, 105 se vendieron en
   * los últimos 120 días, así que pueden llegar a una orden de verdad. En el
   * Excel salen como celda VACÍA y no como cero, y la pantalla dice cuántos
   * renglones de la orden están así: es algo que se arregla cargando el código
   * en Sigma, no acá.
   */
  codigoCompra: string | null;
  ean: string | null;
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
  /** Unidades vendidas en la ventana del ritmo. */
  uds: number;
  ritmoDiario: number;
  /**
   * Sobre cuántos días se midió el ritmo. Es la ventana elegida, salvo que el
   * artículo haya vendido por primera vez adentro de ella: ahí son los días que
   * lleva vendiendo, con un piso de `DIAS_MINIMOS_DE_RITMO`.
   */
  diasRitmo: number;
  /**
   * `true` si el ritmo se midió sobre menos días que la ventana, o sea que el
   * artículo empezó a venderse hace poco. Un ritmo de 0,6 medido sobre 30 días
   * y uno medido sobre 120 no se leen igual aunque el número sea el mismo.
   */
  ritmoRecortado: boolean;
  /** Cuándo se dio de alta en Sigma (`YYYY-MM-DD`). */
  alta: string | null;
  /**
   * `true` si el proveedor lo está discontinuando: la descripción arranca con
   * uno de los `PREFIJOS_DISCONTINUO`. No se sugiere nunca —el proveedor lo
   * está dando de baja— pero se puede comprar a mano cuando lo ofrece a
   * liquidación, y para eso está el recorte "Discontinuos".
   */
  esDiscontinuo: boolean;
  /**
   * CON QUE SELL IN SE COMPRO LO QUE SE VENDIO en la ventana del ritmo,
   * ponderado por unidades.
   *
   * Existe porque el sugerido proyecta hacia adelante lo que se vendió hacia
   * atrás, y eso esconde un supuesto: que las condiciones de compra son las
   * mismas. Un artículo que voló el mes pasado con 40 % de sell in no tiene
   * por qué volar este mes al 10 %, y el ritmo —que sólo mira unidades— pide
   * lo mismo igual. Comparado contra `sellInPct`, este número dice si lo que
   * se está por comprar se compra en las mismas condiciones en que se vendió.
   *
   * `null` cuando ninguna de las ventas de la ventana tiene sell in conocido.
   */
  sellInVendidoPct: number | null;
  /**
   * Qué parte de las unidades vendidas en la ventana tiene sell in conocido,
   * de 0 a 1. Sin esto el promedio de arriba no se puede interpretar: uno
   * sobre el 20 % de lo vendido no dice lo mismo que uno sobre el 100 %.
   */
  sellInVendidoCobertura: number | null;
  /**
   * `true` si se dio de alta hace menos de `DIAS_ARTICULO_NUEVO`.
   *
   * NO es lo mismo que `ritmoRecortado`: un artículo puede ser viejo y haber
   * empezado a venderse recién ahora, o ser nuevo y no haber vendido nunca. El
   * segundo caso es el que el cálculo no puede encontrar solo --sin ventas no
   * hay ritmo-- y por eso la marca existe.
   */
  esNuevo: boolean;
  cobertura: number | null;
  /**
   * Cuántas unidades sugiere comprar la pantalla: la necesidad movida por la
   * oferta y recortada por el techo. Es lo que se ve y con lo que arranca el
   * renglón de la orden. Las cuatro piezas de abajo son para poder justificarlo
   * en el tooltip sin recalcular nada en el navegador.
   */
  sugerido: number;
  /**
   * `true` si el sugerido NO es una cuenta sino el mínimo de un bulto.
   *
   * Pasa cuando el artículo no vendió nada en la ventana --recién se dio de
   * alta, o hace rato que no se mueve-- y entonces no hay ritmo con el que
   * calcular nada. La decisión ahí es de una persona, y un bulto es el punto
   * de partida para ajustarla: por debajo de un bulto no se le pide a un
   * proveedor.
   *
   * La pantalla lo marca para que ese número no se lea como una necesidad
   * medida, que es lo que sí son los demás.
   */
  sugeridoMinimo: boolean;
  /** Unidades que faltan para cubrir objetivo + reposición, sin tocar. */
  sugeridoBase: number;
  /** El techo: lo máximo que se puede pedir sin pasar la cobertura máxima. */
  sugeridoTope: number;
  /** Por cuánto se multiplicó la base por la oferta. 1 = no se movió. */
  factorOferta: number;
  /**
   * EL DESCUENTO HABITUAL: el promedio de los meses en que SI hubo oferta, de
   * los últimos seis. Es contra esto que se mide si la oferta de este mes es
   * buena.
   *
   * Los meses en cero NO entran en el promedio, y eso es todo el punto: un mes
   * sin oferta no es "una oferta del 0 %" que baje la referencia, es un mes en
   * el que no hubo nada. Con los ceros adentro, un artículo con historia
   * 10·10·0·10·0·0 daba 5 % de habitual, y entonces el 10 % de siempre
   * aparecía como "5 puntos de ventaja" e inflaba el sugerido.
   *
   * `null` si nunca tuvo oferta en la ventana; el cálculo lo lee como 0, o sea
   * que cualquier descuento de hoy es nuevo.
   */
  habitualSellIn: number | null;
  /** En cuántos de los últimos seis meses tuvo oferta. 0 = nunca tuvo. */
  mesesConOferta: number;
  /**
   * El proveedor mandó su sell in de este mes y a ESTE artículo no le dio nada,
   * habiéndole dado hace poco. Es el freno: el sugerido queda en 0 aunque la
   * cuenta diera más, porque comprarlo ahora es pagar a precio de lista algo
   * que viene con descuento.
   */
  sinOfertaPorAhora: boolean;
  /**
   * Lleva varios meses seguidos sin oferta y antes tenía. Acá no hay oferta que
   * esperar, así que SÍ se sugiere lo que haga falta — con el aviso al lado de
   * que se está comprando a precio de lista.
   */
  dejoDeTenerSellIn: boolean;
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
  /**
   * Cuántas UNIDADES de este SKU se compraron el mes pasado. 0 cuando no hay
   * renglón, que --por lo de arriba-- no quiere decir que no se haya comprado.
   */
  unidadesMesPasado: number;
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
  ventana: number;
  /**
   * Los días de cobertura con los que se calculó el sugerido.
   *
   * LO DEVUELVE EL SERVIDOR aunque la pantalla ya los eligió, por el mismo
   * motivo que `ventana` y `mesPasado`: mientras una consulta viaja, el filtro
   * local ya cambió, y explicar un número con un parámetro que no es el que se
   * usó es peor que no explicarlo.
   */
  cobertura: number;
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
  /**
   * Cuándo llegó la última foto de la planilla de sell in, o `null` si no hay
   * ninguna. Es de cuándo es el DESCUENTO que viaja a la orden de compra — no
   * cuándo se generó esta pantalla.
   */
  sellInFoto: string | null;
  /**
   * CUANTOS ARTICULOS ENCONTRO EL FILTRO, sin los recortes.
   *
   * Viene en 0 salvo que `filas` esté vacía: es ahí donde hace falta, para que
   * la pantalla pueda decir "con estos recortes no queda nada, pero el filtro
   * tiene 23 artículos" y ofrecer sacarlos, en vez de quedarse en blanco como
   * si la marca no existiera.
   */
  articulosDelFiltro: number;
  comprasHasta: string | null;
  generadoEn: string;
};

// --- Trazabilidad de Full ---------------------------------------------------

export type FiltrosTrazabilidad = {
  proveedor?: string[];
  grupo?: string[];
  sku?: string[];
  /**
   * La línea de base: desde qué día se cuenta el saldo. Sin esto arranca en la
   * primera foto que haya. Sirve para "borrón y cuenta nueva" después de
   * resolver un reclamo con Mercado Libre.
   */
  desde?: string;
  /** Ver también los artículos cuyo saldo cierra en cero (el 71 %). */
  todos?: boolean;
  /** Sólo los que pasan el umbral de reclamo. */
  soloReclamables?: boolean;
  buscar?: string;
};

export type KpisTrazabilidad = {
  skus: number;
  /** Los que netean exactamente cero: la cuenta les cierra. */
  skusEnOrden: number;
  skusReclamables: number;
  /** Saldo del conjunto. Positivo = ML declara de más. */
  neto: number;
  unidadesReclamables: number;
  plataReclamable: number;
  /**
   * La suma de TODAS las caídas diarias, sin netear. Se muestra al lado del
   * neto a propósito: la distancia entre los dos es cuánto de lo que parece un
   * faltante se corrige solo al día siguiente.
   */
  brutoCaidas: number;
  enviado: number;
  vendido: number;
};

export type PuntoTrazabilidad = {
  fecha: string;
  /** Lo que no explican ni las ventas ni el stock del día anterior. */
  sorpresa: number;
  enviado: number;
  vendido: number;
  /** La suma corrida de `sorpresa`: la línea que importa. */
  acumulado: number;
};

export type FilaTrazabilidad = {
  sku: string;
  producto: string | null;
  proveedor: string | null;
  marca: string | null;
  grupo: string | null;
  /** El saldo. Negativo = Mercado Libre declara menos de lo que debería. */
  neto: number;
  /**
   * Lo despachado en los últimos días, que todavía puede estar viajando. Se
   * suma al neto antes de decidir si hay algo que reclamar.
   */
  enTransito: number;
  brutoCaidas: number;
  diasConCaida: number;
  enviado: number;
  vendido: number;
  declaradoHoy: number;
  primeraCaida: string | null;
  ultimaCaida: string | null;
  costo: number;
  /** Lo que vale el faltante, a costo. Sólo tiene sentido si `neto` es negativo. */
  plata: number;
};

export type DashboardTrazabilidad = {
  kpis: KpisTrazabilidad;
  serie: PuntoTrazabilidad[];
  filas: FilaTrazabilidad[];
  recortada: boolean;
  /** Desde y hasta cuándo hay foto diaria del stock de Full. */
  desde: string | null;
  hasta: string | null;
  diasDeFoto: number;
};

/* -------------------------------------------------------------------------
   Precios TN — Comparador (Operaciones)

   Lo que produce el proyecto `precios` y este tablero sólo muestra. Los montos
   vienen como `float8` desde Postgres porque son para mostrar; las cuentas que
   importan --piso de margen, precio propuesto-- ya se hicieron allá con
   Decimal, y acá no se recalcula ninguna.
   ------------------------------------------------------------------------- */

/** Un competidor concreto, con su precio y el link para ir a verlo. */
export type CompetidorPrecioTn = {
  fuente: string;
  precio: number;
  /** El día en que se capturó ESTE precio, no el día de la corrida. */
  dia: string;
  disponible: boolean;
  url: string | null;
  /**
   * Cuántas capturas anteriores de este mismo competidor quedaron dentro de la
   * ventana y no se usan. Es el "+2" del chip: sirve para ver que el precio se
   * movió sin repetir el competidor tres veces en la fila.
   */
  anteriores: number;
};

export type FilaPrecioTn = {
  id: number;
  sku: string;
  descripcion: string;
  marca: string | null;
  proveedor: string | null;
  accion: "mantener" | "subir" | "bajar" | "omitir";
  estado: "pendiente" | "aprobada" | "rechazada" | "aplicada" | "vencida";
  precioActual: number | null;
  precioPropuesto: number | null;
  piso: number | null;
  mejorCompetencia: number | null;
  /** Fracción: 0,22 = estamos 22 % arriba del más barato del mercado. */
  difMercado: number | null;
  grupo: string;
  motivos: string[];
  /**
   * De dónde sale el costo: el de lista y la oferta del proveedor sobre él.
   *
   *     costo = costoTeorico × (1 − ofertaPct/100)
   *
   * No entra en ninguna cuenta. Está para poder ver si un costo bajo es una
   * oferta puntual que se termina, o el precio de siempre — que no es lo mismo
   * a la hora de bajar un precio de venta.
   */
  costoTeorico: number | null;
  /** Porcentaje, no fracción: 25 es 25 %. Así viene de la lista del proveedor. */
  ofertaPct: number | null;
  /** Mes comercial de la lista, "2026-09". */
  costoMes: string | null;
  /** Desde cuándo rige esa lista. Un mes puede tener varias. */
  costoDesde: string | null;
  competidores: CompetidorPrecioTn[];
  stock: number | null;
  /** Costo NETO (sin IVA), con el descuento del proveedor ya aplicado. */
  costo: number | null;
  /**
   * Margen de contribución como fracción de la venta SIN IVA, al precio de hoy
   * y al propuesto. 0,15 = 15 %.
   *
   * Los calcula el motor y los guarda en la propuesta: la cuenta vive en
   * `dominio/margen.py` y es la misma con la que se despeja el piso. Si el
   * tablero la recalculara, el día que una cambie mostraría un margen que el
   * motor no usó para decidir. `null` en las propuestas anteriores a la corrida
   * que empezó a guardarlos.
   */
  margenActual: number | null;
  margenPropuesto: number | null;
  /**
   * La ficha del producto en NUESTRA tienda, para poder mirarlo antes de
   * autorizar el precio. `null` cuando no se conoce la dirección: se muestra el
   * nombre sin link, nunca uno armado a mano — en Tienda Nube el handle sale
   * del título del producto y no del id, así que componerlo sería inventarlo.
   */
  url: string | null;
};

export type ResumenPreciosTn = {
  corridaId: number | null;
  /** Cuándo corrió el motor que produjo estas propuestas. */
  corridaFecha: string | null;
  /**
   * Cuándo se miró a la competencia por última vez, que NO es lo mismo.
   *
   * El motor puede correr hoy sobre observaciones de hace tres días: para él
   * son datos vigentes según la política, y no tiene forma de avisar. Quien
   * aprueba necesita este otro número, porque es el que dice si la pantalla
   * está hablando del mercado de hoy o del de la semana pasada.
   */
  comparadoEn: string | null;
  grupos: Record<string, number>;
  /** Propuestas de la corrida que todavía nadie decidió, de cualquier tipo. */
  pendientes: number;
  /**
   * Las que de verdad esperan una decisión: pendientes CON un cambio propuesto.
   *
   * No es lo mismo que `pendientes` y la diferencia es enorme — 510 contra
   * 3.735 en la corrida donde se detectó. Lo que sobra son artículos sin stock,
   * sin competencia, o que el motor decidió mantener: están pendientes porque
   * nadie los tocó, pero no hay nada que apretar.
   */
  porDecidir: number;
  decididas: number;
  /** Aprobadas y todavía sin escribir en la tienda, de todas las corridas. */
  aprobadasSinAplicar: number;
};

/** Los filtros de la pantalla. `null` = sin filtrar por eso. */
export type FiltrosPreciosTn = {
  grupo: string | null;
  proveedor: string | null;
  marca: string | null;
  /** Código de fuente: muestra sólo lo que se comparó contra ese competidor. */
  competidor: string | null;
  busqueda: string | null;
};

/** Los valores que existen hoy para llenar los desplegables. */
export type CatalogosPreciosTn = {
  proveedores: string[];
  marcas: string[];
  /**
   * Los códigos de fuente que REALMENTE aparecen en esta corrida.
   *
   * No la lista de competidores configurados: la de los que contestaron. La
   * diferencia es el dato -- una fuente activa que no aparece acá es una
   * fuente que no está trayendo nada, y eso no se ve en ningún otro lado.
   */
  competidores: string[];
};

/**
 * Un precio efectivamente escrito en Tienda Nube.
 *
 * Sale de `precios.cambio`, que es append-only por trigger: un registro de
 * auditoría que se puede editar no es un registro de auditoría. `precioAnterior`
 * es lo que permite volver atrás sin depender de que Tienda Nube recuerde nada.
 */
/**
 * Filtros del historial de cambios.
 *
 * SON OTROS QUE LOS DE LA COLA, aunque se parezcan. La cola filtra una corrida
 * --grupo de alerta, competidor--; el historial filtra el tiempo, que es lo
 * que la cola no tiene. Compartir un tipo obligaria a que cada pantalla
 * ignorara en silencio la mitad de los campos.
 */
export type FiltrosCambiosTn = {
  proveedor: string | null;
  marca: string | null;
  busqueda: string | null;
  /** YYYY-MM-DD, inclusive los dos. */
  desde: string | null;
  hasta: string | null;
};

/** Los valores que existen hoy en el historial, para llenar los desplegables. */
export type CatalogosCambiosTn = {
  proveedores: string[];
  marcas: string[];
};

export type CambioPrecioTn = {
  id: number;
  sku: string;
  descripcion: string;
  marca: string | null;
  proveedor: string | null;
  precioAnterior: number;
  precioNuevo: number;
  /** Fracción: 0,12 = el precio subió 12 %. */
  variacion: number | null;
  aplicadoEn: string;
  autorizadoPor: string | null;
  /** La ficha en NUESTRA tienda, para ir a verlo. */
  url: string | null;
  /**
   * Con qué rentabilidad quedó el artículo a ese precio. Fracción: 0,32 = 32 %.
   *
   * Sale del margen que calculó el MOTOR para el precio propuesto, no de una
   * cuenta hecha acá: sacar el IVA, restar pasarela e impuestos vive en
   * `dominio/margen.py` y es la misma cuenta con la que se despeja el piso.
   * Viene null cuando el precio escrito no es el que el motor propuso --un
   * precio a mano, un deshacer-- porque entonces ese margen no le corresponde.
   */
  margen: number | null;
  yaSeDeshizo: boolean;
};
