import PestanasMeli, { type Pestana } from "@/components/PestanasMeli";

/**
 * Las tres pestañas del tablero de Mercado Libre, iguales a las del reporte de
 * Data Studio. La de stock queda marcada como pendiente: `bronze.ml_stock_full`
 * y `bronze.ml_publicaciones` se cargaron una sola vez y hoy están viejas, así
 * que armarla mostraría "días sin venta" calculados sobre un stock que ya no es.
 */
const PESTANAS: Pestana[] = [
  { href: "/venta-minorista/mercado-libre", label: "Tablero" },
  { href: "/venta-minorista/mercado-libre/alertas", label: "Alertas" },
  {
    href: "/venta-minorista/mercado-libre/stock-full",
    label: "Stock Full · días sin venta",
    pendiente: true,
  },
];

export default function MercadoLibreLayout({
  children,
}: LayoutProps<"/venta-minorista/mercado-libre">) {
  return (
    <>
      <PestanasMeli pestanas={PESTANAS} />
      {children}
    </>
  );
}
