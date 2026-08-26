"use client";

import { useState } from "react";
import EncabezadoPagina from "@/components/EncabezadoPagina";
import BarrasCategoria from "@/components/charts/BarrasCategoria";
import TortaProveedores from "@/components/charts/TortaProveedores";
import { BotonLimpiar, SelectorMultiple } from "@/components/SelectorFiltro";
import { nombreEmpresa } from "@/lib/constantes";
import { alternar as alternarValor, vacio as sinValores } from "@/lib/filtros";
import { sumar, Tabla, type Columna } from "@/components/Tabla";
import { Aviso, Esqueleto, Panel, TarjetaKpi } from "@/components/ui";
import {
  fmtMes,
  fmtMoneda,
  fmtMonedaCorta,
  fmtNumero,
  fmtPct,
} from "@/lib/format";
import { PALETA } from "@/lib/paleta";
import { useDatosTablero } from "@/lib/useDatosTablero";
import type {
  DashboardCuentas,
  FilaCliente,
  FiltrosCuentas,
  OpcionesCuentas,
} from "@/lib/types";

type Respuesta = DashboardCuentas & { opciones: OpcionesCuentas | null };

/** Colores fijos por categoría: el semáforo tiene que leerse igual siempre. */
const COLOR_CATEGORIA: Record<string, string> = {
  "AL DÍA": PALETA[1],
  BUENO: PALETA[4],
  OBSERVACIÓN: PALETA[2],
  RIESGOSO: PALETA[5],
  CRÍTICO: "#f43f5e",
};

function columnas(filas: FilaCliente[]): Columna<FilaCliente>[] {
  return [
    {
      titulo: "Cliente",
      celda: (f) => (
        <span className="block max-w-[260px] truncate">{f.razonSocial}</span>
      ),
      orden: (f) => f.razonSocial,
    },
    {
      titulo: "Categoría",
      celda: (f) => (
        <span
          style={{ color: COLOR_CATEGORIA[f.categoria ?? ""] ?? undefined }}
        >
          {f.categoria ?? "—"}
        </span>
      ),
      orden: (f) => f.categoria,
    },
    {
      titulo: "Vendedor",
      celda: (f) => f.vendedor ?? "—",
      orden: (f) => f.vendedor,
    },
    {
      titulo: "Saldo total",
      celda: (f) => fmtMoneda(f.saldoTotal),
      numerica: true,
      orden: (f) => f.saldoTotal,
      total: fmtMoneda(sumar(filas, (f) => f.saldoTotal)),
    },
    {
      titulo: "Saldo vencido",
      celda: (f) => fmtMoneda(f.saldoVencido),
      numerica: true,
      orden: (f) => f.saldoVencido,
      total: fmtMoneda(sumar(filas, (f) => f.saldoVencido)),
    },
    {
      titulo: "Atraso máx.",
      celda: (f) => (f.atrasoMax == null ? "—" : `${fmtNumero(f.atrasoMax)} d`),
      numerica: true,
      orden: (f) => f.atrasoMax,
      // El PEOR de la lista, no una suma ni un promedio: "atraso máximo" del
      // conjunto es el del cliente más atrasado. Sumar días de clientes distintos
      // no sería nada, y el promedio escondería justo al que hay que llamar.
      total: (() => {
        const conDato = filas.filter((f) => f.atrasoMax != null);
        return conDato.length === 0
          ? "—"
          : `${fmtNumero(Math.max(...conDato.map((f) => f.atrasoMax as number)))} d`;
      })(),
    },
  ];
}

/**
 * Cómo se arma el estado de cada cliente.
 *
 * La regla la calcula el Apps Script de Cuentas Corrientes al escribir
 * `bronze.cuentas_corrientes_scoring`; acá solo se explica. Si allá cambia el
 * criterio, esto queda mintiendo — ya pasó una vez.
 *
 * Son DOS pasos y después una grilla, y ese orden importa: la tolerancia de 15
 * días se evalúa ANTES que la exposición, así que un cliente con pocos días de
 * atraso queda "al día" aunque deba el 100 % del saldo.
 *
 * Ojo con los dos nombres, que se leen al revés de lo que parece: BUENO es el
 * mejor estado (no debe nada vencido) y AL DÍA es el que SÍ debe, pero dentro
 * de la tolerancia.
 *
 * Verificado contra los 122 clientes cargados: coinciden los 122.
 */
const PASOS_LEYENDA: {
  pregunta: string;
  detalle: string;
  estado: string;
  tono: keyof typeof TONO_ESTADO;
}[] = [
  {
    pregunta: "¿Sin facturas vencidas?",
    detalle: "no debe nada atrasado",
    estado: "Bueno",
    tono: "bueno",
  },
  {
    pregunta: "¿Atraso de 15 días o menos?",
    detalle: "tolerancia interna",
    estado: "Al día",
    tono: "aldia",
  },
];

const COLUMNAS_LEYENDA = ["Exposición ≤ 60 %", "Exposición > 60 %"] as const;

