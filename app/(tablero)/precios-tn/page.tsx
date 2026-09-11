import DashboardPreciosTn from "@/components/DashboardPreciosTn";

export const dynamic = "force-dynamic";

export const metadata = { title: "Precios TN — Comparador — Tablero Brandmark" };

/**
 * Precios TN — Comparador. La cola de aprobación de los cambios de precio de
 * Tienda Nube, más las alertas que salen de comparar contra la competencia.
 *
 * LO QUE ESTA PÁGINA NUNCA VA A HACER: escribir un precio en Tienda Nube.
 * Aprobar acá sólo cambia el estado de una fila en `precios.propuesta`. La
 * escritura real la hace el proyecto `precios`
 * (github.com/valeriabrandmark/precios) desde un workflow, con un token que
 * esta aplicación no tiene y no debe tener. Así, aunque alguien se robe una
 * sesión del tablero, lo peor que puede hacer es aprobar algo — que después
 * queda registrado en `precios.cambio`, que es inmutable.
 *
 * QUIÉN LA VE: `superadmin` y `admin_tn`. NO la ve `admin`, que ve todo el
 * resto del tablero — es la única regla del tablero que se rompe así, y se
 * rompe acá porque este módulo autoriza reescribir precios de venta.
 *
 * NO HAY GUARDA EN ESTE ARCHIVO, y es a propósito. El permiso se resuelve en
 * `lib/permisos.ts`, que es lo que mira el middleware antes de que esta función
 * llegue a ejecutarse. Una segunda comprobación acá no agregaría seguridad
 * --sin la primera esto no corre-- y sí agregaría un lugar más donde la regla
 * puede quedar desincronizada. Las páginas publicadas del tablero no la tienen;
 * ésta tampoco.
 */
export default function PreciosTnPage() {
  return <DashboardPreciosTn />;
}
