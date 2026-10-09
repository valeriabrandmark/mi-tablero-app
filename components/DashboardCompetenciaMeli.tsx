"use client";

import { useEffect, useMemo, useState } from "react";
import { Tabla, type Columna } from "@/components/Tabla";
import { Aviso, Esqueleto, Panel, TarjetaKpi } from "@/components/ui";
import {
  GRUPOS,
  NOMBRES_BOOST,
  NOMBRES_LOGISTICA,
  NOMBRES_MOTIVO,
  TOLERANCIA_COSTO_FOXIE,
  type Boost,
  type ClaveGrupo,
  type Desglose,
  type FilaCompetencia,
  type Rival,
} from "@/lib/competencia-meli";
import { fmtMoneda, fmtNumero, fmtPct } from "@/lib/format";
import { TEMA } from "@/lib/paleta";
import type { DashboardCompetencia } from "@/lib/queries-competencia-meli";
import { useDatosTablero } from "@/lib/useDatosTablero";

/**
 * "Mercado Libre — Competencia".
 *
 * Contesta tres preguntas por cada publicación de catálogo:
 *
 *   1. ¿Cuánto hay que bajar para ganar la caja? (Mercado Libre, price_to_win)
 *   2. ¿Qué queda a ese precio? El desglose de costo, oferta, comisión, envío
 *      e impuestos, con los mismos costos que el resto del tablero.
 *   3. Si no conviene bajar, ¿en qué nos diferencia el que gana? Full, cuotas,
 *      reputación: lo que ML informa como boosts y motivos.
 *
 * Son ~1.600 filas y bajan todas: se filtran acá, sin ir al servidor.
 */

const TONOS: Record<string, string> = {
  critico: "border-negativo/40 bg-negativo/10 text-negativo",
  aviso: "border-c3/40 bg-c3/15 text-c3",
  neutro: "border-line bg-panel-2 text-muted",
  ok: "border-c1/40 bg-c1/10 text-c1",
};

const CLASE_INPUT =
  "border-line bg-panel-2 text-ink rounded-lg border px-2.5 py-1.5 text-xs focus:border-c1/50 focus:outline-none";

/** Cuántas filas se dibujan. El resto se alcanza buscando o filtrando. */
const MAX_FILAS = 300;

const grupoDe = (clave: ClaveGrupo) => GRUPOS.find((g) => g.clave === clave)!;

function colorMargen(m: number | null | undefined): string | undefined {
  if (m == null) return undefined;
  return m < 0 ? TEMA.negativo : undefined;
}

function linkMl(itemId: string): string {
  // MLA1234 -> MLA-1234: la ficha pública de la publicación.
  return `https://articulo.mercadolibre.com.ar/${itemId.replace(/^([A-Z]{3})/, "$1-")}`;
}

function nombreBoost(b: Boost): string {
  return NOMBRES_BOOST[b.id] ?? b.id;
}

