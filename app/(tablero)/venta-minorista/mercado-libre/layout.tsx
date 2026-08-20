import PestanasMeli, { type Pestana } from "@/components/PestanasMeli";

/**
 * Las tres pestañas del tablero de Mercado Libre, iguales a las del reporte de
 * Data Studio.
 *
 * La de stock estuvo marcada como "pendiente" hasta que el orquestador empezó a
 * cargar `ml_stock_full` y `ml_publicaciones` todos los días: antes se habían
 * cargado una sola vez, y armarla habría mostrado "días sin venta" calculados
 * sobre un stock que ya no era.
 */
const PESTANAS: Pestana[] = [
  { href: "/venta-minorista/mercado-libre", label: "Tablero" },
  { href: "/venta-minorista/mercado-libre/alertas", label: "Alertas" },
  {
    href: "/venta-minorista/mercado-libre/stock-full",
    label: "Stock Full · días sin venta",
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
