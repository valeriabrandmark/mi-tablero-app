"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Panel, TarjetaKpi } from "@/components/ui";
import { CajaTooltip, FilaTooltip } from "@/components/charts/TooltipOscuro";
import { fmtMoneda, fmtNumero } from "@/lib/format";
import { TEMA } from "@/lib/paleta";
import type { DatosTablero } from "@/lib/marketing-fuentes";
import {
  costoPorCompra,
  cpc,
  cpm,
  ctr,
  diasConPauta,
  roas,
  type CampanaMeta,
  type MetaAds,
  type MetaAdsMarca,
} from "@/lib/meta-ads-tipos";
import {
  AVANCE_MES,
  CANALES,
  COLABORACIONES,
  CORTE,
  HITOS,
  INDICADORES,
  MARCAS,
  META_INFLUENCERS_MES,
  META_PUBLICACIONES_SEMANA,
  META_TIENDAS_NUEVAS,
  TIENDAS_NUEVAS_MES,
  gastoTotal,
  proyectar,
  ventaAcumulada,
  ventaTotal,
  type ClaveMarca,
  type EstadoFuente,
  type EstadoHito,
  type Marca,
} from "@/lib/marketing-demo";

/**
 * TABLERO DE MARCA — PROTOTIPO.
 *
 * Arma, sobre datos de ejemplo (`lib/marketing-demo.ts`), lo que va a mirar
 * Agatina como responsable de marca: presupuesto, gastos, deadlines, y los
 * KPIs del acuerdo de rol en sus tres niveles (marca → demanda → venta).
 *
 * Dos vistas: CONSOLIDADO, que es la que sirve para medirla a ella (scorecard,
 * presupuesto de las cuatro marcas, entregas), y UNA POR MARCA, que es la que
 * ella usa para mover la demanda (embudo, pauta, contenido, influencers).
 */

const COLOR_CANAL: Record<string, string> = {
  "Meta Ads": "#3b82f6",
  "Google Ads": "#f59e0b",
  Influencers: "#f472b6",
  Contenido: "#a78bfa",
  Ferias: "#22d3ee",
};

const pct0 = new Intl.NumberFormat("es-AR", { style: "percent", maximumFractionDigits: 0 });
const pct1 = new Intl.NumberFormat("es-AR", { style: "percent", maximumFractionDigits: 1 });
const dec1 = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 1, minimumFractionDigits: 1 });
/**
 * Moneda corta CON un decimal en millones. La de lib/format redondea a entero
 * y acá los presupuestos son de $2,5MM: "$ 3 M" decía otra cosa.
 */
function fmtMonedaCorta(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `$ ${dec1.format(n / 1_000_000).replace(/,0$/, "")} M`;
  if (abs >= 1_000) return `$ ${Math.round(n / 1_000)} k`;
  return `$ ${Math.round(n)}`;
}
const p0 = (n: number) => (Number.isFinite(n) ? pct0.format(n) : "—");
const p1 = (n: number) => (Number.isFinite(n) ? pct1.format(n) : "—");

const VERDE = "#22c55e";
const AMBAR = "#f59e0b";
const ROJO = TEMA.negativo;

/** Verde si cumple, ámbar si está cerca, rojo si está lejos. */
function semaforo(cumplimiento: number): string {
  if (cumplimiento >= 0.95) return VERDE;
  if (cumplimiento >= 0.7) return AMBAR;
  return ROJO;
}

/**
 * Las fuentes reales, para cualquier panel que necesite saber de dónde salió
 * su número. Va por contexto porque la consultan paneles a varios niveles.
 */
const Fuentes = createContext<DatosTablero | null>(null);
function useFuentes(): DatosTablero {
  const f = useContext(Fuentes);
  if (!f) throw new Error("Falta el proveedor de fuentes");
  return f;
}

function fechaCorta(iso: string): string {
  const d = new Date(iso);
  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Argentina/Buenos_Aires",
  }).format(d);
}

// ---------------------------------------------------------------------------
// Piezas chicas
// ---------------------------------------------------------------------------

function Chip({ color, children }: { color: string; children: ReactNode }) {
  return (
    <span
      className="inline-block rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap"
      style={{ color, borderColor: `${color}55`, background: `${color}1a` }}
    >
      {children}
    </span>
  );
}

const ESTADO_HITO: Record<EstadoHito, { label: string; color: string }> = {
  hecho: { label: "Entregado", color: VERDE },
  en_curso: { label: "En curso", color: "#3b82f6" },
  pendiente: { label: "Pendiente", color: TEMA.muted },
  atrasado: { label: "Atrasado", color: ROJO },
};

const ESTADO_FUENTE: Record<EstadoFuente, { label: string; color: string }> = {
  listo: { label: "Listo", color: VERDE },
  verificar: { label: "Pendiente de verificar", color: AMBAR },
  montar: { label: "A montar", color: ROJO },
};

function Barrita({ valor, color }: { valor: number; color: string }) {
  return (
    <div className="bg-panel-2 h-1.5 w-full overflow-hidden rounded-full">
      <div
        className="h-full rounded-full"
        style={{ width: `${Math.min(Math.max(valor, 0), 1) * 100}%`, background: color }}
      />
    </div>
  );
}

function TooltipSimple({
  active,
  payload,
  label,
  formato,
}: {
  active?: boolean;
  payload?: { name?: string; value?: number; color?: string; fill?: string; stroke?: string }[];
  label?: string | number;
  formato: (n: number) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <CajaTooltip titulo={label}>
      {payload.map((p, i) => (
        <FilaTooltip
          key={`${p.name}-${i}`}
          color={p.color ?? p.fill ?? p.stroke ?? TEMA.muted}
          label={String(p.name ?? "")}
          valor={formato(Number(p.value ?? 0))}
        />
      ))}
    </CajaTooltip>
  );
}

const ejes = {
  stroke: TEMA.muted,
  fontSize: 11,
  tickLine: false,
  axisLine: false,
} as const;

function Leyenda() {
  return <Legend wrapperStyle={{ fontSize: 11, color: TEMA.muted }} iconSize={8} />;
}

