import EncabezadoCanal from "@/components/EncabezadoCanal";
import Pestanas, { type Pestana } from "@/components/Pestanas";

/**
 * Las pestañas del tablero de Mercado Libre. Las tres primeras son las del
 * reporte de Data Studio.
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
  // Esta no viene de Data Studio: es el experimento de markup, y es la única
  // que no describe lo que pasó sino que responde una pregunta que nos hicimos.
  {
    href: "/venta-minorista/mercado-libre/elasticidad",
    label: "Elasticidad de precios",
  },
  // La misma medición, cortada por las semanas del experimento en vez de por un
  // rango libre. Va aparte y no como un filtro de la anterior porque contesta
  // otra pregunta: no "con qué margen conviene vender" sino "cómo viene
  // evolucionando semana a semana".
  {
    href: "/venta-minorista/mercado-libre/resultados",
    label: "Resultados por semana",
  },
];

export default function MercadoLibreLayout({
  children,
}: LayoutProps<"/venta-minorista/mercado-libre">) {
  // El logo va acá y no en cada página: es el mismo tablero visto de varias
  // maneras, no varias secciones distintas. Puesto en las pestañas se repetiría
  // una vez por pestaña y parpadearía al cambiar de una a otra.
  return (
    <>
      <h1 className="mb-4">
        <EncabezadoCanal canal="mercado-libre" />
      </h1>
      <Pestanas pestanas={PESTANAS} />
      {children}
    </>
  );
}
