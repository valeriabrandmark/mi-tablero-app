import Pestanas, { type Pestana } from "@/components/Pestanas";

/**
 * Las dos vistas de la carga de facturas.
 *
 * CARGAR Y RECLAMAR SON EL MISMO TRABAJO PARTIDO EN EL TIEMPO. La factura se
 * cruza contra la OC, se manda a Sigma, y lo que no coincidió queda para
 * pedirle al proveedor —a veces ese mismo día, a veces la semana que viene—.
 * Si lo segundo no tiene dónde vivir, se pierde: la pantalla se cierra y la
 * diferencia que se vio queda en la cabeza de quien la cargó.
 *
 * Por eso es una pestaña del mismo módulo y no un tablero aparte. Comparten el
 * permiso por prefijo (`facturas_compra` en lib/modulos.ts) porque es la misma
 * conversación: qué me facturaron, y qué de eso no cierra.
 */
const PESTANAS: Pestana[] = [
  { href: "/facturas-compra", label: "Cargar una factura" },
  { href: "/facturas-compra/enviadas", label: "Enviadas a Sigma" },
];

export default function FacturasCompraLayout({
  children,
}: LayoutProps<"/facturas-compra">) {
  return (
    <>
      <Pestanas pestanas={PESTANAS} />
      {children}
    </>
  );
}
