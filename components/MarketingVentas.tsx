"use client";

import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Panel } from "@/components/ui";
import { CajaTooltip, FilaTooltip } from "@/components/charts/TooltipOscuro";
import { fmtMoneda, fmtNumero } from "@/lib/format";
import { TEMA } from "@/lib/paleta";
import { MARCAS, type ClaveMarca } from "@/lib/marketing-demo";
import type { LineaVenta } from "@/lib/marketing-fuentes";

/**
 * VENTAS POR PROVINCIA y DETALLE DE VENTAS del Tablero de Marca.
 *
 * Las dos salen de las mismas líneas (lib/queries-marketing.ts →
 * leerDetalleVentas): todos los canales, no sólo Tienda Nube. Respetan el
 * filtro "Ventas de" del encabezado.
 */

export type OrigenVenta = "todas" | "mayorista" | "mercadolibre" | "tiendas";

const CANAL_DE_ORIGEN: Record<Exclude<OrigenVenta, "todas">, LineaVenta["canal"]> = {
  mayorista: "Mayorista",
  mercadolibre: "Mercado Libre",
  tiendas: "Tienda Nube",
};

const COLOR_CANAL: Record<LineaVenta["canal"], string> = {
  Mayorista: "#3b82f6",
  "Mercado Libre": "#facc15",
  "Tienda Nube": "#22d3ee",
};

const pct = new Intl.NumberFormat("es-AR", { style: "percent", maximumFractionDigits: 0 });
const dec1 = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 1 });
const nombreMarca = (c: ClaveMarca) => MARCAS.find((m) => m.clave === c)?.nombre ?? c;

export function filtrarLineas(lineas: LineaVenta[], marca: ClaveMarca | null, origen: OrigenVenta) {
  return lineas.filter(
    (l) => (marca === null || l.clave === marca) && (origen === "todas" || l.canal === CANAL_DE_ORIGEN[origen]),
  );
}

// ---------------------------------------------------------------------------
// Provincia
// ---------------------------------------------------------------------------

const CON_TILDE: Record<string, string> = {
  TUCUMAN: "Tucumán",
  CORDOBA: "Córdoba",
  "ENTRE RIOS": "Entre Ríos",
  NEUQUEN: "Neuquén",
  "RIO NEGRO": "Río Negro",
  "TIERRA DEL FUEGO": "Tierra del Fuego",
};

/**
 * Cada canal escribe la provincia a su manera ("TUCUMAN", "Tucumán",
 * "Capital Federal", "Gran Buenos Aires"...). Se lleva todo al mismo nombre:
 * Capital/CABA → "CABA"; Gran Buenos Aires y Provincia → "Buenos Aires".
 */
export function provinciaNormal(p: string | null): string | null {
  if (!p || !p.trim()) return null;
  const s = p.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toUpperCase().replace(/\s+/g, " ");
  if (/^(CAPITAL FEDERAL|CABA|C\.?A\.?B\.?A\.?|CIUDAD AUTONOMA DE BUENOS AIRES|CIUDAD DE BUENOS AIRES)$/.test(s)) return "CABA";
  if (/^(GRAN BUENOS AIRES|GBA|BUENOS AIRES|BS\.? ?AS\.?|PROVINCIA DE BUENOS AIRES|PCIA\.? DE BUENOS AIRES)$/.test(s)) return "Buenos Aires";
  if (CON_TILDE[s]) return CON_TILDE[s];
  if (s.startsWith("TIERRA DEL FUEGO")) return "Tierra del Fuego";
  return s.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase()).replace(/\b(De|Del|La|Y)\b/g, (w) => w.toLowerCase());
}

