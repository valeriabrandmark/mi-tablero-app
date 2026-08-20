import EncabezadoCanal from "@/components/EncabezadoCanal";
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
  // El logo va acá y no en cada página: es el mismo tablero visto de tres
  // maneras, no tres secciones distintas. Puesto en las pestañas se repetiría
  // tres veces y parpadearía al cambiar de una a otra.
  return (
    <>
      <h1 className="mb-4">
        <EncabezadoCanal canal="mercado-libre" />
      </h1>
      <PestanasMeli pestanas={PESTANAS} />
      {children}
    </>
  );
}
