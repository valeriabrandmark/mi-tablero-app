import EncabezadoCanal from "@/components/EncabezadoCanal";
import Pestanas, { type Pestana } from "@/components/Pestanas";

/**
 * Las pestañas del tablero de Tienda Nube.
 *
 * Analytics va como pestaña y no como entrada de la barra lateral por lo mismo
 * que Elasticidad en Mercado Libre: es el MISMO canal mirado distinto —qué
 * pasó con la plata, qué pasó con la gente—, no otra sección del negocio.
 */
const PESTANAS: Pestana[] = [
  { href: "/venta-minorista/tienda-nube", label: "Tablero" },
  // El comportamiento de los visitantes: de dónde vienen, qué miran y dónde
  // abandonan. Todavía en construcción, esperando acceso a Google Analytics.
  { href: "/venta-minorista/tienda-nube/analytics", label: "Analytics" },
];

export default function TiendaNubeLayout({
  children,
}: LayoutProps<"/venta-minorista/tienda-nube">) {
  // El logo va acá y no en cada página: es el mismo tablero visto de varias
  // maneras, no varias secciones distintas. Puesto en las páginas parpadearía
  // al cambiar de pestaña.
  return (
    <>
      <h1 className="mb-4">
        <EncabezadoCanal canal="tienda-nube" />
      </h1>
      <Pestanas pestanas={PESTANAS} />
      {children}
    </>
  );
}
