import CargaFactura from "@/components/CargaFactura";
import EnProduccion from "@/components/EnProduccion";
import { permisoDelUsuario, puedeVerBorradores } from "@/lib/permisos";
import { authConfigurada } from "@/lib/supabase/env";
import { getUsuario } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata = { title: "Cargar factura — Tablero Brandmark" };

/**
 * Cargar una factura de compra cruzándola contra su OC.
 *
 * EN CONSTRUCCIÓN mientras falten dos cosas de la API de Sigma: el endpoint
 * para importar el comprobante de compra y el que lista las OC pendientes. El
 * cruce ya anda solo --con las OC que mandó el tablero o pegando una de
 * Sigma--, pero hasta que se pueda mandar el comprobante, el último paso sigue
 * siendo cargarlo a mano.
 *
 * Es de Compras y no de Stock porque cuelga de `/stock/compras`: hereda el
 * permiso del módulo sin tocar `lib/modulos.ts`.
 *
 * Para publicarla: sacar la ruta de PAGINAS_EN_CONSTRUCCION en lib/permisos.ts.
 */
export default async function CargaFacturaPage() {
  const usuario = authConfigurada ? await getUsuario() : null;
  const permiso = permisoDelUsuario(usuario);

  if (authConfigurada && !puedeVerBorradores(permiso)) {
    return <EnProduccion titulo="Cargar factura de compra" />;
  }
  return <CargaFactura />;
}
