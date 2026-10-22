"use client";

import { useEffect, useMemo, useState } from "react";
import { Aviso, Panel, TarjetaKpi } from "@/components/ui";
import { fmtMoneda, fmtNumero } from "@/lib/format";
import type { DiferenciaGuardada } from "@/lib/factura-cruce";
import type {
  EstadoReclamo,
  FacturaEnviada,
} from "@/lib/queries-facturas";

/* -------------------------------------------------------------------------
   FACTURAS ENVIADAS A SIGMA, Y QUE FALTA RECLAMAR

   La pantalla entra por LO QUE FALTA, no por la lista completa. Una lista de
   todas las facturas mandadas es un archivo; lo que hace falta mirar todos los
   días son las que tenían diferencias y nadie reclamó todavía.

   LOS DOS CIERRES NO SON EL MISMO. "Reclamado" es que se le pidió al
   proveedor; "omitido" es que se decidió dejarlo pasar. Meterlos en el mismo
   estado borraría el dato que haría falta para notar un mes con mucho omitido.
   ------------------------------------------------------------------------- */

const BOTON =
  "border-line hover:bg-panel-2 text-muted hover:text-ink rounded-lg border px-3 py-1.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40";
const BOTON_ACTIVO = "border-c1 bg-c1/15 text-c1 rounded-lg border px-3 py-1.5 text-xs";
const CAMPO =
  "border-line bg-panel-2 text-ink placeholder:text-muted/60 rounded-lg border px-2.5 py-1.5 text-sm focus:border-c1 focus:outline-none";

const COLOR_RECLAMO: Record<EstadoReclamo, string> = {
  pendiente: "border-amber-500/40 bg-amber-500/10 text-amber-200",
  reclamado: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  omitido: "border-line bg-panel-2 text-muted",
};

const TEXTO_RECLAMO: Record<EstadoReclamo, string> = {
  pendiente: "Falta reclamar",
  reclamado: "Reclamado",
  omitido: "Omitido",
};

const MOTIVO: Record<string, string> = {
  cantidad: "Diferencia de cantidad",
  precio: "Diferencia de costo",
  "cantidad y precio": "Diferencia de cantidad y costo",
  "falta en factura": "Pedido y no facturado",
  "no está en la OC": "Facturado sin estar en la OC",
  "sin identificar": "Artículo no identificado",
};