export function VentasPorProvincia({ lineas, titulo }: { lineas: LineaVenta[]; titulo?: string }) {
  const [ver, setVer] = useState<"venta" | "pedidos">("venta");
  const total = lineas.reduce((s, l) => s + l.venta, 0);
  const porProv = new Map<string, Record<LineaVenta["canal"], number> & { _orden: Set<string> }>();
  let sinDato = 0;
  for (const l of lineas) {
    const prov = provinciaNormal(l.provincia);
    if (!prov) {
      sinDato += l.venta;
      continue;
    }
    const x = porProv.get(prov) ?? { Mayorista: 0, "Mercado Libre": 0, "Tienda Nube": 0, _orden: new Set<string>() };
    if (ver === "venta") x[l.canal] += l.venta;
    else if (!x._orden.has(`${l.canal}-${l.orden}`)) {
      x._orden.add(`${l.canal}-${l.orden}`);
      x[l.canal] += 1;
    }
    porProv.set(prov, x);
  }
  const filas = [...porProv.entries()]
    .map(([provincia, v]) => ({ provincia, Mayorista: v.Mayorista, "Mercado Libre": v["Mercado Libre"], "Tienda Nube": v["Tienda Nube"] }))
    .map((f) => ({ ...f, total: f.Mayorista + f["Mercado Libre"] + f["Tienda Nube"] }))
    .sort((a, b) => b.total - a.total);
  const top = filas.slice(0, 12);
  const canales = (["Mayorista", "Mercado Libre", "Tienda Nube"] as const).filter((c) => filas.some((f) => f[c] > 0));
  const formato = ver === "venta" ? fmtMoneda : fmtNumero;

  return (
    <Panel titulo={titulo ?? "Ventas por provincia"} nota="Todos los canales · Mayorista por el cliente, Mercado Libre y Tienda Nube por el envío">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
        {(["venta", "pedidos"] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setVer(v)}
            className={`rounded-lg border px-2.5 py-1 ${ver === v ? "border-c1 bg-c1/15 text-c1" : "border-line text-muted hover:text-ink"}`}
          >
            {v === "venta" ? "Venta $" : "Pedidos"}
          </button>
        ))}
        {total > 0 && sinDato > 0 && (
          <span className="text-muted">
            {pct.format(sinDato / total)} de la venta sin provincia ({fmtMoneda(sinDato)}): clientes mayoristas sin ficha o envíos sin destino
          </span>
        )}
      </div>
      {top.length === 0 ? (
        <p className="text-muted text-sm">Sin ventas con provincia en el período.</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
          <div style={{ height: Math.max(160, top.length * 26 + 40) }}>
            <ResponsiveContainer>
              <BarChart data={top} layout="vertical" margin={{ left: 10 }}>
                <CartesianGrid stroke={TEMA.line} horizontal={false} />
                <XAxis
                  type="number"
                  stroke={TEMA.muted}
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  allowDecimals={false}
                  tickFormatter={(v: number) => (ver === "venta" ? (v >= 1e6 ? `$ ${dec1.format(v / 1e6)} M` : `$ ${Math.round(v / 1e3)} k`) : fmtNumero(v))}
                />
                <YAxis type="category" dataKey="provincia" stroke={TEMA.muted} fontSize={11} tickLine={false} axisLine={false} width={110} />
                <Tooltip
                  cursor={{ fill: "#ffffff08" }}
                  content={({ active, payload, label }) =>
                    active && payload?.length ? (
                      <CajaTooltip titulo={label}>
                        {payload.map((p) => (
                          <FilaTooltip key={String(p.name)} color={String(p.color)} label={String(p.name)} valor={formato(Number(p.value))} />
                        ))}
                      </CajaTooltip>
                    ) : null
                  }
                />
                <Legend wrapperStyle={{ fontSize: 11, color: TEMA.muted }} iconSize={8} />
                {canales.map((c) => (
                  <Bar key={c} dataKey={c} stackId="p" fill={COLOR_CANAL[c]} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-muted border-line border-b text-left">
                  <th className="px-2 py-1.5 font-medium">Provincia</th>
                  <th className="px-2 py-1.5 text-right font-medium">{ver === "venta" ? "Venta" : "Pedidos"}</th>
                  <th className="px-2 py-1.5 text-right font-medium">%</th>
                </tr>
              </thead>
              <tbody className="divide-line divide-y">
                {filas.slice(0, 15).map((f) => (
                  <tr key={f.provincia}>
                    <td className="px-2 py-1.5">{f.provincia}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{formato(f.total)}</td>
                    <td className="text-muted px-2 py-1.5 text-right tabular-nums">
                      {pct.format(f.total / filas.reduce((s, x) => s + x.total, 0))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Detalle de ventas
// ---------------------------------------------------------------------------

/** De dónde vino la venta, con lo que se sabe. De Meta no hay dato por pedido. */
export function pautaDe(l: LineaVenta, influencerPorCupon: Map<string, string>): string | null {
  if (l.cupon) {
    const inf = influencerPorCupon.get(l.cupon);
    return inf ? `Influencer: ${inf} (${l.cupon})` : `Cupón ${l.cupon}`;
  }
  if (l.conAds) return "Mercado Ads";
  if (l.utmFuente) {
    const f = l.utmFuente.toLowerCase();
    const fuente = /facebook|^fb|instagram|^ig$|meta/.test(f) ? "Meta" : /google/.test(f) ? "Google" : l.utmFuente;
    return l.utmCampana ? `${fuente} · ${l.utmCampana}` : fuente;
  }
  return null;
}

const POR_PAGINA = 50;
type Orden = "fecha" | "venta" | "margen";

const fechaCorta = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(2, 4)}`;

export function DetalleVentas({
  lineas,
  mostrarMarca,
  influencerPorCupon,
  motivo,
  recortado,
}: {
  lineas: LineaVenta[];
  mostrarMarca: boolean;
  influencerPorCupon: Map<string, string>;
  motivo?: string;
  recortado?: boolean;
}) {
  const [buscar, setBuscar] = useState("");
  const [conPauta, setConPauta] = useState<"todas" | "si" | "no">("todas");
  const [orden, setOrden] = useState<Orden>("fecha");
  const [pagina, setPagina] = useState(0);

  const texto = buscar.trim().toLowerCase();
  const filas = lineas
    .map((l) => ({ ...l, pauta: pautaDe(l, influencerPorCupon), prov: provinciaNormal(l.provincia) }))
    .filter(
      (l) =>
        (conPauta === "todas" || (conPauta === "si" ? !!l.pauta : !l.pauta)) &&
        (!texto ||
          [l.producto, l.sku, l.cliente, l.orden, l.prov, l.pauta, l.canal].some((x) => x && x.toLowerCase().includes(texto))),
    )
    .sort((a, b) =>
      orden === "venta" ? b.venta - a.venta : orden === "margen" ? (b.margen ?? -Infinity) - (a.margen ?? -Infinity) : a.fecha < b.fecha ? 1 : -1,
    );
  const totalVenta = filas.reduce((s, l) => s + l.venta, 0);
  const conMargen = filas.filter((l) => l.margen !== null && l.neto);
  const totalMargen = conMargen.reduce((s, l) => s + (l.margen ?? 0), 0);
  const totalNeto = conMargen.reduce((s, l) => s + (l.neto ?? 0), 0);
  const ventaConPauta = filas.filter((l) => l.pauta).reduce((s, l) => s + l.venta, 0);
  const paginas = Math.max(1, Math.ceil(filas.length / POR_PAGINA));
  const pag = Math.min(pagina, paginas - 1);
  const visibles = filas.slice(pag * POR_PAGINA, (pag + 1) * POR_PAGINA);

  function descargar() {
    const cab = ["Fecha", "Marca", "Canal", "Comprobante/orden", "Cliente", "Provincia", "SKU", "Producto", "Cantidad", "Venta", "Margen", "Margen %", "Pauta / campaña"];
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csv = [
      cab.join(";"),
      ...filas.map((l) =>
        [
          l.fecha, nombreMarca(l.clave), l.canal, l.orden, l.cliente, l.prov, l.sku, l.producto, l.cantidad,
          Math.round(l.venta), l.margen === null ? "" : Math.round(l.margen),
          l.margen !== null && l.neto ? Math.round((l.margen / l.neto) * 100) : "", l.pauta,
        ].map(esc).join(";"),
      ),
    ].join("\n");
    const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "ventas-marketing.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  const CAMPO = "border-line bg-panel-2 text-ink rounded-lg border px-2.5 py-1.5 text-xs focus:border-c1 focus:outline-none";
  return (
    <Panel titulo="Detalle de ventas" nota="Cada venta del período: canal, artículo, rentabilidad y la pauta que la trajo">
      {motivo && <p className="mb-2 text-xs text-amber-400">No se pudo leer el detalle: {motivo}</p>}
      <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Resumen titulo="Venta" valor={fmtMoneda(totalVenta)} detalle={`${fmtNumero(filas.length)} líneas`} />
        <Resumen
          titulo="Rentabilidad"
          valor={totalNeto ? pct.format(totalMargen / totalNeto) : "—"}
          detalle={`${fmtMoneda(totalMargen)} de margen${conMargen.length < filas.length ? ` · ${fmtNumero(filas.length - conMargen.length)} sin costo` : ""}`}
        />
        <Resumen
          titulo="Venta con pauta identificada"
          valor={totalVenta ? pct.format(ventaConPauta / totalVenta) : "—"}
          detalle={`${fmtMoneda(ventaConPauta)} · cupón, Mercado Ads o UTM`}
        />
        <Resumen
          titulo="Ticket promedio"
          valor={fmtMoneda(totalVenta / Math.max(1, new Set(filas.map((l) => `${l.canal}-${l.orden}`)).size))}
          detalle="Por pedido / comprobante"
        />
      </div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <input className={`${CAMPO} w-60`} placeholder="Buscar producto, SKU, cliente, provincia…" value={buscar} onChange={(e) => { setBuscar(e.target.value); setPagina(0); }} />
        <select className={CAMPO} value={conPauta} onChange={(e) => { setConPauta(e.target.value as typeof conPauta); setPagina(0); }}>
          <option value="todas">Con y sin pauta</option>
          <option value="si">Sólo con pauta</option>
          <option value="no">Sólo sin pauta</option>
        </select>
        <select className={CAMPO} value={orden} onChange={(e) => setOrden(e.target.value as Orden)}>
          <option value="fecha">Más recientes</option>
          <option value="venta">Mayor venta</option>
          <option value="margen">Mayor margen</option>
        </select>
        <button type="button" onClick={descargar} className="border-line text-muted hover:text-ink ml-auto rounded-lg border px-2.5 py-1.5 text-xs">
          Descargar CSV
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-muted border-line border-b text-left">
              {["Fecha", ...(mostrarMarca ? ["Marca"] : []), "Canal", "Producto", "Cant.", "Venta", "Margen", "Provincia", "Pauta / campaña", "Comprobante"].map((h) => (
                <th key={h} className="px-2 py-2 font-medium whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-line divide-y">
            {visibles.map((l, i) => (
              <tr key={`${l.canal}-${l.orden}-${l.sku}-${i}`}>
                <td className="px-2 py-1.5 whitespace-nowrap tabular-nums">{fechaCorta(l.fecha)}</td>
                {mostrarMarca && <td className="px-2 py-1.5 whitespace-nowrap">{nombreMarca(l.clave)}</td>}
                <td className="px-2 py-1.5 whitespace-nowrap">
                  <span className="mr-1.5 inline-block size-2 rounded-full" style={{ background: COLOR_CANAL[l.canal] }} />
                  {l.canal}
                </td>
                <td className="max-w-80 px-2 py-1.5">
                  <span className="line-clamp-2">{l.producto}</span>
                  {l.cliente && <span className="text-muted block">{l.cliente}</span>}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums">{fmtNumero(l.cantidad)}</td>
                <td className="px-2 py-1.5 text-right whitespace-nowrap tabular-nums">{fmtMoneda(l.venta)}</td>
                <td className="px-2 py-1.5 text-right whitespace-nowrap tabular-nums">
                  {l.margen === null ? (
                    <span className="text-muted">—</span>
                  ) : (
                    <span style={{ color: l.margen < 0 ? TEMA.negativo : undefined }}>
                      {fmtMoneda(l.margen)}
                      {l.neto ? <span className="text-muted ml-1">{pct.format(l.margen / l.neto)}</span> : null}
                    </span>
                  )}
                </td>
                <td className="px-2 py-1.5 whitespace-nowrap">{l.prov ?? <span className="text-muted">—</span>}</td>
                <td className="px-2 py-1.5">{l.pauta ?? <span className="text-muted">—</span>}</td>
                <td className="text-muted px-2 py-1.5 font-mono whitespace-nowrap">{l.orden ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {filas.length === 0 && <p className="text-muted p-4 text-center text-sm">Sin ventas para mostrar.</p>}
      </div>
      <div className="text-muted mt-2 flex flex-wrap items-center justify-between gap-2 text-xs">
        <span>
          Mercado Ads = la publicación tenía anuncio con gasto ese día. De Meta no hay dato por pedido: se mide en su sección.
          {recortado && " · Se muestran las 5.000 líneas más recientes: acortá el período para ver todo."}
        </span>
        {paginas > 1 && (
          <span className="flex items-center gap-2">
            <button type="button" disabled={pag === 0} onClick={() => setPagina(pag - 1)} className="border-line rounded border px-2 py-0.5 disabled:opacity-40">‹</button>
            {pag + 1} / {paginas}
            <button type="button" disabled={pag >= paginas - 1} onClick={() => setPagina(pag + 1)} className="border-line rounded border px-2 py-0.5 disabled:opacity-40">›</button>
          </span>
        )}
      </div>
    </Panel>
  );
}

function Resumen({ titulo, valor, detalle }: { titulo: string; valor: string; detalle: string }) {
  return (
    <div className="bg-panel-2 rounded-lg p-3">
      <p className="text-muted text-[11px]">{titulo}</p>
      <p className="mt-1 text-base font-semibold tabular-nums">{valor}</p>
      <p className="text-muted mt-0.5 text-[11px]">{detalle}</p>
    </div>
  );
}
