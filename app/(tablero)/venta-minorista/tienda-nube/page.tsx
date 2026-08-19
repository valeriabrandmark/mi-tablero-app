import DashboardTiendaNube from "@/components/DashboardTiendaNube";
import { getDiaInicialTiendaNube } from "@/lib/queries-tiendanube";

/**
 * Dinámica y no prerenderizada: el mes comercial con el que abre se resuelve por
 * request. Si se prerenderizara, quedaría congelado en el mes del build.
 */
export const dynamic = "force-dynamic";

export const metadata = { title: "Tienda Nube — Tablero Brandmark" };

export default async function TiendaNubePage() {
  return <DashboardTiendaNube diaInicial={await getDiaInicialTiendaNube()} />;
}
