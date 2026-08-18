import { redirect } from "next/navigation";
import { INICIO_MINORISTA } from "@/lib/permisos";

/**
 * La sección no tiene portada propia: entrar a "Venta minorista" es entrar a
 * Mercado Libre. Existe igual para que la URL de la sección no sea un 404 si
 * alguien la escribe o la deja guardada.
 */
export default function VentaMinoristaPage() {
  redirect(INICIO_MINORISTA);
}
