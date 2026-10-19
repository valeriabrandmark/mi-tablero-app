import Pestanas, { type Pestana } from "@/components/Pestanas";
import { enConstruccion } from "@/lib/permisos";

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
  // Lo que viene después de la orden: cuando llega la factura, cruzarla
  // contra la OC renglón por renglón aunque venga en otro orden.
  { href: "/stock/compras/facturas", label: "Cargar factura" },
  // Va al final porque es la única que no mira el stock de hoy sino cómo se
  // movió: es una auditoría contra Mercado Libre, no una foto del depósito.
  { href: "/stock/trazabilidad-full", label: "Trazabilidad Full" },
];

export default function StockLayout({ children }: LayoutProps<"/stock">) {
  return (
    <>
      <Pestanas
        pestanas={PESTANAS.map((p) => ({
          ...p,
          enConstruccion: enConstruccion(p.href),
        }))}
      />
      {children}
    </>
  );
}
