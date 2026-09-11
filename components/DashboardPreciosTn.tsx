"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { fmtMoneda, fmtPct } from "@/lib/format";
import { Tabla, type Columna } from "@/components/Tabla";
import { ALERTAS, nombreFuente, type ClaveAlerta } from "@/lib/precios-tn";
import type {
  CambioPrecioTn,
  CatalogosPreciosTn,
  FilaPrecioTn,
  FiltrosPreciosTn,
  ResumenPreciosTn,
} from "@/lib/types";

/**
 * Precios TN — Comparador.
 *
 * LA COLA SE ORDENA POR DISTANCIA AL MERCADO. Lo que hay que priorizar es
 * cuánto nos separa de la competencia: un producto 60 % caro es más urgente que
 * uno 5 % caro, aunque el segundo sea más fácil de arreglar.
 *
 * CADA COMPETIDOR SE MUESTRA CON NOMBRE, PRECIO Y LINK. Aprobar un cambio de
 * precio sin poder abrir la ficha del otro y verla es aprobar a ciegas.
 *
 * LOS FILTROS VIVEN EN EL SERVIDOR, no en el navegador. La lista está limitada
 * a 200 filas: filtrar acá mostraría "las 3 de Chicco que había entre las
 * primeras 200" en vez de las de Chicco, y nadie se enteraría de la diferencia.
 */

const TONOS: Record<string, string> = {
  critico: "border-negativo/40 bg-negativo/10 text-negativo",
  aviso: "border-c3/40 bg-c3/15 text-c3",
  neutro: "border-line bg-panel-2 text-muted",
};

const SIN_FILTRO: FiltrosPreciosTn = {
  grupo: null,
  proveedor: null,
  marca: null,
  busqueda: null,
};

/** Los filtros como query string, en el único lugar donde se traducen. */
function aParams(f: FiltrosPreciosTn): Record<string, string> {
  const p: Record<string, string> = {};
  if (f.grupo) p.grupo = f.grupo;
  if (f.proveedor) p.proveedor = f.proveedor;
  if (f.marca) p.marca = f.marca;
  if (f.busqueda) p.q = f.busqueda;
  return p;
}

