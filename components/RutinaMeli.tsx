"use client";

import { useEffect, useState } from "react";
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
 * UN CLIC EN UN CASILLERO VACÍO LO TILDA, y se guarda en ese momento: es lo
 * que se hace veinte veces por día, y tiene que costar lo mismo que en papel.
 * Un clic en uno ya marcado abre, pegado al casillero, el menú para pasarlo a
 * "no correspondía", escribirle la nota o vaciarlo.
 *
 * El menú estuvo primero ABAJO DE LA PLANILLA, y no se veía: con diecisiete
 * filas quedaba fuera de pantalla, y el clic parecía no hacer nada más que
 * seleccionar (lo encontró a.maldonado probándola el 23/10).
 */

const NOMBRES_DIA = ["Lun", "Mar", "Mié", "Jue", "Vie"];

type Casillero = { fecha: string; tarea: string; vez: number };

const claveDe = (c: Casillero) => `${c.fecha}|${c.tarea}|${c.vez}`;

/** Guarda un casillero. `estado: null` lo vacía. Devuelve el error, o null. */
async function guardarCasillero(
  c: Casillero,
  estado: EstadoRutina | null,
  nota: string | null,
): Promise<string | null> {
  try {
    const res = await fetch("/api/tareas-meli/rutina", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...c, estado, nota }),
    });
    if (res.ok) return null;
    const cuerpo = await res.json().catch(() => null);
    return cuerpo?.error ?? `Error ${res.status}`;
  } catch {
    return "No se pudo guardar: revisá la conexión";
  }
}

type Props = {
  puedeContestar: boolean;
  /** Alertas de riesgo de descarte sin contestar; `null` mientras carga. */
  pendientesDescarte: number | null;
};

const mismo = (a: Casillero | null, b: Casillero) =>
  a != null && a.fecha === b.fecha && a.tarea === b.tarea && a.vez === b.vez;

/**
 * El menú de un casillero ya marcado, flotando pegado a él.
 *
 * `fixed` y no `absolute`: la planilla vive dentro de un contenedor con scroll
 * horizontal, que recortaría cualquier cosa que se salga de su caja.
 */
function Menu({
  casillero,
  tarea,
  marca,
  pos,
  alElegir,
  alCerrar,
}: {
  casillero: Casillero;
  tarea: string;
  marca: MarcaRutina | undefined;
  pos: { top: number; left: number };
  alElegir: (estado: EstadoRutina | null, nota: string | null) => void;
  alCerrar: () => void;
}) {
  const [nota, setNota] = useState(marca?.nota ?? "");
  const notaFinal = nota.trim() || null;
  const boton = "rounded-md border border-line px-2 py-1 text-xs text-left hover:bg-panel";

  return (
    <div
      role="dialog"
      style={{ top: pos.top, left: pos.left }}
      className="border-line bg-panel-2 fixed z-50 flex w-64 flex-col gap-1.5 rounded-xl border p-3 shadow-xl"
    >
      <span className="text-xs font-medium">
        {tarea}
        {casillero.vez > 1 ? ` (${casillero.vez}ª vez)` : ""} · {fmtFechaCorta(casillero.fecha)}
      </span>
      <input
        autoFocus
        value={nota}
        onChange={(e) => setNota(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") alElegir(marca?.estado ?? "hecho", notaFinal);
          if (e.key === "Escape") alCerrar();
        }}
        placeholder="Nota (ej.: HOLA cuotas)"
        maxLength={200}
        className="border-line bg-panel rounded-md border px-2 py-1 text-xs"
      />
      <button type="button" onClick={() => alElegir("hecho", notaFinal)} className={`${boton} bg-emerald-600/20`}>
        ✓ Hecho
      </button>
      <button type="button" onClick={() => alElegir("no_correspondia", notaFinal)} className={boton}>
        — No correspondía
      </button>
      {marca && (
        <button type="button" onClick={() => alElegir(null, null)} className={boton}>
          Vaciar el casillero
        </button>
      )}
      <div className="flex items-center justify-between">
        {marca?.actualizadoEn ? (
          <span className="text-muted text-[10px]">
            {marca.usuario.split("@")[0]} · {fmtFechaCorta(marca.actualizadoEn.slice(0, 10))}{" "}
            {marca.actualizadoEn.slice(11)}
          </span>
        ) : marca ? (
          <span className="text-muted text-[10px]">Recién marcado</span>
        ) : (
          <span />
        )}
        <button type="button" onClick={alCerrar} className="text-muted text-xs underline">
          Cerrar
        </button>
      </div>
    </div>
  );
}

