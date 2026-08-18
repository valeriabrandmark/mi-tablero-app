import { notFound } from "next/navigation";
import DashboardObjetivos from "@/components/DashboardObjetivos";
import { vendedorDesdeSlug } from "@/lib/constantes";
import { permisoDelUsuario, puedeVerVendedor } from "@/lib/permisos";
import { authConfigurada } from "@/lib/supabase/env";
import { getUsuario } from "@/lib/supabase/server";
import { getMesInicialObjetivos } from "@/lib/queries-objetivos";

/**
 * Una página de objetivos por vendedor, para poder dar permiso sobre una sola
 * más adelante y que cada vendedor entre directo a la suya, sin filtrar.
 *
 * Va dinámica y no prerenderizada porque el mes comercial vigente se calcula
 * por request: si se prerenderizara, el mes quedaría congelado en el del build
 * y en septiembre el tablero seguiría abriendo en agosto.
 */
export const dynamic = "force-dynamic";

export async function generateMetadata(props: PageProps<"/objetivos/[vendedor]">) {
  const { vendedor } = await props.params;
  const nombre = vendedorDesdeSlug(vendedor);
  return { title: `Objetivos ${nombre ?? ""} — Tablero Brandmark`.replace("  ", " ") };
}

export default async function ObjetivosVendedorPage(props: PageProps<"/objetivos/[vendedor]">) {
  const { vendedor } = await props.params;
  const nombre = vendedorDesdeSlug(vendedor);

  // Un slug que no es de la lista es 404, no una página vacía: esta ruta es la
  // que va a estar detrás de los permisos por vendedor.
  if (!nombre) notFound();

  // Defensa en profundidad: el proxy ya manda a cada uno a lo suyo, pero si esa
  // regla se rompiera, acá la página de otro es un 404 y no una filtración.
  if (authConfigurada) {
    const permiso = permisoDelUsuario(await getUsuario());
    if (!puedeVerVendedor(permiso, nombre)) notFound();
  }

  return <DashboardObjetivos vendedor={nombre} mesInicial={await getMesInicialObjetivos(nombre)} />;
}
