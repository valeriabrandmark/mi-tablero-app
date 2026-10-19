"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Aviso, Esqueleto, Panel, TarjetaKpi } from "@/components/ui";
import {
  adivinarColumnas,
  cruzar,
  leerNumero,
  leerRenglones,
  leerTablaPegada,
  renglonesDeOCPegada,
  renglonesDeOrdenEnviada,
  ROLES_COLUMNA,
  totalesComprobante,
  type ArticuloMaestro,
  type EstadoCruce,
  type LineaCruce,
  type RenglonOC,
  type RolColumna,
  type TablaPegada,
} from "@/lib/factura-cruce";
import { fmtMoneda, fmtNumero } from "@/lib/format";
import type { OrdenEnviada } from "@/lib/queries-ordenes";

/* -------------------------------------------------------------------------
   LO QUE SE GUARDA EN EL NAVEGADOR

   Una factura de 200 renglones a medio revisar no se puede perder porque se
   cerró la pestaña. Se guarda en este navegador y nada más: es un borrador de
   trabajo, no un registro. Si el navegador no deja guardar (ventana privada),
   la pantalla anda igual.
   ------------------------------------------------------------------------- */

const CLAVE_BORRADOR = "carga-factura:borrador:v1";

type Cabecera = {
  tipo: "FACTURA" | "NOTA DE CREDITO";
  letra: "A" | "B" | "C" | "M";
  numero: string;
  fecha: string;
};

type Borrador = {
  fuente: "tablero" | "pegada";
  ordenId: string;
  textoOC: string;
  rolesOC: RolColumna[] | null;
  textoFactura: string;
  rolesFactura: RolColumna[] | null;
  manuales: Record<number, string>;
  cabecera: Cabecera;
  descuentoPie: string;
  otrosImpuestos: string;
  totalImpreso: string;
};

