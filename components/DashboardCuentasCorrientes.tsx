"use client";

import { useState } from "react";
import EncabezadoPagina from "@/components/EncabezadoPagina";
import BarrasCategoria from "@/components/charts/BarrasCategoria";
import TortaProveedores from "@/components/charts/TortaProveedores";
import { BotonLimpiar, SelectorMultiple } from "@/components/SelectorFiltro";
import { alternar as alternarValor, vacio as sinValores } from "@/lib/filtros";
import { Tabla, type Columna } from "@/components/Tabla";
import { Aviso, Esqueleto, Panel, TarjetaKpi } from "@/components/ui";
import { fmtMes, fmtMoneda, fmtMonedaCorta, fmtNumero, fmtPct } from "@/lib/format";
import { PALETA } from "@/lib/paleta";
import { useDatosTablero } from "@/lib/useDatosTablero";
import type { DashboardCuentas, FilaCliente, FiltrosCuentas, OpcionesCuentas } from "@/lib/types";

type Respuesta = DashboardCuentas & { opciones: OpcionesCuentas | null };

/** Colores fijos por categoría: el semáforo tiene que leerse igual siempre. */
const COLOR_CATEGORIA: Record<string, string> = {
  "AL DÍA": PALETA[1],
  BUENO: PALETA[4],
  OBSERVACIÓN: PALETA[2],
  RIESGOSO: PALETA[5],
  CRÍTICO: "#f43f5e",
};

const COLUMNAS: Columna<FilaCliente>[] = [
  {
    titulo: "Cliente",
    celda: (f) => <span className="block max-w-[260px] truncate">{f.razonSocial}</span>,
    orden: (f) => f.razonSocial,
  },
  {
    titulo: "Categoría",
    celda: (f) => (
      <span style={{ color: COLOR_CATEGORIA[f.categoria ?? ""] ?? undefined }}>
        {f.categoria ?? "—"}
      </span>
    ),
    orden: (f) => f.categoria,
  },
  { titulo: "Vendedor", celda: (f) => f.vendedor ?? "—", orden: (f) => f.vendedor },
  { titulo: "Saldo total", celda: (f) => fmtMoneda(f.saldoTotal), numerica: true, orden: (f) => f.saldoTotal },
  { titulo: "Saldo vencido", celda: (f) => fmtMoneda(f.saldoVencido), numerica: true, orden: (f) => f.saldoVencido },
  {
    titulo: "Atraso máx.",
    celda: (f) => (f.atrasoMax == null ? "—" : `${fmtNumero(f.atrasoMax)} d`),
    numerica: true,
    orden: (f) => f.atrasoMax,
  },
];