function Tabla({ cabecera, children }: { cabecera: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-muted border-line border-b text-left text-xs">
            {cabecera.map((c) => (
              <th key={c} className="px-2 py-2 font-medium whitespace-nowrap">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-line divide-y">{children}</tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Scorecard: cómo se mide a Agatina
// ---------------------------------------------------------------------------

type FilaScore = {
  grupo: "Actividad" | "Venta" | "Gestión";
  meta: string;
  objetivo: string;
  real: string;
  cumplimiento: number;
  peso: number;
};

function armarScorecard(marcas: Marca[], tiendasNuevasReal: number | null): FilaScore[] {
  const tiendasNuevas = tiendasNuevasReal ?? TIENDAS_NUEVAS_MES;
  const propias = marcas.filter((m) => m.foco);
  const dg = marcas.find((m) => m.clave === "diaper_genie")!;
  const ht = marcas.find((m) => m.clave === "hola_toys")!;

  const pautaDias = propias.reduce((s, m) => s + m.diasPautaActiva, 0) / propias.length;
  const pubs = propias.flatMap((m) => m.publicacionesPorSemana);
  const pubsProm = pubs.reduce((s, v) => s + v, 0) / pubs.length;
  const navidad = HITOS.find((h) => h.que.startsWith("Campaña de Navidad"))!;
  const revistas = HITOS.filter((h) => h.que.startsWith("Revista") && h.entregado);
  const presupuesto = propias.reduce((s, m) => s + (m.presupuestoMes ?? 0), 0);
  const gastado = propias.reduce((s, m) => s + gastoTotal(m), 0);
  const ejec = gastado / presupuesto;
  const medibles = INDICADORES.filter((i) => i.estado === "listo").length / INDICADORES.length;

  return [
    {
      grupo: "Actividad",
      meta: "Colaboraciones con influencers",
      objetivo: `${META_INFLUENCERS_MES} / mes`,
      real: `${COLABORACIONES.length}`,
      cumplimiento: COLABORACIONES.length / META_INFLUENCERS_MES,
      peso: 0.1,
    },
    {
      grupo: "Actividad",
      meta: "Pauta activa todos los días (Meta Ads)",
      objetivo: `${CORTE.dia} de ${CORTE.dia} días`,
      real: `${dec1.format(pautaDias)} días`,
      cumplimiento: pautaDias / CORTE.dia,
      peso: 0.1,
    },
    {
      grupo: "Actividad",
      meta: "Publicaciones por semana por marca",
      objetivo: `${META_PUBLICACIONES_SEMANA} mínimo`,
      real: dec1.format(pubsProm),
      cumplimiento: pubsProm / META_PUBLICACIONES_SEMANA,
      peso: 0.1,
    },
    {
      grupo: "Actividad",
      meta: "Campaña de Navidad publicada",
      objetivo: `antes del ${navidad.vence}`,
      real: ESTADO_HITO[navidad.estado].label,
      cumplimiento: navidad.estado === "hecho" ? 1 : navidad.estado === "en_curso" ? 0.5 : 0,
      peso: 0.1,
    },
    {
      grupo: "Actividad",
      meta: "Revista entregada antes del día 5",
      objetivo: "100 % a tiempo",
      real: `${revistas.length} de ${revistas.length}`,
      cumplimiento: 1,
      peso: 0.1,
    },
    {
      grupo: "Venta",
      meta: "Venta Diaper Genie (proyectada)",
      objetivo: fmtMonedaCorta(dg.ventaObjetivoMes),
      real: fmtMonedaCorta(proyectar(ventaTotal(dg))),
      cumplimiento: proyectar(ventaTotal(dg)) / dg.ventaObjetivoMes!,
      peso: 0.15,
    },
    {
      grupo: "Venta",
      meta: "Venta Hola Toys (proyectada)",
      objetivo: fmtMonedaCorta(ht.ventaObjetivoMes),
      real: fmtMonedaCorta(proyectar(ventaTotal(ht))),
      cumplimiento: proyectar(ventaTotal(ht)) / ht.ventaObjetivoMes!,
      peso: 0.15,
    },
    {
      grupo: "Venta",
      meta: "Tiendas nuevas que abren cuenta",
      objetivo: `${META_TIENDAS_NUEVAS.min} a ${META_TIENDAS_NUEVAS.max}`,
      real: `${tiendasNuevas} (proy. ${Math.round(proyectar(tiendasNuevas))})${tiendasNuevasReal === null ? " · ejemplo" : ""}`,
      cumplimiento: proyectar(tiendasNuevas) / META_TIENDAS_NUEVAS.min,
      peso: 0.1,
    },
    {
      grupo: "Gestión",
      meta: "Presupuesto al ritmo del mes",
      objetivo: `≤ ${p0(AVANCE_MES + 0.1)} ejecutado`,
      real: `${p0(ejec)} ejecutado`,
      cumplimiento: ejec <= AVANCE_MES + 0.1 ? 1 : (AVANCE_MES + 0.1) / ejec,
      peso: 0.05,
    },
    {
      grupo: "Gestión",
      meta: "Indicadores medidos y cargados",
      objetivo: "100 %",
      real: p0(medibles),
      cumplimiento: medibles,
      peso: 0.05,
    },
  ];
}

function Scorecard({ marcas }: { marcas: Marca[] }) {
  const { venta } = useFuentes();
  const filas = armarScorecard(marcas, venta.tiendasNuevas.cantidad);
  const total = filas.reduce((s, f) => s + f.peso * Math.min(f.cumplimiento, 1), 0);
  const porGrupo = (["Actividad", "Venta", "Gestión"] as const).map((g) => {
    const fs = filas.filter((f) => f.grupo === g);
    const peso = fs.reduce((s, f) => s + f.peso, 0);
    const logrado = fs.reduce((s, f) => s + f.peso * Math.min(f.cumplimiento, 1), 0);
    return { grupo: g, peso, cumplimiento: logrado / peso };
  });

  return (
    <Panel
      titulo="Scorecard — cómo se mide a Agatina"
      nota="Actividad depende solo de ella · Venta es compartida con Alejandro"
    >
      <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
        <div className="bg-panel-2 flex flex-col items-center justify-center rounded-xl p-4">
          <p className="text-muted text-xs">Puntaje del mes</p>
          <p
            className="mt-1 text-5xl font-semibold tabular-nums"
            style={{ color: semaforo(total) }}
          >
            {Math.round(total * 100)}
          </p>
          <p className="text-muted text-xs">de 100</p>
          <div className="mt-4 w-full space-y-2">
            {porGrupo.map((g) => (
              <div key={g.grupo}>
                <div className="flex justify-between text-[11px]">
                  <span>
                    {g.grupo} <span className="text-muted">({p0(g.peso)})</span>
                  </span>
                  <span className="tabular-nums">{p0(g.cumplimiento)}</span>
                </div>
                <Barrita valor={g.cumplimiento} color={semaforo(g.cumplimiento)} />
              </div>
            ))}
          </div>
        </div>

        <Tabla cabecera={["Nivel", "Meta", "Objetivo", "Real", "Cumplimiento", "Peso"]}>
          {filas.map((f) => (
            <tr key={f.meta}>
              <td className="text-muted px-2 py-2 text-xs">{f.grupo}</td>
              <td className="px-2 py-2">{f.meta}</td>
              <td className="text-muted px-2 py-2 whitespace-nowrap">{f.objetivo}</td>
              <td className="px-2 py-2 whitespace-nowrap tabular-nums">{f.real}</td>
              <td className="w-40 px-2 py-2">
                <div className="flex items-center gap-2">
                  <Barrita valor={f.cumplimiento} color={semaforo(f.cumplimiento)} />
                  <span className="w-10 text-right text-xs tabular-nums">
                    {p0(f.cumplimiento)}
                  </span>
                </div>
              </td>
              <td className="text-muted px-2 py-2 text-xs tabular-nums">{p0(f.peso)}</td>
            </tr>
          ))}
        </Tabla>
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Vista consolidada
// ---------------------------------------------------------------------------

function VistaConsolidada({ marcas, meta }: { marcas: Marca[]; meta: MetaAds }) {
  const asignado = marcas.reduce((s, m) => s + (m.presupuestoMes ?? 0), 0);
  const gastado = marcas.reduce((s, m) => s + gastoTotal(m), 0);
  const venta = marcas.reduce((s, m) => s + ventaTotal(m), 0);
  const propias = marcas.filter((m) => m.foco);
  const objetivoPropias = propias.reduce((s, m) => s + (m.ventaObjetivoMes ?? 0), 0);
  const proyPropias = propias.reduce((s, m) => s + proyectar(ventaTotal(m)), 0);
  const entregas = HITOS.filter((h) => h.entregado);
  const aTiempo = entregas.filter((h) => h.estado === "hecho").length;
  const atrasados = HITOS.filter((h) => h.estado === "atrasado").length;
  const costoInf = COLABORACIONES.reduce((s, c) => s + c.costo, 0);
  const ventaInf = COLABORACIONES.reduce((s, c) => s + c.ventaAtribuida, 0);

  const presupuestoPorMarca = marcas.map((m) => ({
    marca: m.nombre,
    Asignado: m.presupuestoMes ?? 0,
    Gastado: gastoTotal(m),
    "Ritmo esperado": (m.presupuestoMes ?? 0) * AVANCE_MES,
  }));

  const ventaPorMarca = marcas.map((m) => ({
    marca: m.nombre,
    "Venta al corte": ventaTotal(m),
    Proyección: proyectar(ventaTotal(m)),
    Objetivo: m.ventaObjetivoMes ?? m.ventaBase,
  }));

  const canalPorMarca = marcas.map((m) => ({ marca: m.nombre, ...m.gastoPorCanal }));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <TarjetaKpi
          titulo="Presupuesto ejecutado"
          valor={fmtMonedaCorta(gastado)}
          acento={semaforo(gastado / asignado <= AVANCE_MES + 0.1 ? 1 : 0.8)}
          detalle={`${p0(gastado / asignado)} de ${fmtMonedaCorta(asignado)} · mes al ${p0(AVANCE_MES)}`}
        />
        <TarjetaKpi
          titulo="Venta del mes (4 marcas)"
          valor={fmtMonedaCorta(venta)}
          detalle={`Proyección ${fmtMonedaCorta(proyectar(venta))}`}
        />
        <TarjetaKpi
          titulo="Marcas propias vs objetivo"
          valor={p0(proyPropias / objetivoPropias)}
          acento={semaforo(proyPropias / objetivoPropias)}
          detalle={`${fmtMonedaCorta(proyPropias)} proy. / ${fmtMonedaCorta(objetivoPropias)}`}
        />
        <TarjetaKpi
          titulo="Retorno (venta ÷ inversión)"
          valor={`${dec1.format(venta / gastado)}x`}
          detalle="MER del mes, todas las marcas"
        />
        <TarjetaKpi
          titulo="Influencers"
          valor={`${COLABORACIONES.length} / ${META_INFLUENCERS_MES}`}
          acento={semaforo(COLABORACIONES.length / META_INFLUENCERS_MES)}
          detalle={`ROI ${dec1.format(ventaInf / costoInf)}x · ${fmtMonedaCorta(costoInf)} invertidos`}
        />
        <TarjetaKpi
          titulo="Deadlines"
          valor={`${aTiempo} / ${entregas.length} a tiempo`}
          acento={atrasados ? ROJO : VERDE}
          detalle={atrasados ? `${atrasados} atrasado(s)` : "Sin atrasos"}
        />
      </div>

      <PanelFuentes />

      <Scorecard marcas={marcas} />

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel titulo="Presupuesto por marca" nota="Asignado vs gastado vs ritmo del mes">
          <div className="h-72">
            <ResponsiveContainer>
              <BarChart data={presupuestoPorMarca} barGap={2}>
                <CartesianGrid stroke={TEMA.line} vertical={false} />
                <XAxis dataKey="marca" {...ejes} />
                <YAxis {...ejes} tickFormatter={(v) => fmtMonedaCorta(v)} width={60} />
                <Tooltip
                  cursor={{ fill: "#ffffff08" }}
                  content={<TooltipSimple formato={fmtMoneda} />}
                />
                <Leyenda />
                <Bar dataKey="Asignado" fill="#3b4250" radius={[3, 3, 0, 0]} />
                <Bar dataKey="Ritmo esperado" fill="#3b82f655" radius={[3, 3, 0, 0]} />
                <Bar dataKey="Gastado" fill="#3b82f6" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="text-muted mt-2 text-xs">
            Unibrandco y Litter Genie no tienen presupuesto asignado (a definir): todo lo que se
            gasta ahí es un desvío a consultar con Alejandro.
          </p>
        </Panel>

        <Panel titulo="Venta por marca" nota="Al corte, proyectada y objetivo (o línea de base)">
          <div className="h-72">
            <ResponsiveContainer>
              <BarChart data={ventaPorMarca} barGap={2}>
                <CartesianGrid stroke={TEMA.line} vertical={false} />
                <XAxis dataKey="marca" {...ejes} />
                <YAxis {...ejes} tickFormatter={(v) => fmtMonedaCorta(v)} width={60} />
                <Tooltip
                  cursor={{ fill: "#ffffff08" }}
                  content={<TooltipSimple formato={fmtMoneda} />}
                />
                <Leyenda />
                <Bar dataKey="Venta al corte" fill="#22c55e" radius={[3, 3, 0, 0]} />
                <Bar dataKey="Proyección" fill="#22c55e66" radius={[3, 3, 0, 0]} />
                <Bar dataKey="Objetivo" fill="#3b4250" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel titulo="Gasto por canal y marca" nota="Pauta, influencers, contenido, ferias">
          <div className="h-72">
            <ResponsiveContainer>
              <BarChart data={canalPorMarca}>
                <CartesianGrid stroke={TEMA.line} vertical={false} />
                <XAxis dataKey="marca" {...ejes} />
                <YAxis {...ejes} tickFormatter={(v) => fmtMonedaCorta(v)} width={60} />
                <Tooltip
                  cursor={{ fill: "#ffffff08" }}
                  content={<TooltipSimple formato={fmtMoneda} />}
                />
                <Leyenda />
                {CANALES.map((c) => (
                  <Bar key={c} dataKey={c} stackId="g" fill={COLOR_CANAL[c]} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel titulo="Resumen por marca" nota={CORTE.mes}>
          <Tabla cabecera={["Marca", "Estado", "Gastado", "Venta", "Retorno", "Seguidores", "Leads"]}>
            {marcas.map((m) => (
              <tr key={m.clave}>
                <td className="px-2 py-2 whitespace-nowrap">
                  <span
                    className="mr-2 inline-block size-2 rounded-full"
                    style={{ background: m.color }}
                  />
                  {m.nombre}
                </td>
                <td className="text-muted px-2 py-2 text-xs">{m.estado}</td>
                <td className="px-2 py-2 whitespace-nowrap tabular-nums">{fmtMonedaCorta(gastoTotal(m))}</td>
                <td className="px-2 py-2 whitespace-nowrap tabular-nums">{fmtMonedaCorta(ventaTotal(m))}</td>
                <td className="px-2 py-2 tabular-nums">
                  {dec1.format(ventaTotal(m) / gastoTotal(m))}x
                </td>
                <td className="px-2 py-2 tabular-nums">
                  {fmtNumero(m.seguidores)}{" "}
                  <span className="text-xs" style={{ color: VERDE }}>
                    +{p1(m.seguidores / m.seguidoresMesAnterior - 1)}
                  </span>
                </td>
                <td className="px-2 py-2 tabular-nums">{m.leadsMayoristas}</td>
              </tr>
            ))}
          </Tabla>
        </Panel>
      </div>

      <PanelMetaConsolidado marcas={marcas} meta={meta} />

      <Deadlines marca={null} />
      <Indicadores />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Vista por marca
// ---------------------------------------------------------------------------

function VistaMarca({ m, meta }: { m: Marca; meta: MetaAdsMarca }) {
  const gastado = gastoTotal(m);
  const venta = ventaTotal(m);
  const proy = proyectar(venta);
  const objetivo = m.ventaObjetivoMes;
  const ejec = m.presupuestoMes ? gastado / m.presupuestoMes : null;
  const fuentes = useFuentes();
  const tn = fuentes.venta.tiendaNube.porMarca[m.clave];
  const ig = fuentes.instagram[m.clave];
  const may = fuentes.venta.mayorista.porMarca[m.clave];
  // Con pedidos importados, los canjes y la venta de cada cupón salen de
  // Tienda Nube; el costo de la colaboración sigue siendo carga manual.
  const colabs = COLABORACIONES.filter((c) => c.marca === m.clave).map((c) => {
    const real = tn?.cupones.find((x) => x.cupon === c.cupon.toUpperCase());
    return tn ? { ...c, canjes: real?.pedidos ?? 0, ventaAtribuida: real?.venta ?? 0 } : c;
  });
  const costoPauta = m.gastoPorCanal["Meta Ads"] + m.gastoPorCanal["Google Ads"];
  const cac = (costoPauta + m.gastoPorCanal.Influencers) / m.pedidosTienda;
  const conversion = m.pedidosTienda / m.visitasTienda;
  const ticket = m.ventaTiendas / m.pedidosTienda;
  const interaccion = m.interacciones30d / m.alcance30d;

  const acumulado = ventaAcumulada(m);
  const metaMes = objetivo ?? m.ventaBase;
  const serieVenta = Array.from({ length: CORTE.diasMes }, (_, i) => ({
    dia: i + 1,
    Real: i < acumulado.length ? Math.round(acumulado[i]) : null,
    [objetivo ? "Ritmo objetivo" : "Ritmo línea de base"]: Math.round(
      (metaMes / CORTE.diasMes) * (i + 1),
    ),
  }));
  const claveRitmo = objetivo ? "Ritmo objetivo" : "Ritmo línea de base";

  const canales = CANALES.map((c) => ({ canal: c, Gasto: m.gastoPorCanal[c] }));
  const historia = m.historia.map((h) => ({ ...h, Retorno: h.venta / h.inversion }));
  const publicaciones = m.publicacionesPorSemana.map((v, i) => ({
    semana: `Sem ${i + 1}`,
    Publicaciones: v,
  }));
  const embudo = [
    { paso: "Alcance (30 d)", valor: m.alcance30d },
    { paso: "Visitas tienda", valor: m.visitasTienda },
    { paso: "Clics de pauta", valor: m.clicsPauta },
    { paso: "Pedidos", valor: m.pedidosTienda },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Chip color={m.color}>{m.estado}</Chip>
        {m.margen && (
          <Chip color={TEMA.muted}>
            Margen ~{p1(m.margen)} · punto de equilibrio{" "}
            {fmtMonedaCorta((m.presupuestoMes ?? 0) / m.margen)} de venta
          </Chip>
        )}
      </div>

      <h3 className="text-muted text-xs font-medium tracking-wide uppercase">
        Presupuesto y venta
      </h3>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <TarjetaKpi
          titulo="Presupuesto del mes"
          valor={m.presupuestoMes ? fmtMonedaCorta(m.presupuestoMes) : "A definir"}
          detalle="Pauta, contenido, producciones, influencers y ferias"
        />
        <TarjetaKpi
          titulo="Gastado"
          valor={fmtMonedaCorta(gastado)}
          acento={ejec === null ? AMBAR : semaforo(ejec <= AVANCE_MES + 0.1 ? 1 : 0.8)}
          detalle={
            ejec === null
              ? "Sin presupuesto asignado"
              : `${p0(ejec)} ejecutado · mes al ${p0(AVANCE_MES)}`
          }
        />
        <TarjetaKpi
          titulo="Venta al corte"
          valor={fmtMonedaCorta(venta)}
          detalle={`Tiendas ${fmtMonedaCorta(m.ventaTiendas)} · Mayorista ${fmtMonedaCorta(m.ventaMayorista)}`}
        />
        <TarjetaKpi
          titulo={objetivo ? "Proyección vs objetivo" : "Proyección vs línea de base"}
          valor={p0(proy / metaMes)}
          acento={semaforo(proy / metaMes)}
          detalle={`${fmtMonedaCorta(proy)} / ${fmtMonedaCorta(metaMes)}`}
        />
        <TarjetaKpi
          titulo="Retorno (venta ÷ inversión)"
          valor={`${dec1.format(venta / gastado)}x`}
          detalle="MER del mes"
        />
        <TarjetaKpi
          titulo="Costo de adquisición"
          valor={fmtMoneda(cac)}
          detalle="(Pauta + influencers) ÷ pedidos"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-muted text-xs font-medium tracking-wide uppercase">Marca y demanda</h3>
        {ig.fuente === "meta" ? (
          <Chip color={VERDE}>
            Instagram conectado{ig.datos.usuario ? ` · @${ig.datos.usuario}` : ""}
          </Chip>
        ) : (
          <span title={ig.motivo}>
            <Chip color={AMBAR}>Instagram: datos de ejemplo</Chip>
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <TarjetaKpi
          titulo="Seguidores"
          valor={fmtNumero(m.seguidores)}
          detalle={`+${fmtNumero(m.seguidores - m.seguidoresMesAnterior)} en el mes (${p1(m.seguidores / m.seguidoresMesAnterior - 1)})`}
        />
        <TarjetaKpi
          titulo={ig.fuente === "meta" ? "Alcance del mes" : "Alcance 30 días"}
          valor={fmtNumero(m.alcance30d)}
          detalle={`Interacción ${p1(interaccion)}`}
        />
        <TarjetaKpi
          titulo="Mensajes recibidos"
          valor={fmtNumero(m.mensajes30d)}
          acento={m.tiempoRespuestaMin <= 120 ? VERDE : AMBAR}
          detalle={`1ª respuesta en ${m.tiempoRespuestaMin} min promedio`}
        />
        <TarjetaKpi
          titulo="Puntaje tienda"
          valor={`${dec1.format(m.puntajeTienda)} ★`}
          detalle={`${fmtNumero(m.resenas)} reseñas`}
        />
        <TarjetaKpi
          titulo="Conversión tienda"
          valor={p1(conversion)}
          detalle={`Ticket promedio ${fmtMonedaCorta(ticket)}`}
        />
        <TarjetaKpi
          titulo={may ? "Tiendas nuevas de la marca" : "Leads mayoristas"}
          valor={fmtNumero(may ? may.tiendasNuevas : m.leadsMayoristas)}
          detalle={
            may
              ? "Primera compra a SIGMA este mes"
              : `Pauta activa ${m.diasPautaActiva} de ${CORTE.dia} días`
          }
          acento={may ? undefined : m.diasPautaActiva === CORTE.dia ? VERDE : AMBAR}
        />
      </div>

      <SeccionTiendaNube m={m} />

      <SeccionMeta m={m} meta={meta} />

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel titulo="Venta acumulada del mes" nota={`vs ${claveRitmo.toLowerCase()}`}>
          <div className="h-72">
            <ResponsiveContainer>
              <LineChart data={serieVenta}>
                <CartesianGrid stroke={TEMA.line} vertical={false} />
                <XAxis dataKey="dia" {...ejes} />
                <YAxis {...ejes} tickFormatter={(v) => fmtMonedaCorta(v)} width={60} />
                <Tooltip content={<TooltipSimple formato={fmtMoneda} />} />
                <Leyenda />
                <Line
                  dataKey={claveRitmo}
                  stroke={TEMA.muted}
                  strokeDasharray="4 4"
                  dot={false}
                  strokeWidth={1.5}
                />
                <Line
                  dataKey="Real"
                  stroke={m.color}
                  strokeWidth={2.5}
                  dot={false}
                  connectNulls={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel titulo="Gasto por canal" nota={m.presupuestoMes ? `de ${fmtMoneda(m.presupuestoMes)}` : "Presupuesto a definir"}>
          <div className="h-72">
            <ResponsiveContainer>
              <BarChart data={canales} layout="vertical" margin={{ left: 10 }}>
                <CartesianGrid stroke={TEMA.line} horizontal={false} />
                <XAxis type="number" {...ejes} tickFormatter={(v) => fmtMonedaCorta(v)} />
                <YAxis type="category" dataKey="canal" {...ejes} width={80} />
                <Tooltip
                  cursor={{ fill: "#ffffff08" }}
                  content={<TooltipSimple formato={fmtMoneda} />}
                />
                <Bar dataKey="Gasto" radius={[0, 3, 3, 0]}>
                  {canales.map((c) => (
                    <Cell key={c.canal} fill={COLOR_CANAL[c.canal]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel titulo="Inversión vs venta" nota="Últimos 4 meses · *noviembre proyectado">
          <div className="h-72">
            <ResponsiveContainer>
              <ComposedChart data={historia}>
                <CartesianGrid stroke={TEMA.line} vertical={false} />
                <XAxis dataKey="mes" {...ejes} />
                <YAxis yAxisId="m" {...ejes} tickFormatter={(v) => fmtMonedaCorta(v)} width={60} />
                <YAxis
                  yAxisId="r"
                  orientation="right"
                  {...ejes}
                  tickFormatter={(v) => `${v}x`}
                  width={35}
                />
                <Tooltip
                  cursor={{ fill: "#ffffff08" }}
                  content={
                    <TooltipSimple
                      formato={(n) => (n < 100 ? `${dec1.format(n)}x` : fmtMoneda(n))}
                    />
                  }
                />
                <Leyenda />
                <Bar yAxisId="m" dataKey="inversion" name="Inversión" fill="#3b82f6" radius={[3, 3, 0, 0]} />
                <Bar yAxisId="m" dataKey="venta" name="Venta" fill={m.color} radius={[3, 3, 0, 0]} />
                <Line yAxisId="r" dataKey="Retorno" stroke={AMBAR} strokeWidth={2} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel titulo="Contenido publicado" nota={`Meta: ${META_PUBLICACIONES_SEMANA} por semana`}>
          <div className="h-72">
            <ResponsiveContainer>
              <BarChart data={publicaciones}>
                <CartesianGrid stroke={TEMA.line} vertical={false} />
                <XAxis dataKey="semana" {...ejes} />
                <YAxis {...ejes} allowDecimals={false} width={30} />
                <Tooltip
                  cursor={{ fill: "#ffffff08" }}
                  content={<TooltipSimple formato={fmtNumero} />}
                />
                <ReferenceLine
                  y={META_PUBLICACIONES_SEMANA}
                  stroke={AMBAR}
                  strokeDasharray="4 4"
                  label={{ value: "Meta", fill: AMBAR, fontSize: 11, position: "right" }}
                />
                <Bar dataKey="Publicaciones" radius={[3, 3, 0, 0]}>
                  {publicaciones.map((p) => (
                    <Cell
                      key={p.semana}
                      fill={p.Publicaciones >= META_PUBLICACIONES_SEMANA ? VERDE : ROJO}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel titulo="Embudo de demanda" nota="Del alcance al pedido">
          <div className="space-y-3">
            {embudo.map((e, i) => (
              <div key={e.paso}>
                <div className="flex justify-between text-xs">
                  <span>{e.paso}</span>
                  <span className="tabular-nums">
                    {fmtNumero(e.valor)}
                    {i > 0 && (
                      <span className="text-muted ml-2">
                        {p1(e.valor / embudo[i - 1].valor)} del paso anterior
                      </span>
                    )}
                  </span>
                </div>
                <div className="bg-panel-2 mt-1 h-5 overflow-hidden rounded">
                  <div
                    className="h-full rounded"
                    style={{
                      width: `${Math.max(Math.sqrt(e.valor / embudo[0].valor) * 100, 2)}%`,
                      background: m.color,
                      opacity: 1 - i * 0.18,
                    }}
                  />
                </div>
              </div>
            ))}
            <p className="text-muted text-[11px]">
              Ancho en escala raíz para que los pasos chicos se vean. Visitas y conversión quedan
              firmes cuando se verifique Google Analytics.
            </p>
          </div>
        </Panel>

        <Panel titulo="Origen del tráfico" nota="Google Analytics · pendiente de verificar">
          <div className="h-60">
            <ResponsiveContainer>
              <BarChart data={m.traficoOrigen} layout="vertical" margin={{ left: 10 }}>
                <CartesianGrid stroke={TEMA.line} horizontal={false} />
                <XAxis type="number" {...ejes} tickFormatter={(v) => fmtNumero(v)} />
                <YAxis type="category" dataKey="origen" {...ejes} width={70} />
                <Tooltip
                  cursor={{ fill: "#ffffff08" }}
                  content={<TooltipSimple formato={fmtNumero} />}
                />
                <Bar dataKey="visitas" name="Visitas" fill={m.color} radius={[0, 3, 3, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>

      <Panel
        titulo="Influencers"
        nota={
          tn
            ? "Canjes y venta leídos de los pedidos importados · el costo es carga manual"
            : "Un cupón único por colaboración · datos de ejemplo"
        }
      >
        {colabs.length === 0 ? (
          <p className="text-muted text-sm">Sin colaboraciones este mes.</p>
        ) : (
          <Tabla cabecera={["Influencer", "Fecha", "Cupón", "Costo", "Canjes", "Venta atribuida", "ROI", "CAC"]}>
            {colabs.map((c) => (
              <tr key={c.cupon}>
                <td className="px-2 py-2">{c.influencer}</td>
                <td className="text-muted px-2 py-2">{c.fecha}</td>
                <td className="px-2 py-2 font-mono text-xs">{c.cupon}</td>
                <td className="px-2 py-2 tabular-nums">{fmtMoneda(c.costo)}</td>
                <td className="px-2 py-2 tabular-nums">{c.canjes}</td>
                <td className="px-2 py-2 tabular-nums">{fmtMoneda(c.ventaAtribuida)}</td>
                <td className="px-2 py-2 tabular-nums" style={{ color: semaforo(c.ventaAtribuida / c.costo / 3) }}>
                  {dec1.format(c.ventaAtribuida / c.costo)}x
                </td>
                <td className="px-2 py-2 tabular-nums">{c.canjes ? fmtMoneda(c.costo / c.canjes) : "—"}</td>
              </tr>
            ))}
          </Tabla>
        )}
      </Panel>

      <Deadlines marca={m.clave} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Meta Ads (API de Marketing de Meta)
// ---------------------------------------------------------------------------

function ChipFuente({ meta }: { meta: MetaAdsMarca }) {
  return meta.fuente === "meta" ? (
    <Chip color={VERDE}>Conectado a Meta Ads</Chip>
  ) : (
    <span title={meta.motivo}>
      <Chip color={AMBAR}>Meta Ads: datos de ejemplo</Chip>
    </span>
  );
}

function PanelMetaConsolidado({ marcas, meta }: { marcas: Marca[]; meta: MetaAds }) {
  const conectadas = marcas.filter((m) => meta[m.clave].fuente === "meta").length;
  return (
    <Panel
      titulo="Meta Ads por marca"
      nota={
        conectadas === marcas.length
          ? "Leído de la API de Meta · se actualiza cada 15 min"
          : `${conectadas} de ${marcas.length} marcas conectadas · el resto con datos de ejemplo`
      }
    >
      <Tabla
        cabecera={[
          "Marca",
          "Inversión",
          "Alcance",
          "Frecuencia",
          "CTR",
          "CPM",
          "Compras",
          "Costo por compra",
          "ROAS",
          "Días sin pauta",
          "Fuente",
        ]}
      >
        {marcas.map((m) => {
          const x = meta[m.clave];
          const t = x.totales;
          const cortes = x.diario.length - diasConPauta(x.diario);
          return (
            <tr key={m.clave}>
              <td className="px-2 py-2 whitespace-nowrap">
                <span className="mr-2 inline-block size-2 rounded-full" style={{ background: m.color }} />
                {m.nombre}
              </td>
              <td className="px-2 py-2 whitespace-nowrap tabular-nums">{fmtMonedaCorta(t.gasto)}</td>
              <td className="px-2 py-2 tabular-nums">{fmtNumero(t.alcance)}</td>
              <td className="px-2 py-2 tabular-nums">{dec1.format(t.frecuencia)}</td>
              <td className="px-2 py-2 tabular-nums">{p1(ctr(t))}</td>
              <td className="px-2 py-2 whitespace-nowrap tabular-nums">{fmtMoneda(cpm(t))}</td>
              <td className="px-2 py-2 tabular-nums">{fmtNumero(t.compras)}</td>
              <td className="px-2 py-2 whitespace-nowrap tabular-nums">{fmtMoneda(costoPorCompra(t))}</td>
              <td className="px-2 py-2 tabular-nums" style={{ color: semaforo(roas(t) / 3) }}>
                {dec1.format(roas(t))}x
              </td>
              <td className="px-2 py-2 tabular-nums" style={{ color: cortes ? ROJO : VERDE }}>
                {cortes}
              </td>
              <td className="px-2 py-2">
                <ChipFuente meta={x} />
              </td>
            </tr>
          );
        })}
      </Tabla>
      <p className="text-muted mt-2 text-xs">
        ROAS de Meta = valor de compras atribuidas por el píxel ÷ inversión. Atribuye con su
        propia ventana (7 días clic / 1 día vista), así que suele dar más que el retorno total de
        la tienda: sirve para comparar campañas entre sí, no para sumar contra la venta.
      </p>
    </Panel>
  );
}

function SeccionMeta({ m, meta }: { m: Marca; meta: MetaAdsMarca }) {
  const t = meta.totales;
  const dias = diasConPauta(meta.diario);
  const cortes = meta.diario.length - dias;
  const diario = meta.diario.map((d) => ({
    fecha: d.fecha,
    Inversión: d.gasto,
    Compras: d.compras,
  }));

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-muted text-xs font-medium tracking-wide uppercase">Meta Ads</h3>
        <ChipFuente meta={meta} />
        {meta.fuente === "demo" && meta.motivo && (
          <span className="text-muted text-[11px]">{meta.motivo}</span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <TarjetaKpi
          titulo="Inversión del mes"
          valor={fmtMonedaCorta(t.gasto)}
          detalle={
            m.presupuestoMes ? `${p0(t.gasto / m.presupuestoMes)} del presupuesto de la marca` : "Presupuesto a definir"
          }
        />
        <TarjetaKpi
          titulo="Pauta activa"
          valor={`${dias} de ${meta.diario.length} días`}
          acento={cortes ? ROJO : VERDE}
          detalle={cortes ? `${cortes} día(s) sin gasto: corte de pauta` : "Sin cortes"}
        />
        <TarjetaKpi
          titulo="Alcance · frecuencia"
          valor={fmtNumero(t.alcance)}
          acento={t.frecuencia > 4 ? AMBAR : undefined}
          detalle={`Frecuencia ${dec1.format(t.frecuencia)}${t.frecuencia > 4 ? " · audiencia saturada" : ""}`}
        />
        <TarjetaKpi
          titulo="CTR · CPC"
          valor={p1(ctr(t))}
          detalle={`CPC ${fmtMoneda(cpc(t))} · CPM ${fmtMoneda(cpm(t))}`}
        />
        <TarjetaKpi
          titulo="Compras atribuidas"
          valor={fmtNumero(t.compras)}
          detalle={`${fmtMonedaCorta(t.valorCompras)} · ${fmtMoneda(costoPorCompra(t))} c/u`}
        />
        <TarjetaKpi
          titulo="ROAS Meta"
          valor={`${dec1.format(roas(t))}x`}
          acento={semaforo(roas(t) / 3)}
          detalle={`${fmtNumero(t.conversaciones)} conversaciones por mensaje`}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel titulo="Inversión diaria en Meta" nota="Barra roja = día sin pauta">
          <div className="h-72">
            <ResponsiveContainer>
              <ComposedChart data={diario}>
                <CartesianGrid stroke={TEMA.line} vertical={false} />
                <XAxis dataKey="fecha" {...ejes} />
                <YAxis yAxisId="m" {...ejes} tickFormatter={(v) => fmtMonedaCorta(v)} width={60} />
                <YAxis yAxisId="c" orientation="right" {...ejes} allowDecimals={false} width={30} />
                <Tooltip
                  cursor={{ fill: "#ffffff08" }}
                  content={<TooltipSimple formato={(n) => (n < 1000 ? fmtNumero(n) : fmtMoneda(n))} />}
                />
                <Leyenda />
                <Bar yAxisId="m" dataKey="Inversión" radius={[3, 3, 0, 0]} minPointSize={3}>
                  {diario.map((d) => (
                    <Cell key={d.fecha} fill={d.Inversión > 0 ? "#3b82f6" : ROJO} />
                  ))}
                </Bar>
                <Line yAxisId="c" dataKey="Compras" stroke={m.color} strokeWidth={2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel titulo="Campañas de Meta" nota="Mes en curso, de mayor a menor inversión">
          {meta.campanas.length === 0 ? (
            <p className="text-muted text-sm">Sin campañas con gasto este mes.</p>
          ) : (
            <Tabla cabecera={["Campaña", "Inversión", "CTR", "Compras", "Costo/compra", "ROAS"]}>
              {meta.campanas.map((c) => (
                <tr key={c.nombre}>
                  <td className="px-2 py-2">{c.nombre}</td>
                  <td className="px-2 py-2 whitespace-nowrap tabular-nums">{fmtMonedaCorta(c.gasto)}</td>
                  <td className="px-2 py-2 tabular-nums">{p1(ctr(c))}</td>
                  <td className="px-2 py-2 tabular-nums">{fmtNumero(c.compras)}</td>
                  <td className="px-2 py-2 whitespace-nowrap tabular-nums">{fmtMoneda(costoPorCompra(c))}</td>
                  <td className="px-2 py-2 tabular-nums" style={{ color: semaforo(roas(c) / 3) }}>
                    {dec1.format(roas(c))}x
                  </td>
                </tr>
              ))}
            </Tabla>
          )}
          <p className="text-muted mt-2 text-xs">
            ROAS bajo no siempre es malo: las campañas de alcance o de mensajes no buscan compras.
            Ojo con las de venta por debajo de 3x.
          </p>
        </Panel>

        <Panel titulo="Dónde se gasta: plataformas" nota="Inversión y ROAS por ubicación">
          <BarrasMeta filas={meta.plataformas} color={m.color} />
        </Panel>

        <Panel titulo="A quién le llega: edades" nota="Inversión y ROAS por rango de edad">
          <BarrasMeta filas={meta.edades} color={m.color} />
        </Panel>

        <Panel titulo="Anuncios con más inversión" nota="Qué creatividad vende" className="xl:col-span-2">
          {meta.anuncios.length === 0 ? (
            <p className="text-muted text-sm">Sin anuncios con gasto este mes.</p>
          ) : (
            <Tabla cabecera={["Anuncio", "Inversión", "Impresiones", "CTR", "Compras", "Costo/compra", "ROAS"]}>
              {meta.anuncios.map((c) => (
                <tr key={c.nombre}>
                  <td className="px-2 py-2">{c.nombre}</td>
                  <td className="px-2 py-2 whitespace-nowrap tabular-nums">{fmtMonedaCorta(c.gasto)}</td>
                  <td className="px-2 py-2 tabular-nums">{fmtNumero(c.impresiones)}</td>
                  <td className="px-2 py-2 tabular-nums">{p1(ctr(c))}</td>
                  <td className="px-2 py-2 tabular-nums">{fmtNumero(c.compras)}</td>
                  <td className="px-2 py-2 whitespace-nowrap tabular-nums">{fmtMoneda(costoPorCompra(c))}</td>
                  <td className="px-2 py-2 tabular-nums" style={{ color: semaforo(roas(c) / 3) }}>
                    {dec1.format(roas(c))}x
                  </td>
                </tr>
              ))}
            </Tabla>
          )}
        </Panel>
      </div>
    </>
  );
}

function BarrasMeta({ filas, color }: { filas: CampanaMeta[]; color: string }) {
  const datos = filas.map((f) => ({ nombre: f.nombre, Inversión: f.gasto, ROAS: roas(f) }));
  return (
    <div className="h-60">
      <ResponsiveContainer>
        <ComposedChart data={datos} layout="vertical" margin={{ left: 10 }}>
          <CartesianGrid stroke={TEMA.line} horizontal={false} />
          <XAxis type="number" {...ejes} tickFormatter={(v) => fmtMonedaCorta(v)} />
          <YAxis type="category" dataKey="nombre" {...ejes} width={110} />
          <Tooltip
            cursor={{ fill: "#ffffff08" }}
            content={<TooltipSimple formato={(n) => (n < 100 ? `${dec1.format(n)}x` : fmtMoneda(n))} />}
          />
          <Bar dataKey="Inversión" fill={color} radius={[0, 3, 3, 0]} />
          <Bar dataKey="ROAS" hide />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tienda Nube (pedidos importados del CSV)
// ---------------------------------------------------------------------------

function SeccionTiendaNube({ m }: { m: Marca }) {
  const { venta, generado } = useFuentes();
  const tn = venta.tiendaNube.porMarca[m.clave];
  if (!tn) {
    return (
      <div className="border-line bg-panel flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3 text-sm">
        <span>
          <span className="text-muted mr-2 text-xs font-medium tracking-wide uppercase">Tienda Nube</span>
          <Chip color={AMBAR}>Sin pedidos importados: venta de tienda con datos de ejemplo</Chip>
          {venta.tiendaNube.motivo && (
            <span className="text-muted ml-2 text-[11px]">{venta.tiendaNube.motivo}</span>
          )}
        </span>
        <a href="/marketing/importar" className="text-c1 text-xs hover:underline">
          Importar el CSV de ventas →
        </a>
      </div>
    );
  }
  const total = tn.clientesNuevos + tn.clientesRecurrentes;
  const atrasada = Date.parse(generado) - Date.parse(tn.ultimaImportacion) > 8 * 86_400_000;
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-muted text-xs font-medium tracking-wide uppercase">Tienda Nube</h3>
        <Chip color={atrasada ? AMBAR : VERDE}>
          Importado · último pedido {fechaCorta(tn.ultimoPedido)}
        </Chip>
        {atrasada && <span className="text-[11px]" style={{ color: AMBAR }}>Hace más de una semana que no se importa</span>}
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <TarjetaKpi titulo="Venta tienda (c/IVA)" valor={fmtMonedaCorta(tn.venta)} detalle={`${fmtNumero(tn.pedidos)} pedidos pagados`} />
        <TarjetaKpi titulo="Ticket promedio" valor={fmtMoneda(tn.pedidos ? tn.venta / tn.pedidos : NaN)} />
        <TarjetaKpi
          titulo="Clientes nuevos"
          valor={fmtNumero(tn.clientesNuevos)}
          detalle={total ? `${p0(tn.clientesNuevos / total)} de los compradores del mes` : "—"}
        />
        <TarjetaKpi
          titulo="Clientes que vuelven"
          valor={fmtNumero(tn.clientesRecurrentes)}
          detalle="Ya habían comprado en la tienda"
        />
        <TarjetaKpi
          titulo="Venta con cupón"
          valor={fmtMonedaCorta(tn.cupones.reduce((s, c) => s + c.venta, 0))}
          detalle={`${tn.cupones.length} cupones usados`}
        />
        <TarjetaKpi
          titulo="Costo por cliente nuevo"
          valor={fmtMoneda(tn.clientesNuevos ? (m.gastoPorCanal["Meta Ads"] + m.gastoPorCanal["Google Ads"] + m.gastoPorCanal.Influencers) / tn.clientesNuevos : NaN)}
          detalle="(Pauta + influencers) ÷ clientes nuevos"
        />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel titulo="Cupones usados" nota="Cada influencer con su cupón único">
          {tn.cupones.length === 0 ? (
            <p className="text-muted text-sm">Ningún pedido con cupón este mes.</p>
          ) : (
            <Tabla cabecera={["Cupón", "Pedidos", "Venta"]}>
              {tn.cupones.map((c) => (
                <tr key={c.cupon}>
                  <td className="px-2 py-2 font-mono text-xs">{c.cupon}</td>
                  <td className="px-2 py-2 tabular-nums">{fmtNumero(c.pedidos)}</td>
                  <td className="px-2 py-2 tabular-nums">{fmtMoneda(c.venta)}</td>
                </tr>
              ))}
            </Tabla>
          )}
        </Panel>
        <Panel titulo="Pedidos por provincia" nota="Dónde pega la pauta">
          <div className="h-60">
            <ResponsiveContainer>
              <BarChart data={tn.provincias} layout="vertical" margin={{ left: 10 }}>
                <CartesianGrid stroke={TEMA.line} horizontal={false} />
                <XAxis type="number" {...ejes} allowDecimals={false} />
                <YAxis type="category" dataKey="provincia" {...ejes} width={110} />
                <Tooltip cursor={{ fill: "#ffffff08" }} content={<TooltipSimple formato={fmtNumero} />} />
                <Bar dataKey="pedidos" name="Pedidos" fill={m.color} radius={[0, 3, 3, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Estado de las fuentes
// ---------------------------------------------------------------------------

/**
 * De dónde sale cada número, marca por marca. El acuerdo de rol lo dice así:
 * "si un indicador no se puede medir, eso es un hallazgo a resolver". Este
 * panel es esa lista de hallazgos, y se achica sola a medida que se conecta.
 */
function PanelFuentes() {
  const { meta, instagram, venta } = useFuentes();
  type Estado = { ok: boolean; texto: string };
  const filas: { fuente: string; uso: string; porMarca: Record<ClaveMarca, Estado> | null; general?: Estado }[] = [
    {
      fuente: "Meta Ads (API)",
      uso: "Inversión, días de pauta, alcance, CTR, compras, ROAS",
      porMarca: Object.fromEntries(
        MARCAS.map((m) => [m.clave, meta[m.clave].fuente === "meta" ? { ok: true, texto: "Conectado" } : { ok: false, texto: meta[m.clave].motivo ?? "Ejemplo" }]),
      ) as Record<ClaveMarca, Estado>,
    },
    {
      fuente: "Instagram (API)",
      uso: "Seguidores, alcance, interacción, publicaciones por semana",
      porMarca: Object.fromEntries(
        MARCAS.map((m) => {
          const ig = instagram[m.clave];
          return [m.clave, ig.fuente === "meta" ? { ok: true, texto: "Conectado" } : { ok: false, texto: ig.motivo }];
        }),
      ) as Record<ClaveMarca, Estado>,
    },
    {
      fuente: "Tienda Nube (CSV importado)",
      uso: "Venta de tienda, pedidos, ticket, cupones, clientes nuevos",
      porMarca: Object.fromEntries(
        MARCAS.map((m) => {
          const tn = venta.tiendaNube.porMarca[m.clave];
          return [m.clave, tn ? { ok: true, texto: `Al ${fechaCorta(tn.ultimoPedido)}` } : { ok: false, texto: venta.tiendaNube.motivo ?? "Sin importar" }];
        }),
      ) as Record<ClaveMarca, Estado>,
    },
    {
      fuente: "SIGMA (gold.fact_ventas)",
      uso: "Venta mayorista por marca, tiendas nuevas",
      porMarca: Object.fromEntries(
        MARCAS.map((m) => {
          const may = venta.mayorista.porMarca[m.clave];
          return [
            m.clave,
            may
              ? { ok: true, texto: "Conectado" }
              : { ok: false, texto: m.clave === "unibrandco" ? "No aplica" : (venta.mayorista.motivo ?? "Sin datos") },
          ];
        }),
      ) as Record<ClaveMarca, Estado>,
    },
    {
      fuente: "Carga manual",
      uso: "Costo de influencers, leads, mensajes, fechas límite, Google Ads",
      porMarca: null,
      general: { ok: false, texto: "Datos de ejemplo · falta el formulario de carga" },
    },
  ];
  return (
    <Panel titulo="De dónde sale cada número" nota="Verde = dato real · ámbar = ejemplo, con el motivo al pasar el mouse">
      <Tabla cabecera={["Fuente", "Alimenta", ...MARCAS.map((m) => m.nombre)]}>
        {filas.map((f) => (
          <tr key={f.fuente}>
            <td className="px-2 py-2 whitespace-nowrap">{f.fuente}</td>
            <td className="text-muted px-2 py-2 text-xs">{f.uso}</td>
            {f.porMarca
              ? MARCAS.map((m) => {
                  const e = f.porMarca![m.clave];
                  return (
                    <td key={m.clave} className="px-2 py-2" title={e.texto}>
                      <Chip color={e.ok ? VERDE : AMBAR}>
                        {e.ok ? e.texto : "Ejemplo"}
                      </Chip>
                    </td>
                  );
                })
              : (
                <td colSpan={MARCAS.length} className="px-2 py-2">
                  <Chip color={AMBAR}>{f.general!.texto}</Chip>
                </td>
              )}
          </tr>
        ))}
      </Tabla>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Deadlines e indicadores
// ---------------------------------------------------------------------------

function Deadlines({ marca }: { marca: ClaveMarca | null }) {
  const hitos = HITOS.filter((h) => marca === null || h.marca === marca || h.marca === "todas");
  const nombre = (k: ClaveMarca | "todas") =>
    k === "todas" ? "Todas" : (MARCAS.find((m) => m.clave === k)?.nombre ?? k);
  return (
    <Panel titulo="Deadlines y entregas" nota="Fecha comprometida vs fecha real · meta 100 % a tiempo">
      <Tabla cabecera={["Entrega", "Marca", "Vence", "Entregado", "Presupuesto", "Responsable", "Estado"]}>
        {hitos.map((h) => (
          <tr key={h.que}>
            <td className="px-2 py-2">{h.que}</td>
            <td className="text-muted px-2 py-2 text-xs whitespace-nowrap">{nombre(h.marca)}</td>
            <td className="px-2 py-2 tabular-nums">{h.vence}</td>
            <td className="px-2 py-2 tabular-nums">{h.entregado ?? "—"}</td>
            <td className="px-2 py-2 tabular-nums">
              {h.presupuesto ? fmtMonedaCorta(h.presupuesto) : "—"}
            </td>
            <td className="text-muted px-2 py-2 text-xs whitespace-nowrap">{h.responsable}</td>
            <td className="px-2 py-2">
              <Chip color={ESTADO_HITO[h.estado].color}>{ESTADO_HITO[h.estado].label}</Chip>
            </td>
          </tr>
        ))}
      </Tabla>
    </Panel>
  );
}

const NIVELES = { 1: "Marca", 2: "Demanda", 3: "Venta" } as const;

function Indicadores() {
  return (
    <Panel
      titulo="KPIs: de dónde sale cada uno"
      nota="Los marcados con + se suman a los del acuerdo de rol para poder medirla"
    >
      <Tabla cabecera={["Nivel", "Indicador", "Cómo se calcula", "Fuente", "¿Listo?"]}>
        {INDICADORES.map((i) => (
          <tr key={i.nombre}>
            <td className="text-muted px-2 py-2 text-xs whitespace-nowrap">
              {i.nivel} · {NIVELES[i.nivel]}
            </td>
            <td className="px-2 py-2">{i.nombre}</td>
            <td className="text-muted px-2 py-2 text-xs">{i.formula}</td>
            <td className="px-2 py-2 text-xs whitespace-nowrap">{i.fuente}</td>
            <td className="px-2 py-2">
              <Chip color={ESTADO_FUENTE[i.estado].color}>{ESTADO_FUENTE[i.estado].label}</Chip>
            </td>
          </tr>
        ))}
      </Tabla>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Página
// ---------------------------------------------------------------------------

export default function DashboardMarketing({ datos }: { datos: DatosTablero }) {
  const [vista, setVista] = useState<ClaveMarca | "todas">("todas");
  const { meta, instagram, venta: real } = datos;

  // LO REAL PISA AL EJEMPLO, campo por campo. Así el presupuesto, el
  // scorecard y el retorno usan el mismo número que cada sección y no pueden
  // contradecirse: si Meta dice $420 k, el gasto de la marca es $420 k.
  const marcas: Marca[] = MARCAS.map((m) => {
    const ig = instagram[m.clave];
    const tn = real.tiendaNube.porMarca[m.clave];
    const may = real.mayorista.porMarca[m.clave];
    const r: Marca = {
      ...m,
      gastoPorCanal: { ...m.gastoPorCanal, "Meta Ads": meta[m.clave].totales.gasto },
      diasPautaActiva: diasConPauta(meta[m.clave].diario),
      clicsPauta: meta[m.clave].totales.clics,
      conversionesPauta: meta[m.clave].totales.compras,
    };
    if (ig.fuente === "meta") {
      const d = ig.datos;
      r.seguidores = d.seguidores;
      r.seguidoresMesAnterior = d.seguidores - (d.seguidoresNuevos ?? 0);
      if (d.alcance != null) r.alcance30d = d.alcance;
      r.interacciones30d = d.interacciones;
      r.publicacionesPorSemana = d.publicacionesPorSemana;
    }
    if (tn) {
      r.ventaTiendas = tn.venta;
      r.pedidosTienda = tn.pedidos;
    }
    if (may) r.ventaMayorista = may.venta;
    if (tn || may) {
      // La forma de la curva sale de lo real; lo que falte se completa con
      // el ejemplo repartido parejo, y `ventaAcumulada` escala al total.
      r.ventaDiaria = Array.from({ length: CORTE.dia }, (_, i) =>
        (tn ? (tn.diaria[i] ?? 0) : m.ventaTiendas / CORTE.dia) +
        (may ? (may.diaria[i] ?? 0) : m.ventaMayorista / CORTE.dia),
      );
    }
    return r;
  });
  const marca = marcas.find((m) => m.clave === vista) ?? null;

  const opciones: { clave: ClaveMarca | "todas"; nombre: string; color: string }[] = [
    { clave: "todas", nombre: "Consolidado", color: TEMA.ink },
    ...marcas.map((m) => ({ clave: m.clave, nombre: m.nombre, color: m.color })),
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Tablero de Marca</h1>
          <p className="text-muted text-sm">
            Agatina · responsable de marca · {CORTE.mes}, datos al {CORTE.fecha} (día {CORTE.dia}{" "}
            de {CORTE.diasMes})
          </p>
        </div>
        <Chip color={AMBAR}>Ámbar = dato de ejemplo hasta conectar su fuente</Chip>
      </div>

      <nav className="border-line -mx-1 flex gap-1 overflow-x-auto border-b px-1">
        {opciones.map((o) => {
          const activa = vista === o.clave;
          return (
            <button
              key={o.clave}
              type="button"
              onClick={() => setVista(o.clave)}
              className={`flex items-center gap-2 border-b-2 px-3 py-2 text-sm whitespace-nowrap transition-colors ${
                activa ? "text-ink" : "text-muted hover:text-ink border-transparent"
              }`}
              style={activa ? { borderColor: o.color } : undefined}
            >
              {o.clave !== "todas" && (
                <span className="size-2 rounded-full" style={{ background: o.color }} />
              )}
              {o.nombre}
            </button>
          );
        })}
      </nav>

      <Fuentes.Provider value={datos}>
        {marca ? (
          <VistaMarca key={marca.clave} m={marca} meta={meta[marca.clave]} />
        ) : (
          <VistaConsolidada marcas={marcas} meta={meta} />
        )}
      </Fuentes.Provider>
    </div>
  );
}