const BORRADOR_VACIO: Borrador = {
  fuente: "tablero",
  ordenId: "",
  textoOC: "",
  rolesOC: null,
  textoFactura: "",
  rolesFactura: null,
  manuales: {},
  cabecera: { tipo: "FACTURA", letra: "A", numero: "", fecha: "" },
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
  return BORRADOR_VACIO;
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

const COMO_TEXTO: Record<string, string> = {
  codigo: "por SKU",
  "codigo proveedor": "por código del proveedor",
  ean: "por EAN",
  "ean display": "por EAN del display",
  "ean bulto": "por EAN del bulto",
  descripcion: "por descripción: revisar",
  manual: "asignado a mano",
};

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

  const cambiar = (parcial: Partial<Borrador>) => setB((x) => ({ ...x, ...parcial }));

  useEffect(() => {
    try {
      window.localStorage.setItem(CLAVE_BORRADOR, JSON.stringify(b));
    } catch {
      /* sin almacenamiento: no se guarda y listo */
    }
  }, [b]);

  useEffect(() => {
    fetch("/api/compras/ordenes")
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? `Error ${r.status}`);
        setOrdenes(j.ordenes as OrdenEnviada[]);
      })
      .catch((e: Error) => setErrorOrdenes(e.message));
  }, []);

  /* --- La OC ------------------------------------------------------------ */

  const tablaOC = useMemo(() => leerTablaPegada(b.textoOC), [b.textoOC]);
  const rolesOC = useMemo(
    () => rolesVigentes(b.rolesOC, tablaOC),
    [b.rolesOC, tablaOC],
  );

  const ordenElegida = ordenes?.find((o) => o.id === b.ordenId) ?? null;
  const renglonesOC: RenglonOC[] = useMemo(() => {
    if (b.fuente === "tablero") {
      return ordenElegida ? renglonesDeOrdenEnviada(ordenElegida.payload) : [];
    }
    return renglonesDeOCPegada(tablaOC, rolesOC);
  }, [b.fuente, ordenElegida, tablaOC, rolesOC]);

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

  /* --- La factura -------------------------------------------------------- */

  const tablaFactura = useMemo(() => leerTablaPegada(b.textoFactura), [b.textoFactura]);
  const rolesFactura = useMemo(
    () => rolesVigentes(b.rolesFactura, tablaFactura),
    [b.rolesFactura, tablaFactura],
  );
  const renglonesFactura = useMemo(
    () => leerRenglones(tablaFactura, rolesFactura),
    [tablaFactura, rolesFactura],
  );

  /* --- El cruce ---------------------------------------------------------- */

  const resultado = useMemo(
    () => cruzar(renglonesOC, renglonesFactura, maestro, b.manuales),
    [renglonesOC, renglonesFactura, maestro, b.manuales],
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

  const lineas = useMemo(() => {
    const orden = (l: LineaCruce) => ORDEN_ESTADO.indexOf(l.estado);
    return [...resultado.lineas]
      .filter((l) => !soloDiferencias || l.estado !== "ok")
      .sort((x, y) => orden(x) - orden(y));
  }, [resultado, soloDiferencias]);

  const hayOC = renglonesOC.length > 0;
  const hayFactura = renglonesFactura.length > 0;
  const r = resultado.resumen;

  const descripcionDe = useMemo(
    () => new Map(maestro.map((a) => [a.sku, a.descripcion])),
    [maestro],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold tracking-tight">Cargar factura de compra</h1>
        <button
          className={BOTON}
          onClick={() => {
            if (window.confirm("¿Empezar una factura nueva? Se borra lo cargado.")) {
              setB({ ...BORRADOR_VACIO, fuente: b.fuente });
            }
          }}
        >
          Empezar otra
        </button>
      </div>

      {/* 1. LA OC ------------------------------------------------------- */}
      <Panel titulo="1. Orden de compra" nota={hayOC ? `${renglonesOC.length} renglones` : undefined}>
        <div className="mb-3 flex flex-wrap gap-2">
          <button
            className={b.fuente === "tablero" ? BOTON_ACTIVO : BOTON}
            onClick={() => cambiar({ fuente: "tablero", manuales: {} })}
          >
            Una OC mandada desde el tablero
          </button>
          <button
            className={b.fuente === "pegada" ? BOTON_ACTIVO : BOTON}
            onClick={() => cambiar({ fuente: "pegada", manuales: {} })}
          >
            Pegar una OC de Sigma
          </button>
        </div>

        {b.fuente === "tablero" ? (
          errorOrdenes ? (
            <Aviso>No se pudieron leer las órdenes: {errorOrdenes}</Aviso>
          ) : (
            <select
              className={`${CAMPO} w-full max-w-2xl`}
              value={b.ordenId}
              onChange={(e) => cambiar({ ordenId: e.target.value, manuales: {} })}
            >
              <option value="">
                {ordenes ? "Elegí la OC…" : "Cargando órdenes…"}
              </option>
              {ordenes?.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.enviadaEn} · {o.proveedorNombre ?? o.proveedorCodigo} · {o.renglones} renglones ·{" "}
                  {fmtMoneda(o.totalBruto)}
                  {o.resultado !== "ok" ? " · (resultado incierto)" : ""}
                </option>
              ))}
            </select>
          )
        ) : (
          <div className="space-y-3">
            <p className="text-muted text-xs">
              Copiá los renglones de la OC desde Sigma o desde un Excel (código, cantidad en
              unidades, precio unitario de lista y bonificaciones) y pegalos acá.
            </p>
            <textarea
              className={`${CAMPO} h-28 w-full font-mono text-xs`}
              placeholder={"IM06003\t12\t38824,48\t0\nIM07003\t36\t31272,60\t5"}
              value={b.textoOC}
              onChange={(e) => cambiar({ textoOC: e.target.value, rolesOC: null, manuales: {} })}
            />
            {tablaOC.filas.length > 0 && (
              <VistaPrevia
                tabla={tablaOC}
                roles={rolesOC}
                onRoles={(roles) => cambiar({ rolesOC: roles })}
              />
            )}
          </div>
        )}
        {errorMaestro && (
          <div className="mt-3">
            <Aviso>No se pudo leer el maestro de Sigma: {errorMaestro}</Aviso>
          </div>
        )}
      </Panel>

      {/* 2. LA FACTURA --------------------------------------------------- */}
      <Panel
        titulo="2. Factura del proveedor"
        nota={hayFactura ? `${renglonesFactura.length} renglones leídos` : undefined}
      >
        <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <label className="text-muted space-y-1 text-xs">
            <span>Tipo</span>
            <select
              className={`${CAMPO} w-full`}
              value={b.cabecera.tipo}
              onChange={(e) =>
                cambiar({ cabecera: { ...b.cabecera, tipo: e.target.value as Cabecera["tipo"] } })
              }
            >
              <option value="FACTURA">Factura</option>
              <option value="NOTA DE CREDITO">Nota de crédito</option>
            </select>
          </label>
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

        <p className="text-muted mb-2 text-xs">
          Copiá la tabla de renglones de la factura (desde el Excel, el PDF o el mail del
          proveedor) y pegala acá con Ctrl+V. No hace falta ordenarla ni limpiarla: el
          subtotal y las filas sin cantidad se descartan solas.
        </p>
        <textarea
          className={`${CAMPO} h-36 w-full font-mono text-xs`}
          placeholder={"Código\tDescripción\tCant.\tP. Unit.\tBonif %\tImporte\nP04.033.26\tVASO HURON 473ML ROSA\t8\t10.500,00\t10\t75.600,00"}
          value={b.textoFactura}
          onChange={(e) =>
            cambiar({ textoFactura: e.target.value, rolesFactura: null, manuales: {} })
          }
        />
        {tablaFactura.filas.length > 0 && (
          <div className="mt-3">
            <VistaPrevia
              tabla={tablaFactura}
              roles={rolesFactura}
              onRoles={(roles) => cambiar({ rolesFactura: roles })}
            />
          </div>
        )}
      </Panel>

      {/* 3. EL CRUCE ----------------------------------------------------- */}
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
              titulo="Sin identificar"
              valor={fmtNumero(r.sinIdentificar)}
              acento={r.sinIdentificar ? "#f43f5e" : undefined}
              compacta
            />
            <TarjetaKpi
              titulo="Diferencia por precio"
              valor={fmtMoneda(r.difPrecio)}
              detalle="lo facturado de más (o de menos) contra el precio de la OC"
              acento={Math.abs(r.difPrecio) > 1 ? "#f59e0b" : undefined}
              compacta
            />
          </div>

          <Panel
            titulo="3. Cruce renglón por renglón"
            nota={`Neto OC ${fmtMoneda(r.netoOC)} · Neto factura ${fmtMoneda(r.netoFactura)}`}
          >
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <button
                className={soloDiferencias ? BOTON_ACTIVO : BOTON}
                onClick={() => setSoloDiferencias(true)}
              >
                Sólo lo que hay que mirar
              </button>
              <button
                className={!soloDiferencias ? BOTON_ACTIVO : BOTON}
                onClick={() => setSoloDiferencias(false)}
              >
                Todo ({resultado.lineas.length})
              </button>
              <button className={BOTON} onClick={() => descargarCsv(resultado.lineas)}>
                Descargar cruce (CSV)
              </button>
            </div>

            {lineas.length === 0 ? (
              <Aviso tono="info">
                Todos los renglones coinciden con la OC en cantidad y precio.
              </Aviso>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[960px] text-xs">
                  <thead>
                    <tr className="border-line text-muted border-b text-left">
                      <th className="py-2 pr-2 font-normal">Estado</th>
                      <th className="py-2 pr-2 font-normal">Artículo (Sigma)</th>
                      <th className="py-2 pr-2 font-normal">Cómo vino en la factura</th>
                      <th className="py-2 pr-2 text-right font-normal">Cant. OC</th>
                      <th className="py-2 pr-2 text-right font-normal">Cant. factura</th>
                      <th className="py-2 pr-2 text-right font-normal">Dif.</th>
                      <th className="py-2 pr-2 text-right font-normal">P. neto OC</th>
                      <th className="py-2 pr-2 text-right font-normal">P. neto factura</th>
                      <th className="py-2 text-right font-normal">Dif. $</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lineas.map((l, i) => (
                      <FilaCruce
                        key={`${l.sku ?? "x"}-${l.renglones[0]?.fila ?? i}`}
                        l={l}
                        maestro={maestro}
                        renglonesOC={renglonesOC}
                        descripcionDe={descripcionDe}
                        onAsignar={(fila, sku) => {
                          const manuales = { ...b.manuales };
                          if (sku) manuales[fila] = sku;
                          else delete manuales[fila];
                          cambiar({ manuales });
                        }}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
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
              renglón sin identificar.
            </p>
          </Panel>

          {/* 5. SIGMA ----------------------------------------------------- */}
          <Panel titulo="5. Cargar en Sigma">
            <Aviso tono="alerta">
              Todavía no se puede mandar sola: falta el endpoint de la API de Sigma para importar
              comprobantes de compra. Apenas esté, este botón arma el comprobante con los renglones
              de arriba (en unidades, con el precio y las bonificaciones de la factura) y lo carga
              vinculado a la OC.
            </Aviso>
            <button className={`${BOTON} mt-3`} disabled>
              Cargar comprobante en Sigma
            </button>
          </Panel>
        </>
      )}

      {!hayOC && (
        <Aviso tono="info">Elegí o pegá la OC para empezar.</Aviso>
      )}
      {hayOC && !hayFactura && (
        <Aviso tono="info">Ahora pegá los renglones de la factura.</Aviso>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------
   PIEZAS
   ------------------------------------------------------------------------- */

/**
 * Los roles que se están usando: los que eligió la persona si siguen
 * sirviendo para esta tabla, si no los adivinados. "Siguen sirviendo" quiere
 * decir que la tabla tiene la misma cantidad de columnas.
 */
function rolesVigentes(elegidos: RolColumna[] | null, tabla: TablaPegada): RolColumna[] {
  const ancho = tabla.filas[0]?.length ?? 0;
  if (elegidos && elegidos.length === ancho) return elegidos;
  return adivinarColumnas(tabla);
}

/**
 * Las primeras filas de lo pegado, con un desplegable arriba de cada columna.
 *
 * MUESTRA LOS NÚMEROS YA LEÍDOS, no el texto pegado. Es la única forma de ver
 * a tiempo que "1.234" se leyó como mil doscientos y no como uno coma dos.
 */
function VistaPrevia({
  tabla,
  roles,
  onRoles,
}: {
  tabla: TablaPegada;
  roles: RolColumna[];
  onRoles: (roles: RolColumna[]) => void;
}) {
  const numericos: RolColumna[] = ["cantidad", "precio", "descuento1", "descuento2", "importe"];
  return (
    <div className="overflow-x-auto">
      <p className="text-muted mb-2 text-xs">
        Revisá qué es cada columna (lo adiviné{tabla.encabezados ? " por los títulos" : " por el contenido"}
        ). Si alguna está mal, cambiala en el desplegable.
      </p>
      <table className="w-full text-xs">
        <thead>
          <tr>
            {roles.map((rol, i) => (
              <th key={i} className="pr-2 pb-2 text-left font-normal">
                <select
                  className={`${CAMPO} w-full min-w-[110px] py-1 text-xs ${rol === "ignorar" ? "opacity-60" : ""}`}
                  value={rol}
                  onChange={(e) => {
                    const nuevo = e.target.value as RolColumna;
                    // Un rol en una sola columna: si ya estaba en otra, esa pasa a "no usar".
                    onRoles(
                      roles.map((r, j) =>
                        j === i ? nuevo : r === nuevo && nuevo !== "ignorar" ? "ignorar" : r,
                      ),
                    );
                  }}
                >
                  {ROLES_COLUMNA.map((o) => (
                    <option key={o.clave} value={o.clave}>
                      {o.label}
                    </option>
                  ))}
                </select>
                {tabla.encabezados && (
                  <span className="text-muted mt-1 block truncate">{tabla.encabezados[i]}</span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {tabla.filas.slice(0, 5).map((f, i) => (
            <tr key={i} className="border-line border-t">
              {f.map((c, j) => {
                const n = numericos.includes(roles[j]) ? leerNumero(c) : null;
                return (
                  <td
                    key={j}
                    className={`py-1 pr-2 ${roles[j] === "ignorar" ? "text-muted/50" : ""} ${
                      numericos.includes(roles[j]) ? "text-right tabular-nums" : ""
                    }`}
                  >
                    {numericos.includes(roles[j])
                      ? n == null
                        ? <span className="text-rose-300">{c || "—"}</span>
                        : n.toLocaleString("es-AR", { maximumFractionDigits: 4 })
                      : c}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {tabla.filas.length > 5 && (
        <p className="text-muted mt-1 text-xs">… y {tabla.filas.length - 5} filas más.</p>
      )}
    </div>
  );
}

function FilaCruce({
  l,
  maestro,
  renglonesOC,
  descripcionDe,
  onAsignar,
}: {
  l: LineaCruce;
  maestro: ArticuloMaestro[];
  renglonesOC: RenglonOC[];
  descripcionDe: Map<string, string>;
  onAsignar: (fila: number, sku: string | null) => void;
}) {
  const precio = (n: number | null | undefined) =>
    n == null ? "—" : fmtMoneda(Math.round(n * 100) / 100);
  const dudosa = ["sin identificar", "no está en la OC"].includes(l.estado) || l.como === "descripcion";
  const r0 = l.renglones[0];

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
            <span className="text-muted block max-w-[280px] truncate" title={descripcionDe.get(l.sku)}>
              {descripcionDe.get(l.sku) ?? l.descripcion}
            </span>
          </>
        ) : (
          <span className="text-muted">—</span>
        )}
      </td>
      <td className="py-2 pr-2">
        {l.renglones.length === 0 ? (
          <span className="text-muted">no vino</span>
        ) : (
          <>
            {l.renglones.map((x) => (
              <span key={x.fila} className="block max-w-[300px] truncate" title={x.descripcion}>
                <span className="text-muted">fila {x.fila} · </span>
                {[x.codigo, x.ean].filter(Boolean).join(" / ")} {x.descripcion}
              </span>
            ))}
            {l.como && (
              <span className={`block ${l.como === "descripcion" ? "text-amber-200" : "text-muted"}`}>
                {COMO_TEXTO[l.como]}
                {l.factor > 1 ? ` · en bultos de ${l.factor}` : ""}
              </span>
            )}
            {dudosa && r0 && (
              <AsignarSku
                fila={r0.fila}
                actual={l.como === "manual" ? l.sku : null}
                maestro={maestro}
                renglonesOC={renglonesOC}
                onAsignar={onAsignar}
              />
            )}
          </>
        )}
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
      <td className="py-2 text-right tabular-nums">
        {l.difPrecio === 0 ? <span className="text-muted">—</span> : fmtMoneda(l.difPrecio)}
      </td>
    </tr>
  );
}

/**
 * Asignar a mano un renglón que el cruce no pudo (o no debería) decidir solo.
 *
 * PRIMERO LOS DE LA OC, porque es casi seguro que el renglón es uno de esos;
 * el resto del maestro del proveedor queda disponible escribiendo.
 */
function AsignarSku({
  fila,
  actual,
  maestro,
  renglonesOC,
  onAsignar,
}: {
  fila: number;
  actual: string | null;
  maestro: ArticuloMaestro[];
  renglonesOC: RenglonOC[];
  onAsignar: (fila: number, sku: string | null) => void;
}) {
  const [texto, setTexto] = useState(actual ?? "");
  const id = `asignar-${fila}`;
  const enOC = new Set(renglonesOC.map((r) => r.sku));
  const opciones = [
    ...maestro.filter((a) => enOC.has(a.sku)),
    ...maestro.filter((a) => !enOC.has(a.sku)),
  ];
  const porSku = new Set(maestro.map((a) => a.sku));

  return (
    <span className="mt-1 flex items-center gap-1">
      <input
        list={id}
        className={`${CAMPO} w-44 py-1 text-xs`}
        placeholder="Asignar SKU…"
        value={texto}
        onChange={(e) => {
          const v = e.target.value;
          setTexto(v);
          const sku = v.split(" — ")[0].trim();
          if (porSku.has(sku)) onAsignar(fila, sku);
        }}
      />
      <datalist id={id}>
        {opciones.map((a) => (
          <option key={a.sku} value={`${a.sku} — ${a.descripcion}`}>
            {enOC.has(a.sku) ? "en la OC" : ""}
          </option>
        ))}
      </datalist>
      {actual && (
        <button
          className="text-muted hover:text-ink px-1"
          title="Volver a lo que dedujo el cruce"
          onClick={() => {
            setTexto("");
            onAsignar(fila, null);
          }}
        >
          ×
        </button>
      )}
    </span>
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

/** El cruce entero en CSV, con punto y coma y coma decimal para que Excel lo abra bien. */
function descargarCsv(lineas: LineaCruce[]) {
  const num = (n: number | null | undefined) =>
    n == null ? "" : String(Math.round(n * 100) / 100).replace(".", ",");
  const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const filas = [
    [
      "Estado", "SKU", "Descripción Sigma", "Filas factura", "Cómo se identificó",
      "Cant. OC", "Cant. factura", "Dif. cant.", "P. neto OC", "P. neto factura", "Dif. $",
    ].join(";"),
    ...lineas.map((l) =>
      [
        esc(l.estado),
        esc(l.sku ?? ""),
        esc(l.descripcion),
        esc(l.renglones.map((r) => r.fila).join(", ")),
        esc(l.como ? COMO_TEXTO[l.como] : ""),
        num(l.oc?.unidades),
        num(l.factura?.unidades),
        num(l.difUnidades),
        num(l.oc?.precioNeto),
        num(l.factura?.precioNeto),
        num(l.difPrecio),
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
