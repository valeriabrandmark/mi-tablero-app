"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Aviso, Esqueleto, Panel, TarjetaKpi } from "@/components/ui";
import {
  buscarArticulo,
  cruzar,
  indexarMaestro,
  leerNumero,
  renglonesDeOrdenEnviada,
  totalesComprobante,
  type ArticuloMaestro,
  type EstadoCruce,
  type LineaCruce,
  type RenglonFactura,
  type RenglonOC,
} from "@/lib/factura-cruce";
import { fmtMoneda, fmtNumero } from "@/lib/format";
import type { OrdenEnviada } from "@/lib/queries-ordenes";

/* -------------------------------------------------------------------------
   LO QUE SE GUARDA EN EL NAVEGADOR

   Una factura de 80 renglones a medio tipear no se puede perder porque se
   cerró la pestaña. Se guarda en este navegador y nada más: es un borrador de
   trabajo, no un registro. Si el navegador no deja guardar (ventana privada),
   la pantalla anda igual.
   ------------------------------------------------------------------------- */

const CLAVE_BORRADOR = "carga-factura:borrador:v2";

type Unidad = "U" | "B";

/** Un renglón de la factura tal como se tipea. Todo texto: se lee al cruzar. */
type LineaCarga = {
  id: string;
  /** SKU, EAN o código de compra del proveedor: cualquiera sirve. */
  codigo: string;
  cantidad: string;
  unidad: Unidad;
  /** Importe neto de la línea, sin IVA y con las bonificaciones del renglón. */
  importe: string;
};

type Cabecera = {
  letra: "A" | "B" | "C" | "M";
  numero: string;
  fecha: string;
};

type Borrador = {
  proveedor: string;
  ordenId: string;
  cabecera: Cabecera;
  lineas: LineaCarga[];
  descuentoPie: string;
  otrosImpuestos: string;
  totalImpreso: string;
};

let siguienteId = 0;
const lineaVacia = (codigo = "", unidad: Unidad = "U"): LineaCarga => ({
  id: `${Date.now().toString(36)}-${(siguienteId++).toString(36)}`,
  codigo,
  cantidad: "",
  unidad,
  importe: "",
});

const BORRADOR_VACIO: Borrador = {
  proveedor: "",
  ordenId: "",
  cabecera: { letra: "A", numero: "", fecha: "" },
  lineas: [],
  descuentoPie: "",
  otrosImpuestos: "",
  totalImpreso: "",
};

function leerBorrador(): Borrador {
  try {
    const crudo = window.localStorage.getItem(CLAVE_BORRADOR);
    if (crudo) return { ...BORRADOR_VACIO, ...JSON.parse(crudo) };
  } catch {
    /* sin almacenamiento: se arranca de cero */
  }
  return { ...BORRADOR_VACIO, lineas: [lineaVacia()] };
}

/* -------------------------------------------------------------------------
   ESTILOS
   ------------------------------------------------------------------------- */

const BOTON =
  "border-line hover:bg-panel-2 text-muted hover:text-ink rounded-lg border px-3 py-1.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40";
const BOTON_ACTIVO = "border-c1 bg-c1/15 text-c1 rounded-lg border px-3 py-1.5 text-xs";
const CAMPO =
  "border-line bg-panel-2 text-ink placeholder:text-muted/60 rounded-lg border px-2.5 py-1.5 text-sm focus:border-c1 focus:outline-none";

const COLOR_ESTADO: Record<EstadoCruce, string> = {
  ok: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  cantidad: "border-amber-500/40 bg-amber-500/10 text-amber-200",
  precio: "border-amber-500/40 bg-amber-500/10 text-amber-200",
  "cantidad y precio": "border-amber-500/40 bg-amber-500/10 text-amber-200",
  "falta en factura": "border-rose-500/30 bg-rose-500/10 text-rose-300",
  "no está en la OC": "border-c4/40 bg-c4/10 text-c4",
  "sin identificar": "border-rose-500/30 bg-rose-500/10 text-rose-300",
};

/** De qué se puede fiar menos: va primero en la tabla. */
const ORDEN_ESTADO: EstadoCruce[] = [
  "sin identificar",
  "no está en la OC",
  "falta en factura",
  "cantidad y precio",
  "cantidad",
  "precio",
  "ok",
];

/** Cómo se dice cada diferencia en el mail al proveedor. */
const MOTIVO_MAIL: Record<EstadoCruce, string> = {
  ok: "OK",
  cantidad: "Diferencia de cantidad",
  precio: "Diferencia de costo",
  "cantidad y precio": "Diferencia de cantidad y costo",
  "falta en factura": "Pedido y no facturado",
  "no está en la OC": "Facturado sin estar en la OC",
  "sin identificar": "Artículo no identificado",
};

/* -------------------------------------------------------------------------
   LAS CUENTAS DE CADA DIFERENCIA
   ------------------------------------------------------------------------- */

/**
 * Lo que cuesta una línea del cruce, separado en sus dos causas.
 *
 * POR PRECIO es lo que ya calcula el cruce: (costo facturado − costo de la OC)
 * × unidades facturadas. POR CANTIDAD son las unidades de más o de menos a
 * costo de la OC; lo que vino sin estar en la OC va entero acá. Sumadas dan
 * neto facturado − neto pedido de esa línea.
 */
