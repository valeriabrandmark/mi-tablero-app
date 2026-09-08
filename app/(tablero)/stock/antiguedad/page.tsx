import DashboardAntiguedad from "@/components/DashboardAntiguedad";

export const dynamic = "force-dynamic";

export const metadata = { title: "Antigüedad de stock — Tablero Brandmark" };

/**
 * Antigüedad de stock, publicada junto con el resto de Operaciones. La ven el
 * `superadmin` y el `admin`, que son los únicos que `puedeVer` deja entrar a
 * /stock.
 */
export default function AntiguedadPage() {
  return <DashboardAntiguedad />;
}
