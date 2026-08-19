"use client";

import { useState } from "react";
import EncabezadoPagina from "@/components/EncabezadoPagina";
import BarrasCategoria from "@/components/charts/BarrasCategoria";
import TortaProveedores from "@/components/charts/TortaProveedores";
import { BotonLimpiar, SelectorFiltro, SelectorMultiple } from "@/components/SelectorFiltro";
import { alternar as alternarValor, vacio as sinValores } from "@/lib/filtros";
import { Tabla, type Columna } from "@/components/Tabla";
import { Aviso, Esqueleto, Panel, TarjetaKpi } from "@/components/ui";
import { fmtMes, fmtMoneda, fmtMonedaCorta, fmtNumero, fmtPct } from "@/lib/format";
import { PALETA } from "@/lib/paleta";
import { useDatosTablero } from "@/lib/useDatosTablero";
import type {
  DashboardLogistica,
  FilaComprobante,
  FiltrosLogistica,
  ModoFlete,
  OpcionesLogistica,
} from "@/lib/types";

type Respuesta = DashboardLogistica & { opciones: OpcionesLogistica | null };

const MODOS: [ModoFlete, string][] = [
  ["sin", "Sin flete"],
  ["real", "Solo flete real"],
  ["real-estimado", "Real + estimado"],
];

const COLUMNAS: Columna<FilaComprobante>[] = [
  { titulo: "Comprobante", celda: (f) => f.comprobante ?? "—", orden: (f) => f.comprobante },
  { titulo: "N° orden", celda: (f) => f.nroOrden ?? "—", orden: (f) => f.nroOrden },
  { titulo: "Cliente", celda: (f) => <span className="block max-w-[220px] truncate">{f.cliente ?? "—"}</span>, orden: (f) => f.cliente },
  { titulo: "Provincia", celda: (f) => f.provincia ?? "—", orden: (f) => f.provincia },
  { titulo: "Fecha", celda: (f) => f.fecha ?? "—", orden: (f) => f.fecha },
  { titulo: "Facturación", celda: (f) => fmtMoneda(f.facturacion), numerica: true, orden: (f) => f.facturacion },
  { titulo: "Flete", celda: (f) => fmtMoneda(f.flete), numerica: true, orden: (f) => f.flete },
  { titulo: "% Flete", celda: (f) => fmtPct(f.pctFlete), numerica: true, orden: (f) => f.pctFlete },
];

