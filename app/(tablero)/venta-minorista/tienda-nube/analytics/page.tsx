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
    return <EnProduccion titulo="Analytics Tienda Nube" />;
  }

  return (
    // EL BORRADOR. Hoy es lo mismo que ve el resto porque todavía no hay
    // nada construido: acá abajo va el tablero a medida que se arme, y ahí
    // recién la puerta de arriba empieza a separar de verdad.
    <EnProduccion titulo="Analytics Tienda Nube" />
  );
}
