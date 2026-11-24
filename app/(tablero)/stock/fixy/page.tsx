import DashboardFixy from "@/components/DashboardFixy";

export const dynamic = "force-dynamic";

export const metadata = { title: "FIXY — Tablero Brandmark" };

/**
 * FIXY, el depósito de Buenos Aires que despacha Tienda Nube y Flex: qué se
 * mandó, qué se avisó, qué hay y qué se publica. Las reglas en lib/fixy.ts.
 */
export default function FixyPage() {
  return <DashboardFixy />;
}
