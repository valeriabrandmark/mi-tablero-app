"use client";

import { useCallback, useEffect, useState } from "react";
import { fmtMoneda, fmtPct } from "@/lib/format";
import { Tabla, type Columna } from "@/components/Tabla";
import { ALERTAS, nombreFuente, type ClaveAlerta } from "@/lib/precios-tn";
import type { FilaPrecioTn, ResumenPreciosTn } from "@/lib/types";

/**
 * Precios TN — Comparador.
 *
 * LA COLA SE ORDENA POR DISTANCIA AL MERCADO, no por el tamaño del cambio que
 * propone el motor. Un producto 60 % caro que la banda sólo deja bajar 10 %
 * tiene que salir primero: lo que hay que priorizar es cuánto nos separa de la
 * competencia, no cuánto alcanzó a corregir el motor en una corrida.
 *
 * CADA COMPETIDOR SE MUESTRA CON NOMBRE, PRECIO Y LINK. Aprobar un cambio de
 * precio sin poder abrir la ficha del otro y verla es aprobar a ciegas.
 */

const TONOS: Record<string, string> = {
  critico: "border-negativo/40 bg-negativo/10 text-negativo",
  aviso: "border-c3/40 bg-c3/15 text-c3",
  neutro: "border-line bg-panel-2 text-muted",
};

function Diferencia({ valor }: { valor: number | null }) {
  if (valor === null) return <span className="text-muted">—</span>;
  const caro = valor > 0;
  return (
    <span className={caro ? "text-negativo" : "text-c1"}>
      {caro ? "+" : ""}
      {fmtPct(valor)}
    </span>
  );
}

function Competidores({ lista }: { lista: FilaPrecioTn["competidores"] }) {
  if (!lista?.length) return <span className="text-muted text-xs">sin datos</span>;

  // El más barato primero: es contra quien el cliente nos compara cuando abre
  // dos pestañas, y es el que define la referencia que usó el motor.
  const ordenados = [...lista].sort((a, b) => a.precio - b.precio);

  return (
    <div className="flex flex-wrap gap-1.5">
      {ordenados.map((c) => {
        const contenido = (
          <>
            <span className="opacity-70">{nombreFuente(c.fuente)}</span>{" "}
            <span className="font-mono">{fmtMoneda(c.precio)}</span>
            {!c.disponible && <span className="text-muted ml-1 text-[10px]">(sin stock)</span>}
          </>
        );
        const clases =
          "border-line bg-panel-2 rounded-full border px-2 py-0.5 text-[11px] whitespace-nowrap";
        return c.url ? (
          <a
            key={`${c.fuente}-${c.precio}`}
            href={c.url}
            target="_blank"
            rel="noopener noreferrer"
            className={`${clases} hover:border-c1/50 hover:text-c1`}
            title="Abrir la ficha en su sitio"
          >
            {contenido} ↗
          </a>
        ) : (
          <span key={`${c.fuente}-${c.precio}`} className={clases}>
            {contenido}
          </span>
        );
      })}
    </div>
  );
}


/**
 * Las columnas, con su ayuda.
 *
 * LOS TOOLTIPS NO ESTAN EN TODAS, y ese es el criterio que ya trae `Tabla`: si
 * el texto solo repite el titulo, estorba y ademas entrena a no leer los que si
 * dicen algo. Van donde el nombre no alcanza -- y en esta pantalla no alcanza
 * casi nunca, porque cada numero sale de una cuenta que nadie puede adivinar.
 */
