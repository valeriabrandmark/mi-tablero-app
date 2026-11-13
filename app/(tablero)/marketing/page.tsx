import DashboardMarketing from "@/components/DashboardMarketing";
import { leerInstagram, leerMetaAds } from "@/lib/meta-ads";
import { hastaConDatos, periodoAnterior, resolverPeriodo } from "@/lib/marketing-periodo";
import { leerVentaReal } from "@/lib/queries-marketing";
import { leerPlanillaCarga } from "@/lib/queries-carga";
import { leerPlan } from "@/lib/queries-planificacion";

export const dynamic = "force-dynamic";

export const metadata = { title: "Tablero de Marca — Tablero Brandmark" };

/**
 * Tablero de Marca: presupuesto, gastos, deadlines y KPIs de la responsable de
 * marca, separado por Diaper Genie, Hola Toys, Unibrandco y Litter Genie.
 *
 * SÓLO LO VE EL SUPERADMIN (lib/permisos.ts, `esDeMarketing`): el proxy
 * rebota a cualquier otro antes de llegar acá.
 *
 * Las fuentes se leen en el servidor --el token de Meta y la base no viajan
 * al navegador-- y cada una que falte cae a datos de ejemplo con su motivo:
 *
 *   Meta Ads / Instagram   lib/meta-ads.ts (API, con token)
 *   Tienda Nube            bronze.mkt_tn_pedidos (CSV importado a mano)
 *   Mayorista              gold.fact_ventas (SIGMA, ya en la base)
 *   Planificación          bronze.mkt_iniciativas (fechas límite)
 *   Carga de marketing     bronze.mkt_colaboraciones, mkt_gastos, mkt_presupuesto...
 *                          (Marketing → Carga) + canjes de SIGMA (gold.fact_ventas)
 *   Mercado Libre          gold.fact_ventas (por marca del producto)
 *   Carga manual           todavía ejemplo (lib/marketing-demo.ts)
 */
export default async function MarketingPage(props: PageProps<"/marketing">) {
  // El período viaja en la URL (?desde=&hasta=), así se puede compartir el
  // link y el botón Atrás vuelve al período anterior. Sin fechas: mes en curso.
  const sp = await props.searchParams;
  const uno = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const periodo = resolverPeriodo(uno(sp.desde), uno(sp.hasta));
  const rango = { desde: periodo.desde, hasta: hastaConDatos(periodo) };
  // Cada KPI se compara con el período anterior cortado a la misma altura.
  const ant = periodoAnterior(periodo);
  const rangoAnt = { desde: ant.desde, hasta: hastaConDatos(ant) };

  const [meta, instagram, venta, plan, planilla, metaAnt, instagramAnt, ventaAnt] = await Promise.all([
    leerMetaAds(periodo),
    leerInstagram(periodo),
    leerVentaReal(rango),
    // Si las tablas de Planificación no existen todavía, el tablero sigue
    // con el ejemplo y lo dice: no es motivo para que no abra.
    leerPlan(periodo.desde, periodo.hasta)
      .then((p) => ({ iniciativas: p.iniciativas }))
      .catch((e: unknown) => ({
        iniciativas: [],
        motivo: /mkt_/.test(String(e)) ? "Falta correr migraciones/marketing_planificacion.sql" : "Sin conexión a la base",
      })),
    leerPlanillaCarga(),
    leerMetaAds(ant),
    leerInstagram(ant),
    leerVentaReal(rangoAnt),
  ]);
  return (
    <DashboardMarketing
      datos={{
        meta,
        instagram,
        venta,
        plan,
        planilla,
        anterior: { periodo: ant, meta: metaAnt, instagram: instagramAnt, venta: ventaAnt },
        generado: new Date().toISOString(),
      }}
      periodo={periodo}
    />
  );
}
