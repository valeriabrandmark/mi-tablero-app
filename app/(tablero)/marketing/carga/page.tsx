import CargaMarketing from "@/components/CargaMarketing";

export const dynamic = "force-dynamic";

export const metadata = { title: "Carga de marketing — Tablero Brandmark" };

/**
 * Carga y edición de colaboraciones, influencers, canjes (de SIGMA), envíos,
 * gastos, presupuesto y contenido. Reemplaza a la planilla de Google Sheets:
 * todo queda en tablas bronze.mkt_* con historial (migraciones/marketing_carga.sql).
 * Sólo el superadmin, como todo /marketing.
 */
export default function CargaMarketingPage() {
  return <CargaMarketing />;
}
