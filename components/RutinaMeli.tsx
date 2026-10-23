"use client";

import { useState } from "react";
import { Aviso, Esqueleto, Panel, TarjetaKpi } from "@/components/ui";
import { fmtFechaCorta, fmtNumero, fmtPct } from "@/lib/format";
import {
  FERIADO,
  INICIO_RUTINA,
  TAREAS_RUTINA,
  cumplimiento,
  diasDeSemana,
  lunesDe,
  sumarDias,
  vecesEnDia,
  type DashboardRutinaMeli,
  type EstadoRutina,
  type MarcaRutina,
  type TareaRutina,
} from "@/lib/rutina-meli";
import { useDatosTablero } from "@/lib/useDatosTablero";

/**
 * La planilla de rutina de "Mis tareas": una fila por tarea, una columna por
 * día hábil de la semana, como la de papel.
 *
 * Tocar un casillero lo selecciona y abre abajo el editor (hecho / no
 * correspondía / vaciar, más la nota). Es un paso más que un tilde directo,
 * pero en papel la nota se escribía en el mismo casillero, y sin editor no
 * habría dónde.
 */

const NOMBRES_DIA = ["Lun", "Mar", "Mié", "Jue", "Vie"];

type Casillero = { fecha: string; tarea: string; vez: number };

type Props = {
  puedeContestar: boolean;
  /** Alertas de riesgo de descarte sin contestar; `null` mientras carga. */
  pendientesDescarte: number | null;
};

const mismo = (a: Casillero | null, b: Casillero) =>
  a != null && a.fecha === b.fecha && a.tarea === b.tarea && a.vez === b.vez;

function Editor({
  casillero,
  tarea,
  marca,
  alGuardar,
  alCerrar,
}: {
  casillero: Casillero;
  tarea: string;
  marca: MarcaRutina | undefined;
  alGuardar: () => void;
  alCerrar: () => void;
}) {
  const [nota, setNota] = useState(marca?.nota ?? "");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guardar(estado: EstadoRutina | null) {
    setGuardando(true);
    setError(null);
    try {
      const res = await fetch("/api/tareas-meli/rutina", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...casillero, estado, nota }),
      });
      const cuerpo = await res.json().catch(() => null);
      if (!res.ok) throw new Error(cuerpo?.error ?? `Error ${res.status}`);
      alGuardar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar");
    } finally {
      setGuardando(false);
    }
  }

  const boton = "rounded-md border border-line px-2.5 py-1 text-xs disabled:opacity-50";

  return (
    <div className="border-line bg-panel-2 mt-3 flex flex-wrap items-center gap-2 rounded-xl border p-3">
      <span className="text-sm font-medium">
        {tarea}
        {casillero.vez > 1 ? ` (${casillero.vez}ª vez)` : ""} · {fmtFechaCorta(casillero.fecha)}
      </span>
      <button type="button" disabled={guardando} onClick={() => guardar("hecho")} className={`${boton} bg-emerald-600/20`}>
        ✓ Hecho
      </button>
      <button type="button" disabled={guardando} onClick={() => guardar("no_correspondia")} className={boton}>
        — No correspondía
      </button>
      {marca && (
        <button type="button" disabled={guardando} onClick={() => guardar(null)} className={boton}>
          Vaciar
        </button>
      )}
      <input
        value={nota}
        onChange={(e) => setNota(e.target.value)}
        placeholder="Nota (ej.: HOLA cuotas)"
        maxLength={200}
        className="border-line bg-panel min-w-48 flex-1 rounded-md border px-2 py-1 text-xs"
      />
      <button type="button" onClick={alCerrar} className="text-muted text-xs underline">
        Cerrar
      </button>
      {marca && (
        <span className="text-muted w-full text-[11px]">
          Marcado por {marca.usuario.split("@")[0]} el {fmtFechaCorta(marca.actualizadoEn.slice(0, 10))}{" "}
          a las {marca.actualizadoEn.slice(11)}
        </span>
      )}
      {error && <span className="w-full text-xs text-rose-300">{error}</span>}
    </div>
  );
}