function columnas(
  decidir: (id: number, decision: "aprobada" | "rechazada") => void,
): Columna<FilaPrecioTn>[] {
  return [
    {
      titulo: "Producto",
      ayuda:
        "Descripción, SKU y marca según Sigma, más las unidades disponibles en Digip. " +
        "Debajo van los motivos que escribió el motor: por qué llegó a ese precio y qué lo limitó.",
      celda: (f) => (
        <div>
          <span className="block max-w-[260px] truncate font-medium" title={f.descripcion}>
            {f.descripcion}
          </span>
          <span className="text-muted font-mono text-[10px]">
            {f.sku}
            {f.marca ? ` · ${f.marca}` : ""}
            {f.stock !== null ? ` · ${f.stock} u.` : ""}
          </span>
          {f.motivos?.length > 0 && (
            <ul className="text-muted mt-1 space-y-0.5 text-[10px]">
              {f.motivos.map((m, i) => (
                <li key={i}>· {m}</li>
              ))}
            </ul>
          )}
        </div>
      ),
      orden: (f) => f.descripcion,
    },
    {
      titulo: "Hoy",
      ayuda:
        "El precio que ve el cliente ahora mismo en la tienda, leído de la API de Tienda Nube " +
        "en la última corrida. Si el producto tiene promoción activa, es el promocional y no el de lista.",
      celda: (f) => fmtMoneda(f.precioActual),
      numerica: true,
      orden: (f) => f.precioActual,
    },
    {
      titulo: "Propuesto",
      ayuda:
        "A dónde llevaría el precio el motor. Sale de igualar al competidor más barato, " +
        "subirlo al piso si quedaba por debajo, y después limitar el movimiento a ±10 % del precio de hoy. " +
        "Vacío = el motor no propone nada (sin stock, sin costo o sin competencia).",
      celda: (f) =>
        f.precioPropuesto ? fmtMoneda(f.precioPropuesto) : <span className="text-muted">—</span>,
      numerica: true,
      orden: (f) => f.precioPropuesto,
    },
    {
      titulo: "Piso",
      ayuda:
        "El precio final más bajo que todavía deja 15 % de margen de contribución. " +
        "Parte del costo de compra con el descuento del proveedor ya aplicado, y le descuenta " +
        "el IVA del artículo, el arancel de la pasarela más cara (3,62 % sobre el total cobrado) " +
        "y el 7,4 % de IIBB, cheque y municipal sobre la venta sin IVA. " +
        "No es costo × 1,15: a ese precio se perdería plata, porque el IVA solo ya se lleva 21 %.",
      celda: (f) => <span className="text-muted">{fmtMoneda(f.piso)}</span>,
      numerica: true,
      orden: (f) => f.piso,
    },
    {
      titulo: "vs mercado",
      ayuda:
        "Cuánto nos separa del competidor más barato: positivo = estamos más caros. " +
        "Es lo que ordena la cola, porque lo que hay que priorizar es la distancia al mercado, " +
        "no cuánto alcanzó a corregir el motor dentro de su banda.",
      celda: (f) => <Diferencia valor={f.difMercado} />,
      numerica: true,
      orden: (f) => f.difMercado,
    },
    {
      titulo: "Competencia",
      ayuda:
        "Las tiendas que tienen este mismo código de barras, de la más barata a la más cara. " +
        "Cada una abre su ficha en el sitio del competidor para verificarlo con tus propios ojos. " +
        "Las marcadas sin stock no cuentan para la referencia: su precio es una ficción.",
      celda: (f) => <Competidores lista={f.competidores} />,
      orden: (f) => f.mejorCompetencia,
    },
    {
      titulo: "",
      ayuda:
        "Autorizar NO cambia el precio en Tienda Nube: marca la propuesta como aprobada, " +
        "firmada con tu mail. La escritura la hace el proyecto `precios` desde su workflow.",
      celda: (f) =>
        f.estado !== "pendiente" ? (
          <span className="text-muted text-xs">{f.estado}</span>
        ) : f.precioPropuesto === null ? (
          <span className="text-muted text-xs">sin propuesta</span>
        ) : (
          <div className="flex justify-end gap-1.5">
            <button
              onClick={() => decidir(f.id, "aprobada")}
              className="border-c1/40 bg-c1/10 text-c1 hover:bg-c1/20 rounded-lg border px-2.5 py-1 text-xs"
            >
              Autorizar
            </button>
            <button
              onClick={() => decidir(f.id, "rechazada")}
              className="border-line hover:bg-panel-2 text-muted hover:text-ink rounded-lg border px-2.5 py-1 text-xs"
            >
              No
            </button>
          </div>
        ),
    },
  ];
}

