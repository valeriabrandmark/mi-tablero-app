"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Aviso } from "@/components/ui";
import { fmtMoneda, fmtNumero } from "@/lib/format";
import {
  LISTAS,
  MARCAS_CARGA,
  TABLAS,
  nombreMarcaCarga,
  validar,
  type Campo,
  type ClaveTabla,
  type Fila,
  type LineaCanje,
  type ProductoManual,
} from "@/lib/marketing-carga";

/**
 * MARKETING → CARGA.
 *
 * Todo lo que antes vivía en la planilla de Google Sheets se carga y se edita
 * acá, con formularios: campos obligatorios, listas cerradas y las mismas
 * reglas que valida la API (lib/marketing-carga.ts). Cada cambio queda en el
 * historial de la base.
 *
 * Los canjes vienen de SIGMA: cada comprobante de los clientes CANJE… se ata
 * a su colaboración desde el formulario de la colaboración o desde la
 * pestaña "Canjes SIGMA".
 */

type Datos = {
  influencers: Fila[];
  colaboraciones: Fila[];
  productos: Fila[];
  canjes: { comprobante: string; colaboracion_id: string }[];
  envios: Fila[];
  gastos: Fila[];
  presupuesto: Fila[];
  contenido: Fila[];
  lineasSigma: LineaCanje[];
};

type Pestana = ClaveTabla | "canjes";
const PESTANAS: { clave: Pestana; label: string }[] = [
  { clave: "colaboraciones", label: "Colaboraciones" },
  { clave: "canjes", label: "Canjes SIGMA" },
  { clave: "influencers", label: "Influencers" },
  { clave: "envios", label: "Envíos" },
  { clave: "gastos", label: "Otros gastos" },
  { clave: "presupuesto", label: "Presupuesto" },
  { clave: "contenido", label: "Contenido" },
];

const CAMPO =
  "border-line bg-panel-2 text-ink w-full rounded-lg border px-2.5 py-1.5 text-sm [color-scheme:dark] focus:border-c1 focus:outline-none";

