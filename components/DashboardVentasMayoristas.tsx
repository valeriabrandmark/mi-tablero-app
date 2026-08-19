"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import BarraFiltros from "@/components/Filtros";
import EncabezadoPagina from "@/components/EncabezadoPagina";
import BarrasCategoria from "@/components/charts/BarrasCategoria";
import BarrasMargen from "@/components/charts/BarrasMargen";
import LineasPorVendedor from "@/components/charts/LineasPorVendedor";
import TortaProveedores from "@/components/charts/TortaProveedores";
import { Tabla, type Columna } from "@/components/Tabla";
import { Aviso, Delta, Esqueleto, Panel, TarjetaKpi } from "@/components/ui";
import { fmtFechaCorta, fmtMoneda, fmtNumero, fmtPct } from "@/lib/format";
import { alternar as alternarValor } from "@/lib/filtros";
import { CRUZADOS, type FilaArticulo, type FilaComprobanteVenta } from "@/lib/types";

const ETIQUETA_CRUZADO: Record<(typeof CRUZADOS)[number], string> = {
  proveedor: "Proveedor",
  cliente: "Cliente",
  sku: "SKU",
  comprobante: "Comprobante",
};
import { MIN_UNIDADES_MARGEN } from "@/lib/constantes";
import { aQueryString } from "@/lib/filtros";
import { PALETA } from "@/lib/paleta";
import type { DashboardVentasMayoristas, Filtros, OpcionesFiltro } from "@/lib/types";

const COL_ARTICULOS: Columna<FilaArticulo>[] = [
  { titulo: "SKU", celda: (a) => a.sku ?? "—", orden: (a) => a.sku },
  {
    titulo: "Producto",
    celda: (a) => <span className="block max-w-[280px] truncate">{a.producto ?? "—"}</span>,
    orden: (a) => a.producto,
  },
  { titulo: "Unidades", celda: (a) => fmtNumero(a.cantidad), numerica: true, orden: (a) => a.cantidad },
  { titulo: "Oferta %", celda: (a) => (a.ofertaPct == null ? "—" : fmtPct(a.ofertaPct / 100)), numerica: true, orden: (a) => a.ofertaPct },
  { titulo: "Precio prom.", celda: (a) => fmtMoneda(a.precioPromedio), numerica: true, orden: (a) => a.precioPromedio },
  { titulo: "Costo prom.", celda: (a) => fmtMoneda(a.costoPromedio), numerica: true, orden: (a) => a.costoPromedio },
  { titulo: "Facturación", celda: (a) => fmtMoneda(a.facturacion), numerica: true, orden: (a) => a.facturacion },
  { titulo: "% Rentab.", celda: (a) => fmtPct(a.rentabilidadPct), numerica: true, orden: (a) => a.rentabilidadPct },
];

