"use client";

import { useState } from "react";
import { ListaAvance } from "@/components/BarraAvance";
import { BotonLimpiar, SelectorFiltro } from "@/components/SelectorFiltro";
import { Tabla, type Columna } from "@/components/Tabla";
import { Aviso, Esqueleto, Panel, TarjetaKpi } from "@/components/ui";
import { fmtMes, fmtNumero, fmtPct } from "@/lib/format";
import { PALETA } from "@/lib/paleta";
import { useDatosTablero } from "@/lib/useDatosTablero";
import type {
  DashboardObjetivos,
  FilaAporteSku,
  FilaObjetivo,
  FiltrosObjetivos,
  OpcionesObjetivos,
} from "@/lib/types";

type Respuesta = DashboardObjetivos & { opciones: OpcionesObjetivos | null };

const COLUMNAS_DETALLE: Columna<FilaObjetivo>[] = [
  { titulo: "Grupo", celda: (f) => f.grupo },
  { titulo: "Vendedor", celda: (f) => f.vendedor ?? "—" },
  { titulo: "Objetivo", celda: (f) => fmtNumero(f.objetivo), numerica: true },
  { titulo: "Vendido", celda: (f) => fmtNumero(f.vendido), numerica: true },
  { titulo: "Faltan", celda: (f) => fmtNumero(f.faltan), numerica: true },
  {
    titulo: "Avance",
    numerica: true,
    celda: (f) => (
      <span style={f.objetivo > 0 && f.vendido >= f.objetivo ? { color: PALETA[1] } : undefined}>
        {fmtPct(f.avancePct)}
      </span>
    ),
  },
];

const COLUMNAS_SKU: Columna<FilaAporteSku>[] = [
  { titulo: "Grupo", celda: (f) => f.grupo },
  { titulo: "SKU", celda: (f) => f.sku ?? "—" },
  {
    titulo: "Producto",
    celda: (f) => <span className="block max-w-[420px] truncate">{f.producto ?? "—"}</span>,
  },
  { titulo: "Unidades", celda: (f) => fmtNumero(f.vendido), numerica: true },
];

export default function DashboardObjetivosPage() {
  const [filtros, setFiltros] = useState<FiltrosObjetivos>({});

  const { data, cargando, error, recargar, empezarCarga } = useDatosTablero<Respuesta>(
    "/api/objetivos",
    filtros as Record<string, string | undefined>,
    { conOpciones: "1" },
  );

  const opciones = data?.opciones ?? null;

  const cambiar = (f: FiltrosObjetivos) => {
    empezarCarga();
    setFiltros(f);
  };

  /** Click en una barra: aplica el valor, o lo saca si ya estaba puesto. */
  const alternar = (campo: "grupo" | "vendedor") => (valor: string) =>
    cambiar({ ...filtros, [campo]: filtros[campo] === valor ? undefined : valor });

  const k = data?.kpis;
  const vacio = !filtros.mes && !filtros.vendedor && !filtros.grupo;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Objetivos</h1>
          <p className="text-muted mt-1 text-xs">
            {data
              ? `Actualizado ${new Date(data.generadoEn).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}`
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

      <div className="border-line bg-panel flex flex-wrap items-end gap-3 rounded-xl border p-3">
        <SelectorFiltro
          etiqueta="Mes comercial"
          valor={filtros.mes}
          opciones={opciones?.meses ?? []}
          onChange={(v) => cambiar({ ...filtros, mes: v })}
          formato={fmtMes}
        />
        <SelectorFiltro
          etiqueta="Vendedor"
          valor={filtros.vendedor}
          opciones={opciones?.vendedores ?? []}
          onChange={(v) => cambiar({ ...filtros, vendedor: v })}
        />
        <SelectorFiltro
          etiqueta="Grupo"
          valor={filtros.grupo}
          opciones={opciones?.grupos ?? []}
          onChange={(v) => cambiar({ ...filtros, grupo: v })}
        />
        <BotonLimpiar onClick={() => cambiar({})} deshabilitado={vacio} />

        <span className="text-muted ml-auto max-w-md text-[11px] leading-tight">
          Solo canal Mayorista. Un MIX se mide sobre la suma de sus SKUs, no SKU por SKU.
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
          {Array.from({ length: 4 }, (_, i) => (
            <Esqueleto key={i} className="h-[86px]" />
          ))}
        </div>
      ) : k ? (
        <div
          className={`grid gap-3 transition-opacity sm:grid-cols-2 lg:grid-cols-4 ${cargando ? "opacity-50" : ""}`}
        >
          <TarjetaKpi
            titulo="Objetivo (unidades)"
            valor={fmtNumero(k.objetivo)}
            detalle={`${fmtNumero(k.pares)} objetivos cargados`}
          />
          <TarjetaKpi titulo="Vendido (unidades)" valor={fmtNumero(k.vendido)} acento={PALETA[0]} />
          <TarjetaKpi
            titulo="Avance"
            valor={fmtPct(k.avancePct)}
            detalle={`Faltan ${fmtNumero(Math.max(k.objetivo - k.vendido, 0))} unidades`}
            acento={k.avancePct != null && k.avancePct >= 1 ? PALETA[1] : PALETA[2]}
          />
          <TarjetaKpi
            titulo="Objetivos cumplidos"
            valor={`${fmtNumero(k.cumplidos)} / ${fmtNumero(k.pares)}`}
            detalle="Pares vendedor × grupo al 100%"
            acento={PALETA[1]}
          />
        </div>
      ) : null}

      {data && (
        <div className={`space-y-4 transition-opacity ${cargando ? "opacity-50" : ""}`}>
          <div className="grid gap-4 xl:grid-cols-2">
            <Panel titulo="Avance por grupo" nota="Click para filtrar">
              <ListaAvance
                filas={data.porGrupo}
                etiqueta={(f) => f.grupo}
                seleccionado={filtros.grupo}
                onSeleccionar={alternar("grupo")}
              />
            </Panel>
            <Panel titulo="Avance por vendedor" nota="Click para filtrar">
              <ListaAvance
                filas={data.porVendedor}
                etiqueta={(f) => f.vendedor ?? "—"}
                seleccionado={filtros.vendedor}
                onSeleccionar={alternar("vendedor")}
              />
            </Panel>
          </div>

          <Panel titulo="Detalle por vendedor y grupo" nota={`${data.detalle.length} filas`}>
            <Tabla
              filas={data.detalle}
              columnas={COLUMNAS_DETALLE}
              clave={(f) => `${f.grupo}-${f.vendedor}`}
            />
          </Panel>

          <Panel
            titulo="Qué SKU aporta a cada grupo"
            nota="Unidades vendidas dentro del recorte elegido"
          >
            <Tabla
              filas={data.aportesSku}
              columnas={COLUMNAS_SKU}
              clave={(f, i) => `${f.grupo}-${f.sku}-${i}`}
              vacio="Todavía no hay ventas de estos productos en el recorte elegido."
            />
          </Panel>
        </div>
      )}
    </div>
  );
}
