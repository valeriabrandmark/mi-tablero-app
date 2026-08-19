import DashboardMeli from "@/components/DashboardMeli";
import { getDiaInicialMeli } from "@/lib/queries-meli";

/**
 * Dinámica y no prerenderizada: el mes comercial con el que abre se resuelve por
 * request. Si se prerenderizara, quedaría congelado en el mes del build.
 */
export const dynamic = "force-dynamic";

export const metadata = { title: "Mercado Libre — Tablero Brandmark" };

export default async function MercadoLibrePage() {
  return <DashboardMeli diaInicial={await getDiaInicialMeli()} />;
}
