"use client";

import { useState } from "react";
import VentaRentabilidadMeli from "@/components/charts/VentaRentabilidadMeli";
import TortaProveedores from "@/components/charts/TortaProveedores";
import BarraFiltrosMeli from "@/components/FiltrosMeli";
import { Tabla, type Columna } from "@/components/Tabla";
import { Aviso, Esqueleto, Panel, TarjetaKpi } from "@/components/ui";
import { alternar as alternarValor, vacio as sinValores } from "@/lib/filtros";
import { fmtFechaCorta, fmtMoneda, fmtNumero, fmtPct } from "@/lib/format";
import { CARGA_IMPOSITIVA } from "@/lib/meli";
import { PALETA, TEMA } from "@/lib/paleta";
import { useDatosTablero } from "@/lib/useDatosTablero";
import type { ArticuloMeli, DashboardMeli, FiltrosMeli, OpcionesMeli, RankingMeli } from "@/lib/types";

type Respuesta = DashboardMeli & { opciones: OpcionesMeli | null };

const COLUMNAS_ARTICULOS: Columna<ArticuloMeli>[] = [
  { titulo: "SKU", celda: (a) => a.sku ?? "—" },
  {
    titulo: "Producto",
    celda: (a) => <span className="block max-w-[320px] truncate">{a.producto ?? "—"}</span>,
  },
  {
    titulo: "Marca",
    celda: (a) => <span className="block max-w-[140px] truncate">{a.marca ?? "—"}</span>,
  },
  { titulo: "Unid.", celda: (a) => fmtNumero(a.unidades), numerica: true },
  { titulo: "Venta c/IVA", celda: (a) => fmtMoneda(a.ventaCiva), numerica: true },
  { titulo: "Costo", celda: (a) => fmtMoneda(a.costo), numerica: true },
  { titulo: "Comisión", celda: (a) => fmtMoneda(a.comision), numerica: true },
  { titulo: "Envío", celda: (a) => fmtMoneda(a.envio), numerica: true },
  {
    titulo: "Rentabilidad",
    celda: (a) => (
      <span style={a.rentabilidad < 0 ? { color: TEMA.negativo } : undefined}>
        {fmtMoneda(a.rentabilidad)}
      </span>
    ),
    numerica: true,
  },
  {
    titulo: "Margen",
    celda: (a) => (
      <span style={(a.margenPct ?? 0) < 0 ? { color: TEMA.negativo } : undefined}>
        {fmtPct(a.margenPct)}
      </span>
    ),
    numerica: true,
  },
];

/** Ranking en tabla y no en gráfico: son cuatro números por fila, no uno. */
function TablaRanking({
  filas,
  titulo,
  seleccionados,
  onSeleccionar,
}: {
  filas: RankingMeli[];
  titulo: string;
  seleccionados?: string[];
  onSeleccionar: (v: string) => void;
}) {
  const columnas: Columna<RankingMeli>[] = [
    {
      titulo,
      celda: (r) => <span className="block max-w-[220px] truncate">{r.label}</span>,
    },
    { titulo: "Venta c/IVA", celda: (r) => fmtMoneda(r.venta), numerica: true },
    { titulo: "Unid.", celda: (r) => fmtNumero(r.unidades), numerica: true },
    {
      titulo: "Rentab.",
      celda: (r) => (
        <span style={r.rentabilidad < 0 ? { color: TEMA.negativo } : undefined}>
          {fmtMoneda(r.rentabilidad)}
        </span>
      ),
      numerica: true,
    },
    {
      titulo: "Margen",
      celda: (r) => (
        <span style={(r.margenPct ?? 0) < 0 ? { color: TEMA.negativo } : undefined}>
          {fmtPct(r.margenPct)}
        </span>
      ),
      numerica: true,
    },
  ];

  return (
    <Tabla
      filas={filas}
      columnas={columnas}
      clave={(r) => r.label}
      onClickFila={(r) => onSeleccionar(r.label)}
      activa={(r) => (seleccionados?.length ? seleccionados.includes(r.label) : false)}
    />
  );
}