export default function DashboardPreciosTn() {
  const [resumen, setResumen] = useState<ResumenPreciosTn | null>(null);
  const [filas, setFilas] = useState<FilaPrecioTn[]>([]);
  const [grupo, setGrupo] = useState<ClaveAlerta | null>(null);
  const [cargando, setCargando] = useState(true);
  const [aviso, setAviso] = useState<string | null>(null);

  // El efecto NO toca el estado antes del await, y por eso `cargando` arranca
  // en true y lo vuelve a poner en true quien cambia de grupo (que es un
  // manejador de evento, no un efecto). Escribir estado sincronicamente dentro
  // de un efecto es lo que marca react-hooks/set-state-in-effect, y con razon:
  // provoca un render de mas en cada montaje.
  //
  // `vigente` evita la carrera clasica: si alguien clickea dos grupos rapido,
  // la respuesta lenta de la primera no puede pisar a la segunda.
  const [recarga, setRecarga] = useState(0);

  useEffect(() => {
    let vigente = true;
    (async () => {
      try {
        const r = await fetch(`/api/precios-tn${grupo ? `?grupo=${grupo}` : ""}`, {
          cache: "no-store",
        });
        if (!r.ok) {
          throw new Error((await r.json().catch(() => null))?.error ?? `HTTP ${r.status}`);
        }
        const datos = await r.json();
        if (!vigente) return;
        setResumen(datos.resumen);
        setFilas(datos.filas);
        setAviso(null);
      } catch (e) {
        if (vigente) setAviso(e instanceof Error ? e.message : "No se pudieron traer los datos");
      } finally {
        if (vigente) setCargando(false);
      }
    })();
    return () => {
      vigente = false;
    };
  }, [grupo, recarga]);

  const recargar = useCallback(() => {
    setCargando(true);
    setRecarga((n) => n + 1);
  }, []);

  const cambiarGrupo = useCallback((g: ClaveAlerta | null) => {
    setCargando(true);
    setGrupo(g);
  }, []);

  async function decidir(id: number, decision: "aprobada" | "rechazada") {
    setAviso(null);
    const r = await fetch("/api/precios-tn/decidir", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, decision }),
    });
    if (!r.ok) {
      // El 409 es el caso de dos personas decidiendo lo mismo a la vez. Se
      // avisa y se recarga: fingir que funcionó sería peor.
      setAviso((await r.json().catch(() => null))?.error ?? "No se pudo guardar");
      recargar();
      return;
    }
    setFilas((previas) =>
      previas.map((f) => (f.id === id ? { ...f, estado: decision } : f)),
    );
  }

  const alertas = ALERTAS.filter((a) => (resumen?.grupos?.[a.clave] ?? 0) > 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight">Precios TN — Comparador</h1>
        {resumen?.corridaFecha && (
          <p className="text-muted text-xs">
            Última comparación: {new Date(resumen.corridaFecha).toLocaleString("es-AR")} ·{" "}
            {resumen.pendientes} pendientes · {resumen.decididas} decididas
          </p>
        )}
      </div>

      {aviso && (
        <p className="border-negativo/40 bg-negativo/10 text-negativo rounded-lg border px-3 py-2 text-sm">
          {aviso}
        </p>
      )}

      {/* Las alertas. No son tramos de un mismo eje: son situaciones que se
          resuelven de formas distintas, por eso van separadas y en este orden. */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {alertas.map((a) => {
          const total = resumen?.grupos?.[a.clave] ?? 0;
          const activo = grupo === a.clave;
          return (
            <button
              key={a.clave}
              onClick={() => cambiarGrupo(activo ? null : (a.clave as ClaveAlerta))}
              className={`rounded-xl border p-3 text-left transition ${TONOS[a.tono]} ${
                activo ? "ring-c1/60 ring-2" : "hover:opacity-80"
              }`}
            >
              <p className="text-2xl font-semibold">{total}</p>
              <p className="text-sm font-medium">{a.titulo}</p>
              <p className="mt-1 text-[11px] leading-snug opacity-75">{a.detalle}</p>
            </button>
          );
        })}
      </div>

      {grupo && (
        <button
          onClick={() => cambiarGrupo(null)}
          className="border-line hover:bg-panel-2 text-muted hover:text-ink rounded-lg border px-3 py-1.5 text-xs"
        >
          ← Ver todos
        </button>
      )}

      {cargando ? (
        <p className="text-muted text-sm">Cargando…</p>
      ) : (
        <Tabla
          filas={filas}
          columnas={columnas(decidir)}
          clave={(f) => String(f.id)}
          vacio="No hay propuestas para revisar."
        />
      )}

      <p className="text-muted text-[11px]">
        Autorizar acá NO cambia el precio en Tienda Nube: marca la propuesta como
        aprobada. La escritura la hace el proyecto <code>precios</code> desde su
        workflow, con un token que este tablero no tiene.
      </p>
    </div>
  );
}