export default function FacturasEnviadas() {
  const [facturas, setFacturas] = useState<FacturaEnviada[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [soloPendientes, setSoloPendientes] = useState(true);
  const [abierta, setAbierta] = useState<number | null>(null);

  useEffect(() => {
    let vivo = true;
    fetch("/api/compras/facturas/enviadas")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: { facturas?: FacturaEnviada[] }) => {
        if (vivo) setFacturas(j.facturas ?? []);
      })
      .catch(() => {
        if (vivo) {
          setError("No se pudo leer la lista de facturas enviadas.");
          setFacturas([]);
        }
      });
    return () => {
      vivo = false;
    };
  }, []);

  /**
   * EL FILTRO ES DEL LADO DEL NAVEGADOR y no otra consulta: la lista entera
   * son 200 filas como mucho, y tenerla cargada deja que alternar entre "falta
   * reclamar" y "todas" sea instantáneo. Volver a pedirla haría parpadear la
   * pantalla para esconder filas que ya estaban.
   */
  const visibles = useMemo(
    () =>
      (facturas ?? []).filter(
        (f) => !soloPendientes || (f.conDiferencia > 0 && f.reclamo === "pendiente"),
      ),
    [facturas, soloPendientes],
  );

  const pendientes = useMemo(
    () => (facturas ?? []).filter((f) => f.conDiferencia > 0 && f.reclamo === "pendiente"),
    [facturas],
  );

  const marcar = async (id: number, reclamo: EstadoReclamo, nota: string) => {
    setError(null);
    try {
      const r = await fetch("/api/compras/facturas/enviadas", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, reclamo, nota }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `Error ${r.status}`);
      setFacturas(j.facturas ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar");
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">
          Facturas enviadas a Sigma
        </h1>
        <p className="text-muted mt-1 text-xs">
          Lo que se cargó, y lo que falta reclamarle al proveedor
        </p>
      </div>

      {error && <Aviso>{error}</Aviso>}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <TarjetaKpi
          titulo="Falta reclamar"
          valor={fmtNumero(pendientes.length)}
          detalle="facturas con diferencias sin cerrar"
          acento={pendientes.length ? "#f59e0b" : undefined}
          compacta
        />
        <TarjetaKpi
          titulo="En diferencias de costo"
          valor={fmtMoneda(pendientes.reduce((s, f) => s + f.difCosto, 0))}
          detalle="lo facturado de más o de menos contra la OC"
          compacta
        />
        <TarjetaKpi
          titulo="En diferencias de cantidad"
          valor={fmtMoneda(pendientes.reduce((s, f) => s + f.difCantidad, 0))}
          detalle="unidades de más o de menos, a costo de la OC"
          compacta
        />
        <TarjetaKpi
          titulo="Cargadas en total"
          valor={fmtNumero(facturas?.length ?? 0)}
          detalle="las que entraron en Sigma"
          compacta
        />
      </div>

      <Panel
        titulo={soloPendientes ? "Falta reclamar" : "Todas las enviadas"}
        nota={`${visibles.length} de ${facturas?.length ?? 0}`}
      >
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <button
            className={soloPendientes ? BOTON_ACTIVO : BOTON}
            onClick={() => setSoloPendientes(true)}
          >
            Falta reclamar ({pendientes.length})
          </button>
          <button
            className={!soloPendientes ? BOTON_ACTIVO : BOTON}
            onClick={() => setSoloPendientes(false)}
          >
            Todas ({facturas?.length ?? 0})
          </button>
        </div>

        {facturas === null ? (
          <p className="text-muted text-sm">Cargando…</p>
        ) : visibles.length === 0 ? (
          <Aviso tono="info">
            {soloPendientes
              ? "No queda ninguna diferencia sin reclamar."
              : "Todavía no se mandó ninguna factura a Sigma desde el tablero."}
          </Aviso>
        ) : (
          <div className="space-y-2">
            {visibles.map((f) => (
              <FilaFactura
                key={f.id}
                factura={f}
                abierta={abierta === f.id}
                onAbrir={() => setAbierta(abierta === f.id ? null : f.id)}
                onMarcar={(estado, nota) => marcar(f.id, estado, nota)}
              />
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

/** Una factura: el resumen, y adentro las diferencias con lo que se puede hacer. */
function FilaFactura({
  factura,
  abierta,
  onAbrir,
  onMarcar,
}: {
  factura: FacturaEnviada;
  abierta: boolean;
  onAbrir: () => void;
  onMarcar: (estado: EstadoReclamo, nota: string) => void | Promise<void>;
}) {
  const [nota, setNota] = useState(factura.reclamoNota ?? "");
  const [guardando, setGuardando] = useState(false);
  const hayQueReclamar = factura.conDiferencia > 0;

  const marcar = async (estado: EstadoReclamo) => {
    setGuardando(true);
    await onMarcar(estado, nota);
    setGuardando(false);
  };

  return (
    <div className="border-line rounded-lg border p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">
            {factura.proveedor ?? "Sin proveedor"}
            {factura.numero ? ` · ${factura.numero}` : ""}
          </p>
          <p className="text-muted mt-0.5 text-xs">
            {factura.fechaFactura ? `Factura del ${factura.fechaFactura}` : ""}
            {factura.fechaFactura ? " · " : ""}
            Enviada el {factura.enviadaEn}
            {factura.usuario ? ` por ${factura.usuario}` : ""}
            {" · "}
            {fmtMoneda(factura.total)}
          </p>
          {hayQueReclamar ? (
            <p className="mt-1 text-xs text-amber-200">
              {fmtNumero(factura.conDiferencia)} renglón
              {factura.conDiferencia === 1 ? "" : "es"} con diferencia
              {factura.difCosto !== 0 && ` · costo ${fmtMoneda(factura.difCosto)}`}
              {factura.difCantidad !== 0 &&
                ` · cantidad ${fmtMoneda(factura.difCantidad)}`}
            </p>
          ) : (
            <p className="text-muted mt-1 text-xs">
              Sin diferencias contra la orden.
            </p>
          )}
          {factura.reclamo !== "pendiente" && (
            <p className="text-muted mt-0.5 text-xs">
              {TEXTO_RECLAMO[factura.reclamo]}
              {factura.reclamoEn ? ` el ${factura.reclamoEn}` : ""}
              {factura.reclamoPor ? ` por ${factura.reclamoPor}` : ""}
              {factura.reclamoNota ? ` — ${factura.reclamoNota}` : ""}
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {hayQueReclamar && (
            <span
              className={`rounded-full border px-2.5 py-1 text-xs ${COLOR_RECLAMO[factura.reclamo]}`}
            >
              {TEXTO_RECLAMO[factura.reclamo]}
            </span>
          )}
          {hayQueReclamar && (
            <button type="button" className={BOTON} onClick={onAbrir}>
              {abierta ? "Cerrar" : "Ver diferencias"}
            </button>
          )}
        </div>
      </div>

      {abierta && hayQueReclamar && (
        <div className="border-line mt-3 border-t pt-3">
          <TablaDiferencias lineas={factura.diferencias} />

          {/* LA NOTA ES LO QUE HACE UTIL AL ESTADO dentro de dos meses. "Omitido"
              a secas no dice nada; "omitido, lo compensan en la próxima" sí. */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input
              className={`${CAMPO} min-w-0 flex-1 text-xs`}
              placeholder="Nota: qué se reclamó, o por qué se deja pasar"
              value={nota}
              onChange={(e) => setNota(e.target.value)}
            />
            {factura.reclamo !== "reclamado" && (
              <button
                type="button"
                className={BOTON_ACTIVO}
                disabled={guardando}
                onClick={() => void marcar("reclamado")}
              >
                Marcar reclamado
              </button>
            )}
            {factura.reclamo !== "omitido" && (
              <button
                type="button"
                className={BOTON}
                disabled={guardando}
                onClick={() => void marcar("omitido")}
                title="No se va a reclamar. Queda cerrado, pero diciendo que se dejó pasar."
              >
                Omitir
              </button>
            )}
            {factura.reclamo !== "pendiente" && (
              <button
                type="button"
                className={BOTON}
                disabled={guardando}
                onClick={() => void marcar("pendiente")}
                title="Volver a abrirlo: marcarlo por error no puede enterrar un reclamo."
              >
                Volver a pendiente
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Las diferencias congeladas al momento de mandar la factura. */
function TablaDiferencias({ lineas }: { lineas: DiferenciaGuardada[] }) {
  if (lineas.length === 0) {
    return (
      <p className="text-muted text-xs">
        Esta factura se mandó antes de que se guardaran las diferencias, así que
        no quedaron registradas. Las que se manden de ahora en más sí.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-xs">
        <thead>
          <tr className="border-line text-muted border-b text-left">
            <th className="py-2 pr-2 font-normal">Motivo</th>
            <th className="py-2 pr-2 font-normal">Artículo</th>
            <th className="py-2 pr-2 text-right font-normal">Unid. OC</th>
            <th className="py-2 pr-2 text-right font-normal">Unid. factura</th>
            <th className="py-2 pr-2 text-right font-normal">Dif. unid.</th>
            <th className="py-2 pr-2 text-right font-normal">Dif. $ costo</th>
            <th className="py-2 text-right font-normal">Dif. $ cantidad</th>
          </tr>
        </thead>
        <tbody>
          {lineas.map((l, i) => (
            <tr key={`${l.sku ?? "x"}-${i}`} className="border-line/60 border-b">
              <td className="py-1.5 pr-2">{MOTIVO[l.motivo] ?? l.motivo}</td>
              <td className="py-1.5 pr-2">
                <span className="font-mono">{l.sku ?? "—"}</span>
                <span className="text-muted block">{l.descripcion}</span>
              </td>
              <td className="py-1.5 pr-2 text-right tabular-nums">
                {l.unidadesOC == null ? "—" : fmtNumero(l.unidadesOC)}
              </td>
              <td className="py-1.5 pr-2 text-right tabular-nums">
                {l.unidadesFactura == null ? "—" : fmtNumero(l.unidadesFactura)}
              </td>
              <td className="py-1.5 pr-2 text-right tabular-nums">
                {l.difUnidades === 0
                  ? "—"
                  : `${l.difUnidades > 0 ? "+" : ""}${fmtNumero(l.difUnidades)}`}
              </td>
              <td className="py-1.5 pr-2 text-right tabular-nums">
                {l.difCosto === 0 ? "—" : fmtMoneda(l.difCosto)}
              </td>
              <td className="py-1.5 text-right tabular-nums">
                {l.difCantidad === 0 ? "—" : fmtMoneda(l.difCantidad)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
