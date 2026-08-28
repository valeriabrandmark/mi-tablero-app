import EnProduccion from "@/components/EnProduccion";
import { permisoDelUsuario, puedeVerBorradores } from "@/lib/permisos";
import { authConfigurada } from "@/lib/supabase/env";
import { getUsuario } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata = { title: "Analytics Tienda Nube — Tablero Brandmark" };

/**
 * El comportamiento de los visitantes de la tienda: de dónde vienen, qué miran
 * y dónde abandonan. Todavía en construcción.
 *
 * ESTÁ FRENADA POR UN DATO QUE NO TENEMOS, no por falta de código: Google
 * Analytics ya está midiendo la tienda, pero la propiedad la administra la
 * agencia de marketing. Hasta que den acceso de lectura no hay de dónde leer.
 *
 * Para publicarla: sacar la ruta de PAGINAS_EN_CONSTRUCCION en lib/permisos.ts.
 */
export default async function AnalyticsTiendaNubePage() {
  const usuario = authConfigurada ? await getUsuario() : null;
  const permiso = permisoDelUsuario(usuario);

  if (authConfigurada && !puedeVerBorradores(permiso)) {
    return (
      <EnProduccion
        titulo="Analytics Tienda Nube"
        descripcion="Va a mostrar de dónde llega la gente a la tienda, qué productos se miran más y en qué paso del checkout se abandona la compra."
      />
    );
  }

  return (
    <EnProduccion
      titulo="Analytics Tienda Nube"
      descripcion="Frenada esperando acceso de lectura a la propiedad de Google Analytics, que hoy administra la agencia. No falta código: falta de dónde leer."
    />
  );
}