function difPorCantidad(l: LineaCruce): number {
  if (l.oc) return Math.round(l.difUnidades * l.oc.precioNeto * 100) / 100;
  return l.factura?.neto ?? 0;
}

/* -------------------------------------------------------------------------
   LA PANTALLA
   ------------------------------------------------------------------------- */

/**
 * El borrador vive en el navegador, así que la pantalla se dibuja recién ahí:
 * en el servidor no hay localStorage, y arrancar vacía para después llenarse
 * haría parpadear todo lo cargado (y React se quejaría de la hidratación).
 */
const sinSuscripcion = () => () => {};
export default function CargaFactura() {
  const enCliente = useSyncExternalStore(
    sinSuscripcion,
    () => true,
    () => false,
  );
  if (!enCliente) return <Esqueleto className="h-96" />;
  return <Formulario />;
}

function Formulario() {
  const [b, setB] = useState<Borrador>(leerBorrador);
  const [ordenes, setOrdenes] = useState<OrdenEnviada[] | null>(null);
  const [errorOrdenes, setErrorOrdenes] = useState<string | null>(null);
  // El maestro y su error quedan atados a los SKU que los pidieron: cuando la
  // OC cambia, lo viejo deja de valer solo, sin tener que vaciarlo.
  const [maestroDe, setMaestroDe] = useState<{
    clave: string;
    articulos: ArticuloMaestro[];
    error: string | null;
  }>({ clave: "", articulos: [], error: null });
  const [soloDiferencias, setSoloDiferencias] = useState(true);
  const enfocar = useRef<string | null>(null);

  const cambiar = (parcial: Partial<Borrador>) => setB((x) => ({ ...x, ...parcial }));
  const cambiarLinea = (id: string, parcial: Partial<LineaCarga>) =>
    setB((x) => ({
      ...x,
      lineas: x.lineas.map((l) => (l.id === id ? { ...l, ...parcial } : l)),
    }));
  const agregarLinea = () => {
    const nueva = lineaVacia();
    enfocar.current = nueva.id;
    setB((x) => ({ ...x, lineas: [...x.lineas, nueva] }));
  };

  useEffect(() => {
    try {
      window.localStorage.setItem(CLAVE_BORRADOR, JSON.stringify(b));
    } catch {
      /* sin almacenamiento: no se guarda y listo */
    }
  }, [b]);

  // Después de agregar un renglón, el cursor va al código del nuevo.
  useEffect(() => {
    if (!enfocar.current) return;
    document.getElementById(`codigo-${enfocar.current}`)?.focus();
    enfocar.current = null;
  }, [b.lineas.length]);

  useEffect(() => {
    fetch("/api/compras/ordenes")
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? `Error ${r.status}`);
        setOrdenes(j.ordenes as OrdenEnviada[]);
      })
      .catch((e: Error) => setErrorOrdenes(e.message));
  }, []);

  /* --- El proveedor y la OC ---------------------------------------------- */

  const proveedores = useMemo(() => {
    const m = new Map<string, string>();
    for (const o of ordenes ?? []) {
      const clave = o.proveedorCodigo ?? o.proveedorNombre ?? "";
      if (clave && !m.has(clave)) m.set(clave, o.proveedorNombre ?? clave);
    }
    return [...m].sort((x, y) => x[1].localeCompare(y[1]));
  }, [ordenes]);

  const ordenesDelProveedor = useMemo(
    () =>
      (ordenes ?? []).filter(
        (o) => (o.proveedorCodigo ?? o.proveedorNombre ?? "") === b.proveedor,
      ),
    [ordenes, b.proveedor],
  );
  const orden = ordenesDelProveedor.find((o) => o.id === b.ordenId) ?? null;
  const renglonesOC: RenglonOC[] = useMemo(
    () => (orden ? renglonesDeOrdenEnviada(orden.payload) : []),
    [orden],
  );

  // El maestro del proveedor, cada vez que cambia el juego de SKU de la OC.
  const claveSkus = useMemo(
    () => [...new Set(renglonesOC.map((r) => r.sku))].sort().join("|"),
    [renglonesOC],
  );
  useEffect(() => {
    if (!claveSkus) return;
    let vigente = true;
    fetch("/api/compras/facturas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ skus: claveSkus.split("|") }),
    })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? `Error ${r.status}`);
        if (vigente) {
          setMaestroDe({ clave: claveSkus, articulos: j.articulos as ArticuloMaestro[], error: null });
        }
      })
      .catch(
        (e: Error) =>
          vigente && setMaestroDe({ clave: claveSkus, articulos: [], error: e.message }),
      );
    return () => {
      vigente = false;
    };
  }, [claveSkus]);
  const maestro = useMemo(
    () => (maestroDe.clave === claveSkus ? maestroDe.articulos : []),
    [maestroDe, claveSkus],
  );
  const errorMaestro = maestroDe.clave === claveSkus ? maestroDe.error : null;
  const cargandoMaestro = !!claveSkus && maestroDe.clave !== claveSkus;
  const indice = useMemo(() => indexarMaestro(maestro), [maestro]);
  const skusOC = useMemo(() => new Set(renglonesOC.map((r) => r.sku)), [renglonesOC]);

  /* --- La factura, renglón por renglón ----------------------------------- */

  /**
   * Cada renglón tipeado, ya resuelto: qué artículo es y cuántas UNIDADES son.
   *
   * La cantidad se pasa a unidades acá, con el bulto del maestro, y el renglón
   * va al cruce con `unidadFija`: la persona ya dijo si eran bultos o
   * unidades, así que el cruce no tiene que adivinarlo.
   */
  const leidas = useMemo(
    () =>
      b.lineas.map((l, i) => {
        const encontrado = buscarArticulo(indice, [l.codigo]);
        const a = encontrado && "a" in encontrado ? encontrado.a : null;
        const cant = leerNumero(l.cantidad);
        const importe = leerNumero(l.importe);
        const porBulto = l.unidad === "B" ? (a?.unidadesPorBulto ?? 1) : 1;
        const vacia = !l.codigo.trim() && cant == null && importe == null;
        const renglon: RenglonFactura | null = vacia
          ? null
          : {
              fila: i + 1,
              codigo: a?.sku ?? "",
              ean: "",
              // Sin artículo, la descripción es el error: así el cruce no la
              // empareja por parecido con nada de la OC y queda sin identificar.
              descripcion: a
                ? a.descripcion
                : encontrado && "error" in encontrado
                  ? encontrado.error
                  : "Sin código",
              cantidad: cant == null ? null : cant * porBulto,
              precio: null,
              descuento1: 0,
              descuento2: 0,
              importe,
              unidadFija: true,
            };
        return {
          l,
          a,
          error: encontrado && "error" in encontrado ? encontrado.error : null,
          unidades: cant == null ? null : cant * porBulto,
          sinBulto: l.unidad === "B" && !!a && a.unidadesPorBulto <= 1,
          renglon,
        };
      }),
    [b.lineas, indice],
  );
  const renglonesFactura = useMemo(
    () => leidas.flatMap((x) => (x.renglon ? [x.renglon] : [])),
    [leidas],
  );

  /** Carga un renglón por artículo de la OC, para completar cantidad e importe. */
  const traerArticulosDeLaOC = () => {
    const yaEstan = new Set(leidas.map((x) => x.a?.sku).filter(Boolean));
    const nuevas = renglonesOC
      .filter((r) => !yaEstan.has(r.sku))
      .map((r) => lineaVacia(r.sku));
    setB((x) => ({
      ...x,
      lineas: [...x.lineas.filter((l) => l.codigo || l.cantidad || l.importe), ...nuevas],
    }));
  };

  /* --- El cruce ---------------------------------------------------------- */

  const resultado = useMemo(
    () => cruzar(renglonesOC, renglonesFactura, maestro),
    [renglonesOC, renglonesFactura, maestro],
  );
  const totales = useMemo(
    () =>
      totalesComprobante(resultado, {
        descuentoPie: leerNumero(b.descuentoPie) ?? 0,
        otrosImpuestos: leerNumero(b.otrosImpuestos) ?? 0,
        totalImpreso: leerNumero(b.totalImpreso),
      }),
    [resultado, b.descuentoPie, b.otrosImpuestos, b.totalImpreso],
  );

  const ordenadas = useMemo(() => {
    const orden = (l: LineaCruce) => ORDEN_ESTADO.indexOf(l.estado);
    return [...resultado.lineas].sort((x, y) => orden(x) - orden(y));
  }, [resultado]);
  const diferencias = ordenadas.filter((l) => l.estado !== "ok");
  const lineasVisibles = soloDiferencias ? diferencias : ordenadas;

  const descripcionDe = useMemo(
    () => new Map(maestro.map((a) => [a.sku, a.descripcion])),
    [maestro],
  );

  const hayOC = renglonesOC.length > 0;
  const hayFactura = renglonesFactura.length > 0;
  const r = resultado.resumen;
  const difCantidadTotal = diferencias.reduce((s, l) => s + difPorCantidad(l), 0);

  const datosMail: DatosMail = {
    proveedor: orden?.proveedorNombre ?? orden?.proveedorCodigo ?? "",
    oc: orden ? `OC enviada el ${orden.enviadaEn}` : "",
    factura: [
      `Factura ${b.cabecera.letra}`,
      b.cabecera.numero,
      b.cabecera.fecha ? `del ${b.cabecera.fecha.split("-").reverse().join("/")}` : "",
    ]
      .filter(Boolean)
      .join(" "),
    lineas: diferencias,
    descripcionDe,
    totales,
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold tracking-tight">Carga de Facturas de compra</h1>
        <button
          className={BOTON}
          onClick={() => {
            if (window.confirm("¿Empezar una factura nueva? Se borra lo cargado.")) {
              setB({ ...BORRADOR_VACIO, proveedor: b.proveedor, lineas: [lineaVacia()] });
            }
          }}
        >
          Empezar otra
        </button>
      </div>

      {/* 1. LA OC ------------------------------------------------------- */}
      <Panel
        titulo="1. Orden de compra"
        nota={hayOC ? `${renglonesOC.length} artículos · ${fmtNumero(orden?.unidades)} unidades` : undefined}
      >
        {errorOrdenes ? (
          <Aviso>No se pudieron leer las órdenes: {errorOrdenes}</Aviso>
        ) : (
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
            <label className="text-muted space-y-1 text-xs">
              <span>Proveedor</span>
              <select
                className={`${CAMPO} w-full`}
                value={b.proveedor}
                onChange={(e) => cambiar({ proveedor: e.target.value, ordenId: "" })}
              >
                <option value="">{ordenes ? "Elegí el proveedor…" : "Cargando…"}</option>
                {proveedores.map(([clave, nombre]) => (
                  <option key={clave} value={clave}>
                    {nombre}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-muted space-y-1 text-xs">
              <span>Orden de compra</span>
              <select
                className={`${CAMPO} w-full`}
                value={b.ordenId}
                disabled={!b.proveedor}
                onChange={(e) => cambiar({ ordenId: e.target.value })}
              >
                <option value="">
                  {b.proveedor
                    ? `Elegí la OC (${ordenesDelProveedor.length})…`
                    : "Primero el proveedor"}
                </option>
                {ordenesDelProveedor.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.enviadaEn} · {o.renglones} artículos · {fmtNumero(o.unidades)} u. ·{" "}
                    {fmtMoneda(o.totalBruto)}
                    {o.usuario ? ` · ${o.usuario}` : ""}
                    {o.nota ? ` · ${o.nota}` : ""}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
        <p className="text-muted mt-2 text-xs">
          Son las órdenes mandadas a Sigma desde Compras. Ya están en unidades y a costo de
          lista, así que no hace falta cargarlas.
        </p>
        {errorMaestro && (
          <div className="mt-3">
            <Aviso>No se pudo leer el maestro de Sigma: {errorMaestro}</Aviso>
          </div>
        )}
      </Panel>

      {/* 2. LA FACTURA --------------------------------------------------- */}
      {hayOC && (
        <Panel
          titulo="2. Factura del proveedor"
          nota={hayFactura ? `${renglonesFactura.length} renglones` : undefined}
        >
          <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <label className="text-muted space-y-1 text-xs">
              <span>Letra</span>
              <select
                className={`${CAMPO} w-full`}
                value={b.cabecera.letra}
                onChange={(e) =>
                  cambiar({ cabecera: { ...b.cabecera, letra: e.target.value as Cabecera["letra"] } })
                }
              >
                {["A", "B", "C", "M"].map((l) => (
                  <option key={l}>{l}</option>
                ))}
              </select>
            </label>
            <label className="text-muted space-y-1 text-xs">
              <span>Número</span>
              <input
                className={`${CAMPO} w-full`}
                placeholder="00004-00000232"
                value={b.cabecera.numero}
                onChange={(e) => cambiar({ cabecera: { ...b.cabecera, numero: e.target.value } })}
              />
            </label>
            <label className="text-muted space-y-1 text-xs">
              <span>Fecha</span>
              <input
                type="date"
                className={`${CAMPO} w-full`}
                value={b.cabecera.fecha}
                onChange={(e) => cambiar({ cabecera: { ...b.cabecera, fecha: e.target.value } })}
              />
            </label>
          </div>

          <div className="mb-2 flex flex-wrap items-center gap-2">
            <button className={BOTON} onClick={traerArticulosDeLaOC} disabled={cargandoMaestro}>
              Traer los artículos de la OC
            </button>
            <span className="text-muted text-xs">
              En código va el SKU, el EAN o el código del proveedor. El importe es el total neto
              de la línea, sin IVA.
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-xs">
              <thead>
                <tr className="text-muted text-left">
                  <th className="w-8 pb-2 font-normal">#</th>
                  <th className="pr-2 pb-2 font-normal">Código</th>
                  <th className="pr-2 pb-2 font-normal">Descripción</th>
                  <th className="w-24 pr-2 pb-2 text-right font-normal">Cantidad</th>
                  <th className="w-28 pr-2 pb-2 font-normal">Unidad</th>
                  <th className="w-36 pr-2 pb-2 text-right font-normal">Importe línea</th>
                  <th className="w-24 pr-2 pb-2 text-right font-normal">Unidades</th>
                  <th className="w-6 pb-2" />
                </tr>
              </thead>
              <tbody>
                {leidas.map((x, i) => (
                  <tr key={x.l.id} className="border-line border-t align-top">
                    <td className="text-muted py-1.5 pr-2">{i + 1}</td>
                    <td className="py-1 pr-2">
                      <input
                        id={`codigo-${x.l.id}`}
                        list="articulos-factura"
                        className={`${CAMPO} w-40 py-1 font-mono text-xs`}
                        value={x.l.codigo}
                        onChange={(e) => {
                          const codigo = e.target.value;
                          // El EAN del bulto dice solo que viene en bultos.
                          const h = buscarArticulo(indice, [codigo]);
                          cambiarLinea(x.l.id, {
                            codigo,
                            ...(h && "a" in h && h.porBulto ? { unidad: "B" as Unidad } : {}),
                          });
                        }}
                      />
                    </td>
                    <td className="py-1.5 pr-2">
                      {x.a ? (
                        <>
                          <span className="block max-w-[320px] truncate" title={x.a.descripcion}>
                            {x.a.descripcion}
                          </span>
                          <span className="text-muted">
                            {x.a.sku}
                            {x.a.unidadesPorBulto > 1 ? ` · bulto x ${x.a.unidadesPorBulto}` : ""}
                            {skusOC.has(x.a.sku) ? "" : " · no está en la OC"}
                          </span>
                        </>
                      ) : x.error ? (
                        <span className="text-rose-300">{x.error}</span>
                      ) : cargandoMaestro && x.l.codigo ? (
                        <span className="text-muted">Buscando…</span>
                      ) : null}
                    </td>
                    <td className="py-1 pr-2">
                      <input
                        className={`${CAMPO} w-full py-1 text-right text-xs`}
                        inputMode="decimal"
                        value={x.l.cantidad}
                        onChange={(e) => cambiarLinea(x.l.id, { cantidad: e.target.value })}
                      />
                    </td>
                    <td className="py-1 pr-2">
                      <select
                        className={`${CAMPO} w-full py-1 text-xs`}
                        value={x.l.unidad}
                        onChange={(e) => cambiarLinea(x.l.id, { unidad: e.target.value as Unidad })}
                      >
                        <option value="U">Unidades</option>
                        <option value="B">Bultos</option>
                      </select>
                      {x.sinBulto && (
                        <span className="mt-1 block text-amber-200">
                          Sigma no tiene unidades por bulto: se cuenta 1
                        </span>
                      )}
                    </td>
                    <td className="py-1 pr-2">
                      <input
                        className={`${CAMPO} w-full py-1 text-right text-xs`}
                        inputMode="decimal"
                        placeholder="0,00"
                        value={x.l.importe}
                        onChange={(e) => cambiarLinea(x.l.id, { importe: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && i === leidas.length - 1) agregarLinea();
                        }}
                      />
                    </td>
                    <td className="text-muted py-1.5 pr-2 text-right tabular-nums">
                      {x.unidades == null ? "" : fmtNumero(x.unidades)}
                    </td>
                    <td className="py-1">
                      <button
                        className="text-muted hover:text-ink px-1"
                        title="Quitar el renglón"
                        onClick={() =>
                          setB((s) => ({ ...s, lineas: s.lineas.filter((l) => l.id !== x.l.id) }))
                        }
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <datalist id="articulos-factura">
              {[
                ...maestro.filter((a) => skusOC.has(a.sku)),
                ...maestro.filter((a) => !skusOC.has(a.sku)),
              ].map((a) => (
                <option key={a.sku} value={a.sku}>
                  {a.descripcion}
                  {skusOC.has(a.sku) ? " (en la OC)" : ""}
                </option>
              ))}
            </datalist>
          </div>
          <button className={`${BOTON} mt-2`} onClick={agregarLinea}>
            + Agregar renglón
          </button>
        </Panel>
      )}

      {/* 3. EL REPORTE DE DIFERENCIAS ------------------------------------ */}
      {hayOC && hayFactura && (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <TarjetaKpi titulo="Coinciden" valor={fmtNumero(r.ok)} acento="#22c55e" compacta />
            <TarjetaKpi
              titulo="Con diferencia"
              valor={fmtNumero(r.conDiferencia)}
              acento={r.conDiferencia ? "#f59e0b" : undefined}
              compacta
            />
            <TarjetaKpi
              titulo="Faltan en la factura"
              valor={fmtNumero(r.faltan)}
              acento={r.faltan ? "#f43f5e" : undefined}
              compacta
            />
            <TarjetaKpi
              titulo="No estaban en la OC"
              valor={fmtNumero(r.sobran)}
              acento={r.sobran ? "#a78bfa" : undefined}
              compacta
            />
            <TarjetaKpi
              titulo="Dif. por costo"
              valor={fmtMoneda(r.difPrecio)}
              detalle="lo facturado de más (o de menos) contra el costo de la OC"
              acento={Math.abs(r.difPrecio) > 1 ? "#f59e0b" : undefined}
              compacta
            />
            <TarjetaKpi
              titulo="Dif. por cantidad"
              valor={fmtMoneda(difCantidadTotal)}
              detalle="unidades de más o de menos, a costo de la OC"
              acento={Math.abs(difCantidadTotal) > 1 ? "#f59e0b" : undefined}
              compacta
            />
          </div>

          <Panel
            titulo="3. Reporte de diferencias"
            nota={`Neto OC ${fmtMoneda(r.netoOC)} · Neto factura ${fmtMoneda(r.netoFactura)}`}
          >
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <button
                className={soloDiferencias ? BOTON_ACTIVO : BOTON}
                onClick={() => setSoloDiferencias(true)}
              >
                Sólo diferencias ({diferencias.length})
              </button>
              <button
                className={!soloDiferencias ? BOTON_ACTIVO : BOTON}
                onClick={() => setSoloDiferencias(false)}
              >
                Todo ({resultado.lineas.length})
              </button>
              <button
                className={BOTON}
                onClick={() => descargarCsv(resultado.lineas, descripcionDe)}
              >
                Descargar cruce (CSV)
              </button>
            </div>

            {lineasVisibles.length === 0 ? (
              <Aviso tono="info">
                Todos los artículos coinciden con la OC en cantidad y costo.
              </Aviso>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[980px] text-xs">
                  <thead>
                    <tr className="border-line text-muted border-b text-left">
                      <th className="py-2 pr-2 font-normal">Estado</th>
                      <th className="py-2 pr-2 font-normal">Artículo</th>
                      <th className="py-2 pr-2 text-right font-normal">Unid. OC</th>
                      <th className="py-2 pr-2 text-right font-normal">Unid. factura</th>
                      <th className="py-2 pr-2 text-right font-normal">Dif. unid.</th>
                      <th className="py-2 pr-2 text-right font-normal">Costo unit. OC</th>
                      <th className="py-2 pr-2 text-right font-normal">Costo unit. factura</th>
                      <th className="py-2 pr-2 text-right font-normal">Dif. $ costo</th>
                      <th className="py-2 text-right font-normal">Dif. $ cantidad</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lineasVisibles.map((l, i) => (
                      <FilaCruce
                        key={`${l.sku ?? "x"}-${l.renglones[0]?.fila ?? i}`}
                        l={l}
                        descripcionDe={descripcionDe}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="text-muted mt-3 text-xs">
              Todo en unidades y a costo neto por unidad, con las bonificaciones del renglón. El
              costo se compara con media unidad de tolerancia (0,5 % o $0,50).
            </p>
          </Panel>

          {/* 4. LOS TOTALES ---------------------------------------------- */}
          <Panel titulo="4. Totales del comprobante">
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <label className="text-muted space-y-1 text-xs">
                  <span>Bonificación al pie %</span>
                  <input
                    className={`${CAMPO} w-full text-right`}
                    inputMode="decimal"
                    placeholder="0"
                    value={b.descuentoPie}
                    onChange={(e) => cambiar({ descuentoPie: e.target.value })}
                  />
                </label>
                <label className="text-muted space-y-1 text-xs">
                  <span>Percepciones y otros</span>
                  <input
                    className={`${CAMPO} w-full text-right`}
                    inputMode="decimal"
                    placeholder="0,00"
                    value={b.otrosImpuestos}
                    onChange={(e) => cambiar({ otrosImpuestos: e.target.value })}
                  />
                </label>
                <label className="text-muted space-y-1 text-xs">
                  <span>Total impreso</span>
                  <input
                    className={`${CAMPO} w-full text-right`}
                    inputMode="decimal"
                    placeholder="0,00"
                    value={b.totalImpreso}
                    onChange={(e) => cambiar({ totalImpreso: e.target.value })}
                  />
                </label>
              </div>

              <table className="w-full text-sm tabular-nums">
                <tbody>
                  <FilaTotal label="Neto de los renglones" valor={totales.neto} />
                  {totales.descuentoPie !== 0 && (
                    <FilaTotal label="Bonificación al pie" valor={-totales.descuentoPie} />
                  )}
                  <FilaTotal label="Neto gravado" valor={totales.netoGravado} />
                  {totales.iva.map((i) => (
                    <FilaTotal
                      key={i.alicuota}
                      label={`IVA ${String(i.alicuota).replace(".", ",")} %`}
                      valor={i.importe}
                    />
                  ))}
                  {totales.otrosImpuestos !== 0 && (
                    <FilaTotal label="Percepciones y otros" valor={totales.otrosImpuestos} />
                  )}
                  <FilaTotal label="Total calculado" valor={totales.total} fuerte />
                  {totales.diferencia != null && (
                    <tr>
                      <td className="pt-2" colSpan={2}>
                        <span
                          className={`inline-block rounded-full border px-3 py-1 text-xs font-medium ${
                            totales.cuadra
                              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                              : "border-rose-500/30 bg-rose-500/10 text-rose-300"
                          }`}
                        >
                          {totales.cuadra
                            ? "Cuadra con el total impreso"
                            : `No cuadra: el calculado da ${fmtMoneda(Math.abs(totales.diferencia))} ${
                                totales.diferencia > 0 ? "más" : "menos"
                              } que el impreso`}
                        </span>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <p className="text-muted mt-3 text-xs">
              El IVA sale de la alícuota de cada artículo en Sigma. Si el total no cuadra por
              centavos es redondeo; si no cuadra por más, casi siempre falta una percepción o un
              renglón.
            </p>
          </Panel>

          {/* 5. LA TABLA PARA EL MAIL ------------------------------------ */}
          <TablaParaMail datos={datosMail} />
        </>
      )}

      {!b.ordenId && <Aviso tono="info">Elegí el proveedor y la OC para empezar.</Aviso>}
      {hayOC && !hayFactura && (
        <Aviso tono="info">
          Ahora cargá los renglones de la factura, o tocá “Traer los artículos de la OC” y
          completá cantidades e importes.
        </Aviso>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------
   PIEZAS
   ------------------------------------------------------------------------- */

function FilaCruce({
  l,
  descripcionDe,
}: {
  l: LineaCruce;
  descripcionDe: Map<string, string>;
}) {
  const precio = (n: number | null | undefined) =>
    n == null ? "—" : fmtMoneda(Math.round(n * 100) / 100);
  const porCantidad = difPorCantidad(l);
  const filas = l.renglones.map((x) => x.fila).join(", ");

  return (
    <tr className="border-line border-b align-top">
      <td className="py-2 pr-2">
        <span className={`inline-block rounded-full border px-2 py-0.5 whitespace-nowrap ${COLOR_ESTADO[l.estado]}`}>
          {l.estado}
        </span>
      </td>
      <td className="py-2 pr-2">
        {l.sku ? (
          <>
            <span className="font-mono">{l.sku}</span>
            <span className="text-muted block max-w-[320px] truncate" title={descripcionDe.get(l.sku)}>
              {descripcionDe.get(l.sku) ?? l.descripcion}
            </span>
          </>
        ) : (
          <span className="text-rose-300">{l.descripcion}</span>
        )}
        {filas && <span className="text-muted block">renglón {filas} de la factura</span>}
      </td>
      <td className="py-2 pr-2 text-right tabular-nums">{l.oc ? fmtNumero(l.oc.unidades) : "—"}</td>
      <td className="py-2 pr-2 text-right tabular-nums">
        {l.factura ? fmtNumero(l.factura.unidades) : "—"}
      </td>
      <td
        className={`py-2 pr-2 text-right tabular-nums ${
          l.difUnidades < 0 ? "text-rose-300" : l.difUnidades > 0 ? "text-amber-200" : "text-muted"
        }`}
      >
        {l.difUnidades === 0 ? "—" : `${l.difUnidades > 0 ? "+" : ""}${fmtNumero(l.difUnidades)}`}
      </td>
      <td className="py-2 pr-2 text-right tabular-nums">{precio(l.oc?.precioNeto)}</td>
      <td
        className={`py-2 pr-2 text-right tabular-nums ${
          l.estado === "precio" || l.estado === "cantidad y precio" ? "text-amber-200" : ""
        }`}
      >
        {precio(l.factura?.precioNeto)}
      </td>
      <td className="py-2 pr-2 text-right tabular-nums">
        {l.difPrecio === 0 ? <span className="text-muted">—</span> : fmtMoneda(l.difPrecio)}
      </td>
      <td className="py-2 text-right tabular-nums">
        {porCantidad === 0 ? <span className="text-muted">—</span> : fmtMoneda(porCantidad)}
      </td>
    </tr>
  );
}

function FilaTotal({ label, valor, fuerte = false }: { label: string; valor: number; fuerte?: boolean }) {
  return (
    <tr className={fuerte ? "border-line border-t font-semibold" : ""}>
      <td className={`py-1 ${fuerte ? "" : "text-muted"}`}>{label}</td>
      <td className="py-1 text-right">{fmtMoneda(valor)}</td>
    </tr>
  );
}

/* -------------------------------------------------------------------------
   LA TABLA PARA EL MAIL

   Igual que "Para mail" en la planilla de sell in: una tabla con estilos en
   línea, lista para pegar en Gmail u Outlook. Se copia como HTML (y como texto
   con tabulaciones, por si se pega en un Excel), así que al pegarla en el
   correo mantiene bordes y colores. Los estilos van escritos en cada celda
   porque los correos ignoran las hojas de estilo.
   ------------------------------------------------------------------------- */

type DatosMail = {
  proveedor: string;
  oc: string;
  factura: string;
  lineas: LineaCruce[];
  descripcionDe: Map<string, string>;
  totales: ReturnType<typeof totalesComprobante>;
};

const n2 = (n: number) =>
  n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pesos = (n: number) => `${n < 0 ? "-" : ""}$ ${n2(Math.abs(n))}`;
const n0 = (n: number) => n.toLocaleString("es-AR", { maximumFractionDigits: 2 });
const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const ENCABEZADOS_MAIL = [
  "Motivo",
  "SKU",
  "Descripción",
  "Unid. OC",
  "Unid. facturadas",
  "Dif. unid.",
  "Costo unit. OC",
  "Costo unit. facturado",
  "Dif. $ costo",
  "Dif. $ cantidad",
];

function celdasMail(l: LineaCruce, descripcionDe: Map<string, string>): string[] {
  return [
    MOTIVO_MAIL[l.estado],
    l.sku ?? "",
    (l.sku && descripcionDe.get(l.sku)) || l.descripcion,
    l.oc ? n0(l.oc.unidades) : "—",
    l.factura ? n0(l.factura.unidades) : "—",
    l.difUnidades === 0 ? "—" : `${l.difUnidades > 0 ? "+" : ""}${n0(l.difUnidades)}`,
    l.oc ? pesos(l.oc.precioNeto) : "—",
    l.factura?.precioNeto != null ? pesos(l.factura.precioNeto) : "—",
    l.difPrecio === 0 ? "—" : pesos(l.difPrecio),
    difPorCantidad(l) === 0 ? "—" : pesos(difPorCantidad(l)),
  ];
}

function htmlMail(d: DatosMail): string {
  const th =
    "border:1px solid #cbd5e1;background:#1e293b;color:#ffffff;padding:6px 8px;font-size:12px;text-align:left;";
  const td = "border:1px solid #cbd5e1;padding:5px 8px;font-size:12px;";
  const num = `${td}text-align:right;white-space:nowrap;`;
  const fondo: Partial<Record<EstadoCruce, string>> = {
    "falta en factura": "#fee2e2",
    "sin identificar": "#fee2e2",
    "no está en la OC": "#ede9fe",
  };
  const totalCosto = d.lineas.reduce((s, l) => s + l.difPrecio, 0);
  const totalCantidad = d.lineas.reduce((s, l) => s + difPorCantidad(l), 0);
  const titulo = [d.proveedor, d.factura, d.oc].filter(Boolean).map(esc).join(" · ");

  const filas = d.lineas
    .map((l) => {
      const c = celdasMail(l, d.descripcionDe);
      const bg = fondo[l.estado] ?? "#fef3c7";
      return `<tr style="background:${bg};">${c
        .map((v, i) => `<td style="${i >= 3 ? num : td}">${esc(v)}</td>`)
        .join("")}</tr>`;
    })
    .join("");

  return `<div style="font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
<p style="font-size:13px;margin:0 0 8px;"><b>Diferencias factura vs. OC</b>${titulo ? ` — ${titulo}` : ""}</p>
<table style="border-collapse:collapse;">
<thead><tr>${ENCABEZADOS_MAIL.map((h) => `<th style="${th}">${esc(h)}</th>`).join("")}</tr></thead>
<tbody>${filas}
<tr style="background:#f1f5f9;font-weight:bold;"><td style="${td}" colspan="8">Total diferencias</td><td style="${num}">${pesos(totalCosto)}</td><td style="${num}">${pesos(totalCantidad)}</td></tr>
</tbody></table>
<p style="font-size:12px;margin:8px 0 0;">Total factura calculado: ${pesos(d.totales.total)}${
    d.totales.diferencia != null && !d.totales.cuadra
      ? ` · Total impreso: ${pesos(d.totales.total - d.totales.diferencia)}`
      : ""
  }</p>
</div>`;
}

function textoMail(d: DatosMail): string {
  return [
    ENCABEZADOS_MAIL.join("\t"),
    ...d.lineas.map((l) => celdasMail(l, d.descripcionDe).join("\t")),
  ].join("\n");
}

function TablaParaMail({ datos }: { datos: DatosMail }) {
  const [copiado, setCopiado] = useState<"ok" | "error" | null>(null);
  const html = useMemo(() => htmlMail(datos), [datos]);

  const copiar = async () => {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([textoMail(datos)], { type: "text/plain" }),
        }),
      ]);
      setCopiado("ok");
    } catch {
      setCopiado("error");
    }
  };

  if (datos.lineas.length === 0) {
    return (
      <Panel titulo="5. Tabla para el mail">
        <Aviso tono="info">No hay diferencias para mandarle al proveedor.</Aviso>
      </Panel>
    );
  }

  return (
    <Panel titulo="5. Tabla para el mail" nota={`${datos.lineas.length} diferencias`}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button className={BOTON_ACTIVO} onClick={() => void copiar()}>
          Copiar tabla para el mail
        </button>
        {copiado === "ok" && (
          <span className="text-xs text-emerald-300">Copiada: pegala en el correo con Ctrl+V.</span>
        )}
        {copiado === "error" && (
          <span className="text-xs text-rose-300">
            El navegador no dejó copiar: seleccioná la tabla de abajo y copiala a mano.
          </span>
        )}
      </div>
      {/* Vista previa tal cual va a quedar en el correo, sobre fondo blanco. */}
      <div
        className="overflow-x-auto rounded-lg bg-white p-3"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </Panel>
  );
}

/** El cruce entero en CSV, con punto y coma y coma decimal para que Excel lo abra bien. */
function descargarCsv(lineas: LineaCruce[], descripcionDe: Map<string, string>) {
  const num = (n: number | null | undefined) =>
    n == null ? "" : String(Math.round(n * 100) / 100).replace(".", ",");
  const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const filas = [
    [
      "Estado", "SKU", "Descripción", "Renglones factura", "Unid. OC", "Unid. factura",
      "Dif. unid.", "Costo unit. OC", "Costo unit. factura", "Dif. $ costo", "Dif. $ cantidad",
    ].join(";"),
    ...lineas.map((l) =>
      [
        q(l.estado),
        q(l.sku ?? ""),
        q((l.sku && descripcionDe.get(l.sku)) || l.descripcion),
        q(l.renglones.map((r) => r.fila).join(", ")),
        num(l.oc?.unidades),
        num(l.factura?.unidades),
        num(l.difUnidades),
        num(l.oc?.precioNeto),
        num(l.factura?.precioNeto),
        num(l.difPrecio),
        num(difPorCantidad(l)),
      ].join(";"),
    ),
  ];
  const blob = new Blob(["﻿" + filas.join("\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "cruce-factura-oc.csv";
  a.click();
  URL.revokeObjectURL(a.href);
}
