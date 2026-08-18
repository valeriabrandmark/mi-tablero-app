import { Aviso } from "@/components/ui";

export const metadata = { title: "Tienda Nube — Tablero Brandmark" };

/**
 * Todavía no hay tablero de Tienda Nube: en `gold.fact_ventas` no existe un
 * canal para ese negocio, así que no hay nada que mostrar. La página está para
 * que la sección quede armada, y dice qué falta en vez de mostrar ceros —un
 * tablero en cero se lee como "no vendimos", no como "no hay dato".
 */
export default function TiendaNubePage() {
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold tracking-tight">
        Tienda Nube <span className="text-muted text-sm font-normal">· Unibrandco</span>
      </h1>

      <Aviso tono="info">
        <p className="font-medium">Todavía no está armado.</p>
        <p className="mt-1">
          Las ventas de Tienda Nube no llegan a Supabase: en <code>gold.fact_ventas</code> los
          únicos canales cargados son Mayorista y Mercado Libre. Cuando el orquestador las
          suba, este tablero se arma igual que el de Mercado Libre.
        </p>
      </Aviso>
    </div>
  );
}