export default function DashboardMeliPage({ mesInicial }: { mesInicial: string }) {
  const inicial: FiltrosMeli = { mes: [mesInicial] };
  const [filtros, setFiltros] = useState<FiltrosMeli>(inicial);

  const { data, cargando, error, recargar, empezarCarga } = useDatosTablero<Respuesta>(
    "/api/meli",
    filtros as unknown as Record<string, string[] | undefined>,
    { conOpciones: "1" },
  );

  const cambiar = (f: FiltrosMeli) => {
    empezarCarga();
    setFiltros(f);
  };

  const alternarEn = (clave: "proveedor" | "marca" | "sku") => (valor: string) =>
    cambiar({ ...filtros, [clave]: alternarValor(filtros[clave], valor) });

  const k = data?.kpis;
  const sinCambios =
    filtros.mes?.length === 1 &&
    filtros.mes[0] === mesInicial &&
    sinValores(filtros.proveedor) &&
    sinValores(filtros.marca) &&
    sinValores(filtros.sku);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">
            Mercado Libre <span className="text-muted text-sm font-normal">· Unibrandco</span>
          </h1>
          <p className="text-muted mt-1 text-xs">
            {data
              ? `Actualizado ${new Date(data.generadoEn).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}` +
                (data.ultimaVenta ? ` · última venta cargada ${fmtFechaCorta(data.ultimaVenta)}` : "")
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

      <BarraFiltrosMeli
        filtros={filtros}
        opciones={data?.opciones ?? null}
        onChange={cambiar}
        onLimpiar={() => cambiar(inicial)}
        sinCambios={!!sinCambios}
        nota="Solo canal Mercado Libre. El mes comercial va del 6 al 5. Todos los márgenes son sobre venta c/IVA — Ventas Mayoristas los mide s/IVA, ojo al comparar."
      />

      {/* Los chips solo aparecen para los filtros que no tienen selector arriba:
          proveedor y marca ya se ven en su desplegable. */}
      {!sinValores(filtros.sku) && (
        <div className="flex flex-wrap items-center gap-2">
          {filtros.sku!.map((s) => (
            <button
              key={s}
              onClick={() => alternarEn("sku")(s)}
              className="border-c1/40 bg-c1/10 text-c1 hover:bg-c1/20 rounded-full border px-3 py-1 text-xs"
            >
              SKU {s} ✕
            </button>
          ))}
        </div>
      )}

      {error && (
        <Aviso>
          <p className="font-medium">No se pudieron leer los datos.</p>
          <p className="mt-1 font-mono text-xs break-words opacity-80">{error}</p>
        </Aviso>
      )}

      {error ? null : !k ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => (
            <Esqueleto key={i} className="h-[86px]" />
          ))}
        </div>
      ) : (
        <div
          className={`grid gap-3 transition-opacity sm:grid-cols-2 lg:grid-cols-4 ${cargando ? "opacity-50" : ""}`}
        >
          <TarjetaKpi
            titulo="Venta c/IVA"
            valor={fmtMoneda(k.ventaCiva)}
            detalle={`${fmtMoneda(k.ventaSiva)} sin IVA`}
          />
          <TarjetaKpi
            titulo="Rentabilidad bruta"
            valor={fmtMoneda(k.rentabilidad)}
            detalle="Venta s/IVA − costo − comisión − envío"
            acento={k.rentabilidad < 0 ? TEMA.negativo : PALETA[1]}
          />
          <TarjetaKpi
            titulo="Margen bruto"
            valor={fmtPct(k.margenPct)}
            detalle="Rentabilidad sobre venta c/IVA"
            acento={(k.margenPct ?? 0) < 0 ? TEMA.negativo : undefined}
          />
          {/* La neta va al lado de la bruta a propósito: la diferencia entre las
              dos es el 7,4 % de impuestos, y verlas separadas es lo que hace
              que una venta "con margen" se lea como lo que es. */}
          <TarjetaKpi
            titulo="Rentabilidad neta"
            valor={fmtMoneda(k.rentabilidadNeta)}
            detalle={`${fmtPct(k.margenNetoPct)} sobre venta c/IVA · ${fmtMoneda(k.impuestos)} de impuestos`}
            acento={k.rentabilidadNeta < 0 ? TEMA.negativo : undefined}
          />

          <TarjetaKpi
            titulo="Órdenes"
            valor={fmtNumero(k.ordenes)}
            detalle={`${fmtNumero(k.unidades)} unidades · ticket ${fmtMoneda(k.ticketPromedio)}`}
          />
          <TarjetaKpi
            titulo="Costo mercadería"
            valor={fmtMoneda(k.costo)}
            detalle="Sin IVA, ya con el descuento del proveedor"
          />
          <TarjetaKpi
            titulo="Comisión Mercado Libre"
            valor={fmtMoneda(k.comision)}
            detalle={`${fmtPct(k.pctComision)} de la venta c/IVA`}
          />
          <TarjetaKpi
            titulo="Costo de envío"
            valor={fmtMoneda(k.envio)}
            detalle={
              k.envio === 0
                ? "Sin envíos cargados en este recorte"
                : `${fmtPct(k.envio / k.ventaCiva)} de la venta c/IVA`
            }
          />
        </div>
      )}

      {data && (
        <div className={`space-y-4 transition-opacity ${cargando ? "opacity-50" : ""}`}>
          <Panel
            titulo="Venta y rentabilidad por día"
            nota="Venta c/IVA contra rentabilidad bruta"
          >
            <VentaRentabilidadMeli datos={data.porDia} />
          </Panel>

          <div className="grid gap-4 xl:grid-cols-2">
            <Panel titulo="Venta por proveedor" nota="Top 12 · click para filtrar">
              <TortaProveedores
                datos={data.porProveedor.map((p) => ({ label: p.label, total: p.venta }))}
                totalGeneral={data.ventaTotalProveedores}
                seleccionados={filtros.proveedor}
                onSeleccionar={alternarEn("proveedor")}
              />
            </Panel>
            <Panel titulo="Rentabilidad por proveedor" nota="Top 12 por venta · click para filtrar">
              <TablaRanking
                filas={data.porProveedor}
                titulo="Proveedor"
                seleccionados={filtros.proveedor}
                onSeleccionar={alternarEn("proveedor")}
              />
            </Panel>
          </div>

          <Panel titulo="Rentabilidad por marca" nota="Top 12 por venta · click para filtrar">
            <TablaRanking
              filas={data.porMarca}
              titulo="Marca"
              seleccionados={filtros.marca}
              onSeleccionar={alternarEn("marca")}
            />
          </Panel>

          <Panel
            titulo="Artículos"
            nota={`${data.articulos.length} SKUs · click para filtrar · impuestos aparte (${fmtPct(CARGA_IMPOSITIVA)})`}
          >
            <Tabla
              filas={data.articulos}
              columnas={COLUMNAS_ARTICULOS}
              clave={(a, i) => `${a.sku ?? "sin-sku"}-${i}`}
              onClickFila={(a) => a.sku && alternarEn("sku")(a.sku)}
              activa={(a) => (filtros.sku?.length ? filtros.sku.includes(a.sku ?? "") : false)}
            />
          </Panel>
        </div>
      )}
    </div>
  );
}
