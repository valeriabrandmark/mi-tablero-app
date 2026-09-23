"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  faltanMinutos,
  haceCuanto,
  RUTA_ACTUALIZAR,
  type EstadoActualizacion,
  type ResultadoDespertador,
} from "@/lib/actualizar";

/**
 * "Actualizar ahora": le pide al pipeline que traiga datos frescos.
 *
 * ---------------------------------------------------------------------------
 * NO ES EL BOTON DE "ACTUALIZAR" QUE YA HABIA, Y LA DIFERENCIA IMPORTA
 *
 * El de antes —ahora "Recargar"— vuelve a leer la base. Es instantáneo y sirve
 * cuando el pipeline corrió hace un rato y la pantalla se quedó con lo de
 * antes. Este otro va un paso más atrás: le pide al orquestador que vaya a
 * buscar a Mercado Libre, SIGMA, Tienda Nube y Digip lo que haya de nuevo.
 * Tarda un par de minutos.
 *
 * Que sean dos botones y no uno es a propósito. Uno solo que hiciera las dos
 * cosas tardaría dos minutos cada vez que alguien quiere refrescar la pantalla,
 * y dispararía corridas del pipeline sin que nadie las haya pedido.
 *
 * ---------------------------------------------------------------------------
 * COMO SABE QUE TERMINO
 *
 * No mira el workflow: mira LA VERSION DE LOS DATOS, la misma marca de tiempo
 * con la que `lib/cache.ts` arma su clave. Se la guarda al apretar y pregunta
 * cada `PASO_SEGUNDOS` hasta que cambia.
 *
 * Eso es mejor que preguntarle a GitHub si el workflow terminó, y no sólo más
 * barato: cuando esa versión cambia, la caché YA quedó invalidada. O sea que el
 * momento en que el botón dice "listo" es exactamente el momento en que la
 * pantalla puede leer datos nuevos. Con la señal de GitHub podrían pasar
 * segundos entre "terminó" y "se ve", y en esos segundos recargar mostraría lo
 * viejo — el botón parecería no funcionar.
 *
 * Además el orquestador escribe esa fila AL TERMINAR CADA PASO, así que si lo
 * primero que hace es traer las ventas, el tablero se entera antes de que
 * termine todo lo demás.
 */

/** Cada cuánto se pregunta si ya cambió algo, mientras se espera. */
const PASO_SEGUNDOS = 10;

/**
 * Cada cuánto se refresca la cuenta regresiva del "en N min".
 *
 * MEDIO MINUTO Y NO UN MINUTO porque el número que se muestra está redondeado
 * hacia abajo: con un refresco de 60 s, un cartel que dice "3 min" podría
 * quedarse ahí casi dos minutos y leerse como congelado.
 *
 * Y se vuelve a PREGUNTARLE AL SERVIDOR en vez de descontar de a uno en el
 * navegador: mientras se espera puede correr el pipeline solo --o puede pedirlo
 * otra persona-- y ahí ya no hay nada que esperar. Descontando a ciegas, el
 * cartel seguiría contando hasta cero sobre datos que ya llegaron.
 */
const REFRESCO_ESPERA_SEGUNDOS = 30;

/**
 * Cuánto se espera antes de soltar.
 *
 * Una corrida normal son ~2 minutos y la más pesada del día ~21. Los 25 no son
 * un límite del pipeline —el workflow tiene su propio presupuesto de 50— sino
 * de la paciencia de esta pantalla: pasado eso deja de preguntar y lo dice, en
 * vez de girar para siempre. Los datos van a llegar igual; lo que se pierde es
 * el aviso automático.
 */
const PACIENCIA_MINUTOS = 25;

type Fase =
  | { tipo: "quieto" }
  | { tipo: "pidiendo" }
  | { tipo: "esperando"; desde: number }
  | { tipo: "listo" }
  | { tipo: "al_dia"; minutos: number | null }
  | { tipo: "tardando" }
  | { tipo: "error"; mensaje: string };

