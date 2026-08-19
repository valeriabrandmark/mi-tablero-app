import AlertasMeli from "@/components/AlertasMeli";
import { getDiaInicialMeli } from "@/lib/queries-meli";

export const dynamic = "force-dynamic";

export const metadata = { title: "Alertas de margen — Tablero Brandmark" };

export default async function AlertasMeliPage() {
  return <AlertasMeli diaInicial={await getDiaInicialMeli()} />;
}
