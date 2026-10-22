import FacturasEnviadas from "@/components/FacturasEnviadas";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Facturas enviadas a Sigma — Tablero Brandmark",
};

/**
 * Las facturas que ya se cargaron, y qué falta reclamarle al proveedor.
 *
 * ---------------------------------------------------------------------------
 * PARA QUE EXISTE
 *
 * Una factura con diferencias se manda igual: la mercadería llegó y el
 * comprobante tiene que estar cargado. Lo que queda abierto es el reclamo, y
 * hasta ahora no quedaba en ningún lado — se veía en la pantalla de carga, se
 * cerraba la pantalla, y lo que había que pedirle al proveedor sobrevivía
 * nada más que en la cabeza de quien la cargó.
 *
 * Acá quedan las tres cosas que hacen falta para que eso no pase: qué
 * diferencia tenía, si se reclamó, y si se decidió no reclamarla.
 */
export default function FacturasEnviadasPage() {
  return <FacturasEnviadas />;
}