export default function BotonActualizar({
  onDatosNuevos,
  conSellIn = false,
}: {
  /** Se llama cuando llegaron datos nuevos, para releer el tablero. */
  onDatosNuevos: () => void;
  /**
   * SOLO PARA COMPRAS. Enciende dos avisos que en los demás tableros serían
   * ruido:
   *
   *   1. Que la planilla del sell in llegó después de la última corrida, o sea
   *      que los descuentos de la pantalla todavía son los de antes.
   *   2. La cuenta regresiva de cuándo se puede volver a pedir una corrida,
   *      bajando sola.
   *
   * Los dos son del flujo de Compras: ahí se edita la planilla y se quiere ver
   * el descuento nuevo YA. En Meli o en Objetivos nadie edita nada antes de
   * apretar, así que "ya estaban al día" alcanza y sobra.
   */
  conSellIn?: boolean;
}) {
  const [estado, setEstado] = useState<EstadoActualizacion | null>(null);
  const [fase, setFase] = useState<Fase>({ tipo: "quieto" });

  // La versión con la que se apretó. En una ref y no en el estado porque la lee
  // el intervalo: en el estado, el intervalo se quedaría con la del render en
  // el que se creó.
  const versionAlPedir = useRef<string | null>(null);

  // El aviso, en una ref. Si el padre pasara una función nueva en cada render,
  // tenerla en las dependencias del efecto desarmaría y volvería a armar el
  // intervalo en cada uno: la cuenta de los 10 segundos nunca llegaría al final
  // y el botón se quedaría esperando para siempre.
  const avisar = useRef(onDatosNuevos);
  useEffect(() => {
    avisar.current = onDatosNuevos;
  }, [onDatosNuevos]);

  // El estado inicial, para poder decir de cuándo son los datos antes de que
  // nadie apriete nada.
  useEffect(() => {
    let vivo = true;
    fetch(RUTA_ACTUALIZAR, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: EstadoActualizacion | null) => {
        if (vivo && d) setEstado(d);
      })
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, []);

  // MIENTRAS SE ESPERA, SE PREGUNTA. El efecto se desarma solo cuando la fase
  // deja de ser "esperando", así que no hace falta limpiar a mano en cada rama.
  useEffect(() => {
    if (fase.tipo !== "esperando") return;
    const arranque = fase.desde;

    const id = setInterval(async () => {
      const r = await fetch(RUTA_ACTUALIZAR, { cache: "no-store" }).catch(() => null);
      const d: EstadoActualizacion | null = r?.ok ? await r.json().catch(() => null) : null;
      if (d) setEstado(d);

      if (d && d.version !== versionAlPedir.current) {
        setFase({ tipo: "listo" });
        avisar.current();
        return;
      }
      if (Date.now() - arranque > PACIENCIA_MINUTOS * 60_000) {
        setFase({ tipo: "tardando" });
      }
    }, PASO_SEGUNDOS * 1000);

    return () => clearInterval(id);
  }, [fase]);

  // LA CUENTA REGRESIVA. Mientras la fase sea "al_dia" y todavía falten
  // minutos, se vuelve a preguntar; cuando llega a cero la fase vuelve a
  // "quieto" y el botón queda como si nada hubiera pasado, que es la verdad:
  // ya se puede pedir de nuevo.
  useEffect(() => {
    if (fase.tipo !== "al_dia" || !conSellIn) return;

    const id = setInterval(async () => {
      const r = await fetch(RUTA_ACTUALIZAR, { cache: "no-store" }).catch(() => null);
      const d: EstadoActualizacion | null = r?.ok ? await r.json().catch(() => null) : null;
      if (!d) return;
      setEstado(d);
      if (faltanMinutos(d) === 0) setFase({ tipo: "quieto" });
    }, REFRESCO_ESPERA_SEGUNDOS * 1000);

    return () => clearInterval(id);
  }, [fase, conSellIn]);

  const pedir = useCallback(async () => {
    setFase({ tipo: "pidiendo" });

    const r = await fetch(RUTA_ACTUALIZAR, { method: "POST" }).catch(() => null);
    const cuerpo = await r?.json().catch(() => null);

    if (!r?.ok) {
      setFase({
        tipo: "error",
        mensaje: cuerpo?.error ?? "No se pudo pedir la actualización.",
      });
      return;
    }

    const resultado: ResultadoDespertador = cuerpo.resultado;
    setEstado({
      version: cuerpo.version,
      minutos: cuerpo.minutos,
      esperaMinutos: cuerpo.esperaMinutos,
      sellInPendiente: cuerpo.sellInPendiente === true,
    });

    if (resultado === "al_dia") {
      // No se pidió corrida porque los datos son más nuevos que la espera. Pero
      // la pantalla puede estar mostrando algo de antes, así que igual se relee:
      // apretar y que no pase absolutamente nada se lee como "está roto".
      setFase({ tipo: "al_dia", minutos: cuerpo.minutos });
      onDatosNuevos();
      return;
    }

    versionAlPedir.current = cuerpo.version;
    setFase({ tipo: "esperando", desde: Date.now() });
  }, [onDatosNuevos]);

  const trabajando = fase.tipo === "pidiendo" || fase.tipo === "esperando";

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={pedir}
        disabled={trabajando}
        title={
          "Le pide al pipeline que vaya a buscar datos nuevos a Mercado Libre, " +
          "SIGMA, Tienda Nube y Digip. Tarda un par de minutos. " +
          "Si los datos ya son de hace menos de " +
          `${estado?.esperaMinutos ?? 15} minutos, no pide nada: ya están frescos.`
        }
        className="border-line hover:bg-panel-2 text-muted hover:text-ink rounded-lg border px-3 py-1.5 text-xs disabled:opacity-40"
      >
        {trabajando ? "Actualizando…" : "Actualizar ahora"}
      </button>
      <Leyenda fase={fase} estado={estado} conSellIn={conSellIn} />
    </div>
  );
}