function columnas(): Columna<FilaCompetencia>[] {
  return [
    { titulo: "SKU", celda: (f) => f.sku ?? "—", orden: (f) => f.sku },
    {
      titulo: "Producto",
      celda: (f) => (
        <span className="block max-w-[160px] truncate sm:max-w-[260px]" title={f.producto ?? undefined}>
          {f.producto ?? f.itemId}
        </span>
      ),
      orden: (f) => f.producto,
    },
    {
      titulo: "Situación",
      celda: (f) => (
        <span className={`rounded-full border px-2 py-0.5 text-[11px] whitespace-nowrap ${TONOS[grupoDe(f.grupo).tono]}`}>
          {grupoDe(f.grupo).titulo}
        </span>
      ),
      orden: (f) => GRUPOS.findIndex((g) => g.clave === f.grupo),
    },
    {
      titulo: "Precio actual",
      numerica: true,
      celda: (f) => fmtMoneda(f.precioActual),
      orden: (f) => f.precioActual,
    },
    {
      titulo: "Precio para ganar",
      ayuda:
        "El precio que gana la caja de compra según Mercado Libre (price_to_win). Es el mismo dato que usa Foxie para repreciar.",
      numerica: true,
      celda: (f) => (f.grupo === "ganando" ? "ganando" : fmtMoneda(f.precioParaGanar)),
      orden: (f) => f.precioParaGanar,
    },
    {
      titulo: "Bajar",
      ayuda: "Cuánto hay que bajar desde el precio actual para ganar la caja.",
      numerica: true,
      celda: (f) =>
        f.bajar == null ? "—" : (
          <span title={fmtPct(f.bajarPct)}>
            {fmtMoneda(f.bajar)} <span className="text-muted">({fmtPct(f.bajarPct)})</span>
          </span>
        ),
      orden: (f) => f.bajarPct,
    },
    {
      titulo: "Margen hoy",
      ayuda: "Rentabilidad neta sobre el precio con IVA, al precio actual.",
      numerica: true,
      celda: (f) => (
        <span style={{ color: colorMargen(f.actual?.margenPct) }}>{fmtPct(f.actual?.margenPct)}</span>
      ),
      orden: (f) => f.actual?.margenPct ?? null,
    },
    {
      titulo: "Margen al ganar",
      ayuda: "Rentabilidad neta sobre el precio con IVA, si bajamos al precio para ganar.",
      numerica: true,
      celda: (f) => (
        <span style={{ color: colorMargen(f.ganar?.margenPct) }}>{fmtPct(f.ganar?.margenPct)}</span>
      ),
      orden: (f) => f.ganar?.margenPct ?? null,
    },
    {
      titulo: "Piso sin pérdida",
      ayuda:
        "El precio con IVA en el que la rentabilidad neta da cero. Aproximado: supone la misma comisión y envío que al precio actual.",
      numerica: true,
      celda: (f) => fmtMoneda(f.equilibrio),
      orden: (f) => f.equilibrio,
    },
    {
      titulo: "Gana",
      celda: (f) =>
        f.grupo === "ganando" ? (
          <span className="text-c1">nosotros</span>
        ) : (
          <span className="block max-w-[140px] truncate" title={f.ganadorApodo ?? f.ganadorItemId ?? undefined}>
            {f.ganadorApodo ?? f.ganadorItemId ?? "—"}
          </span>
        ),
      orden: (f) => f.ganadorApodo,
    },
    {
      titulo: "Rivales",
      numerica: true,
      celda: (f) => fmtNumero(f.rivales),
      orden: (f) => f.rivales,
    },
    {
      titulo: "Costo Foxie",
      ayuda:
        "Diferencia entre el costo que Foxie tiene cargado y el nuestro. Si Foxie tiene otro costo, calcula el piso sobre un número equivocado.",
      numerica: true,
      celda: (f) =>
        f.difCostoFoxie == null ? "—" : (
          <span
            style={{
              color: Math.abs(f.difCostoFoxie) > TOLERANCIA_COSTO_FOXIE ? TEMA.negativo : undefined,
            }}
          >
            {f.difCostoFoxie > 0 ? "+" : ""}
            {fmtPct(f.difCostoFoxie)}
          </span>
        ),
      orden: (f) => (f.difCostoFoxie == null ? null : Math.abs(f.difCostoFoxie)),
    },
  ];
}

/** Una fila del desglose: concepto, y el valor al precio actual y al de ganar. */
function FilaDesglose({
  concepto,
  nota,
  actual,
  ganar,
  resaltar = false,
}: {
  concepto: string;
  nota?: string;
  actual: string;
  ganar: string;
  resaltar?: boolean;
}) {
  return (
    <tr className={`border-line border-t ${resaltar ? "font-semibold" : ""}`}>
      <td className="py-1.5 pr-3">
        {concepto}
        {nota && <span className="text-muted block text-[11px] font-normal">{nota}</span>}
      </td>
      <td className="py-1.5 pr-3 text-right tabular-nums">{actual}</td>
      <td className="py-1.5 text-right tabular-nums">{ganar}</td>
    </tr>
  );
}