export default function DashboardCuentasPage() {
  const [filtros, setFiltros] = useState<FiltrosCuentas>({});

  const { data, cargando, error, recargar, empezarCarga } = useDatosTablero<Respuesta>(
    "/api/cuentas-corrientes",
    filtros,
    { conOpciones: "1" },
  );

  const opciones = data?.opciones ?? null;

  const cambiar = (f: FiltrosCuentas) => {
    empezarCarga();
    setFiltros(f);
  };

  /** Click en un gráfico: suma ese valor a la selección, o lo saca. */
  const alternar = (campo: "categoria" | "vendedor") => (valor: string) =>
    cambiar({ ...filtros, [campo]: alternarValor(filtros[campo], valor) });

  const k = data?.kpis;
  const vacio = sinValores(filtros.vendedor) && sinValores(filtros.empresa) && sinValores(filtros.categoria);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <EncabezadoPagina pagina="cuentas-corrientes">
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
          etiqueta="Categoría"
          valores={filtros.categoria}
          opciones={opciones?.categorias ?? []}
          onChange={(v) => cambiar({ ...filtros, categoria: v })}
        />
        <BotonLimpiar onClick={() => cambiar({})} deshabilitado={vacio} />

        <span className="text-muted ml-auto max-w-md text-[11px] leading-tight">
          Los clientes activos/inactivos cruzan ventas con deuda por nombre normalizado:
          cubre 118 de 129 clientes (96% de la deuda).
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
          <TarjetaKpi titulo="Deuda Total" valor={fmtMoneda(k.deudaTotal)} detalle={`${fmtNumero(k.clientesTotales)} clientes`} acento={PALETA[0]} />
          <TarjetaKpi titulo="Deuda Vencida" valor={fmtMoneda(k.deudaVencida)} acento="#f43f5e" />
          <TarjetaKpi titulo="% Cartera Vencida" valor={fmtPct(k.pctCarteraVencida)} detalle="Vencida / total" acento={PALETA[2]} />
          <TarjetaKpi titulo="Clientes en Riesgo" valor={fmtNumero(k.clientesEnRiesgo)} detalle="Categoría CRÍTICO o RIESGOSO" acento={PALETA[5]} />
          <TarjetaKpi titulo="Clientes Activos (60d)" valor={fmtNumero(k.clientesActivos60d)} detalle="Compraron en los últimos 60 días" acento={PALETA[1]} />
          <TarjetaKpi titulo="Clientes Inactivos (60d)" valor={fmtNumero(k.clientesInactivos60d)} detalle="Sin compras hace más de 60 días" />
          <TarjetaKpi titulo="Vencidos que siguen comprando" valor={fmtNumero(k.clientesVencidosQueCompran)} detalle="Compraron después de entrar en mora" acento={PALETA[3]} />
          <TarjetaKpi titulo="Deuda por vencer" valor={fmtMoneda(k.deudaTotal - k.deudaVencida)} detalle="Todavía dentro del plazo" acento={PALETA[4]} />
        </div>
      ) : null}

      {data && (
        <div className={`space-y-4 transition-opacity ${cargando ? "opacity-50" : ""}`}>
          <div className="grid gap-4 xl:grid-cols-2">
            <Panel titulo="Cantidad de clientes por categoría">
              <TortaProveedores
                datos={data.clientesPorCategoria.map((d) => ({ label: d.label, total: d.valor }))}
                totalGeneral={data.clientesPorCategoria.reduce((a, d) => a + d.valor, 0)}
                seleccionados={filtros.categoria}
                onSeleccionar={alternar("categoria")}
              />
            </Panel>
            <Panel titulo="Deuda total por categoría">
              <BarrasCategoria
                datos={data.deudaPorCategoria}
                formato={fmtMonedaCorta}
                seleccionados={filtros.categoria}
                onSeleccionar={alternar("categoria")}
              />
            </Panel>
            <Panel titulo="Antigüedad de la deuda" nota="Saldo pendiente por bucket de atraso">
              <BarrasCategoria
                datos={data.aging}
                formato={fmtMonedaCorta}
                horizontal={false}
                alturaMinima={280}
                colorUnico={PALETA[2]}
              />
            </Panel>
            <Panel titulo="Saldo vencido cancelado por vendedor" nota="Clientes que salieron de mora">
              <BarrasCategoria
                datos={data.cancelacionesPorVendedor}
                formato={fmtMonedaCorta}
                colorUnico={PALETA[1]}
                seleccionados={filtros.vendedor}
                onSeleccionar={alternar("vendedor")}
              />
            </Panel>
          </div>

          <Panel titulo="Evolución del saldo vencido" nota={`${data.historial.length} períodos cargados`}>
            <BarrasCategoria
              datos={data.historial.map((d) => ({ label: fmtMes(d.label), valor: d.valor }))}
              formato={fmtMonedaCorta}
              horizontal={false}
              alturaMinima={260}
              colorUnico={PALETA[0]}
              vacio="Todavía no hay historial cargado."
            />
          </Panel>

          <Panel titulo="Clientes y Saldos" nota={`${data.clientes.length} ordenados por saldo vencido`}>
            <Tabla filas={data.clientes} columnas={COLUMNAS} clave={(f) => f.razonSocial} />
          </Panel>
        </div>
      )}
    </div>
  );
}
