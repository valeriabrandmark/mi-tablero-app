import AlertasMeli from "@/components/AlertasMeli";
import { getMesInicialMeli } from "@/lib/queries-meli";

export const dynamic = "force-dynamic";

export const metadata = { title: "Alertas de margen — Tablero Brandmark" };

export default async function AlertasMeliPage() {
  return <AlertasMeli mesInicial={await getMesInicialMeli()} />;
}
