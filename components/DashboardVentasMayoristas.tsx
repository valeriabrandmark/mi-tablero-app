"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import BarraFiltros from "@/components/Filtros";
import BarrasMargen from "@/components/charts/BarrasMargen";
import LineasPorVendedor from "@/components/charts/LineasPorVendedor";
import TortaProveedores from "@/components/charts/TortaProveedores";
import { Aviso, Esqueleto, Panel, TarjetaKpi } from "@/components/ui";
import { fmtMoneda, fmtNumero, fmtPct } from "@/lib/format";
import { MIN_UNIDADES_MARGEN } from "@/lib/constantes";
import { PALETA } from "@/lib/paleta";
import type { DashboardVentasMayoristas, Filtros, OpcionesFiltro } from "@/lib/types";

function queryString(f: Filtros) {
  const sp = new URLSearchParams();
  if (f.vendedor) sp.set("vendedor", f.vendedor);
  if (f.empresa) sp.set("empresa", f.empresa);
  if (f.mes) sp.set("mes", f.mes);
  return sp.toString();
}

async function traer<T>(url: string, signal: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal, cache: "no-store" });
  if (res.status === 401) throw new Error("401");
  if (!res.ok) {
    const cuerpo = await res.json().catch(() => null);
    throw new Error(cuerpo?.error ?? `Error ${res.status} al consultar ${url}`);
  }
  return res.json() as Promise<T>;
}

export default function Dashboard() {
  const router = useRouter();
  const [filtros, setFiltros] = useState<Filtros>({});
  const [opciones, setOpciones] = useState<OpcionesFiltro | null>(null);
  const [data, setData] = useState<DashboardVentasMayoristas | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [recargas, setRecargas] = useState(0);

  const manejarError = useCallback(
    (e: unknown) => {
      if (e instanceof DOMException && e.name === "AbortError") return;
      if (e instanceof Error && e.message === "401") {
        router.replace("/login");
        return;
      }
      setError(e instanceof Error ? e.message : "Error desconocido");
    },
    [router],
  );

  useEffect(() => {
    const ac = new AbortController();
    traer<OpcionesFiltro>("/api/filtros", ac.signal).then(setOpciones).catch(manejarError);
    return () => ac.abort();
  }, [manejarError]);

  // `cargando` / `error` se resetean en los handlers, no acá: hacerlo dentro
  // del efecto dispara un render en cascada.
  const cambiarFiltros = useCallback((f: Filtros) => {
    setCargando(true);
    setError(null);
    setFiltros(f);
  }, []);

  const recargar = useCallback(() => {
    setCargando(true);
    setError(null);
    setRecargas((n) => n + 1);
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    const qs = queryString(filtros);
    traer<DashboardVentasMayoristas>(
      `/api/ventas-mayoristas${qs ? `?${qs}` : ""}`,
      ac.signal,
    )
      .then((d) => {
        setData(d);
        setCargando(false);
      })
      .catch((e) => {
        manejarError(e);
        if (!(e instanceof DOMException && e.name === "AbortError")) setCargando(false);
      });

    return () => ac.abort();
  }, [filtros, recargas, manejarError]);

  const k = data?.kpis;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Ventas Mayoristas</h1>
          <p className="text-muted mt-0.5 text-xs">
            {data
              ? `Actualizado ${new Date(data.generadoEn).toLocaleTimeString("es-AR", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}`
              : "Cargando datos en vivo…"}
          </p>
        </div>
        <button
          onClick={recargar}
          disabled={cargando}
          className="border-line hover:bg-panel-2 text-muted hover:text-ink rounded-lg border px-3 py-1.5 text-xs disabled:opacity-40"
        >
          {cargando ? "Actualizando…" : "Actualizar"}
        </button>
      </div>

      <BarraFiltros filtros={filtros} opciones={opciones} onChange={cambiarFiltros} />

      {error && (
        <Aviso>
          <p className="font-medium">No se pudieron leer los datos.</p>
          <p className="mt-1 font-mono text-xs break-words opacity-80">{error}</p>
          <p className="mt-2 text-xs opacity-80">
            Revisá que <code>DB_HOST</code>, <code>DB_PORT</code>, <code>DB_USER</code>,{" "}
            <code>DB_PASS</code> y <code>DB_NAME</code> estén cargadas.
          </p>
        </Aviso>
      )}

      {!k && !error ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {Array.from({ length: 10 }, (_, i) => (
            <Esqueleto key={i} className="h-[86px]" />
          ))}
        </div>
      ) : k ? (
        <div
          className={`grid gap-3 transition-opacity sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 ${
            cargando ? "opacity-50" : ""
          }`}
        >
          <TarjetaKpi
            titulo="Facturación Neta (sin IVA)"
            valor={fmtMoneda(k.facturacionNeta)}
            acento={PALETA[0]}
          />
          <TarjetaKpi titulo="Costo Mercadería" valor={fmtMoneda(k.costoMercaderia)} />
          <TarjetaKpi titulo="Unidades" valor={fmtNumero(k.unidades)} />
          <TarjetaKpi
            titulo="Clientes con Compra"
            valor={fmtNumero(k.clientesConCompra)}
            detalle={`${fmtNumero(k.cantidadPedidos)} pedidos`}
          />
          <TarjetaKpi
            titulo="Margen Ajustado"
            valor={fmtMoneda(k.margenAjustado)}
            detalle={`Margen sin ajustar ${fmtMoneda(k.margenTotal)}`}
            acento={k.margenAjustado >= 0 ? PALETA[1] : "#f43f5e"}
          />
          <TarjetaKpi
            titulo="% Rentabilidad Ajustada"
            valor={fmtPct(k.rentabilidadAjustadaPct)}
            detalle="Margen ajustado / facturación neta"
            acento={PALETA[1]}
          />
          <TarjetaKpi
            titulo="Ticket Promedio"
            valor={fmtMoneda(k.ticketPromedio)}
            detalle="Facturación / pedidos distintos"
          />
          <TarjetaKpi
            titulo="% Facturación Top 10 Clientes"
            valor={fmtPct(k.pctTop10Clientes)}
            detalle="Concentración de cartera"
            acento={PALETA[3]}
          />
          <TarjetaKpi
            titulo="Flete Total (real)"
            valor={fmtMoneda(k.fleteTotalReal)}
            detalle="Factura del transportista ya cargada"
            acento={PALETA[4]}
          />
          <TarjetaKpi
            titulo="Flete Estimado (filtrado)"
            valor={fmtMoneda(k.fleteEstimadoFiltrado)}
            detalle="Prorrateo, todavía sin factura real"
            acento={PALETA[2]}
          />
        </div>
      ) : null}

      {data && (
        <div className={`space-y-4 transition-opacity ${cargando ? "opacity-50" : ""}`}>
          <Panel
            titulo="Facturación Neta por Día y Vendedor"
            nota={`${data.serieDiaria.vendedores.length} vendedores`}
          >
            <LineasPorVendedor serie={data.serieDiaria} />
          </Panel>

          <div className="grid gap-4 xl:grid-cols-2">
            <Panel titulo="Facturación Neta por proveedor" nota="Top 12">
              <TortaProveedores
                datos={data.facturacionPorProveedor}
                totalGeneral={data.kpis.facturacionNeta}
              />
            </Panel>

            <Panel
              titulo="Margen % por proveedor"
              nota={`Ajustado por flete · mín. ${MIN_UNIDADES_MARGEN} unidades`}
            >
              <BarrasMargen datos={data.margenPorProveedor} />
            </Panel>
          </div>
        </div>
      )}
    </div>
  );
}
