"use client";

import { useState } from "react";
import { sumar, Tabla, type Columna } from "@/components/Tabla";
import { Aviso, Esqueleto, Panel, TarjetaKpi } from "@/components/ui";
import { fmtFechaCorta, fmtMoneda, fmtNumero } from "@/lib/format";
import {
  MOTIVOS_DESESTIMAR,
  RESPUESTAS,
  respuestaDe,
  type ClaveRespuesta,
  type DashboardTareasMeli,
  type FilaDescarte,
} from "@/lib/tareas-meli";
import { useDatosTablero } from "@/lib/useDatosTablero";

/**
 * "Mis tareas": la bandeja del responsable de Mercado Libre.
 *
 * Por ahora una sola regla, riesgo de descarte en Full. La pantalla separa lo
 * PENDIENTE de lo ya contestado: la primera tabla es la lista de trabajo, la
 * segunda es para ver qué se decidió y cuándo vuelve a revisarse.
 */

type Props = { puedeContestar: boolean };

function Respondida({ f }: { f: FilaDescarte }) {
  if (!f.ultima) return <span className="text-muted">—</span>;
  const r = respuestaDe(f.ultima.respuesta);
  return (
    <span className="text-xs" title={f.ultima.nota ?? undefined}>
      {r?.label ?? f.ultima.respuesta}
      {f.ultima.motivo ? ` · ${f.ultima.motivo}` : ""}
      <span className="text-muted">
        {" "}
        · {f.ultima.usuario.split("@")[0]} {fmtFechaCorta(f.ultima.creadoEn.slice(0, 10))}
        {f.ultima.vigente ? `, vuelve el ${fmtFechaCorta(f.ultima.venceEn)}` : ", venció"}
      </span>
    </span>
  );
}