function hoyAr() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date());
}
const fechaCorta = (iso: unknown) => (typeof iso === "string" && iso.length >= 10 ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(2, 4)}` : "—");

/** Agrupa las líneas de SIGMA por comprobante. */
function comprobantes(lineas: LineaCanje[]) {
  const m = new Map<string, { comprobante: string; fecha: string; marca: string; costo: number; items: LineaCanje[]; colaboracion_id: number | null }>();
  for (const l of lineas) {
    const c = m.get(l.comprobante) ?? { comprobante: l.comprobante, fecha: l.fecha, marca: l.marca, costo: 0, items: [], colaboracion_id: l.colaboracion_id };
    c.costo += l.costo;
    c.items.push(l);
    m.set(l.comprobante, c);
  }
  return [...m.values()];
}

// ---------------------------------------------------------------------------
// Campos
// ---------------------------------------------------------------------------

function CampoForm({
  c,
  valor,
  onChange,
  datos,
  error,
}: {
  c: Campo;
  valor: unknown;
  onChange: (v: unknown) => void;
  datos: Datos;
  error: boolean;
}) {
  const clase = `${CAMPO} ${error ? "border-rose-500 bg-rose-500/10" : ""}`;
  const v = valor === null || valor === undefined ? "" : String(valor);
  let control: ReactNode;
  switch (c.tipo) {
    case "largo":
      control = <textarea className={`${clase} min-h-16`} value={v} onChange={(e) => onChange(e.target.value)} />;
      break;
    case "numero":
    case "monto":
      control = <input className={clase} type="number" min={0} step={c.tipo === "monto" ? "any" : 1} value={v} onChange={(e) => onChange(e.target.value)} />;
      break;
    case "fecha":
      control = <input className={clase} type="date" value={v.slice(0, 10)} onChange={(e) => onChange(e.target.value)} />;
      break;
    case "mes":
      control = <input className={clase} type="month" value={v} onChange={(e) => onChange(e.target.value)} />;
      break;
    case "lista":
      control = (
        <select className={clase} value={v} onChange={(e) => onChange(e.target.value)}>
          <option value="">Elegir…</option>
          {(LISTAS[c.lista!] as readonly string[]).map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
      );
      break;
    case "marca":
      control = (
        <select className={clase} value={v} onChange={(e) => onChange(e.target.value)}>
          <option value="">Elegir…</option>
          {MARCAS_CARGA.map((m) => (
            <option key={m.clave} value={m.clave}>{m.nombre}</option>
          ))}
        </select>
      );
      break;
    case "marcas": {
      const sel = Array.isArray(valor) ? (valor as string[]) : [];
      control = (
        <div className="flex flex-wrap gap-1.5">
          {MARCAS_CARGA.map((m) => {
            const on = sel.includes(m.clave);
            return (
              <button key={m.clave} type="button" onClick={() => onChange(on ? sel.filter((x) => x !== m.clave) : [...sel, m.clave])}
                className={`rounded-lg border px-2 py-1 text-xs ${on ? "border-c1 bg-c1/15 text-c1" : "border-line text-muted hover:text-ink"}`}>
                {m.nombre}
              </button>
            );
          })}
        </div>
      );
      break;
    }
    case "influencer":
      control = (
        <select className={clase} value={v} onChange={(e) => onChange(e.target.value)}>
          <option value="">Elegir…</option>
          {datos.influencers.map((i) => (
            <option key={String(i.id)} value={String(i.id)}>{String(i.nombre)}{i.instagram ? ` · ${String(i.instagram)}` : ""}</option>
          ))}
        </select>
      );
      break;
    case "colaboracion":
      control = (
        <select className={clase} value={v} onChange={(e) => onChange(e.target.value)}>
          <option value="">— Ninguna —</option>
          {datos.colaboraciones.map((x) => (
            <option key={String(x.id)} value={String(x.id)}>
              {String(x.codigo)} · {nombreMarcaCarga(String(x.marca))} · {String(x.influencer)} · {fechaCorta(x.fecha)}
            </option>
          ))}
        </select>
      );
      break;
    default:
      control = <input className={clase} value={v} onChange={(e) => onChange(e.target.value)} />;
  }
  return (
    <label className={`flex flex-col gap-1 ${c.ancho ? "sm:col-span-2" : ""}`}>
      <span className="text-muted text-[11px]">
        {c.etiqueta}
        {c.requerido && <span className="text-rose-400"> *</span>}
      </span>
      {control}
      {c.ayuda && <span className="text-muted text-[11px]">{c.ayuda}</span>}
    </label>
  );
}

// ---------------------------------------------------------------------------
// Formulario genérico (+ canjes y productos para colaboraciones)
// ---------------------------------------------------------------------------

function Formulario({
  tabla,
  inicial,
  datos,
  onGuardado,
  onCerrar,
  onNuevoInfluencer,
}: {
  tabla: ClaveTabla;
  inicial: Fila;
  datos: Datos;
  onGuardado: (mensaje: string) => void;
  onCerrar: () => void;
  onNuevoInfluencer: () => void;
}) {
  const def = TABLAS[tabla];
  const [f, setF] = useState<Fila>(inicial);
  const id = inicial.id ? Number(inicial.id) : null;
  const [productos, setProductos] = useState<ProductoManual[]>(() =>
    id
      ? datos.productos
          .filter((p) => Number(p.colaboracion_id) === id)
          .map((p) => ({
            sku: (p.sku as string) ?? null, producto: String(p.producto), cantidad: Number(p.cantidad),
            costo_unitario: p.costo_unitario === null ? null : Number(p.costo_unitario),
            pvp_unitario: p.pvp_unitario === null ? null : Number(p.pvp_unitario), fecha_entrega: (p.fecha_entrega as string) ?? null,
          }))
      : [],
  );
  const [comps, setComps] = useState<string[]>(() => (id ? datos.canjes.filter((c) => Number(c.colaboracion_id) === id).map((c) => c.comprobante) : []));
  const [errores, setErrores] = useState<string[]>([]);
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [guardando, setGuardando] = useState(false);
  const [historial, setHistorial] = useState<{ accion: string; usuario: string | null; en: string; antes: Fila | null; despues: Fila | null }[] | null>(null);

  const set = (k: string, v: unknown) => {
    setF((x) => ({ ...x, [k]: v }));
    setMarcados((m) => {
      const n = new Set(m);
      n.delete(k);
      return n;
    });
  };
  const esColab = tabla === "colaboraciones";
  const conPago = f.modalidad === "Pago" || f.modalidad === "Pago + canje";
  const conCanje = f.modalidad === "Canje" || f.modalidad === "Pago + canje";

  // Comprobantes de SIGMA de la misma marca: los libres y los de esta colaboración.
  const disponibles = comprobantes(datos.lineasSigma).filter(
    (c) => c.marca === f.marca && (c.colaboracion_id === null || c.colaboracion_id === id),
  );
  const costoSigma = disponibles.filter((c) => comps.includes(c.comprobante)).reduce((s, c) => s + c.costo, 0);
  const costoManual = productos.reduce((s, p) => s + (Number(p.costo_unitario) || 0) * (Number(p.cantidad) || 0), 0);
  const costoEnvios = id ? datos.envios.filter((e) => Number(e.colaboracion_id) === id).reduce((s, e) => s + (Number(e.costo) || 0), 0) : 0;
  // Con comprobantes de SIGMA, el canje es SIGMA: los productos a mano quedan como referencia.
  const costoCanje = comps.length ? costoSigma : costoManual;
  const total = (conPago ? (Number(f.honorarios) || 0) + (Number(f.iva_honorarios) || 0) : 0) + (Number(f.otros_costos) || 0) + costoCanje + costoEnvios;

  const secciones = [...new Set(def.campos.map((c) => c.seccion ?? ""))];
  const visible = (c: Campo) => !esColab || conPago || !["honorarios", "iva_honorarios", "estado_pago", "fecha_pago", "medio_pago", "factura"].includes(c.clave);

  async function guardar() {
    const datosEnvio: Fila = { ...f };
    if (esColab && !conPago) {
      Object.assign(datosEnvio, { honorarios: null, iva_honorarios: null, estado_pago: "No aplica", fecha_pago: null, medio_pago: null });
    }
    const extra = esColab ? { productos: conCanje ? productos : [], comprobantes: conCanje ? comps : [] } : undefined;
    const errs = validar(tabla, datosEnvio, extra, !id);
    setErrores(errs);
    setMarcados(new Set(def.campos.filter((c) => c.requerido && (datosEnvio[c.clave] === null || datosEnvio[c.clave] === undefined || datosEnvio[c.clave] === "" || (Array.isArray(datosEnvio[c.clave]) && !(datosEnvio[c.clave] as unknown[]).length))).map((c) => c.clave)));
    if (errs.length) return;
    setGuardando(true);
    try {
      const r = await fetch("/api/marketing/carga", {
        method: id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tabla, id, datos: datosEnvio, extra }),
      });
      const j = (await r.json()) as { error?: string };
      if (!r.ok) throw new Error(j.error ?? `Error ${r.status}`);
      onGuardado(`${def.singular[0].toUpperCase()}${def.singular.slice(1)} ${id ? "actualizada/o" : "cargada/o"}`);
    } catch (e) {
      setErrores([e instanceof Error ? e.message : String(e)]);
    } finally {
      setGuardando(false);
    }
  }

  async function borrar() {
    if (!id || !confirm(`¿Borrar ${def.singular}? Queda guardado en el historial.`)) return;
    setGuardando(true);
    try {
      const r = await fetch(`/api/marketing/carga?tabla=${tabla}&id=${id}`, { method: "DELETE" });
      const j = (await r.json()) as { error?: string };
      if (!r.ok) throw new Error(j.error ?? `Error ${r.status}`);
      onGuardado("Borrado (queda en el historial)");
    } catch (e) {
      setErrores([e instanceof Error ? e.message : String(e)]);
    } finally {
      setGuardando(false);
    }
  }

  async function verHistorial() {
    const r = await fetch(`/api/marketing/carga?historial=${tabla}&id=${id}`);
    const j = (await r.json()) as { historial?: typeof historial };
    setHistorial(j.historial ?? []);
  }

  return (
    <div className="space-y-4">
      {secciones.map((s) => (
        <section key={s || "x"} className="space-y-2">
          {s && (!esColab || s !== "Pago" || conPago) && <h3 className="text-muted text-xs font-medium tracking-wide uppercase">{s}</h3>}
          <div className="grid gap-3 sm:grid-cols-2">
            {def.campos.filter((c) => (c.seccion ?? "") === s && visible(c)).map((c) => (
              <CampoForm key={c.clave} c={c} valor={f[c.clave]} onChange={(v) => set(c.clave, v)} datos={datos} error={marcados.has(c.clave)} />
            ))}
          </div>
          {esColab && s === "Acuerdo" && (
            <button type="button" onClick={onNuevoInfluencer} className="text-c1 text-xs hover:underline">
              + ¿No está el influencer? Cargarlo
            </button>
          )}
        </section>
      ))}

      {esColab && conCanje && (
        <section className="space-y-2">
          <h3 className="text-muted text-xs font-medium tracking-wide uppercase">Canje</h3>
          <p className="text-muted text-xs">
            Tildá los comprobantes de SIGMA (clientes CANJE…) que corresponden a esta colaboración. Si el canje no pasó por SIGMA,
            cargá los productos a mano abajo.
          </p>
          {!f.marca ? (
            <p className="text-muted text-sm">Elegí la marca para ver sus comprobantes.</p>
          ) : disponibles.length === 0 ? (
            <p className="text-muted text-sm">No hay comprobantes de canje libres de {nombreMarcaCarga(String(f.marca))} en SIGMA.</p>
          ) : (
            <div className="border-line max-h-56 overflow-y-auto rounded-lg border">
              {disponibles.map((c) => (
                <label key={c.comprobante} className="border-line flex cursor-pointer items-start gap-2 border-b p-2 text-xs last:border-b-0">
                  <input type="checkbox" className="mt-0.5" checked={comps.includes(c.comprobante)}
                    onChange={(e) => setComps((x) => (e.target.checked ? [...x, c.comprobante] : x.filter((y) => y !== c.comprobante)))} />
                  <span className="flex-1">
                    <span className="font-mono">{c.comprobante}</span> · {fechaCorta(c.fecha)} · <b>{fmtMoneda(c.costo)}</b>
                    <span className="text-muted block">{c.items.map((i) => `${i.cantidad}× ${i.producto}`).join(" · ")}</span>
                  </span>
                </label>
              ))}
            </div>
          )}
          <details className="text-xs" open={productos.length > 0}>
            <summary className="text-muted cursor-pointer">Productos cargados a mano ({productos.length}){comps.length > 0 && productos.length > 0 && " · no se suman: hay comprobantes de SIGMA"}</summary>
            <div className="mt-2 space-y-2">
              {productos.map((p, i) => (
                <div key={i} className="grid grid-cols-2 gap-2 sm:grid-cols-[90px_1fr_70px_110px_110px_auto]">
                  <input className={CAMPO} placeholder="SKU" value={p.sku ?? ""} onChange={(e) => setProductos((x) => x.map((y, j) => (j === i ? { ...y, sku: e.target.value } : y)))} />
                  <input className={CAMPO} placeholder="Producto *" value={p.producto} onChange={(e) => setProductos((x) => x.map((y, j) => (j === i ? { ...y, producto: e.target.value } : y)))} />
                  <input className={CAMPO} type="number" min={1} placeholder="Cant." value={p.cantidad} onChange={(e) => setProductos((x) => x.map((y, j) => (j === i ? { ...y, cantidad: Number(e.target.value) } : y)))} />
                  <input className={CAMPO} type="number" min={0} placeholder="Costo unit." value={p.costo_unitario ?? ""} onChange={(e) => setProductos((x) => x.map((y, j) => (j === i ? { ...y, costo_unitario: e.target.value === "" ? null : Number(e.target.value) } : y)))} />
                  <input className={CAMPO} type="number" min={0} placeholder="PVP unit." value={p.pvp_unitario ?? ""} onChange={(e) => setProductos((x) => x.map((y, j) => (j === i ? { ...y, pvp_unitario: e.target.value === "" ? null : Number(e.target.value) } : y)))} />
                  <button type="button" className="text-xs text-rose-400" onClick={() => setProductos((x) => x.filter((_, j) => j !== i))}>Quitar</button>
                </div>
              ))}
              <button type="button" className="border-line text-muted hover:text-ink rounded-lg border border-dashed px-3 py-1 text-xs"
                onClick={() => setProductos((x) => [...x, { sku: null, producto: "", cantidad: 1, costo_unitario: null, pvp_unitario: null, fecha_entrega: null }])}>
                + Producto a mano
              </button>
            </div>
          </details>
        </section>
      )}

      {esColab && (
        <div className="bg-panel-2 grid grid-cols-2 gap-2 rounded-lg p-3 text-xs sm:grid-cols-5">
          <div><span className="text-muted block">Honorarios + IVA</span>{fmtMoneda(conPago ? (Number(f.honorarios) || 0) + (Number(f.iva_honorarios) || 0) : 0)}</div>
          <div><span className="text-muted block">Canje {comps.length ? "(SIGMA)" : "(a mano)"}</span>{fmtMoneda(conCanje ? costoCanje : 0)}</div>
          <div><span className="text-muted block">Envíos</span>{fmtMoneda(costoEnvios)}</div>
          <div><span className="text-muted block">Otros</span>{fmtMoneda(Number(f.otros_costos) || 0)}</div>
          <div><span className="text-muted block">Costo total</span><b>{fmtMoneda(total)}</b></div>
          {!id && <p className="text-muted col-span-full">Los envíos se cargan en la pestaña Envíos, eligiendo esta colaboración.</p>}
        </div>
      )}

      {errores.length > 0 && <Aviso>{errores.join(" · ")}</Aviso>}

      {historial && (
        <div className="border-line max-h-60 overflow-y-auto rounded-lg border p-2 text-xs">
          {historial.length === 0 && <p className="text-muted">Sin cambios registrados.</p>}
          {historial.map((h, i) => (
            <div key={i} className="border-line border-b py-1.5 last:border-b-0">
              <b>{h.accion}</b> · {new Date(h.en).toLocaleString("es-AR")} · {h.usuario ?? "—"}
              {h.antes && h.despues && (
                <span className="text-muted block">
                  {Object.keys(h.despues)
                    .filter((k) => !["actualizado_en", "actualizado_por", "creado_en"].includes(k) && JSON.stringify(h.antes![k]) !== JSON.stringify(h.despues![k]) && k in h.antes!)
                    .map((k) => `${k}: ${JSON.stringify(h.antes![k])} → ${JSON.stringify(h.despues![k])}`)
                    .join(" · ") || "sin cambios de datos"}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-2">
          {id && (
            <>
              <button type="button" onClick={borrar} disabled={guardando} className="rounded-lg border border-rose-500/40 px-3 py-1.5 text-sm text-rose-300 hover:bg-rose-500/10">Borrar</button>
              <button type="button" onClick={verHistorial} className="border-line text-muted hover:text-ink rounded-lg border px-3 py-1.5 text-sm">Historial</button>
            </>
          )}
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={onCerrar} className="border-line text-muted hover:text-ink rounded-lg border px-3 py-1.5 text-sm">Cancelar</button>
          <button type="button" onClick={guardar} disabled={guardando} className="bg-c1 rounded-lg px-4 py-1.5 text-sm font-medium text-white disabled:opacity-40">
            {guardando ? "Guardando…" : id ? "Guardar cambios" : "Cargar"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Modal({ titulo, onCerrar, children }: { titulo: string; onCerrar: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-2 sm:p-6" onMouseDown={(e) => e.target === e.currentTarget && onCerrar()}>
      <div className="border-line bg-panel w-full max-w-3xl rounded-xl border p-4 shadow-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold">{titulo}</h2>
          <button type="button" onClick={onCerrar} className="text-muted hover:text-ink px-2 text-lg" aria-label="Cerrar">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Página
// ---------------------------------------------------------------------------

export default function CargaMarketing() {
  const [datos, setDatos] = useState<Datos | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [pestana, setPestana] = useState<Pestana>("colaboraciones");
  const [marca, setMarca] = useState("");
  const [buscar, setBuscar] = useState("");
  const [modales, setModales] = useState<{ tabla: ClaveTabla; fila: Fila }[]>([]);
  const [hoy] = useState(hoyAr);

  async function cargar() {
    try {
      const r = await fetch("/api/marketing/carga");
      const j = (await r.json()) as Datos & { error?: string };
      if (!r.ok) throw new Error(j.error ?? `Error ${r.status}`);
      setDatos(j);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void cargar();
  }, []);

  const resumenColab = useMemo(() => {
    if (!datos) return new Map<number, { canje: number; envio: number; total: number; sigma: number }>();
    const porComp = new Map<string, number>();
    for (const l of datos.lineasSigma) porComp.set(l.comprobante, (porComp.get(l.comprobante) ?? 0) + l.costo);
    const m = new Map<number, { canje: number; envio: number; total: number; sigma: number }>();
    for (const c of datos.colaboraciones) {
      const id = Number(c.id);
      const comps = datos.canjes.filter((x) => Number(x.colaboracion_id) === id);
      const sigma = comps.reduce((s, x) => s + (porComp.get(x.comprobante) ?? 0), 0);
      const manual = datos.productos.filter((p) => Number(p.colaboracion_id) === id).reduce((s, p) => s + (Number(p.costo_unitario) || 0) * (Number(p.cantidad) || 0), 0);
      const canje = comps.length ? sigma : manual;
      const envio = datos.envios.filter((e) => Number(e.colaboracion_id) === id).reduce((s, e) => s + (Number(e.costo) || 0), 0);
      const total = (Number(c.honorarios) || 0) + (Number(c.iva_honorarios) || 0) + (Number(c.otros_costos) || 0) + canje + envio;
      m.set(id, { canje, envio, total, sigma: comps.length });
    }
    return m;
  }, [datos]);

  if (error) return <Aviso>{error}</Aviso>;
  if (!datos) return <p className="text-muted text-sm">Cargando…</p>;

  const abrir = (tabla: ClaveTabla, fila: Fila) => setModales((m) => [...m, { tabla, fila }]);
  const nuevo = (tabla: ClaveTabla) => {
    const base: Fila = {};
    if (tabla === "colaboraciones") Object.assign(base, { fecha: hoy, estado: "Acordada", marca: marca || "" });
    if (tabla === "envios") Object.assign(base, { fecha: hoy, estado: "Enviado", marca: marca || "" });
    if (tabla === "gastos") Object.assign(base, { fecha: hoy, marca: marca || "" });
    if (tabla === "presupuesto") Object.assign(base, { mes: hoy.slice(0, 7), marca: marca || "" });
    if (tabla === "influencers") Object.assign(base, { red: "Instagram", estado_contacto: "Mensaje enviado", ultimo_contacto: hoy, marcas: marca ? [marca] : [] });
    abrir(tabla, base);
  };

  const texto = buscar.trim().toLowerCase();
  const filtrar = (filas: Fila[]) =>
    filas.filter(
      (f) =>
        (!marca || f.marca === marca || (Array.isArray(f.marcas) && (f.marcas as string[]).includes(marca))) &&
        (!texto || JSON.stringify(f).toLowerCase().includes(texto)),
    );

  const sinAsignar = comprobantes(datos.lineasSigma).filter((c) => c.colaboracion_id === null);

  function celda(f: Fila, c: Campo): ReactNode {
    const v = f[c.clave];
    if (v === null || v === undefined || v === "") return <span className="text-muted">—</span>;
    if (c.tipo === "monto") return fmtMoneda(Number(v));
    if (c.tipo === "numero") return fmtNumero(Number(v));
    if (c.tipo === "fecha") return fechaCorta(v);
    if (c.tipo === "marca") return nombreMarcaCarga(String(v));
    if (c.tipo === "marcas") return (v as string[]).map(nombreMarcaCarga).join(", ");
    if (c.tipo === "influencer") return String(f.influencer ?? v);
    if (c.tipo === "colaboracion") {
      const x = datos!.colaboraciones.find((y) => Number(y.id) === Number(v));
      return x ? `${String(x.codigo)} · ${String(x.influencer)}` : "—";
    }
    return String(v);
  }

  const tablaActual = pestana === "canjes" ? null : TABLAS[pestana];
  const filas = tablaActual ? filtrar(datos[pestana as ClaveTabla] as Fila[]) : [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Carga de marketing</h1>
          <p className="text-muted text-sm">
            Colaboraciones, influencers, canjes, envíos, gastos, presupuesto y contenido. Todo queda en la base, con historial de cambios.
          </p>
        </div>
        {tablaActual && (
          <button type="button" onClick={() => nuevo(tablaActual.clave)} className="bg-c1 rounded-lg px-3 py-1.5 text-sm font-medium text-white">
            + {tablaActual.singular[0].toUpperCase() + tablaActual.singular.slice(1)}
          </button>
        )}
      </div>

      {sinAsignar.length > 0 && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-100">
          Hay <b>{sinAsignar.length}</b> comprobante(s) de canje en SIGMA sin asignar a una colaboración ({fmtMoneda(sinAsignar.reduce((s, c) => s + c.costo, 0))}).
          Igual se cuentan como gasto de la marca; asignarlos dice a qué influencer fueron.{" "}
          <button type="button" className="underline" onClick={() => setPestana("canjes")}>Ver canjes</button>
        </div>
      )}
      {aviso && <Aviso tono="info">{aviso}</Aviso>}

      <nav className="border-line -mx-1 flex gap-1 overflow-x-auto border-b px-1">
        {PESTANAS.map((p) => (
          <button key={p.clave} type="button" onClick={() => setPestana(p.clave)}
            className={`border-b-2 px-3 py-2 text-sm whitespace-nowrap ${pestana === p.clave ? "border-c1 text-ink" : "text-muted hover:text-ink border-transparent"}`}>
            {p.label}
            <span className="text-muted ml-1.5 text-xs">
              {p.clave === "canjes" ? comprobantes(datos.lineasSigma).length : (datos[p.clave as ClaveTabla] as Fila[]).length}
            </span>
          </button>
        ))}
      </nav>

      <div className="flex flex-wrap gap-3">
        <select className={`${CAMPO.replace("w-full", "")} w-56`} value={marca} onChange={(e) => setMarca(e.target.value)}>
          <option value="">Todas las marcas</option>
          {MARCAS_CARGA.map((m) => <option key={m.clave} value={m.clave}>{m.nombre}</option>)}
        </select>
        <input className={`${CAMPO.replace("w-full", "")} w-64`} placeholder="Buscar…" value={buscar} onChange={(e) => setBuscar(e.target.value)} />
      </div>

      {tablaActual && (
        <div className="border-line bg-panel overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-muted border-line border-b text-left text-xs">
                {pestana === "colaboraciones" && <th className="px-2 py-2 font-medium">ID</th>}
                {pestana === "influencers" && <th className="px-2 py-2 font-medium">ID</th>}
                {tablaActual.campos.filter((c) => c.enListado).map((c) => (
                  <th key={c.clave} className="px-2 py-2 font-medium whitespace-nowrap">{c.etiqueta}</th>
                ))}
                {pestana === "colaboraciones" && (
                  <>
                    <th className="px-2 py-2 font-medium">Canje</th>
                    <th className="px-2 py-2 font-medium">Envío</th>
                    <th className="px-2 py-2 font-medium">Costo total</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody className="divide-line divide-y">
              {filas.map((f) => {
                const r = resumenColab.get(Number(f.id));
                return (
                  <tr key={String(f.id)} className="hover:bg-panel-2 cursor-pointer" onClick={() => abrir(tablaActual.clave, f)}>
                    {(pestana === "colaboraciones" || pestana === "influencers") && <td className="text-muted px-2 py-2 font-mono text-xs">{String(f.codigo)}</td>}
                    {tablaActual.campos.filter((c) => c.enListado).map((c) => (
                      <td key={c.clave} className="px-2 py-2 whitespace-nowrap">{celda(f, c)}</td>
                    ))}
                    {pestana === "colaboraciones" && r && (
                      <>
                        <td className="px-2 py-2 whitespace-nowrap">{r.canje ? fmtMoneda(r.canje) : "—"}{r.sigma > 0 && <span className="text-muted ml-1 text-[10px]">SIGMA</span>}</td>
                        <td className="px-2 py-2 whitespace-nowrap">{r.envio ? fmtMoneda(r.envio) : "—"}</td>
                        <td className="px-2 py-2 font-medium whitespace-nowrap">{fmtMoneda(r.total)}</td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filas.length === 0 && <p className="text-muted p-4 text-center text-sm">No hay nada cargado{marca ? ` para ${nombreMarcaCarga(marca)}` : ""}.</p>}
        </div>
      )}

      {pestana === "canjes" && (
        <div className="border-line bg-panel overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-muted border-line border-b text-left text-xs">
                {["Comprobante", "Fecha", "Marca", "Productos", "Costo", "Colaboración"].map((h) => <th key={h} className="px-2 py-2 font-medium">{h}</th>)}
              </tr>
            </thead>
            <tbody className="divide-line divide-y">
              {comprobantes(datos.lineasSigma)
                .filter((c) => (!marca || c.marca === marca) && (!texto || JSON.stringify(c).toLowerCase().includes(texto)))
                .map((c) => {
                  const colab = datos.colaboraciones.find((x) => Number(x.id) === c.colaboracion_id);
                  return (
                    <tr key={c.comprobante}>
                      <td className="px-2 py-2 font-mono text-xs">{c.comprobante}</td>
                      <td className="px-2 py-2">{fechaCorta(c.fecha)}</td>
                      <td className="px-2 py-2">{nombreMarcaCarga(c.marca)}</td>
                      <td className="text-muted px-2 py-2 text-xs">{c.items.map((i) => `${i.cantidad}× ${i.producto}`).join(" · ")}</td>
                      <td className="px-2 py-2 whitespace-nowrap">{fmtMoneda(c.costo)}</td>
                      <td className="px-2 py-2 whitespace-nowrap">
                        {colab ? (
                          <button type="button" className="text-c1 hover:underline" onClick={() => abrir("colaboraciones", colab)}>
                            {String(colab.codigo)} · {String(colab.influencer)}
                          </button>
                        ) : (
                          <span className="text-amber-300">Sin asignar · asignalo desde la colaboración</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
          <p className="text-muted p-3 text-xs">
            Las ventas de SIGMA a los clientes CANJE DIAPER GENIE, CANJES HOLA TOYS y CANJES UNIBRANCO son mercadería entregada en canje.
            Se cuentan como gasto de marketing (a costo) y no como venta. Para asignar un comprobante, abrí la colaboración y tildalo en la sección Canje.
          </p>
        </div>
      )}

      {modales.map((m, i) => (
        <Modal key={i} titulo={`${m.fila.id ? "Editar" : "Cargar"} ${TABLAS[m.tabla].singular}${m.fila.codigo ? ` ${String(m.fila.codigo)}` : ""}`}
          onCerrar={() => setModales((x) => x.slice(0, i))}>
          <Formulario
            tabla={m.tabla}
            inicial={m.fila}
            datos={datos}
            onCerrar={() => setModales((x) => x.slice(0, i))}
            onGuardado={async (msg) => {
              setModales((x) => x.slice(0, i));
              setAviso(msg);
              await cargar();
            }}
            onNuevoInfluencer={() => nuevo("influencers")}
          />
        </Modal>
      ))}
    </div>
  );
}
