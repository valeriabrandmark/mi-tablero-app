"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Aviso, Esqueleto, Panel } from "@/components/ui";
import {
  describirRecurrencia,
  nombreAccion,
  tareasParaAvisar,
  type Estado,
  type Recurrencia,
  type Tarea,
} from "@/lib/tareas";
import {
  guardarAvisadas,
  leerAvisadas,
  notificar,
  pedirPermisoNotificaciones,
  permisoNotificaciones,
  prepararAudio,
  sonarAviso,
  type PermisoNotificaciones,
} from "./avisos";
import {
  claveDia,
  diaLargo,
  finDeMes,
  horaDe,
  inicioDeMes,
  inicioDeSemana,
  inicioDelDia,
  nombreMes,
  sumarDias,
} from "./fechas";
import FormularioTarea, { type EnvioFormulario } from "./FormularioTarea";
import ResumenTareas, { type Periodo } from "./ResumenTareas";
import { ListaDelDia, VistaMes, VistaSemana } from "./VistasCalendario";

type Vista = "semana" | "mes" | "resumen" | "repetitivas";
type Datos = { tareas: Tarea[]; recurrencias: Recurrencia[] };

const VISTAS: { clave: Vista; nombre: string }[] = [
  { clave: "semana", nombre: "Semana" },
  { clave: "mes", nombre: "Mes" },
  { clave: "resumen", nombre: "Resumen" },
  { clave: "repetitivas", nombre: "Repetitivas" },
];

/** Cada cuánto se mira si hay que avisar algo. */
const INTERVALO_AVISOS_MS = 20_000;
/** Cada cuánto se vuelve a leer la base (por las automáticas que corre el cron). */
const INTERVALO_RECARGA_MS = 5 * 60_000;

async function pedir(url: string, method: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const cuerpo = await res.json().catch(() => null);
  if (!res.ok) throw new Error(cuerpo?.error ?? `Error ${res.status}`);
  return cuerpo;
}