/** Los botones de una fila, con el motivo y la nota que piden. */
function Contestar({ f, alGuardar }: { f: FilaDescarte; alGuardar: () => void }) {
  const [elegida, setElegida] = useState<ClaveRespuesta | null>(null);
  const [motivo, setMotivo] = useState("");
  const [nota, setNota] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const r = elegida ? respuestaDe(elegida) : null;

  async function guardar() {
    if (!r) return;
    setGuardando(true);
    setError(null);
    try {
      const res = await fetch("/api/tareas-meli", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sku: f.sku, respuesta: r.clave, motivo, nota }),
      });
      const cuerpo = await res.json().catch(() => null);
      if (!res.ok) throw new Error(cuerpo?.error ?? `Error ${res.status}`);
      alGuardar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar");
      setGuardando(false);
    }
  }

  if (!r) {
    return (
      <div className="flex flex-wrap gap-1">
        {RESPUESTAS.map((x) => (
          <button
            key={x.clave}
            type="button"
            onClick={() => setElegida(x.clave)}
            className="border-line hover:bg-panel-2 rounded-md border px-2 py-0.5 text-xs whitespace-nowrap"
          >
            {x.label}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="flex min-w-64 flex-col gap-1.5">
      <span className="text-xs font-medium">{r.label}</span>
      {r.pideMotivo && (
        <select
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          className="border-line bg-panel rounded-md border px-1.5 py-1 text-xs"
        >
          <option value="">Elegí un motivo…</option>
          {MOTIVOS_DESESTIMAR.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      )}
      <input
        value={nota}
        onChange={(e) => setNota(e.target.value)}
        placeholder="Nota (opcional): qué hiciste"
        maxLength={1000}
        className="border-line bg-panel rounded-md border px-1.5 py-1 text-xs"
      />
      {error && <span className="text-xs text-rose-300">{error}</span>}
      <div className="flex gap-1">
        <button
          type="button"
          disabled={guardando || (r.pideMotivo && !motivo)}
          onClick={guardar}
          className="rounded-md bg-sky-600 px-2 py-0.5 text-xs text-white disabled:opacity-50"
        >
          {guardando ? "Guardando…" : "Guardar"}
        </button>
        <button
          type="button"
          disabled={guardando}
          onClick={() => {
            setElegida(null);
            setError(null);
          }}
          className="border-line rounded-md border px-2 py-0.5 text-xs"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}

export default function TareasMeli({ puedeContestar }: Props) {
  const { data, cargando, error, recargar } = useDatosTablero<DashboardTareasMeli>(
    "/api/tareas-meli",
    {},
  );

  if (error) return <Aviso>No se pudieron cargar las tareas: {error}</Aviso>;
  if (!data) {
    return (
      <div className="grid gap-3">
        <Esqueleto className="h-24" />
        <Esqueleto className="h-96" />
      </div>
    );
  }

  const { regla } = data;
  const pendientes = data.filas.filter((f) => !f.ultima?.vigente);
  const contestadas = data.filas.filter((f) => f.ultima?.vigente);
  const semana = (c: ClaveRespuesta) =>
    data.semana.find((s) => s.respuesta === c)?.cantidad ?? 0;

  const columnas = (conAcciones: boolean): Columna<FilaDescarte>[] => [
    {
      titulo: "Artículo",
      celda: (f) => (
        <div className="max-w-72">
          <div className="font-mono text-xs">{f.sku}</div>
          <div className="text-muted truncate text-xs">{f.producto ?? "—"}</div>
        </div>
      ),
      orden: (f) => f.sku,
    },
    { titulo: "Proveedor", celda: (f) => f.proveedor ?? "—", orden: (f) => f.proveedor },
    {
      titulo: `U. +${regla.diasEnFull} días`,
      ayuda:
        `Unidades en Full con más de ${regla.diasEnFull} días, por FIFO. Con un asterisco, ` +
        "la historia no alcanzó para fechar todas: el número es un piso.",
      celda: (f) => `${fmtNumero(f.uRiesgo)}${f.parcial ? " *" : ""}`,
      orden: (f) => f.uRiesgo,
      numerica: true,
      total: fmtNumero(sumar(pendientes, (f) => f.uRiesgo)),
    },
    {
      titulo: "Valor en riesgo",
      ayuda: "Esas unidades al último costo vigente.",
      celda: (f) => fmtMoneda(f.valorRiesgo),
      orden: (f) => f.valorRiesgo,
      numerica: true,
    },
    {
      titulo: "En Full",
      ayuda: "Todas las unidades aptas del SKU en Full, viejas o no.",
      celda: (f) => fmtNumero(f.uFull),
      orden: (f) => f.uFull,
      numerica: true,
    },
    {
      titulo: "Días sin venta",
      ayuda: "Desde la última venta por Mercado Libre. Vacío: nunca vendió desde que hay datos.",
      celda: (f) =>
        f.diasSinVenta == null ? (
          <span className="text-rose-300">Nunca vendió</span>
        ) : (
          fmtNumero(f.diasSinVenta)
        ),
      orden: (f) => f.diasSinVenta ?? Number.MAX_SAFE_INTEGER,
      numerica: true,
    },
    conAcciones && puedeContestar
      ? {
          titulo: "Respuesta",
          celda: (f) => <Contestar key={f.sku} f={f} alGuardar={recargar} />,
        }
      : { titulo: "Última respuesta", celda: (f) => <Respondida f={f} /> },
  ];

  return (
    <div className={`grid gap-4 ${cargando ? "opacity-60" : ""}`}>
      {!data.respuestasDisponibles && (
        <Aviso tono="alerta">
          Todavía no se pueden guardar respuestas: falta crear la tabla en la base
          (migraciones/tareas_meli.sql). Las alertas se ven igual.
        </Aviso>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <TarjetaKpi
          titulo="Pendientes"
          valor={fmtNumero(pendientes.length)}
          detalle={`${fmtMoneda(sumar(pendientes, (f) => f.valorRiesgo))} en riesgo`}
        />
        {RESPUESTAS.map((r) => (
          <TarjetaKpi
            key={r.clave}
            titulo={`${r.label} · 7 días`}
            valor={fmtNumero(semana(r.clave))}
          />
        ))}
      </div>

      <Panel
        titulo="Riesgo de descarte en Full"
        nota={
          `Artículos con unidades de más de ${regla.diasEnFull} días en Full que no venden por ` +
          `Mercado Libre hace ${regla.diasSinVenta} días o más. Mercado Libre no informa el ` +
          "riesgo de descarte: sale de la antigüedad que calcula el pipeline" +
          (data.foto ? ` (foto del ${fmtFechaCorta(data.foto)}).` : ".") +
          " Si el stock sale de Full, la alerta se cierra sola."
        }
      >
        <Tabla
          filas={pendientes}
          columnas={columnas(true)}
          clave={(f) => f.sku}
          fijas={1}
          vacio="No hay artículos pendientes de revisar."
          etiquetaTotal={
            data.recortada
              ? `${fmtNumero(pendientes.length)} pendientes (las más caras: hay más)`
              : `${fmtNumero(pendientes.length)} pendientes`
          }
        />
      </Panel>

      {contestadas.length > 0 && (
        <Panel
          titulo="Ya contestadas"
          nota="Siguen cumpliendo la regla, pero tienen una respuesta vigente. Cuando venza, si siguen igual, vuelven a pendientes."
        >
          <Tabla
            filas={contestadas}
            columnas={columnas(false)}
            clave={(f) => f.sku}
            fijas={1}
          />
        </Panel>
      )}
    </div>
  );
}
