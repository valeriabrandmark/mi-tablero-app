import DashboardMarketing from "@/components/DashboardMarketing";
import EnProduccion from "@/components/EnProduccion";
import { leerMetaAds } from "@/lib/meta-ads";
import { permisoDelUsuario, puedeVerBorradores } from "@/lib/permisos";
import { authConfigurada } from "@/lib/supabase/env";
import { getUsuario } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata = { title: "Tablero de Marca — Tablero Brandmark" };

/**
 * Tablero de Marca: presupuesto, gastos, deadlines y KPIs de la responsable de
 * marca, separado por Diaper Genie, Hola Toys, Unibrandco y Litter Genie.
 *
 * ES UN PROTOTIPO SOBRE DATOS DE EJEMPLO (lib/marketing-demo.ts). Por eso está
 * en PAGINAS_EN_CONSTRUCCION: el superadmin ve el borrador y el resto el
 * cartel. Para publicarlo, primero hay que conectar las fuentes reales (la
 * planilla mensual de Agatina, Tienda Nube, SIGMA, Google Ads) y recién
 * después sacar la ruta de esa lista. Meta Ads ya se lee de la API apenas se
 * carguen las variables (ver lib/meta-ads.ts).
 */
export default async function MarketingPage() {
  const usuario = authConfigurada ? await getUsuario() : null;
  const permiso = permisoDelUsuario(usuario);

  if (authConfigurada && !puedeVerBorradores(permiso)) {
    return <EnProduccion titulo="Tablero de Marca" />;
  }

  // Meta Ads se lee ACÁ, en el servidor: el token no viaja al navegador.
  // Sin token cada marca cae a datos de ejemplo y la pantalla lo avisa.
  const meta = await leerMetaAds();
  return <DashboardMarketing meta={meta} />;
}