function Leyenda({
  fase,
  estado,
  conSellIn,
}: {
  fase: Fase;
  estado: EstadoActualizacion | null;
  conSellIn: boolean;
}) {
  // El "hace N min" se recalcula solo: sin esto, dejar la pestaña abierta
  // congela el número en el que tenía al abrirla, que es justo el error que
  // este cartel viene a evitar. Mismo motivo que en `UltimaCarga` de Meli.
  const [, repintar] = useState(0);
  useEffect(() => {
    const id = setInterval(() => repintar((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  if (fase.tipo === "error") {
    return <p className="text-negativo max-w-xs text-right text-[11px]">{fase.mensaje}</p>;
  }
  if (fase.tipo === "pidiendo") {
    return <p className="text-muted text-[11px]">Pidiendo la corrida…</p>;
  }
  if (fase.tipo === "esperando") {
    return (
      <p className="text-muted text-[11px]">
        Buscando datos nuevos… suele tardar un par de minutos.
      </p>
    );
  }
  if (fase.tipo === "listo") {
    return <p className="text-c1 text-[11px]">Listo: datos nuevos.</p>;
  }
  if (fase.tipo === "al_dia") {
    const faltan = faltanMinutos(estado);
    // El caso que motivó todo esto: la planilla se subió DESPUES de la última
    // corrida, así que "ya estaban al día" es verdad y al mismo tiempo no
    // contesta lo que la persona quiere saber. Se dice qué falta y cuándo.
    if (conSellIn && estado?.sellInPendiente && faltan > 0) {
      return (
        <p className="max-w-[15rem] text-right text-[11px] text-amber-400">
          Los datos son de {haceCuanto(fase.minutos)}, pero tu planilla llegó
          después: estos descuentos todavía no la incluyen. Probá de nuevo en{" "}
          {faltan} min.
        </p>
      );
    }
    return (
      <p className="text-muted max-w-[15rem] text-right text-[11px]">
        Ya estaban al día ({haceCuanto(fase.minutos)}).
        {conSellIn && faltan > 0 && ` Se puede pedir otra en ${faltan} min.`}
      </p>
    );
  }
  if (fase.tipo === "tardando") {
    return (
      <p className="text-muted max-w-xs text-right text-[11px]">
        Está tardando más de lo normal. Los datos van a llegar igual; recargá en
        un rato.
      </p>
    );
  }

  if (!estado) return null;
  // Antes de que nadie apriete nada: si la planilla ya llegó y el pipeline
  // todavía no la vio, decirlo acá ahorra el viaje de apretar para enterarse.
  if (conSellIn && estado.sellInPendiente) {
    return (
      <p className="max-w-[15rem] text-right text-[11px] text-amber-400">
        Tu planilla del sell in llegó después de la última corrida
        ({haceCuanto(estado.minutos)}): apretá para traer los descuentos nuevos.
      </p>
    );
  }
  return (
    <p className="text-muted text-[11px]">Datos actualizados {haceCuanto(estado.minutos)}</p>
  );
}