export default function RutinaMeli({ puedeContestar, pendientesDescarte }: Props) {
  const [semana, setSemana] = useState<string | undefined>(undefined);
  const [elegido, setElegido] = useState<{ c: Casillero; pos: { top: number; left: number } } | null>(null);
  // Lo que se marcó y todavía no volvió de la base: se muestra en el momento,
  // sin esperar a recargar la semana. `null` = vaciado.
  const [locales, setLocales] = useState<Record<string, MarcaRutina | null>>({});
  const [aviso, setAviso] = useState<string | null>(null);
  const { data, cargando, error, recargar, empezarCarga } = useDatosTablero<DashboardRutinaMeli>(
    "/api/tareas-meli/rutina",
    { semana },
  );

  // El menú flotante queda clavado en la pantalla: si la página se mueve, se
  // cierra en vez de quedar apuntando a otro casillero.
  useEffect(() => {
    if (!elegido) return;
    const cerrar = () => setElegido(null);
    window.addEventListener("scroll", cerrar, true);
    window.addEventListener("resize", cerrar);
    return () => {
      window.removeEventListener("scroll", cerrar, true);
      window.removeEventListener("resize", cerrar);
    };
  }, [elegido]);

  if (error) return <Aviso>No se pudo cargar la rutina: {error}</Aviso>;
  if (!data) return <Esqueleto className="h-96" />;

  const { hoy, lunes } = data;
  const marcas: MarcaRutina[] = [
    ...data.marcas.filter((m) => !(claveDe(m) in locales)),
    ...Object.values(locales).filter((m): m is MarcaRutina => m != null),
  ];
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
    setLocales({});
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
    if (res.ok) {
      setLocales({});
      recargar();
    }
  }

  /** Marca en pantalla al instante, guarda, y si falla lo vuelve atrás y avisa. */
  async function marcar(c: Casillero, estado: EstadoRutina | null, nota: string | null) {
    const k = claveDe(c);
    const previo = locales[k];
    setElegido(null);
    setAviso(null);
    setLocales((l) => ({
      ...l,
      [k]: estado
        ? // Sin fecha: todavía no la puso la base. El menú dice "recién marcado".
          { ...c, estado, nota, usuario: "", actualizadoEn: "" }
        : null,
    }));
    const falla = await guardarCasillero(c, estado, nota);
    if (falla) {
      setLocales((l) => {
        const n = { ...l };
        if (previo === undefined) delete n[k];
        else n[k] = previo;
        return n;
      });
      setAviso(falla);
    }
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
              onClick={(e) => {
                if (!m) return void marcar(c, "hecho", null);
                if (mismo(elegido?.c ?? null, c)) return setElegido(null);
                const r = e.currentTarget.getBoundingClientRect();
                setElegido({
                  c,
                  pos: {
                    top: Math.min(r.bottom + 6, window.innerHeight - 260),
                    left: Math.max(8, Math.min(r.left - 110, window.innerWidth - 272)),
                  },
                });
              }}
              className={`relative h-6 w-6 rounded border text-xs hover:border-sky-400 disabled:cursor-default disabled:opacity-40 ${clase} ${
                mismo(elegido?.c ?? null, c) ? "ring-2 ring-sky-400" : ""
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

  const tareaElegida = elegido ? TAREAS_RUTINA.find((t) => t.clave === elegido.c.tarea) : null;

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
        nota="Clic en un casillero vacío: ✓ hecho. Clic en uno marcado: no correspondía, nota o vaciar. El punto naranja es un pendiente; el azul, una nota (pasá el mouse para leerla)."
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

        {aviso && (
          <div className="mt-3">
            <Aviso>No se guardó: {aviso}</Aviso>
          </div>
        )}

        {elegido && tareaElegida && (
          <Menu
            key={claveDe(elegido.c)}
            casillero={elegido.c}
            tarea={tareaElegida.label}
            marca={marca(elegido.c)}
            pos={elegido.pos}
            alElegir={(estado, nota) => void marcar(elegido.c, estado, nota)}
            alCerrar={() => setElegido(null)}
          />
        )}
      </Panel>
    </div>
  );
}
