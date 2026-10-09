import PosventaMeli from "@/components/PosventaMeli";
import {
  getPreguntasPorPublicacion,
  getPreguntasSinContestar,
  getReclamosAbiertos,
  getReclamosCerrados,
  getResultadoPorMes,
  getResumenCrm,
} from "@/lib/queries-crm";

export const dynamic = "force-dynamic";

export const metadata = { title: "Posventa Mercado Libre — Tablero Brandmark" };

/**
 * El rango de los dos listados de cerrados y del gráfico.
 *
 * Fijo en doce meses y no filtrable, al menos por ahora: la pregunta de esta
 * pantalla es "cómo venimos", y para eso un año alcanza. El histórico llega
 * hasta 2019, pero mostrar siete años de golpe haría un gráfico con los
 * últimos meses aplastados contra el piso.
 */
const MESES_ATRAS = 12;

export default async function PosventaMeliPage() {
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
