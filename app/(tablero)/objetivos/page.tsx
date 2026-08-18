import { redirect } from "next/navigation";
import { slugVendedor, VENDEDORES_OBJETIVOS } from "@/lib/constantes";

/** `/objetivos` no tiene contenido propio: cada vendedor tiene su página. */
export default function ObjetivosPage() {
  redirect(`/objetivos/${slugVendedor(VENDEDORES_OBJETIVOS[0])}`);
}