export default function OrganizadorTareas() {
  const router = useRouter();
  const [ahora, setAhora] = useState(() => new Date());
  const [referencia, setReferencia] = useState(() => new Date());
  const [vista, setVista] = useState<Vista>("semana");
  const [periodo, setPeriodo] = useState<Periodo>("semana");

  const [datos, setDatos] = useState<Datos | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recargas, setRecargas] = useState(0);

  const [form, setForm] = useState<{ tarea: Tarea | null; dia: Date } | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [errorForm, setErrorForm] = useState<string | null>(null);

  const [avisos, setAvisos] = useState<Tarea[]>([]);
  const [sonido, setSonido] = useState(true);
  const [permisoNotif, setPermisoNotif] = useState<PermisoNotificaciones>("default");

  // ------------------------------------------------------------------------
  //  Qué rango se lee
  // ------------------------------------------------------------------------
  //
  // El mes que se está mirando (con las semanas de los bordes) y, siempre, lo
  // que rodea a HOY: los avisos y el resumen de "este mes" tienen que andar
  // aunque el calendario esté parado en marzo.
  const claveMes = claveDia(inicioDeMes(referencia));
  const claveHoy = claveDia(ahora);
  const [desde, hasta] = useMemo(() => {
    const ref = new Date(`${claveMes}T00:00:00`);
    const hoy = new Date(`${claveHoy}T00:00:00`);
    const d = Math.min(inicioDeSemana(ref).getTime(), sumarDias(inicioDeMes(hoy), -7).getTime());
    const h = Math.max(
      sumarDias(inicioDeSemana(finDeMes(ref)), 7).getTime(),
      sumarDias(finDeMes(hoy), 7).getTime(),
    );
    return [new Date(d).toISOString(), new Date(h).toISOString()];
  }, [claveMes, claveHoy]);

  useEffect(() => {
    const ac = new AbortController();
    fetch(`/api/tareas?desde=${encodeURIComponent(desde)}&hasta=${encodeURIComponent(hasta)}`, {
      signal: ac.signal,
      cache: "no-store",
    })
      .then(async (res) => {
        if (res.status === 401) {
          router.replace("/login");
          return null;
        }
        const cuerpo = await res.json().catch(() => null);
        if (!res.ok) throw new Error(cuerpo?.error ?? `Error ${res.status}`);
        return cuerpo as Datos;
      })
      .then((d) => {
        if (!d) return;
        setDatos(d);
        setError(null);
      })
      .catch((e: unknown) => {
        if (ac.signal.aborted) return;
        setError(e instanceof Error ? e.message : "No se pudieron leer las tareas");
      });
    return () => ac.abort();
  }, [desde, hasta, recargas, router]);

  // Volver a leer cada tanto y al volver a la pestaña: las automáticas las
  // ejecuta la base, y su resultado sólo se ve releyendo.
  useEffect(() => {
    const recargar = () => setRecargas((n) => n + 1);
    const id = setInterval(recargar, INTERVALO_RECARGA_MS);
    window.addEventListener("focus", recargar);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", recargar);
    };
  }, []);

  // ------------------------------------------------------------------------
  //  Avisos
  // ------------------------------------------------------------------------
  //
  // Las refs son para que el intervalo --que se arma una sola vez-- vea siempre
  // las tareas y la preferencia de sonido del momento, sin rearmarse.
  const tareasRef = useRef<Tarea[] | null>(null);
  const sonidoRef = useRef(sonido);
  useEffect(() => {
    tareasRef.current = datos?.tareas ?? null;
  }, [datos]);
  useEffect(() => {
    sonidoRef.current = sonido;
  }, [sonido]);

  useEffect(() => {
    // Al abrir la página se avisa también lo de los últimos 2 minutos: si la
    // tarea era a las 9:00 y el tablero se abrió 9:01, el aviso tiene sentido.
    let ultimo = Date.now() - 2 * 60_000;
    const avisadas = leerAvisadas();

    const revisar = () => {
      const ya = Date.now();
      setAhora(new Date(ya));
      setPermisoNotif(permisoNotificaciones());
      const tareas = tareasRef.current;
      // Sin datos todavía, no se corre la ventana: si no, lo que vencía
      // mientras cargaba la página no se avisaría nunca.
      if (!tareas) return;

      const lista = tareasParaAvisar(tareas, ultimo, ya, avisadas);
      ultimo = ya;
      if (lista.length === 0) return;

      for (const t of lista) avisadas.add(`${t.id}@${t.inicio}`);
      guardarAvisadas(avisadas);
      if (sonidoRef.current) sonarAviso();
      for (const t of lista) {
        const antes = t.recordarMinAntes > 0 ? ` (empieza ${horaDe(new Date(t.inicio))})` : "";
        notificar(`🔔 ${t.titulo}`, `Es hora de arrancar${antes}.${t.nota ? ` ${t.nota}` : ""}`, `tarea-${t.id}`);
      }
      setAvisos((prev) => [...prev.filter((p) => !lista.some((t) => t.id === p.id)), ...lista]);
    };

    const primero = setTimeout(revisar, 1_000);
    const id = setInterval(revisar, INTERVALO_AVISOS_MS);
    return () => {
      clearTimeout(primero);
      clearInterval(id);
    };
  }, []);

  async function activarAvisos() {
    prepararAudio();
    setPermisoNotif(await pedirPermisoNotificaciones());
  }

  // ------------------------------------------------------------------------
  //  Cambios
  // ------------------------------------------------------------------------

  /** Reemplaza una tarea en la lista local con lo que devolvió la base. */
  function reemplazar(t: Tarea) {
    setDatos((d) => (d ? { ...d, tareas: d.tareas.map((x) => (x.id === t.id ? t : x)) } : d));
  }

  async function cambiarEstado(t: Tarea, estado: Estado) {
    try {
      const r = await pedir(`/api/tareas/${t.id}`, "PATCH", { estado });
      reemplazar(r.tarea);
      setAvisos((a) => a.filter((x) => x.id !== t.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar");
    }
  }

  async function postergar(t: Tarea, minutos: number) {
    try {
      const r = await pedir(`/api/tareas/${t.id}`, "PATCH", { postergar: minutos });
      reemplazar(r.tarea);
      setAvisos((a) => a.filter((x) => x.id !== t.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo postergar");
    }
  }

  async function guardar(envio: EnvioFormulario) {
    if (!form) return;
    setGuardando(true);
    setErrorForm(null);
    try {
      if (form.tarea) {
        reemplazar((await pedir(`/api/tareas/${form.tarea.id}`, "PATCH", { tarea: envio.datos })).tarea);
      } else {
        await pedir("/api/tareas", "POST", envio.tipo === "tarea" ? { tarea: envio.datos } : { recurrencia: envio.datos });
        setRecargas((n) => n + 1);
      }
      setForm(null);
    } catch (e) {
      setErrorForm(e instanceof Error ? e.message : "No se pudo guardar");
    } finally {
      setGuardando(false);
    }
  }

  async function borrar(t: Tarea) {
    if (!window.confirm(`¿Borrar "${t.titulo}"?`)) return;
    try {
      await pedir(`/api/tareas/${t.id}`, "DELETE");
      setForm(null);
      setRecargas((n) => n + 1);
    } catch (e) {
      setErrorForm(e instanceof Error ? e.message : "No se pudo borrar");
    }
  }

  async function frenar(id: string, titulo: string) {
    if (!window.confirm(`¿Dejar de repetir "${titulo}"? Se borran las próximas; lo ya pasado queda en el historial.`)) {
      return;
    }
    try {
      await pedir(`/api/tareas/recurrentes/${id}`, "DELETE");
      setForm(null);
      setRecargas((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo frenar la repetición");
    }
  }

  function abrirNueva(dia: Date) {
    setErrorForm(null);
    setForm({ tarea: null, dia });
  }

  function abrirTarea(t: Tarea) {
    setErrorForm(null);
    setForm({ tarea: t, dia: new Date(t.inicio) });
  }

  // ------------------------------------------------------------------------
  //  Navegación
  // ------------------------------------------------------------------------

  function mover(paso: number) {
    setReferencia((r) =>
      vista === "mes" ? new Date(r.getFullYear(), r.getMonth() + paso, 1) : sumarDias(r, 7 * paso),
    );
  }

  const tituloNavegacion =
    vista === "mes"
      ? nombreMes(referencia)
      : `Semana del ${diaLargo(inicioDeSemana(referencia))}`;

  const tareasPeriodo = useMemo(() => {
    if (!datos) return [];
    const hoy = inicioDelDia(ahora);
    const [d, h] =
      periodo === "hoy"
        ? [hoy, sumarDias(hoy, 1)]
        : periodo === "semana"
          ? [inicioDeSemana(hoy), sumarDias(inicioDeSemana(hoy), 7)]
          : [inicioDeMes(hoy), finDeMes(hoy)];
    return datos.tareas.filter((t) => {
      const ms = new Date(t.inicio).getTime();
      return ms >= d.getTime() && ms < h.getTime();
    });
  }, [datos, periodo, ahora]);

  return (
    <div className="grid gap-5" onPointerDown={prepararAudio}>
      {/* Encabezado */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Mis tareas</h1>
          <p className="text-muted text-xs capitalize">{diaLargo(ahora)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {permisoNotif === "default" && (
            <button type="button" onClick={activarAvisos} className="bg-c3/15 text-c3 hover:bg-c3/25 rounded-lg px-3 py-2">
              🔔 Activar notificaciones
            </button>
          )}
          {permisoNotif === "denied" && (
            <span className="text-muted" title="Se bloquearon desde el navegador: se habilitan en el candado de la barra de direcciones">
              Notificaciones bloqueadas (suena igual)
            </span>
          )}
          <button
            type="button"
            onClick={() => setSonido((s) => !s)}
            className="bg-panel-2 hover:bg-line rounded-lg px-3 py-2"
            title={sonido ? "Silenciar avisos" : "Activar sonido"}
          >
            {sonido ? "🔊 Sonido" : "🔇 Silencio"}
          </button>
          <button type="button" onClick={sonarAviso} className="bg-panel-2 hover:bg-line rounded-lg px-3 py-2">
            Probar sonido
          </button>
          <button
            type="button"
            onClick={() => abrirNueva(new Date())}
            className="bg-c1 rounded-lg px-4 py-2 text-sm font-medium text-white"
          >
            + Nueva tarea
          </button>
        </div>
      </div>

      {error && <Aviso>{error}</Aviso>}

      {!datos ? (
        <div className="grid gap-4">
          <Esqueleto className="h-32" />
          <Esqueleto className="h-72" />
        </div>
      ) : (
        <>
          <Panel titulo="Hoy" nota="Los avisos suenan con el tablero abierto, aunque esté en otra pestaña">
            <ListaDelDia
              tareas={datos.tareas}
              ahora={ahora}
              alAbrir={abrirTarea}
              alCambiarEstado={cambiarEstado}
              alPostergar={postergar}
            />
          </Panel>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="bg-panel border-line flex rounded-lg border p-0.5 text-xs">
              {VISTAS.map((v) => (
                <button
                  key={v.clave}
                  type="button"
                  onClick={() => setVista(v.clave)}
                  className={`rounded-md px-3 py-1.5 ${vista === v.clave ? "bg-panel-2 text-ink" : "text-muted"}`}
                >
                  {v.nombre}
                </button>
              ))}
            </div>
            {(vista === "semana" || vista === "mes") && (
              <div className="flex items-center gap-1 text-xs">
                <button type="button" onClick={() => mover(-1)} className="bg-panel-2 rounded-md px-2.5 py-1.5">
                  ‹
                </button>
                <button type="button" onClick={() => setReferencia(new Date())} className="bg-panel-2 rounded-md px-2.5 py-1.5">
                  Hoy
                </button>
                <button type="button" onClick={() => mover(1)} className="bg-panel-2 rounded-md px-2.5 py-1.5">
                  ›
                </button>
                <span className="ml-2 capitalize">{tituloNavegacion}</span>
              </div>
            )}
          </div>

          {vista === "semana" && (
            <VistaSemana referencia={referencia} tareas={datos.tareas} ahora={ahora} alAbrir={abrirTarea} alNueva={abrirNueva} />
          )}
          {vista === "mes" && (
            <VistaMes
              referencia={referencia}
              tareas={datos.tareas}
              ahora={ahora}
              alAbrir={abrirTarea}
              alElegirDia={(d) => {
                setReferencia(d);
                setVista("semana");
              }}
            />
          )}
          {vista === "resumen" && (
            <ResumenTareas
              periodo={periodo}
              alCambiarPeriodo={setPeriodo}
              tareas={tareasPeriodo}
              todas={datos.tareas}
              recurrencias={datos.recurrencias}
              ahora={ahora}
            />
          )}
          {vista === "repetitivas" && (
            <Panel titulo="Tareas que se repiten" nota="se crean solas en el calendario">
              {datos.recurrencias.length === 0 ? (
                <p className="text-muted text-sm">
                  Ninguna todavía. Al crear una tarea, marcá “Se repite” para que aparezca sola todos los lunes, el día 6
                  de cada mes, etc.
                </p>
              ) : (
                <ul>
                  {datos.recurrencias.map((r) => (
                    <li key={r.id} className="border-line flex flex-wrap items-center justify-between gap-2 border-b py-2 last:border-0">
                      <div>
                        <p className="text-sm">
                          {r.accion ? "⚙️ " : "🔔 "}
                          {r.titulo}
                          {r.categoria && <span className="text-muted ml-2 text-xs">{r.categoria}</span>}
                        </p>
                        <p className="text-muted text-xs">
                          {describirRecurrencia(r)}
                          {r.accion ? ` · ${nombreAccion(r.accion)}` : ""}
                          {r.hasta ? ` · hasta el ${r.hasta.split("-").reverse().join("/")}` : ""}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => frenar(r.id, r.titulo)}
                        className="text-c3 hover:bg-c3/10 rounded-lg px-3 py-1.5 text-xs"
                      >
                        Dejar de repetir
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          )}
        </>
      )}

      {/* Carteles de "es hora": quedan hasta que se haga algo con ellos */}
      {avisos.length > 0 && (
        <div className="fixed right-4 bottom-4 z-40 flex w-[min(360px,calc(100vw-2rem))] flex-col gap-2">
          {avisos.map((t) => (
            <div key={t.id} className="bg-panel border-c3/50 rounded-xl border p-3 shadow-2xl">
              <p className="text-c3 text-[11px]">🔔 Es hora · {horaDe(new Date(t.inicio))}</p>
              <p className="mt-0.5 text-sm font-medium">{t.titulo}</p>
              {t.nota && <p className="text-muted mt-0.5 line-clamp-2 text-xs">{t.nota}</p>}
              <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
                <button type="button" onClick={() => cambiarEstado(t, "en_curso")} className="bg-c1 rounded-md px-2.5 py-1 text-white">
                  ▶ Arrancar
                </button>
                <button type="button" onClick={() => postergar(t, 10)} className="bg-panel-2 rounded-md px-2.5 py-1">
                  10 min más
                </button>
                <button
                  type="button"
                  onClick={() => setAvisos((a) => a.filter((x) => x.id !== t.id))}
                  className="text-muted ml-auto px-2 py-1"
                >
                  Cerrar
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {form && (
        <FormularioTarea
          // La key reinicia el formulario al pasar de una tarea a otra.
          key={form.tarea?.id ?? `nueva-${claveDia(form.dia)}`}
          tarea={form.tarea}
          diaInicial={form.dia}
          guardando={guardando}
          error={errorForm}
          alGuardar={guardar}
          alCerrar={() => setForm(null)}
          alBorrar={form.tarea ? () => borrar(form.tarea!) : undefined}
          alFrenarRepeticion={
            form.tarea?.recurrenciaId
              ? () => frenar(form.tarea!.recurrenciaId!, form.tarea!.titulo)
              : undefined
          }
        />
      )}
    </div>
  );
}
