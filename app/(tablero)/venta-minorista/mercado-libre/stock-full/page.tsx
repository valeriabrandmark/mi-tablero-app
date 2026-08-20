import DashboardStockFull from "@/components/DashboardStockFull";

/** Dinámica: el stock y los días sin venta se resuelven por request. */
export const dynamic = "force-dynamic";

export const metadata = { title: "Stock Full — Tablero Brandmark" };

export default function StockFullPage() {
  return <DashboardStockFull />;
}
