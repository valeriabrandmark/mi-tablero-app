import EnProduccion from "@/components/EnProduccion";
import PosventaMeli from "@/components/PosventaMeli";
import { permisoDelUsuario, puedeVerBorradores } from "@/lib/permisos";
import {
  getPreguntasPorPublicacion,
  getPreguntasSinContestar,
  getReclamosAbiertos,
  getReclamosCerrados,
  getResultadoPorMes,
  getResumenCrm,
} from "@/lib/queries-crm";
import { authConfigurada } from "@/lib/supabase/env";
import { getUsuario } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata = { title: "Posventa Mercado Libre — Tablero Brandmark" };

/**
 * Reclamos, mediaciones, mensajes y preguntas de Mercado Libre.
 *
 * EN CONSTRUCCIÓN HASTA NOVIEMBRE, y no por falta de código: el extractor
 * (`ml_crm.py` en el orquestador) carga las cuatro tablas en cada corrida, así
 * que cuando se retome va a haber un mes de historia esperando.
 *
 * Queda cerrada por dos razones distintas:
 *
 *   PRIORIDADES. Se decidió retomarla más adelante.
 *
 *   LOS LINKS NO ESTÁN CONFIRMADOS. Mercado Libre no documenta las URLs de su
 *   panel de vendedor, así que los de `lib/enlaces-meli.ts` están armados por
 *   patrón. El de publicaciones es el único seguro. Publicar la pantalla antes
 *   de verificar los otros sería ofrecer botones que pueden terminar en una
 *   página en blanco — y alguien que hace clic y no llega a ningún lado deja
 *   de confiar en todos los links del tablero, no sólo en ése.
 *
 * El `superadmin` SÍ la ve entera, que es lo que permite ir verificando esos
 * links contra datos reales sin que nadie más se cruce con ellos.
 *
 * Para publicarla: sacar la ruta de PAGINAS_EN_CONSTRUCCION en lib/permisos.ts.
 */
const MESES_ATRAS = 12;

export default async function PosventaMeliPage() {
  const usuario = authConfigurada ? await getUsuario() : null;
  const permiso = permisoDelUsuario(usuario);

  // LA PUERTA VA ANTES DE CONSULTAR LA BASE, no después de armar la pantalla.
  // Si fuera al revés, las seis consultas se correrían igual para alguien que
  // no va a ver nada: trabajo de la base pagado para tirarlo a la basura, y en
  // una instancia que ya tuvo problemas de Disk IO eso no es gratis.
  if (authConfigurada && !puedeVerBorradores(permiso)) {
    return <EnProduccion titulo="Posventa Mercado Libre" />;
  }

  const hasta = new Date();
  const desde = new Date(hasta);
  desde.setMonth(desde.getMonth() - MESES_ATRAS);

  const d = desde.toISOString().slice(0, 10);
  const h = hasta.toISOString().slice(0, 10);

  // En paralelo: son seis consultas independientes y encadenarlas sumaría seis
  // viajes a la base para la misma pantalla.
  const [resumen, abiertos, cerrados, porMes, porPublicacion, sinContestar] =
    await Promise.all([
      getResumenCrm(),
      getReclamosAbiertos(),
      getReclamosCerrados(d, h),
      getResultadoPorMes(d, h),
      getPreguntasPorPublicacion(),
      getPreguntasSinContestar(),
    ]);

  return (
    <PosventaMeli
      resumen={resumen}
      abiertos={abiertos}
      cerrados={cerrados}
      porMes={porMes}
      porPublicacion={porPublicacion}
      sinContestar={sinContestar}
    />
  );
}