const FILAS_LEYENDA: {
  atraso: string;
  estados: [string, keyof typeof TONO_ESTADO][];
}[] = [
  {
    atraso: "Atraso 16 a 30 días",
    estados: [
      ["Observación", "observacion"],
      ["Riesgoso", "riesgoso"],
    ],
  },
  {
    atraso: "Atraso de más de 30 días",
    estados: [
      ["Riesgoso", "riesgoso"],
      ["Crítico", "critico"],
    ],
  },
];

const TONO_ESTADO = {
  bueno: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  aldia: "border-sky-500/40 bg-sky-500/10 text-sky-300",
  observacion: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  riesgoso: "border-rose-500/30 bg-rose-500/10 text-rose-300",
  critico: "border-rose-500/60 bg-rose-500/20 text-rose-200",
} as const;

function LeyendaEstados() {
  return (
    <div className="border-line mt-4 border-t pt-4">
      <p className="text-muted mb-3 text-[11px] leading-tight">
        Se pregunta en este orden. Los dos primeros cortan solos; recién si el
        cliente no entra en ninguno pesa <strong>cuánto</strong> del saldo tiene
        vencido.
      </p>

      <div className="mb-3 flex flex-col gap-1.5">
        {PASOS_LEYENDA.map((paso, i) => (
          <div
            key={paso.estado}
            className="flex items-center gap-2 text-[11px]"
          >
            <span className="text-muted w-4 shrink-0 tabular-nums">
              {i + 1}.
            </span>
            <span className="flex-1">
              {paso.pregunta}{" "}
              <span className="text-muted">— {paso.detalle}</span>
            </span>
            <span className="text-muted shrink-0">→</span>
            <span
              className={`w-28 shrink-0 rounded-lg border px-2 py-1 text-center font-medium ${TONO_ESTADO[paso.tono]}`}
            >
              {paso.estado}
            </span>
          </div>
        ))}
      </div>

      <p className="text-muted mb-2 text-[11px] leading-tight">
        Si el atraso pasa los 15 días, el estado sale de cruzar la antigüedad
        con la exposición:
      </p>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[440px] border-separate border-spacing-1 text-[11px]">
          <thead>
            <tr>
              <th className="w-40" />
              {COLUMNAS_LEYENDA.map((c) => (
                <th key={c} className="text-muted text-center font-normal">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {FILAS_LEYENDA.map((fila) => (
              <tr key={fila.atraso}>
                <th className="text-muted text-left font-normal whitespace-nowrap">
                  {fila.atraso}
                </th>
                {fila.estados.map(([nombre, tono], i) => (
                  <td key={i} className="p-0">
                    <div
                      className={`rounded-lg border px-2 py-2.5 text-center font-medium ${TONO_ESTADO[tono]}`}
                    >
                      {nombre}
                    </div>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-muted mt-3 text-[11px] leading-tight">
        La <strong>exposición</strong> es qué parte del saldo del cliente está
        vencida. Y ojo con los nombres: <strong>Bueno</strong> es el mejor
        estado — no debe nada vencido —, mientras que <strong>Al día</strong> sí
        debe, pero dentro de los 15 días de tolerancia.
      </p>
    </div>
  );
}

export default function DashboardCuentasPage() {
  const [filtros, setFiltros] = useState<FiltrosCuentas>({});

  const { data, cargando, error, recargar, empezarCarga } =
    useDatosTablero<Respuesta>("/api/cuentas-corrientes", filtros, {
      conOpciones: "1",
    });

  const opciones = data?.opciones ?? null;

  const cambiar = (f: FiltrosCuentas) => {
    empezarCarga();
    setFiltros(f);
  };

  /** Click en un gráfico: suma ese valor a la selección, o lo saca. */
  const alternar = (campo: "categoria" | "vendedor") => (valor: string) =>
    cambiar({ ...filtros, [campo]: alternarValor(filtros[campo], valor) });

  const k = data?.kpis;
  const vacio =
    sinValores(filtros.vendedor) &&
    sinValores(filtros.empresa) &&
    sinValores(filtros.categoria);

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

      {/* Va arriba de todo y no como nota al pie de un panel a propósito: la
          hora que muestra el encabezado es la de ESTA consulta, no la de los
          datos. Sin esta aclaración se lee que la deuda está al minuto, y no
          lo está — la planilla de cuentas corrientes se refresca una vez por
          día, y adentro de ese día lo que manda es cuándo se asentó cada
          cobranza. */}
      <div className="border-line bg-panel-2 text-muted flex items-start gap-2 rounded-xl border p-3 text-xs leading-tight">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          className="mt-px size-4 shrink-0"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M12 8h.01M11 12h1v4h1" />
        </svg>
        <span>
          El estado de los datos depende de cuándo se hayan asentado las
          cobranzas. La información se actualiza{" "}
          <strong>una vez al día, a primera hora</strong>.
        </span>
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
          formato={nombreEmpresa}
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
          Los clientes activos/inactivos cruzan ventas con deuda por nombre
          normalizado: cubre 118 de 129 clientes (96% de la deuda).
        </span>
      </div>

      {error && (
        <Aviso>
          <p className="font-medium">No se pudieron leer los datos.</p>
          <p className="mt-1 font-mono text-xs break-words opacity-80">
            {error}
          </p>
        </Aviso>
      )}

      {!k && !error ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => (
            <Esqueleto key={i} className="h-[86px]" />
          ))}
        </div>
      ) : k ? (
        <div
          className={`grid gap-3 transition-opacity sm:grid-cols-2 lg:grid-cols-4 ${cargando ? "opacity-50" : ""}`}
        >
          <TarjetaKpi
            titulo="Deuda Total"
            valor={fmtMoneda(k.deudaTotal)}
            detalle={`${fmtNumero(k.clientesTotales)} clientes`}
            acento={PALETA[0]}
          />
          <TarjetaKpi
            titulo="Deuda Vencida"
            valor={fmtMoneda(k.deudaVencida)}
            acento="#f43f5e"
          />
          <TarjetaKpi
            titulo="% Cartera Vencida"
            valor={fmtPct(k.pctCarteraVencida)}
            detalle="Vencida / total"
            acento={PALETA[2]}
          />
          <TarjetaKpi
            titulo="Clientes en Riesgo"
            valor={fmtNumero(k.clientesEnRiesgo)}
            detalle="Categoría CRÍTICO o RIESGOSO"
            acento={PALETA[5]}
          />
          <TarjetaKpi
            titulo="Clientes Activos (60d)"
            valor={fmtNumero(k.clientesActivos60d)}
            detalle="Compraron en los últimos 60 días"
            acento={PALETA[1]}
          />
          <TarjetaKpi
            titulo="Clientes Inactivos (60d)"
            valor={fmtNumero(k.clientesInactivos60d)}
            detalle="Sin compras hace más de 60 días"
          />
          <TarjetaKpi
            titulo="Vencidos que siguen comprando"
            valor={fmtNumero(k.clientesVencidosQueCompran)}
            detalle="Compraron después de entrar en mora"
            acento={PALETA[3]}
          />
          <TarjetaKpi
            titulo="Deuda por vencer"
            valor={fmtMoneda(k.deudaTotal - k.deudaVencida)}
            detalle="Todavía dentro del plazo"
            acento={PALETA[4]}
          />
        </div>
      ) : null}

      {data && (
        <div
          className={`space-y-4 transition-opacity ${cargando ? "opacity-50" : ""}`}
        >
          <div className="grid gap-4 xl:grid-cols-2">
            <Panel titulo="Cantidad de clientes por categoría">
              <TortaProveedores
                datos={data.clientesPorCategoria.map((d) => ({
                  label: d.label,
                  total: d.valor,
                }))}
                totalGeneral={data.clientesPorCategoria.reduce(
                  (a, d) => a + d.valor,
                  0,
                )}
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
            <Panel
              titulo="Antigüedad de la deuda"
              nota="Saldo pendiente por bucket de atraso"
            >
              <BarrasCategoria
                datos={data.aging}
                formato={fmtMonedaCorta}
                horizontal={false}
                alturaMinima={280}
                colorUnico={PALETA[2]}
              />
            </Panel>
            <Panel
              titulo="Saldo vencido cancelado por vendedor"
              nota="Clientes que salieron de mora"
            >
              <BarrasCategoria
                datos={data.cancelacionesPorVendedor}
                formato={fmtMonedaCorta}
                colorUnico={PALETA[1]}
                seleccionados={filtros.vendedor}
                onSeleccionar={alternar("vendedor")}
              />
            </Panel>
          </div>

          <Panel
            titulo="Evolución del saldo vencido"
            nota={`${data.historial.length} períodos cargados`}
          >
            <BarrasCategoria
              datos={data.historial.map((d) => ({
                label: fmtMes(d.label),
                valor: d.valor,
              }))}
              formato={fmtMonedaCorta}
              horizontal={false}
              alturaMinima={260}
              colorUnico={PALETA[0]}
              vacio="Todavía no hay historial cargado."
            />
          </Panel>

          <Panel
            titulo="Clientes y Saldos"
            nota={`${data.clientes.length} ordenados por saldo vencido`}
          >
            {/* Click en una fila filtra por su CATEGORÍA, que es la dimensión de
                esta tabla que ya existe como filtro y a la que responden los
                KPIs de arriba. Filtrar por el cliente suelto dejaría un tablero
                de una fila, que es lo que ya se está mirando. */}
            <Tabla
              filas={data.clientes}
              columnas={columnas(data.clientes)}
              clave={(f) => f.razonSocial}
              onClickFila={(f) =>
                f.categoria && alternar("categoria")(f.categoria)
              }
              activa={(f) =>
                filtros.categoria?.length
                  ? filtros.categoria.includes(f.categoria ?? "")
                  : false
              }
            />
            <LeyendaEstados />
          </Panel>
        </div>
      )}
    </div>
  );
}