export default function DashboardLogisticaPage() {
  const [filtros, setFiltros] = useState<FiltrosLogistica>({ modoFlete: "sin" });

  const { data, cargando, error, recargar, empezarCarga } = useDatosTablero<Respuesta>(
    "/api/logistica",
    filtros as Record<string, string | undefined>,
    { conOpciones: "1" },
  );

  // Mientras recarga se conserva el `data` anterior, así que los selectores
  // nunca se quedan vacíos entre consultas.
  const opciones = data?.opciones ?? null;

  const cambiar = (f: FiltrosLogistica) => {
    empezarCarga();
    setFiltros(f);
  };

  /** Click en un gráfico: suma ese valor a la selección, o lo saca. */
  const alternar = (campo: "proveedor" | "provincia") => (valor: string) =>
    cambiar({ ...filtros, [campo]: alternarValor(filtros[campo], valor) });

  const k = data?.kpis;
  const vacio =
    sinValores(filtros.vendedor) && sinValores(filtros.empresa) && sinValores(filtros.mes) &&
    sinValores(filtros.transporte) && sinValores(filtros.provincia) &&
    sinValores(filtros.estadoFlete) && sinValores(filtros.proveedor) &&
    (filtros.modoFlete ?? "sin") === "sin";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <EncabezadoPagina pagina="logistica">
          <p className="text-muted mt-1 text-xs">
            {data
              ? `Actualizado ${new Date(data.generadoEn).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}`
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

      <div className="border-line bg-panel flex flex-wrap items-end gap-3 rounded-xl border p-3">
        <SelectorMultiple
          etiqueta="Vendedor"
          valores={filtros.vendedor}
          opciones={opciones?.vendedores ?? []}
          onChange={(v) => cambiar({ ...filtros, vendedor: v })}
        />
        <SelectorMultiple
          etiqueta="Empresa"
          valores={filtros.empresa}
          opciones={opciones?.empresas ?? []}
          onChange={(v) => cambiar({ ...filtros, empresa: v })}
        />
        <SelectorMultiple
          etiqueta="Mes comercial"
          valores={filtros.mes}
          opciones={opciones?.meses ?? []}
          onChange={(v) => cambiar({ ...filtros, mes: v })}
          formato={fmtMes}
        />
        <SelectorMultiple
          etiqueta="Transporte"
          valores={filtros.transporte}
          opciones={opciones?.transportes ?? []}
          onChange={(v) => cambiar({ ...filtros, transporte: v })}
        />
        <SelectorMultiple
          etiqueta="Provincia"
          valores={filtros.provincia}
          opciones={opciones?.provincias ?? []}
          onChange={(v) => cambiar({ ...filtros, provincia: v })}
        />
        <SelectorMultiple
          etiqueta="Estado flete"
          valores={filtros.estadoFlete}
          opciones={[["real", "Real"], ["estimado", "Estimado"]]}
          onChange={(v) => cambiar({ ...filtros, estadoFlete: v })}
        />
        <SelectorFiltro
          etiqueta="Flete a descontar del margen"
          valor={filtros.modoFlete}
          opciones={MODOS}
          onChange={(v) => cambiar({ ...filtros, modoFlete: (v as ModoFlete) ?? "sin" })}
          todos="Sin flete"
        />
        <BotonLimpiar onClick={() => cambiar({ modoFlete: "sin" })} deshabilitado={vacio} />

        <span className="text-muted ml-auto max-w-sm text-[11px] leading-tight">
          Solo envíos con provincia cargada, igual que el filtro de página del tablero de
          Power BI.
        </span>
      </div>

      {error && (
        <Aviso>
          <p className="font-medium">No se pudieron leer los datos.</p>
          <p className="mt-1 font-mono text-xs break-words opacity-80">{error}</p>
        </Aviso>
      )}

      {!k && !error ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => (
            <Esqueleto key={i} className="h-[86px]" />
          ))}
        </div>
      ) : k ? (
        <div className={`grid gap-3 transition-opacity sm:grid-cols-2 lg:grid-cols-4 ${cargando ? "opacity-50" : ""}`}>
          <TarjetaKpi titulo="Cantidad de Envíos" valor={fmtNumero(k.cantidadEnvios)} acento={PALETA[0]} />
          <TarjetaKpi titulo="Kg Totales" valor={fmtNumero(k.kgTotales)} />
          <TarjetaKpi titulo="Flete Total" valor={fmtMoneda(k.fleteTotal)} detalle={`Real ${fmtMoneda(k.fleteRealFiltrado)} · Estimado ${fmtMoneda(k.fleteEstimadoFiltrado)}`} acento={PALETA[4]} />
          <TarjetaKpi titulo="Costo por Kg" valor={fmtMoneda(k.costoPorKg)} detalle="Flete total / kg" acento={PALETA[2]} />
          <TarjetaKpi titulo="% Líneas con Flete Real" valor={fmtPct(k.pctLineasFleteReal)} detalle="El resto es prorrateo" />
          <TarjetaKpi titulo="% Flete sobre Facturación" valor={fmtPct(k.pctFleteSobreFacturacion)} acento={PALETA[3]} />
          <TarjetaKpi titulo="Facturación Neta (sin IVA)" valor={fmtMoneda(k.facturacionNeta)} detalle="Solo líneas con envío" />
          <TarjetaKpi titulo="% Rentabilidad Ajustada" valor={fmtPct(k.rentabilidadAjustadaPct)} detalle={`Margen ajustado ${fmtMoneda(k.margenAjustado)}`} acento={PALETA[1]} />
        </div>
      ) : null}

      {data && (
        <div className={`space-y-4 transition-opacity ${cargando ? "opacity-50" : ""}`}>
          <div className="grid gap-4 xl:grid-cols-2">
            <Panel titulo="Unidades por proveedor" nota="Top 12">
              <TortaProveedores
                datos={data.unidadesPorProveedor.map((d) => ({ label: d.label, total: d.valor }))}
                totalGeneral={data.totalesProveedor.unidades}
                seleccionados={filtros.proveedor}
                onSeleccionar={alternar("proveedor")}
              />
            </Panel>
            <Panel titulo="Flete por proveedor" nota="Top 12">
              <TortaProveedores
                datos={data.fletePorProveedor.map((d) => ({ label: d.label, total: d.valor }))}
                totalGeneral={data.totalesProveedor.flete}
                seleccionados={filtros.proveedor}
                onSeleccionar={alternar("proveedor")}
              />
            </Panel>
            <Panel titulo="Margen por proveedor" nota="Ajustado según el flete elegido arriba">
              <BarrasCategoria
                datos={data.margenPorProveedor}
                formato={fmtMonedaCorta}
                colorUnico={PALETA[1]}
                seleccionados={filtros.proveedor}
                onSeleccionar={alternar("proveedor")}
              />
            </Panel>
            <Panel titulo="% Flete sobre facturación por provincia" nota="Top 15">
              <BarrasCategoria
                datos={data.pctFletePorProvincia}
                formato={(n) => fmtPct(n)}
                colorUnico={PALETA[2]}
                seleccionados={filtros.provincia}
                onSeleccionar={alternar("provincia")}
              />
            </Panel>
          </div>

          <Panel titulo="Comprobantes Asociados" nota={`${data.comprobantes.length} de mayor flete`}>
            <Tabla filas={data.comprobantes} columnas={COLUMNAS} clave={(f, i) => `${f.comprobante}-${i}`} />
          </Panel>
        </div>
      )}
    </div>
  );
}
