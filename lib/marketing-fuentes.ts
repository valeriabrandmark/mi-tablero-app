import type { ClaveMarca } from "@/lib/marketing-demo";
import type { MetaAds } from "@/lib/meta-ads-tipos";
import type { Iniciativa } from "@/lib/planificacion";
import type { Planilla } from "@/lib/marketing-planilla";
import type { Periodo } from "@/lib/marketing-periodo";

/**
 * Todo lo que el Tablero de Marca recibe de fuentes REALES, ya calculado en el
 * servidor. Lo que no llega (sin token, sin importar, sin base) viene vacío
 * con su `motivo`, y la pantalla usa el ejemplo avisando.
 *
 * Sin `pg` ni tokens: lo importa el componente del navegador.
 */

export type DatosTiendaNube = {
  /** "api": la tienda tiene API y la trae el orquestador; "importado": CSV. */
  origen: "api" | "importado";
  venta: number;
  pedidos: number;
  /** Venta por día del mes, índice 0 = día 1. */
  diaria: number[];
  cupones: { cupon: string; pedidos: number; venta: number }[];
  clientesNuevos: number;
  clientesRecurrentes: number;
  historia: { mes: string; venta: number }[];
  provincias: { provincia: string; pedidos: number }[];
  ultimoPedido: string;
  ultimaImportacion: string;
};

export type DatosMayorista = {
  venta: number;
  diaria: number[];
  historia: { mes: string; venta: number }[];
  /** Tiendas que compran la marca por primera vez este mes. */
  tiendasNuevas: number;
};

export type DatosMercadoLibre = {
  venta: number;
  pedidos: number;
  diaria: number[];
};

/** Mercado Ads (Product Ads) de la marca en el período: bronze.ml_ads_diario. */
export type DatosMercadoAds = {
  costo: number;
  clics: number;
  impresiones: number;
  /** Venta que Mercado Libre le atribuye a los anuncios (directa + indirecta). */
  ventaAtribuida: number;
  unidades: number;
};

/** Google Ads de la marca en el período: bronze.google_ads_diario. */
export type DatosGoogleAds = {
  costo: number;
  clics: number;
  impresiones: number;
  conversiones: number;
  /** Valor de las conversiones según Google Ads (si la cuenta lo mide). */
  valorConversiones: number;
};

export type DatosVentaReal = {
  tiendaNube: { motivo?: string; porMarca: Partial<Record<ClaveMarca, DatosTiendaNube>> };
  mayorista: { motivo?: string; porMarca: Partial<Record<ClaveMarca, DatosMayorista>> };
  mercadoLibre: { motivo?: string; porMarca: Partial<Record<ClaveMarca, DatosMercadoLibre>> };
  /**
   * Sin `motivo` la API está conectada: una marca que no figura en `porMarca`
   * no invirtió en el período (cero, no "pendiente"). `ultimaCarga` es la
   * última vez que el orquestador trajo datos.
   */
  mercadoAds: { motivo?: string; porMarca: Partial<Record<ClaveMarca, DatosMercadoAds>>; ultimaCarga?: string | null };
  /**
   * Igual que mercadoAds. `sinMarca`: inversión de campañas que no se pudieron
   * asignar a ninguna marca (ni por la cuenta ni por el nombre), para avisar.
   * `conversion`: si alguna cuenta está en otra moneda, con qué se pasó a pesos.
   */
  googleAds: {
    motivo?: string;
    porMarca: Partial<Record<ClaveMarca, DatosGoogleAds>>;
    ultimaCarga?: string | null;
    sinMarca?: number;
    conversion?: string;
  };
  tiendasNuevas: { motivo?: string; cantidad: number | null };
};

/**
 * Una línea del DETALLE DE VENTAS del Tablero de Marca: todos los canales,
 * con provincia, rentabilidad y lo que se sabe de la pauta que la trajo.
 */
export type LineaVenta = {
  clave: ClaveMarca;
  fecha: string;
  canal: "Mayorista" | "Mercado Libre" | "Tienda Nube";
  /** Comprobante de SIGMA o número de orden de ML / Tienda Nube. */
  orden: string | null;
  /** Sólo mayorista (es una empresa); de los compradores minoristas no se muestra el nombre. */
  cliente: string | null;
  sku: string | null;
  producto: string;
  cantidad: number;
  /** Como en el resto del tablero: mayorista sin IVA, minorista con IVA. */
  venta: number;
  /** Venta sin IVA, la base de la rentabilidad. null si no se sabe (CSV importado). */
  neto: number | null;
  /** Margen en pesos (gold.fact_ventas.margen_total). null si no hay costo. */
  margen: number | null;
  provincia: string | null;
  cupon: string | null;
  /** Mercado Libre: la publicación tenía Mercado Ads con gasto ese día. */
  conAds: boolean;
  /** Tienda Nube con API: de dónde vino la visita (utm_source / utm_campaign). */
  utmFuente: string | null;
  utmCampana: string | null;
};

export type DatosInstagram = {
  usuario: string | null;
  seguidores: number;
  /** Seguidores ganados en el mes (métrica follower_count de Insights). */
  seguidoresNuevos: number | null;
  alcance: number | null;
  vistas: number | null;
  interacciones: number;
  publicacionesMes: number;
  /** Semana 1 = días 1 a 7 del mes, etc. */
  publicacionesPorSemana: number[];
};

export type InstagramMarca = { fuente: "meta"; datos: DatosInstagram } | { fuente: "demo"; motivo: string };

export type DatosTablero = {
  meta: MetaAds;
  instagram: Record<ClaveMarca, InstagramMarca>;
  venta: DatosVentaReal;
  /**
   * Las iniciativas de Marketing → Planificación del período. Si hay alguna,
   * las fechas límite, los influencers y esa parte del puntaje salen de acá
   * y no del ejemplo.
   */
  plan: { iniciativas: Iniciativa[]; motivo?: string };
  /**
   * Lo cargado en Marketing → Carga (colaboraciones, canjes de SIGMA, envíos,
   * gastos y presupuesto), con la forma que tenía la planilla de Sheets. Con
   * ella, el presupuesto, la inversión en influencers y los otros gastos son reales.
   */
  planilla: { datos: Planilla | null; motivo?: string };
  /**
   * Lo mismo del PERÍODO ANTERIOR (lib/marketing-periodo.ts → periodoAnterior),
   * para que cada KPI se compare. Planificación y la carga no se repiten: ya
   * vienen enteras y se filtran por fecha en la pantalla.
   */
  /** Detalle de ventas del período (todas las marcas; la pantalla filtra). */
  detalle: { lineas: LineaVenta[]; motivo?: string; recortado?: boolean };
  anterior: { periodo: Periodo; meta: MetaAds; instagram: Record<ClaveMarca, InstagramMarca>; venta: DatosVentaReal };
  /** ISO del momento en que se armó, para el encabezado. */
  generado: string;
};
