import DashboardTrazabilidadFull from "@/components/DashboardTrazabilidadFull";

export const dynamic = "force-dynamic";

export const metadata = { title: "Trazabilidad de Full — Tablero Brandmark" };

/**
 * Trazabilidad de Full, publicada junto con el resto de Operaciones. La ven el
 * `superadmin` y el `admin`, que son los únicos que `puedeVer` deja entrar a
 * /stock.
 */
export default function TrazabilidadFullPage() {
  return <DashboardTrazabilidadFull />;
}
