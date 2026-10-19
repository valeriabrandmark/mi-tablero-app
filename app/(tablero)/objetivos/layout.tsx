import Pestanas, { type Pestana } from "@/components/Pestanas";
import { nombrePropio, slugVendedor, VENDEDORES_OBJETIVOS } from "@/lib/constantes";
import { permisoDelUsuario, puedeVerVendedor } from "@/lib/permisos";
import { authConfigurada } from "@/lib/supabase/env";
import { getUsuario } from "@/lib/supabase/server";

/**
 * Los cuatro vendedores, en pestañas.
 *
 * ANTES ERAN CUATRO ENTRADAS DE LA BARRA LATERAL, y ese era el problema: para
 * los permisos Objetivos es UN módulo --uno solo, `objetivos` en modulos.ts--
 * y en el menú ocupaba cuatro de las siete entradas del grupo más grande. Más
 * de la mitad de "Ventas Mayoristas" era el mismo tablero repetido con otro
 * filtro, y con un quinto vendedor volvía a crecer.
 *
 * La barra lateral separa cosas que no tienen que ver entre sí; las pestañas
 * son el mismo tablero mirado distinto. Cuatro vendedores son exactamente lo
 * segundo, igual que Stock, Mercado Libre y Tienda Nube.
 *
 * ---------------------------------------------------------------------------
 * SE MUESTRAN SOLO LAS QUE LA PERSONA PUEDE ABRIR
 *
 * Y no por prolijidad: un `vendedor` sólo ve la suya, así que listarle las
 * cuatro sería ofrecerle tres links que el proxy le va a rebotar. La misma
 * función que decide el acceso --`puedeVerVendedor`-- decide qué se dibuja,
 * para que no puedan discrepar.
 *
 * CON UNA SOLA NO VA LA BARRA. Una fila de pestañas con una sola pestaña no es
 * una elección, es un adorno que ocupa alto y sugiere que hay más.
 */
export default async function ObjetivosLayout({
  children,
}: LayoutProps<"/objetivos">) {
  const permiso = authConfigurada ? permisoDelUsuario(await getUsuario()) : null;

  // Sin auth configurada (desarrollo local) se ven todos: es el mismo criterio
  // que usa la barra lateral, que ahí muestra el nav entero.
  const visibles = VENDEDORES_OBJETIVOS.filter(
    (v) => !authConfigurada || puedeVerVendedor(permiso, v),
  );

  const pestanas: Pestana[] = visibles.map((v) => ({
    href: `/objetivos/${slugVendedor(v)}`,
    label: nombrePropio(v),
  }));

  return (
    <>
      {pestanas.length > 1 && <Pestanas pestanas={pestanas} />}
      {children}
    </>
  );
}
