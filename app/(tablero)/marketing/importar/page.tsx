import ImportadorTiendaNube from "@/components/ImportadorTiendaNube";

export const dynamic = "force-dynamic";

export const metadata = { title: "Importar Tienda Nube — Tablero Brandmark" };

/**
 * Importador de pedidos de Tienda Nube para el Tablero de Marca. Las tiendas
 * de las marcas no tienen la API (falta el plan Escala), así que se sube el
 * CSV de Ventas que exporta el administrador. Sólo el superadmin, como todo
 * /marketing.
 */
export default function ImportarTiendaNubePage() {
  return <ImportadorTiendaNube />;
}
