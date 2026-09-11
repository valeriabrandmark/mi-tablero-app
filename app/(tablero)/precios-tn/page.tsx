import DashboardPreciosTn from "@/components/DashboardPreciosTn";
import EnProduccion from "@/components/EnProduccion";
import { permisoDelUsuario, puedeVerBorradores } from "@/lib/permisos";
import { authConfigurada } from "@/lib/supabase/env";
import { getUsuario } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata = { title: "Precios TN — Comparador — Tablero Brandmark" };

/**
 * Precios TN — Comparador. Todavía en construcción.
 *
 * QUÉ VA A SER: la cola de aprobación de los cambios de precio de Tienda Nube,
 * más las alertas que salen de comparar contra la competencia (paridad, quiénes
 * están muy abajo, dónde somos los más caros).
 *
 * LO QUE ESTA PÁGINA NUNCA VA A HACER: hablar con Tienda Nube. Aprobar acá sólo
 * cambia el estado de una fila en `precios.propuesta`. La escritura real la hace
 * el proyecto `precios` (github.com/valeriabrandmark/precios) desde un workflow,
 * con un token que esta aplicación no tiene y no debe tener. Así, aunque alguien
 * se robe una sesión del tablero, lo peor que puede hacer es aprobar algo que
 * después queda registrado en `precios.cambio`, que es inmutable.
 *
 * QUIÉN LA VE: `superadmin` y `admin_tn`. NO la ve `admin`, que ve todo el resto
 * del tablero — es la primera vez que esa regla se rompe, y se rompe acá porque
 * este módulo autoriza reescribir precios de venta.
 *
 * Para publicarla: sacar "/precios-tn" de PAGINAS_EN_CONSTRUCCION en
 * lib/permisos.ts. Nada más.
 */
export default async function PreciosTnPage() {
  const usuario = authConfigurada ? await getUsuario() : null;
  const permiso = permisoDelUsuario(usuario);

  // Sin auth configurada (desarrollo local) se ve el borrador: si no, no habría
  // forma de trabajar en la página.
  if (authConfigurada && !puedeVerBorradores(permiso)) {
    return <EnProduccion titulo="Precios TN — Comparador" />;
  }

  // EL BORRADOR. Hasta que "/precios-tn" salga de PAGINAS_EN_CONSTRUCCION, esto
  // lo ve unicamente el superadmin; el `admin_tn` ve el cartel de arriba.
  return <DashboardPreciosTn />;
}