/** "hace 3 horas". El dato crudo importa; la distancia se lee de un vistazo. */
function haceCuanto(iso: string): string {
  const minutos = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutos < 2) return "recién";
  if (minutos < 60) return `hace ${minutos} min`;
  const horas = Math.round(minutos / 60);
  if (horas < 24) return `hace ${horas} h`;
  const dias = Math.round(horas / 24);
  return dias === 1 ? "hace 1 día" : `hace ${dias} días`;
}

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
            title={`Abrir la ficha en ${nombreFuente(c.fuente)} para verificar el precio`}
          >
            {contenido} ↗
          </a>
        ) : (
          <span key={`${c.fuente}-${c.precio}`} className={clases} title="Sin link guardado">
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
        "Descripción, SKU, marca y proveedor según Sigma, más las unidades disponibles en Digip. " +
        "Debajo van los motivos que escribió el motor: por qué llegó a ese precio y qué lo limitó.",
      celda: (f) => (
        <div>
          <span className="block max-w-[260px] truncate font-medium" title={f.descripcion}>
            {f.descripcion}
          </span>
          <span className="text-muted font-mono text-[10px]">
            {f.sku}
            {f.marca ? ` · ${f.marca}` : ""}
            {f.proveedor ? ` · ${f.proveedor}` : ""}
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
        "A dónde llevaría el precio el motor: iguala al competidor más barato, y si eso " +
        "quedaba por debajo del piso, lo sube al piso. NO HAY TOPE DE SUBA — el único límite " +
        "es hacia abajo, y es el piso. Cuando el movimiento pasa del 50 % el motor lo avisa en " +
        "los motivos, para que abras la ficha del competidor antes de autorizar. " +
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

/**
 * Las columnas de "Cambios aplicados".
 *
 * ESTA TABLA ES EL CONTROL, y por eso muestra el precio anterior aunque ya no
 * exista en ningún lado más que acá: `precios.cambio` lo guarda justamente para
 * poder volver atrás sin depender de que Tienda Nube recuerde nada. La tabla es
 * append-only por trigger — un registro de auditoría que se puede editar no es
 * un registro de auditoría.
 */
function columnasCambios(
  deshacer: (id: number) => void,
): Columna<CambioPrecioTn>[] {
  return [
    {
      titulo: "Cuándo",
      ayuda:
        "Cuándo se escribió el precio en Tienda Nube de verdad. No es cuándo lo autorizaste: " +
        "entre una cosa y la otra corrió `precios aplicar`, que vuelve a verificar cada precio " +
        "contra la tienda antes de tocarlo.",
      celda: (c) => (
        <div>
          <span className="block text-xs">
            {new Date(c.aplicadoEn).toLocaleString("es-AR")}
          </span>
          <span className="text-muted text-[10px]">{haceCuanto(c.aplicadoEn)}</span>
        </div>
      ),
      orden: (c) => c.aplicadoEn,
    },
    {
      titulo: "Producto",
      ayuda: "Abre la ficha en NUESTRA tienda para verificar que el precio quedó como esperabas.",
      celda: (c) => (
        <div>
          {c.url ? (
            <a
              href={c.url}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-c1 block max-w-[260px] truncate font-medium"
              title="Abrir la ficha en unibrandco.com.ar"
            >
              {c.descripcion} ↗
            </a>
          ) : (
            <span className="block max-w-[260px] truncate font-medium">{c.descripcion}</span>
          )}
          <span className="text-muted font-mono text-[10px]">
            {c.sku}
            {c.marca ? ` · ${c.marca}` : ""}
          </span>
        </div>
      ),
      orden: (c) => c.descripcion,
    },
    {
      titulo: "Antes",
      ayuda:
        "El precio que tenía la tienda justo antes de que lo escribiéramos. Está guardado en " +
        "`precios.cambio`: es lo que hace posible volver atrás.",
      celda: (c) => <span className="text-muted line-through">{fmtMoneda(c.precioAnterior)}</span>,
      numerica: true,
      orden: (c) => c.precioAnterior,
    },
    {
      titulo: "Ahora",
      ayuda: "El precio que escribimos.",
      celda: (c) => <span className="font-medium">{fmtMoneda(c.precioNuevo)}</span>,
      numerica: true,
      orden: (c) => c.precioNuevo,
    },
    {
      titulo: "Cambio",
      celda: (c) => <Diferencia valor={c.variacion} />,
      numerica: true,
      orden: (c) => c.variacion,
    },
    {
      titulo: "Autorizó",
      ayuda: "Quién aprobó la propuesta que produjo este cambio.",
      celda: (c) => (
        <span className="text-muted text-[11px]">{c.autorizadoPor ?? "—"}</span>
      ),
      orden: (c) => c.autorizadoPor,
    },
    {
      titulo: "",
      ayuda:
        "Deshacer NO escribe en Tienda Nube desde acá: deja pedida una propuesta de vuelta al " +
        "precio anterior, que escribe `precios aplicar` en la próxima corrida. Eso la hace pasar " +
        "por los mismos controles, incluido el que impide pisar una corrección que alguien haya " +
        "hecho a mano en el medio.",
      celda: (c) =>
        c.yaSeDeshizo ? (
          <span className="text-muted text-xs">vuelta pedida</span>
        ) : (
          <div className="flex justify-end">
            <button
              onClick={() => deshacer(c.id)}
              className="border-line hover:bg-panel-2 text-muted hover:text-ink rounded-lg border px-2.5 py-1 text-xs"
            >
              ↩ Deshacer
            </button>
          </div>
        ),
    },
  ];
}

type Aprobables = { total: number; bajan: number; suben: number };
type EstadoCorrida = {
  disponible?: boolean;
  estado: "en_cola" | "corriendo" | "termino" | "fallo" | "sin_datos";
  log?: string | null;
};

const CLASE_SELECT =
  "border-line bg-panel-2 text-ink rounded-lg border px-2.5 py-1.5 text-xs focus:border-c1/50 focus:outline-none";

export default function DashboardPreciosTn() {
  const [resumen, setResumen] = useState<ResumenPreciosTn | null>(null);
  const [filas, setFilas] = useState<FilaPrecioTn[]>([]);
  const [catalogos, setCatalogos] = useState<CatalogosPreciosTn>({ proveedores: [], marcas: [] });
  const [aprobables, setAprobables] = useState<Aprobables>({ total: 0, bajan: 0, suben: 0 });
  const [filtros, setFiltros] = useState<FiltrosPreciosTn>(SIN_FILTRO);
  // El texto del buscador va aparte del filtro: se escribe letra por letra y
  // consultar la base en cada tecla sería una consulta por pulsación.
  const [texto, setTexto] = useState("");
  const [cargando, setCargando] = useState(true);
  const [aviso, setAviso] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [corrida, setCorrida] = useState<EstadoCorrida | null>(null);
  const [recarga, setRecarga] = useState(0);
  // Dos vistas: la cola de lo que falta decidir, y el registro de lo que ya se
  // escribió. Separadas porque se usan en momentos distintos: una es trabajo
  // pendiente y la otra es control de lo hecho.
  const [vista, setVista] = useState<"cola" | "cambios">("cola");
  const [cambios, setCambios] = useState<CambioPrecioTn[]>([]);

  // Medio segundo de quietud antes de consultar. Es el mínimo que se siente
  // instantáneo y el máximo que evita una consulta por letra.
  useEffect(() => {
    const t = setTimeout(() => {
      setFiltros((f) => (f.busqueda === (texto.trim() || null) ? f : { ...f, busqueda: texto.trim() || null }));
    }, 500);
    return () => clearTimeout(t);
  }, [texto]);

  // El efecto NO toca el estado antes del await, y por eso `cargando` arranca
  // en true y lo vuelve a poner en true quien cambia de filtro (que es un
  // manejador de evento, no un efecto). Escribir estado sincronicamente dentro
  // de un efecto es lo que marca react-hooks/set-state-in-effect, y con razon:
  // provoca un render de mas en cada montaje.
  //
  // `vigente` evita la carrera clasica: si alguien clickea dos filtros rapido,
  // la respuesta lenta de la primera no puede pisar a la segunda.
  useEffect(() => {
    let vigente = true;
    (async () => {
      try {
        const qs = new URLSearchParams(aParams(filtros)).toString();
        const r = await fetch(`/api/precios-tn${qs ? `?${qs}` : ""}`, { cache: "no-store" });
        if (!r.ok) {
          throw new Error((await r.json().catch(() => null))?.error ?? `HTTP ${r.status}`);
        }
        const datos = await r.json();
        if (!vigente) return;
        setResumen(datos.resumen);
        setFilas(datos.filas);
        setCatalogos(datos.catalogos);
        setAprobables(datos.aprobables);
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
  }, [filtros, recarga]);

  // El estado del workflow. Se consulta al entrar y, MIENTRAS ESTÁ CORRIENDO,
  // cada 15 segundos: una bajada tarda unos 6 minutos y un botón que no cuenta
  // nada durante 6 minutos se clickea de nuevo.
  useEffect(() => {
    let vigente = true;
    const mirar = async () => {
      const r = await fetch("/api/precios-tn/correr", { cache: "no-store" }).catch(() => null);
      if (!r?.ok || !vigente) return;
      const datos = await r.json();
      if (vigente) setCorrida(datos);
    };
    void mirar();
    const enMarcha = corrida?.estado === "corriendo" || corrida?.estado === "en_cola";
    const t = enMarcha ? setInterval(mirar, 15000) : null;
    return () => {
      vigente = false;
      if (t) clearInterval(t);
    };
  }, [corrida?.estado, recarga]);

  // El historial se trae siempre, no sólo al abrir la solapa: el contador del
  // título tiene que ser cierto desde el primer render, y son pocas filas.
  useEffect(() => {
    let vigente = true;
    (async () => {
      const r = await fetch("/api/precios-tn/cambios", { cache: "no-store" }).catch(() => null);
      if (!r?.ok || !vigente) return;
      const datos = await r.json();
      if (vigente) setCambios(datos.cambios ?? []);
    })();
    return () => {
      vigente = false;
    };
  }, [recarga]);

  const recargar = useCallback(() => {
    setCargando(true);
    setRecarga((n) => n + 1);
  }, []);

  const cambiarFiltro = useCallback((cambio: Partial<FiltrosPreciosTn>) => {
    setCargando(true);
    setConfirmando(false);
    setFiltros((f) => ({ ...f, ...cambio }));
  }, []);

  const limpiar = useCallback(() => {
    setCargando(true);
    setConfirmando(false);
    setTexto("");
    setFiltros(SIN_FILTRO);
  }, []);

  const hayFiltro = useMemo(
    () => Boolean(filtros.grupo || filtros.proveedor || filtros.marca || filtros.busqueda),
    [filtros],
  );

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
    setFilas((previas) => previas.map((f) => (f.id === id ? { ...f, estado: decision } : f)));
    setAprobables((a) => ({ ...a, total: Math.max(0, a.total - 1) }));
  }

  async function autorizarTodo() {
    setAviso(null);
    setConfirmando(false);
    const r = await fetch("/api/precios-tn/decidir", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ todas: true, filtros: aParams(filtros) }),
    });
    if (!r.ok) {
      setAviso((await r.json().catch(() => null))?.error ?? "No se pudo autorizar");
      return;
    }
    const { aprobadas } = await r.json();
    setAviso(`${aprobadas} propuestas autorizadas. Se escriben cuando corra \`precios aplicar\`.`);
    recargar();
  }

  async function deshacer(id: number) {
    setAviso(null);
    const r = await fetch("/api/precios-tn/cambios", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id }),
    });
    if (!r.ok) {
      setAviso((await r.json().catch(() => null))?.error ?? "No se pudo pedir la vuelta atrás");
      recargar();
      return;
    }
    setCambios((previos) => previos.map((c) => (c.id === id ? { ...c, yaSeDeshizo: true } : c)));
    setAviso(
      "Vuelta atrás pedida. El precio anterior se escribe en la próxima corrida de " +
        "`aplicar`, después de verificar que nadie lo haya tocado en el medio.",
    );
  }

  async function correrAhora() {
    setAviso(null);
    setCorrida({ estado: "en_cola" });
    const r = await fetch("/api/precios-tn/correr", { method: "POST" });
    const datos = await r.json().catch(() => null);
    if (!r.ok) {
      setCorrida(null);
      setAviso(datos?.error ?? "No se pudo arrancar la comparación");
      return;
    }
    setAviso(
      datos?.yaCorria
        ? "Ya había una comparación en curso: no se encoló otra."
        : "Comparación arrancada. Tarda unos 6 minutos; la pantalla se actualiza sola.",
    );
  }

  const alertas = ALERTAS.filter((a) => (resumen?.grupos?.[a.clave] ?? 0) > 0);
  const corriendo = corrida?.estado === "corriendo" || corrida?.estado === "en_cola";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Precios TN — Comparador</h1>
          {/* CUÁNDO SE MIRÓ A LA COMPETENCIA, que no es cuándo corrió el motor.
              El motor puede correr hoy sobre precios de hace tres días sin
              avisarlo: para él son datos vigentes según la política. Esta línea
              es la que dice si la pantalla habla del mercado de hoy. */}
          <p className="text-muted mt-1 text-xs">
            {resumen?.comparadoEn ? (
              <>
                Última comparación:{" "}
                <span className="text-ink font-medium">
                  {new Date(resumen.comparadoEn).toLocaleString("es-AR")}
                </span>{" "}
                ({haceCuanto(resumen.comparadoEn)})
              </>
            ) : (
              "Todavía no hay ninguna bajada de competencia terminada."
            )}
          </p>
          {resumen && (
            <p className="text-muted mt-0.5 text-[11px]">
              {resumen.pendientes} pendientes · {resumen.decididas} decididas ·{" "}
              {resumen.aprobadasSinAplicar} autorizadas esperando escritura
            </p>
          )}
        </div>

        <div className="flex flex-col items-end gap-1">
          <button
            onClick={correrAhora}
            disabled={corriendo || corrida?.disponible === false}
            className="border-line hover:bg-panel-2 text-muted hover:text-ink rounded-lg border px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-50"
            title={
              corrida?.disponible === false
                ? "Falta configurar GITHUB_TOKEN_PRECIOS en el entorno"
                : "Vuelve a leer los precios de la competencia y de nuestra tienda, y recalcula las propuestas"
            }
          >
            {corriendo ? "Comparando…" : "↻ Comparar ahora"}
          </button>
          {corrida?.log && (
            <a
              href={corrida.log}
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted hover:text-c1 text-[10px]"
            >
              {corrida.estado === "fallo" ? "⚠ la última corrida falló — ver log" : "ver el log ↗"}
            </a>
          )}
        </div>
      </div>

      {aviso && (
        <p className="border-c3/40 bg-c3/10 text-c3 rounded-lg border px-3 py-2 text-sm">{aviso}</p>
      )}

      {/* Dos momentos distintos: decidir lo que falta, y controlar lo hecho.
          Mezclarlos en una sola tabla haría que el trabajo pendiente quede
          sepultado bajo el historial apenas se apliquen unas semanas. */}
      <div className="border-line flex gap-1 border-b">
        {(
          [
            ["cola", "Para revisar", resumen?.pendientes ?? null],
            ["cambios", "Cambios aplicados", cambios.length],
          ] as const
        ).map(([clave, titulo, total]) => (
          <button
            key={clave}
            onClick={() => setVista(clave)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm transition ${
              vista === clave
                ? "border-c1 text-ink font-medium"
                : "text-muted hover:text-ink border-transparent"
            }`}
          >
            {titulo}
            {total !== null && <span className="text-muted ml-1.5 text-xs">{total}</span>}
          </button>
        ))}
      </div>

      {vista === "cola" && (
        <>
      {/* Las alertas. No son tramos de un mismo eje: son situaciones que se
          resuelven de formas distintas, por eso van separadas y en este orden. */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {alertas.map((a) => {
          const total = resumen?.grupos?.[a.clave] ?? 0;
          const activo = filtros.grupo === a.clave;
          return (
            <button
              key={a.clave}
              onClick={() => cambiarFiltro({ grupo: activo ? null : (a.clave as ClaveAlerta) })}
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

      {/* Los filtros. Se resuelven en el servidor sobre las 845 filas, no sobre
          las 200 que bajaron: filtrar en el navegador mostraría "las de Chicco
          que había entre las primeras 200" y nadie notaría la diferencia. */}
      <div className="border-line bg-panel-2/40 flex flex-wrap items-center gap-2 rounded-xl border p-3">
        <input
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Buscar por SKU o descripción…"
          className={`${CLASE_SELECT} min-w-[220px] flex-1`}
        />
        <select
          value={filtros.proveedor ?? ""}
          onChange={(e) => cambiarFiltro({ proveedor: e.target.value || null })}
          className={CLASE_SELECT}
        >
          <option value="">Todos los proveedores</option>
          {catalogos.proveedores.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <select
          value={filtros.marca ?? ""}
          onChange={(e) => cambiarFiltro({ marca: e.target.value || null })}
          className={CLASE_SELECT}
        >
          <option value="">Todas las marcas</option>
          {catalogos.marcas.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        {hayFiltro && (
          <button
            onClick={limpiar}
            className="border-line hover:bg-panel-2 text-muted hover:text-ink rounded-lg border px-2.5 py-1.5 text-xs"
          >
            Limpiar filtros
          </button>
        )}

        <div className="ml-auto">
          {/* AUTORIZAR TODO LO FILTRADO, nunca "todo" a secas.
              Un botón que aprueba las 845 convierte una decisión en un reflejo:
              el día que una corrida salga rara --un costo mal cargado, una
              fuente que devolvió el precio de otro producto-- se aprueba la
              corrida rara entera de un click. Atado al filtro significa algo
              concreto: "todo lo de esta marca, que acabo de mirar". */}
          <button
            onClick={() => setConfirmando(true)}
            disabled={aprobables.total === 0 || confirmando}
            className="border-c1/40 bg-c1/10 text-c1 hover:bg-c1/20 rounded-lg border px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-40"
          >
            Autorizar {hayFiltro ? "lo filtrado" : "todo"} ({aprobables.total})
          </button>
        </div>
      </div>

      {confirmando && (
        <div className="border-c1/40 bg-c1/5 space-y-2 rounded-xl border p-4">
          <p className="text-sm font-medium">
            Vas a autorizar {aprobables.total} propuestas
            {hayFiltro ? " del filtro actual" : " (sin filtro: la cola entera)"}.
          </p>
          <p className="text-muted text-xs leading-relaxed">
            {aprobables.bajan} bajan de precio y {aprobables.suben} suben. Quedan{" "}
            <b>fuera</b> las de “no se puede competir sin perder”: ésas no son un precio a
            corregir sino una decisión de si seguir vendiendo el producto, y se aprueban de
            a una. Autorizar no cambia nada en Tienda Nube todavía — la escritura la hace{" "}
            <code>precios aplicar</code>, que vuelve a verificar cada precio contra la
            tienda y escribe como máximo 50 por corrida.
          </p>
          <div className="flex gap-2">
            <button
              onClick={autorizarTodo}
              className="border-c1/40 bg-c1/15 text-c1 hover:bg-c1/25 rounded-lg border px-3 py-1.5 text-xs font-medium"
            >
              Sí, autorizar {aprobables.total}
            </button>
            <button
              onClick={() => setConfirmando(false)}
              className="border-line hover:bg-panel-2 text-muted hover:text-ink rounded-lg border px-3 py-1.5 text-xs"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {cargando ? (
        <p className="text-muted text-sm">Cargando…</p>
      ) : (
        <Tabla
          filas={filas}
          columnas={columnas(decidir)}
          clave={(f) => String(f.id)}
          vacio={hayFiltro ? "Nada coincide con el filtro." : "No hay propuestas para revisar."}
        />
      )}
        </>
      )}

      {vista === "cambios" && (
        <>
          {/* EL REGISTRO DE LO QUE SE ESCRIBIO DE VERDAD.
              No sale de las propuestas aprobadas --que son intenciones-- sino
              de precios.cambio, que escribe `aplicar` en la misma transaccion
              en la que cierra la propuesta. Si algo figura aca, se escribio. */}
          {cambios.length === 0 ? (
            <div className="border-line bg-panel-2/40 rounded-xl border p-6 text-center">
              <p className="text-sm font-medium">Todavía no se escribió ningún precio.</p>
              <p className="text-muted mx-auto mt-2 max-w-lg text-xs leading-relaxed">
                Acá va a aparecer cada precio que el proyecto <code>precios</code> escriba en
                Tienda Nube, con el valor anterior guardado para poder volver atrás. Autorizar
                una propuesta no alcanza: la escritura la hace el workflow{" "}
                <em>Aplicar precios en Tienda Nube</em>, con <code>confirmar</code> tildado.
              </p>
            </div>
          ) : (
            <Tabla
              filas={cambios}
              columnas={columnasCambios(deshacer)}
              clave={(c) => String(c.id)}
              vacio="Todavía no se escribió ningún precio."
            />
          )}
        </>
      )}

      <p className="text-muted text-[11px]">
        Ni autorizar ni deshacer cambian un precio en Tienda Nube desde acá: las dos
        cosas dejan una propuesta en la base. La escritura la hace el proyecto{" "}
        <code>precios</code> desde su workflow, con un token que este tablero no tiene
        y no debe tener.
      </p>
    </div>
  );
}