const COL_COMPROBANTES: Columna<FilaComprobanteVenta>[] = [
  { titulo: "Fecha", celda: (c) => c.fecha ?? "—", orden: (c) => c.fecha },
  { titulo: "Comprobante", celda: (c) => c.comprobante ?? "—", orden: (c) => c.comprobante },
  {
    titulo: "Cliente",
    celda: (c) => <span className="block max-w-[260px] truncate">{c.cliente ?? "—"}</span>,
    orden: (c) => c.cliente,
  },
  { titulo: "Unidades", celda: (c) => fmtNumero(c.unidades), numerica: true, orden: (c) => c.unidades },
  { titulo: "Facturación", celda: (c) => fmtMoneda(c.facturacion), numerica: true, orden: (c) => c.facturacion },
];


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

  /** Click en un gráfico o en una tabla: filtra el resto del tablero.
   *  Volver a clickear lo mismo (o el chip) limpia la selección. */
  const alternar = useCallback((campo: keyof Filtros, valor: string) => {
    setCargando(true);
    setError(null);
    setFiltros((f) => ({ ...f, [campo]: alternarValor(f[campo], valor) }));
  }, []);

  const alternarProveedor = useCallback(
    (proveedor: string) => alternar("proveedor", proveedor),
    [alternar],
  );

  const recargar = useCallback(() => {
    setCargando(true);
    setError(null);
    setRecargas((n) => n + 1);
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    const qs = aQueryString(filtros);
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
  const comp = data?.comparacion ?? null;

  // La etiqueta dice hasta qué día se midió el mes anterior. Cuando el mes
  // elegido está corriendo, el actual va por la mitad: compararlo contra un mes
  // entero mostraría una caída que no existe, y sin decirlo el porcentaje no se
  // puede interpretar.
  const contra = comp
    ? comp.hasta
      ? `vs ${comp.mes} hasta ${fmtFechaCorta(comp.hasta)}`
      : `vs ${comp.mes}`
    : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <EncabezadoPagina pagina="ventas">
          <p className="text-muted mt-1 text-xs">
            {data
              ? `Actualizado ${new Date(data.generadoEn).toLocaleTimeString("es-AR", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}`
              : "Cargando datos en vivo…"}
          </p>
        </EncabezadoPagina>
        <button
          onClick={recargar}
          disabled={cargando}
          className="border-line hover:bg-panel-2 text-muted hover:text-ink rounded-lg border px-3 py-1.5 text-xs disabled:opacity-40"
        >
          {cargando ? "Actualizando…" : "Actualizar"}
        </button>
      </div>

      <BarraFiltros filtros={filtros} opciones={opciones} onChange={cambiarFiltros} />

      {CRUZADOS.some((c) => filtros[c]?.length) && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted">Filtrado por:</span>
          {/* Un chip por VALOR elegido, no por campo: con selección múltiple un
              solo chip por campo escondería cuántos valores hay puestos. */}
          {CRUZADOS.flatMap((campo) =>
            (filtros[campo] ?? []).map((valor) => (
            <button
              key={`${campo}-${valor}`}
              onClick={() => alternar(campo, valor)}
              className="border-c1/40 bg-c1/15 text-c1 hover:bg-c1/25 flex items-center gap-1.5 rounded-full border px-3 py-1 font-medium"
            >
              <span className="opacity-70">{ETIQUETA_CRUZADO[campo]}</span>
              {valor}
              <span aria-hidden className="text-sm leading-none">
                ×
              </span>
            </button>
            )),
          )}
          <span className="text-muted max-w-md">
            Todo se filtra por lo elegido, salvo el propio gráfico o tabla de donde salió,
            que mantiene su lista completa con el resto atenuado.
          </span>
        </div>
      )}

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
            detalle={
              contra && comp ? (
                <Delta actual={k.facturacionNeta} anterior={comp.facturacionNeta} contra={contra} />
              ) : undefined
            }
            acento={PALETA[0]}
          />
          <TarjetaKpi titulo="Costo Mercadería" valor={fmtMoneda(k.costoMercaderia)} />
          <TarjetaKpi
            titulo="Unidades"
            valor={fmtNumero(k.unidades)}
            detalle={
              contra && comp ? (
                <Delta actual={k.unidades} anterior={comp.unidades} contra={contra} />
              ) : undefined
            }
          />
          <TarjetaKpi
            titulo="Clientes con Compra"
            valor={fmtNumero(k.clientesConCompra)}
            detalle={`${fmtNumero(k.cantidadPedidos)} pedidos`}
          />
          <TarjetaKpi
            titulo="Margen Ajustado"
            valor={fmtMoneda(k.margenAjustado)}
            detalle={
              contra && comp ? (
                <Delta actual={k.margenAjustado} anterior={comp.margenAjustado} contra={contra} />
              ) : (
                `Margen sin ajustar ${fmtMoneda(k.margenTotal)}`
              )
            }
            acento={k.margenAjustado >= 0 ? PALETA[1] : "#f43f5e"}
          />
          <TarjetaKpi
            titulo="% Rentabilidad Ajustada"
            valor={fmtPct(k.rentabilidadAjustadaPct)}
            detalle={
              contra && comp && comp.rentabilidadAjustadaPct != null && k.rentabilidadAjustadaPct != null
                ? `${comp.rentabilidadAjustadaPct < k.rentabilidadAjustadaPct ? "▲" : "▼"} era ${fmtPct(comp.rentabilidadAjustadaPct)} ${contra}`
                : "Margen ajustado / facturación neta (s/IVA)"
            }
            acento={PALETA[1]}
          />
          <TarjetaKpi
            titulo="Ticket Promedio"
            valor={fmtMoneda(k.ticketPromedio)}
            detalle={
              contra && comp && comp.cantidadPedidos > 0 ? (
                <Delta
                  actual={k.ticketPromedio ?? 0}
                  anterior={comp.facturacionNeta / comp.cantidadPedidos}
                  contra={contra}
                />
              ) : (
                "Facturación / pedidos distintos"
              )
            }
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
            <LineasPorVendedor
              serie={data.serieDiaria}
              onSeleccionar={(v) => cambiarFiltros({ ...filtros, vendedor: alternarValor(filtros.vendedor, v) })}
            />
          </Panel>

          <div className="grid gap-4 xl:grid-cols-2">
            <Panel titulo="Facturación Neta por proveedor" nota="Top 12">
              <TortaProveedores
                datos={data.facturacionPorProveedor}
                totalGeneral={data.facturacionTotalProveedores}
                seleccionados={filtros.proveedor}
                onSeleccionar={alternarProveedor}
              />
            </Panel>

            <Panel
              titulo="Margen % por proveedor"
              nota={`Sobre facturación s/IVA · ajustado por flete · mín. ${MIN_UNIDADES_MARGEN} unidades`}
            >
              <BarrasMargen
                datos={data.margenPorProveedor}
                seleccionados={filtros.proveedor}
                onSeleccionar={alternarProveedor}
              />
            </Panel>
          </div>

          <Panel
            titulo="% Rentabilidad Ajustada por cliente"
            nota="Los 15 clientes más grandes · rentabilidad sobre facturación s/IVA"
          >
            <BarrasCategoria
              datos={data.rentabilidadPorCliente}
              formato={(n) => fmtPct(n)}
              colorUnico={PALETA[3]}
              seleccionados={filtros.cliente}
              onSeleccionar={(c) => alternar("cliente", c)}
            />
          </Panel>

          <div className="grid gap-4 xl:grid-cols-2">
            <Panel titulo="Artículos incluídos" nota={`${data.articulos.length} SKUs`}>
              <Tabla
                filas={data.articulos}
                columnas={COL_ARTICULOS}
                clave={(a, i) => `${a.sku}-${i}`}
                onClickFila={(a) => a.sku && alternar("sku", a.sku)}
                activa={(a) => !!a.sku && !!filtros.sku?.includes(a.sku)}
              />
            </Panel>
            <Panel titulo="Comprobantes" nota={`${data.comprobantes.length} por facturación`}>
              <Tabla
                filas={data.comprobantes}
                columnas={COL_COMPROBANTES}
                clave={(c, i) => `${c.comprobante}-${i}`}
                onClickFila={(c) => c.comprobante && alternar("comprobante", c.comprobante)}
                activa={(c) => !!c.comprobante && !!filtros.comprobante?.includes(c.comprobante)}
              />
            </Panel>
          </div>
        </div>
      )}
    </div>
  );
}
