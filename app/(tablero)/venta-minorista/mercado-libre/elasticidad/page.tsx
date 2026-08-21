import DashboardElasticidad from "@/components/DashboardElasticidad";

/** Dinámica: el experimento se consolida cada 6 h y se lee por request. */
export const dynamic = "force-dynamic";

export const metadata = { title: "Elasticidad de precios — Tablero Brandmark" };

export default function ElasticidadPage() {
  return <DashboardElasticidad />;
}
