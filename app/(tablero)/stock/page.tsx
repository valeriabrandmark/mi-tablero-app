import DashboardStock from "@/components/DashboardStock";

export const dynamic = "force-dynamic";

export const metadata = { title: "Stock — Tablero Brandmark" };

/**
 * El tablero de Stock. PUBLICADO: ya no es un borrador.
 *
 * No decide permisos y no tiene por qué: `puedeVer` sólo deja entrar a /stock
 * al `superadmin` y al `admin`, así que quien llega acá ya pasó la puerta. La
 * página se limita a mostrar el tablero.
 */
export default function StockPage() {
  return <DashboardStock />;
}
