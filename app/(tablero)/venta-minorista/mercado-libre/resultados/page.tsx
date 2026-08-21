import DashboardResultados from "@/components/DashboardResultados";

/** Dinámica: las semanas se llenan a medida que entran ventas. */
export const dynamic = "force-dynamic";

export const metadata = { title: "Resultados por semana — Tablero Brandmark" };

export default function ResultadosPage() {
  return <DashboardResultados />;
}
