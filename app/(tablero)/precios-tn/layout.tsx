import Pestanas, { type Pestana } from "@/components/Pestanas";

/**
 * Las dos vistas de Precios TN, en pestañas.
 *
 * RENTABILIDAD ERA UNA ENTRADA DE LA BARRA LATERAL, al lado del comparador, y
 * era la única sub-página de todo el tablero ascendida al menú: Stock, Mercado
 * Libre y Tienda Nube ponen las suyas en pestañas. Dos reglas para lo mismo es
 * lo que hacía que el menú se sintiera improvisado.
 *
 * Y son dos vistas del mismo módulo en el sentido más literal que hay en esta
 * aplicación: salen de la MISMA corrida de `precios`, comparten el permiso por
 * prefijo (`/precios-tn/`, ver `esDePreciosTn`) y se miran en la misma
 * conversación -- a cuánto vender, y si a ese costo se puede.
 *
 * El comparador queda primero porque es la pantalla que se usa todos los días;
 * la rentabilidad se abre cuando hay que discutir un markup.
 */
const PESTANAS: Pestana[] = [
  { href: "/precios-tn", label: "Comparador" },
  { href: "/precios-tn/rentabilidad", label: "Rentabilidad por proveedor" },
];

export default function PreciosTnLayout({
  children,
}: LayoutProps<"/precios-tn">) {
  return (
    <>
      <Pestanas pestanas={PESTANAS} />
      {children}
    </>
  );
}