function TablaDesglose({ f }: { f: FilaCompetencia }) {
  const a = f.actual;
  const g = f.ganar;
  const v = (d: Desglose | null, k: keyof Desglose, signo = 1) =>
    d ? fmtMoneda((d[k] as number) * signo) : "—";

  const ofertas: string[] = [];
  if (f.ofertaProvPct) ofertas.push(`oferta proveedor ${fmtNumero(f.ofertaProvPct)} %`);
  if (f.ofertaPropiaPct) ofertas.push(`oferta propia ${fmtNumero(f.ofertaPropiaPct)} %`);
  const notaCosto =
    f.costo == null
      ? "sin costo cargado"
      : `lista ${fmtMoneda(f.costoTeorico)}${ofertas.length ? ` · ${ofertas.join(" · ")}` : ""}`;

  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-muted text-left">
          <th className="pb-1 font-normal">Por unidad</th>
          <th className="pb-1 text-right font-normal">Precio actual</th>
          <th className="pb-1 text-right font-normal">
            {f.grupo === "ganando" ? "Ganando" : "Precio para ganar"}
          </th>
        </tr>
      </thead>
      <tbody>
        <FilaDesglose concepto="Precio con IVA" actual={v(a, "precio")} ganar={v(g, "precio")} resaltar />
        <FilaDesglose concepto={`IVA ${fmtNumero(f.ivaPct)} %`} actual={v(a, "iva", -1)} ganar={v(g, "iva", -1)} />
        <FilaDesglose concepto="Costo del producto" nota={notaCosto} actual={v(a, "costo", -1)} ganar={v(g, "costo", -1)} />
        <FilaDesglose
          concepto="Comisión Mercado Libre"
          nota={
            f.comisionPct != null
              ? `${fmtNumero(f.comisionPct)} %${f.comisionFija ? ` + ${fmtMoneda(f.comisionFija)} fijo` : ""}, sin IVA${
                  g?.comisionEstimada || a?.comisionEstimada ? " · estimada" : ""
                }`
              : undefined
          }
          actual={v(a, "comision", -1)}
          ganar={v(g, "comision", -1)}
        />
        <FilaDesglose
          concepto="Envío"
          nota={
            f.envioFuente === "ventas"
              ? "promedio por unidad de las ventas de los últimos 60 días"
              : f.envioFuente === "foxie"
                ? "el que calcula Foxie (sin ventas recientes)"
                : "sin dato: se toma 0"
          }
          actual={v(a, "envio", -1)}
          ganar={v(g, "envio", -1)}
        />
        <FilaDesglose concepto="Impuestos (IIBB, cheque, municipal)" actual={v(a, "impuestos", -1)} ganar={v(g, "impuestos", -1)} />
        <FilaDesglose concepto="Rentabilidad neta" actual={v(a, "neta")} ganar={v(g, "neta")} resaltar />
        <FilaDesglose
          concepto="Margen sobre precio"
          actual={fmtPct(a?.margenPct)}
          ganar={fmtPct(g?.margenPct)}
          resaltar
        />
      </tbody>
    </table>
  );
}

function ListaBoosts({ titulo, boosts }: { titulo: string; boosts: Boost[] }) {
  const tenemos = boosts.filter((b) => b.status === "boosted");
  const faltan = boosts.filter((b) => b.status === "opportunity");
  return (
    <div className="text-xs">
      <p className="text-muted mb-1">{titulo}</p>
      {tenemos.length === 0 && faltan.length === 0 && <p className="text-muted">—</p>}
      <div className="flex flex-wrap gap-1">
        {tenemos.map((b) => (
          <span key={b.id} className={`rounded-full border px-2 py-0.5 ${TONOS.ok}`}>
            {nombreBoost(b)}
          </span>
        ))}
        {faltan.map((b) => (
          <span key={b.id} className={`rounded-full border px-2 py-0.5 ${TONOS.aviso}`} title="Oportunidad: no lo tenemos y suma para ganar">
            falta: {nombreBoost(b)}
          </span>
        ))}
      </div>
    </div>
  );
}

