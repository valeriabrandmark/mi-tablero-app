import EnProduccion from "@/components/EnProduccion";
import { permisoDelUsuario, puedeVerBorradores } from "@/lib/permisos";
import { authConfigurada } from "@/lib/supabase/env";
import { getUsuario } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata = { title: "Stock — Tablero Brandmark" };

/**
 * El tablero de Stock, todavía en construcción.
 *
 * QUIÉN VE QUÉ SE DECIDE ACÁ Y NO EN EL PROXY, y es a propósito: la página es
 * accesible para todos los que pueden ver el tablero —no es un secreto— y lo
 * que cambia es el CONTENIDO. Bloquear la ruta daría un 403 y parecería un
 * error de permisos, cuando lo que pasa es que todavía no está hecha.
 *
 * Para publicarla: sacar "/stock" de PAGINAS_EN_CONSTRUCCION en lib/permisos.ts
 * y reemplazar el borrador de abajo por el tablero.
 */
export default async function StockPage() {
  const usuario = authConfigurada ? await getUsuario() : null;
  const permiso = permisoDelUsuario(usuario);

  // Sin auth configurada (desarrollo local) se ve el borrador: si no, no habría
  // forma de trabajar en la página.
  if (authConfigurada && !puedeVerBorradores(permiso)) {
    return (
      <EnProduccion
        titulo="Stock"
        descripcion="Va a mostrar la mercadería disponible, cuánta plata hay inmovilizada en ella, qué se está quedando sin reposición y qué lleva meses sin moverse."
      />
    );
  }

  return (
    <EnProduccion
      titulo="Stock"
      descripcion="Todavía no hay nada construido. Esta es la página donde va a vivir el tablero: el resto del andamiaje —ruta, permisos, entrada en el menú— ya está listo."
    />
  );
}
