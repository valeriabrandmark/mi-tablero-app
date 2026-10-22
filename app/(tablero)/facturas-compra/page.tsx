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
 * TIENE SU PROPIO MODULO (`facturas_compra` en lib/modulos.ts) y no el de
 * Compras, aunque cruce contra las órdenes que salen de ahí: son dos trabajos
 * distintos y los puede hacer gente distinta. Juntos había que dar los dos o
 * ninguno.
 *
 * Esto SI escribe en Sigma (`ImportCompras`), así que además de ver la
 * pantalla hace falta el permiso de editar del módulo y número de Sigma --ver
 * `puedeCargarFacturas` en lib/permisos.ts--. El `admin` no la ve, igual que
 * con Precios TN.
 */
export default function CargaFacturaPage() {
  return <CargaFactura />;
}