export default function RutinaMeli({ puedeContestar, pendientesDescarte }: Props) {
  const [semana, setSemana] = useState<string | undefined>(undefined);
  const [elegido, setElegido] = useState<Casillero | null>(null);
  const { data, cargando, error, recargar, empezarCarga } = useDatosTablero<DashboardRutinaMeli>(
    "/api/tareas-meli/rutina",
    { semana },
  );

  if (error) return <Aviso>No se pudo cargar la rutina: {error}</Aviso>;
  if (!data) return <Esqueleto className="h-96" />;

  const { hoy, lunes, marcas } = data;
  const dias = diasDeSemana(lunes);
  const esSemanaActual = lunes === lunesDe(hoy);
  const marca = (c: Casillero) =>
    marcas.find((m) => m.fecha === c.fecha && m.tarea === c.tarea && m.vez === c.vez);
  const feriados = new Set(marcas.filter((m) => m.tarea === FERIADO).map((m) => m.fecha));
  const total = cumplimiento(dias, hoy, marcas);
  const pct = (c: { esperados: number; hechos: number; noCorrespondia: number }) =>
    c.esperados ? (c.hechos + c.noCorrespondia) / c.esperados : null;

  const irA = (lunesNuevo: string) => {
    setElegido(null);
    empezarCarga();
    setSemana(lunesNuevo);
  };

  async function alternarFeriado(fecha: string) {
    const res = await fetch("/api/tareas-meli/rutina", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fecha,
        tarea: FERIADO,
        vez: 1,
        estado: feriados.has(fecha) ? null : "no_correspondia",
      }),
    });
    if (res.ok) recargar();
  }

  function celda(t: TareaRutina, fecha: string) {
    const veces = vecesEnDia(t, fecha);
    if (veces === 0 || feriados.has(fecha)) return null;
    const futuro = fecha > hoy;

    return (
      <div className="flex justify-center gap-1">
        {Array.from({ length: veces }, (_, i) => {
          const c = { fecha, tarea: t.clave, vez: i + 1 };
          const m = marca(c);
          const [texto, clase] =
            m?.estado === "hecho"
              ? ["✓", "bg-emerald-500/25 text-emerald-200 border-emerald-500/40"]
              : m?.estado === "no_correspondia"
                ? ["—", "text-muted border-line"]
                : fecha < hoy && fecha >= INICIO_RUTINA
                  ? ["·", "border-amber-500/50 text-amber-300"]
                  : ["", "border-line"];
          return (
            <button
              key={c.vez}
              type="button"
              disabled={futuro || !puedeContestar}
              title={m?.nota ?? undefined}
              onClick={() => setElegido(mismo(elegido, c) ? null : c)}
              className={`relative h-6 w-6 rounded border text-xs disabled:cursor-default disabled:opacity-40 ${clase} ${
                mismo(elegido, c) ? "ring-2 ring-sky-400" : ""
              }`}
            >
              {texto}
              {m?.nota && <span className="absolute -top-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-sky-400" />}
            </button>
          );
        })}
      </div>
    );
  }

  const tareaElegida = elegido ? TAREAS_RUTINA.find((t) => t.clave === elegido.tarea) : null;

  return (
    <div className={`grid gap-4 ${cargando ? "opacity-60" : ""}`}>
      {!data.disponible && (
        <Aviso tono="alerta">
          Todavía no se puede guardar la rutina: falta crear la tabla en la base
          (migraciones/tareas_meli_rutina.sql).
        </Aviso>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <TarjetaKpi
          titulo="Cumplimiento de la semana"
          valor={pct(total) == null ? "—" : fmtPct(pct(total))}
          detalle="Hechos y no correspondía, sobre lo que correspondía hasta ayer y lo marcado hoy"
        />
        <TarjetaKpi titulo="Hechos" valor={fmtNumero(total.hechos)} />
        <TarjetaKpi titulo="No correspondía" valor={fmtNumero(total.noCorrespondia)} />
        <TarjetaKpi titulo="Quedaron pendientes" valor={fmtNumero(total.pendientes)} />
      </div>

      <Panel
        titulo={`Rutina · semana del ${fmtFechaCorta(lunes)}`}
        nota="✓ hecho · — no correspondía · punto naranja: quedó pendiente. El punto azul es una nota: pasá el mouse para leerla."
      >
        <div className="mb-3 flex items-center gap-2 text-xs">
          <button type="button" onClick={() => irA(sumarDias(lunes, -7))} className="border-line rounded-md border px-2 py-1">
            ← Anterior
          </button>
          <button
            type="button"
            disabled={esSemanaActual}
            onClick={() => irA(sumarDias(lunes, 7))}
            className="border-line rounded-md border px-2 py-1 disabled:opacity-40"
          >
            Siguiente →
          </button>
          {!esSemanaActual && (
            <button type="button" onClick={() => irA(lunesDe(hoy))} className="text-sky-300 underline">
              Volver a esta semana
            </button>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="text-muted text-xs">
                <th className="bg-panel sticky left-0 py-2 pr-3 text-left font-normal">Tarea</th>
                {dias.map((d, i) => (
                  <th key={d} className={`px-2 py-2 font-normal ${d === hoy ? "text-sky-300" : ""}`}>
                    <div>
                      {NOMBRES_DIA[i]} {fmtFechaCorta(d)}
                    </div>
                    {puedeContestar && d <= hoy && (
                      <button type="button" onClick={() => alternarFeriado(d)} className="text-[10px] underline opacity-70">
                        {feriados.has(d) ? "Feriado · quitar" : "Marcar feriado"}
                      </button>
                    )}
                  </th>
                ))}
                <th className="px-2 py-2 text-right font-normal">Semana</th>
              </tr>
            </thead>
            <tbody>
              {TAREAS_RUTINA.map((t) => {
                const c = cumplimiento(dias, hoy, marcas, [t]);
                return (
                  <tr key={t.clave} className="border-line border-t">
                    <td className="bg-panel sticky left-0 py-1.5 pr-3">
                      {t.label}
                      {t.alerta === "riesgo_descarte" && pendientesDescarte != null && pendientesDescarte > 0 && (
                        <span className="ml-1.5 rounded-full bg-amber-500/20 px-1.5 text-[10px] text-amber-200">
                          {pendientesDescarte} alertas abajo
                        </span>
                      )}
                      {t.frecuencia.tipo === "mensual" && (
                        <span className="text-muted ml-1 text-[10px]">(el {t.frecuencia.dia} de cada mes)</span>
                      )}
                    </td>
                    {t.frecuencia.tipo === "evento" ? (
                      <td colSpan={5} className="text-muted px-2 text-center text-xs italic">
                        Aparece {t.frecuencia.cuando}
                      </td>
                    ) : (
                      dias.map((d) => (
                        <td key={d} className={`px-2 py-1.5 ${d === hoy ? "bg-sky-500/5" : ""}`}>
                          {feriados.has(d) ? <div className="text-muted text-center text-[10px]">feriado</div> : celda(t, d)}
                        </td>
                      ))
                    )}
                    <td className="text-muted px-2 text-right text-xs tabular-nums">
                      {pct(c) == null ? "" : fmtPct(pct(c))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {elegido && tareaElegida && (
          <Editor
            key={`${elegido.fecha}|${elegido.tarea}|${elegido.vez}`}
            casillero={elegido}
            tarea={tareaElegida.label}
            marca={marca(elegido)}
            alGuardar={() => {
              setElegido(null);
              recargar();
            }}
            alCerrar={() => setElegido(null)}
          />
        )}
      </Panel>
    </div>
  );
}
