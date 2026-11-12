import type { ClaveMarca } from "@/lib/marketing-demo";
import type { MetaAds } from "@/lib/meta-ads-tipos";
import type { Iniciativa } from "@/lib/planificacion";
import type { Planilla } from "@/lib/marketing-planilla";

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

export type DatosVentaReal = {
  tiendaNube: { motivo?: string; porMarca: Partial<Record<ClaveMarca, DatosTiendaNube>> };
  mayorista: { motivo?: string; porMarca: Partial<Record<ClaveMarca, DatosMayorista>> };
  tiendasNuevas: { motivo?: string; cantidad: number | null };
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
   * La última foto de la planilla de Marketing (Google Sheets). Con ella, el
   * presupuesto, la inversión en influencers y los otros gastos son reales.
   */
  planilla: { datos: Planilla | null; motivo?: string };
  /** ISO del momento en que se armó, para el encabezado. */
  generado: string;
};