function Rivales({ productId, ganadorItemId }: { productId: string; ganadorItemId: string | null }) {
  const [rivales, setRivales] = useState<Rival[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    fetch(`/api/competencia-meli?producto=${encodeURIComponent(productId)}`, { signal: ac.signal })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "Error");
        setRivales(j.rivales);
      })
      .catch((e) => {
        if (!ac.signal.aborted) setError(String(e.message ?? e));
      });
    return () => ac.abort();
  }, [productId]);

  if (error) return <Aviso>{error}</Aviso>;
  if (!rivales) return <Esqueleto className="h-24" />;
  if (rivales.length === 0) return <p className="text-muted text-xs">Sin competidores registrados.</p>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-muted text-left">
            <th className="pb-1 font-normal">Vendedor</th>
            <th className="pb-1 text-right font-normal">Precio</th>
            <th className="pb-1 font-normal">Envío</th>
            <th className="pb-1 font-normal">Reputación</th>
            <th className="pb-1 text-right font-normal">Ventas</th>
          </tr>
        </thead>
        <tbody>
          {rivales.map((r) => (
            <tr key={r.itemId} className={`border-line border-t ${r.propia ? "text-c1" : ""}`}>
              <td className="py-1 pr-3">
                <a href={linkMl(r.itemId)} target="_blank" rel="noreferrer" className="hover:underline">
                  {r.propia ? "Nosotros" : (r.apodo ?? r.sellerId ?? r.itemId)}
                </a>
                {r.itemId === ganadorItemId && <span className="text-c3 ml-1">★ gana</span>}
                {r.tiendaOficial && <span className="text-muted ml-1">(tienda oficial)</span>}
              </td>
              <td className="py-1 pr-3 text-right tabular-nums">
                {fmtMoneda(r.precio)}
                {r.precioOriginal && r.precioOriginal > (r.precio ?? 0) && (
                  <span className="text-muted ml-1 line-through">{fmtMoneda(r.precioOriginal)}</span>
                )}
              </td>
              <td className="py-1 pr-3">
                {NOMBRES_LOGISTICA[r.logistica ?? ""] ?? r.logistica ?? "—"}
                {r.envioGratis ? " · gratis" : ""}
              </td>
              <td className="py-1 pr-3">
                {r.reputacion ?? "—"}
                {r.medalla ? ` · ${r.medalla}` : ""}
              </td>
              <td className="py-1 text-right tabular-nums">{fmtNumero(r.ventasTotales)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Detalle({ f, hayFoxie }: { f: FilaCompetencia; hayFoxie: boolean }) {
  const g = grupoDe(f.grupo);
  return (
    <Panel titulo={`${f.sku ?? ""} ${f.producto ?? f.itemId}`} nota={f.itemId}>
      <div className={`mb-4 rounded-lg border p-3 text-xs ${TONOS[g.tono]}`}>
        <p className="font-semibold">{g.titulo}</p>
        <p className="mt-1 opacity-90">{g.detalle}</p>
        {f.grupo !== "ganando" && f.bajar != null && (
          <p className="mt-1">
            Hay que bajar {fmtMoneda(f.bajar)} ({fmtPct(f.bajarPct)}), de {fmtMoneda(f.precioActual)} a{" "}
            {fmtMoneda(f.precioParaGanar)}.
            {f.equilibrio != null && ` El piso sin pérdida es ${fmtMoneda(f.equilibrio)}.`}
          </p>
        )}
        {f.error && <p className="mt-1">Error de la consulta: {f.error}</p>}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <TablaDesglose f={f} />
          {hayFoxie && f.costoFoxie != null && (
            <p className="text-muted mt-2 text-[11px]">
              Costo en Foxie: {fmtMoneda(f.costoFoxie)} sin IVA
              {f.difCostoFoxie != null && Math.abs(f.difCostoFoxie) > TOLERANCIA_COSTO_FOXIE && (
                <span style={{ color: TEMA.negativo }}>
                  {" "}
                  — distinto del nuestro ({f.difCostoFoxie > 0 ? "+" : ""}
                  {fmtPct(f.difCostoFoxie)}): Foxie calcula su piso con otro costo.
                </span>
              )}
            </p>
          )}
        </div>
        <div className="space-y-4">
          <ListaBoosts titulo="Lo que suma nuestra publicación" boosts={f.boosts} />
          {f.grupo !== "ganando" && <ListaBoosts titulo="Lo que suma la que gana" boosts={f.ganadorBoosts} />}
          {f.motivos.length > 0 && (
            <div className="text-xs">
              <p className="text-muted mb-1">Motivos que informa Mercado Libre</p>
              <ul className="list-disc pl-4">
                {f.motivos.map((m) => (
                  <li key={m}>{NOMBRES_MOTIVO[m] ?? m}</li>
                ))}
              </ul>
            </div>
          )}
          {f.catalogProductId && (
            <div>
              <p className="text-muted mb-1 text-xs">Todos los vendedores del producto</p>
              <Rivales productId={f.catalogProductId} ganadorItemId={f.ganadorItemId} />
            </div>
          )}
        </div>
      </div>
    </Panel>
  );
}

export default function DashboardCompetenciaMeli() {
  const { data, cargando, error } = useDatosTablero<DashboardCompetencia>("/api/competencia-meli", {});
  const [grupo, setGrupo] = useState<ClaveGrupo | null>(null);
  const [texto, setTexto] = useState("");
  const [marca, setMarca] = useState("");
  const [elegida, setElegida] = useState<string | null>(null);

  const filas = useMemo(() => data?.filas ?? [], [data]);

  const conteo = useMemo(() => {
    const c = Object.fromEntries(GRUPOS.map((g) => [g.clave, 0])) as Record<ClaveGrupo, number>;
    for (const f of filas) c[f.grupo]++;
    return c;
  }, [filas]);

  const marcas = useMemo(
    () => [...new Set(filas.map((f) => f.marca).filter((m): m is string => !!m))].sort(),
    [filas],
  );

  const filtradas = useMemo(() => {
    const t = texto.trim().toLowerCase();
    // De lo más grave a lo que está bien, y dentro de cada grupo lo que más hay
    // que bajar primero: así las 300 que se dibujan son las que importan.
    const prioridad = (f: FilaCompetencia) => GRUPOS.findIndex((g) => g.clave === f.grupo);
    const orden = (a: FilaCompetencia, b: FilaCompetencia) =>
      prioridad(a) - prioridad(b) || (b.bajarPct ?? -1) - (a.bajarPct ?? -1);
    return filas.filter(
      (f) =>
        (!grupo || f.grupo === grupo) &&
        (!marca || f.marca === marca) &&
        (!t ||
          [f.sku, f.producto, f.itemId, f.ganadorApodo].some((x) => x?.toLowerCase().includes(t))),
    ).sort(orden);
  }, [filas, grupo, marca, texto]);

  const cols = useMemo(() => columnas(), []);
  const seleccion = filas.find((f) => f.itemId === elegida) ?? null;
  const foxieDistinto = filas.filter(
    (f) => f.difCostoFoxie != null && Math.abs(f.difCostoFoxie) > TOLERANCIA_COSTO_FOXIE,
  ).length;

  if (error) return <Aviso>{error}</Aviso>;
  if (cargando && !data) return <Esqueleto className="h-96" />;
  if (data?.sinDatos) {
    return (
      <Aviso tono="info">
        Todavía no hay datos de competencia. Los carga <code>ml_competencia.py</code> en el
        orquestador de tablero_quo, cada 4 horas; aparecen acá después de su primera corrida.
      </Aviso>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-muted text-xs">
        {fmtNumero(filas.length)} publicaciones de catálogo activas · precio para ganar de Mercado Libre
        {data?.actualizado && ` · actualizado ${new Date(data.actualizado).toLocaleString("es-AR")}`}
      </p>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <TarjetaKpi
          titulo="Ganando la caja"
          valor={fmtNumero(conteo.ganando)}
          detalle={filas.length ? fmtPct(conteo.ganando / filas.length) : undefined}
          acento={TEMA.ink}
        />
        <TarjetaKpi titulo="Se puede ganar bajando" valor={fmtNumero(conteo.puede_ganar)} />
        <TarjetaKpi titulo="Compartiendo 1er lugar" valor={fmtNumero(conteo.comparte)} />
        <TarjetaKpi
          titulo="No se puede competir"
          valor={fmtNumero(conteo.no_competible)}
          acento={conteo.no_competible ? TEMA.negativo : undefined}
          detalle="al precio para ganar se pierde plata"
        />
        {data?.hayFoxie ? (
          <TarjetaKpi
            titulo="Costo distinto en Foxie"
            valor={fmtNumero(foxieDistinto)}
            acento={foxieDistinto ? TEMA.negativo : undefined}
            detalle={`más de ${fmtPct(TOLERANCIA_COSTO_FOXIE)} de diferencia`}
          />
        ) : (
          <TarjetaKpi titulo="Costo en Foxie" valor="—" detalle="foxie.py todavía no corrió" />
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {GRUPOS.map((g) => {
          const activo = grupo === g.clave;
          return (
            <button
              key={g.clave}
              onClick={() => setGrupo(activo ? null : g.clave)}
              title={g.detalle}
              className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition ${TONOS[g.tono]} ${
                activo ? "ring-c1/60 ring-2" : "hover:opacity-80"
              }`}
            >
              <span className="font-semibold">{conteo[g.clave]}</span>
              <span>{g.titulo}</span>
            </button>
          );
        })}
      </div>
      {grupo && <p className="text-muted text-[11px]">{grupoDe(grupo).detalle}</p>}

      <div className="border-line bg-panel-2/40 flex flex-wrap items-center gap-2 rounded-xl border p-3">
        <input
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Buscar por SKU, producto, publicación o vendedor…"
          className={`${CLASE_INPUT} min-w-[220px] flex-1`}
        />
        <select value={marca} onChange={(e) => setMarca(e.target.value)} className={CLASE_INPUT}>
          <option value="">Todas las marcas</option>
          {marcas.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </div>

      {seleccion && <Detalle key={seleccion.itemId} f={seleccion} hayFoxie={!!data?.hayFoxie} />}

      <Panel
        titulo="Publicaciones de catálogo"
        nota={
          filtradas.length > MAX_FILAS
            ? `se muestran ${MAX_FILAS} de ${fmtNumero(filtradas.length)}: buscá o filtrá para ver el resto · click en una fila para el desglose`
            : `${fmtNumero(filtradas.length)} · click en una fila para el desglose`
        }
      >
        <Tabla
          filas={filtradas.slice(0, MAX_FILAS)}
          columnas={cols}
          clave={(f) => f.itemId}
          fijas={2}
          onClickFila={(f) => setElegida(elegida === f.itemId ? null : f.itemId)}
          activa={(f) => f.itemId === elegida}
        />
      </Panel>
    </div>
  );
}
