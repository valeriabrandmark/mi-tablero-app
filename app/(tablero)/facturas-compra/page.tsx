import CargaFactura from "@/components/CargaFactura";

export const dynamic = "force-dynamic";

export const metadata = { title: "Carga de Facturas de compra — Tablero Brandmark" };

/**
 * Cargar una factura de compra cruzándola contra la OC que salió del tablero.
 *
 * La OC no se carga: se elige entre las que se mandaron a Sigma desde Compras
 * (`app.ordenes_compra_enviadas`), que ya están en unidades y a precio de
 * lista. Sólo se tipea la factura --artículo, cantidad, bultos o unidades e
 * importe del renglón-- y sale el reporte de diferencias y la tabla para el
 * mail al proveedor.
 *
 * El permiso es el del módulo Compras (lib/modulos.ts): la ve quien ve las
 * órdenes. Todavía no escribe en Sigma; el comprobante se sigue cargando con
 * la planilla.
 */
export default function CargaFacturaPage() {
  return <CargaFactura />;
}
