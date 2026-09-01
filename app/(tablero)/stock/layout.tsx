import Pestanas, { type Pestana } from "@/components/Pestanas";

/**
 * Las pestañas de Stock.
 *
 * Antigüedad va como pestaña y no como entrada de la barra lateral por lo mismo
 * que Analytics en Tienda Nube: es el MISMO stock mirado distinto —cuánto hay y
 * cuánto se mueve, contra hace cuánto que está y cuándo se vence—, no otra
 * sección del negocio.
 */
const PESTANAS: Pestana[] = [
  { href: "/stock", label: "Tablero" },
  { href: "/stock/antiguedad", label: "Antigüedad" },
  // Compras es la única que no sólo mira: arma una orden y la baja en el
  // formato que importa Sigma. Va acá igual porque las cuentas son las mismas
  // —ritmo, cobertura, sugerido— y separarla las duplicaría.
  { href: "/stock/compras", label: "Compras" },
];

export default function StockLayout({ children }: LayoutProps<"/stock">) {
  return (
    <>
      <Pestanas pestanas={PESTANAS} />
      {children}
    </>
  );
}
