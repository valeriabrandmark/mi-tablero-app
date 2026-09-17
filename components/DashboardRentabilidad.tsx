"use client";

import { useCallback, useEffect, useState } from "react";
import { fmtMoneda, fmtPct } from "@/lib/format";
import { Tabla, type Columna } from "@/components/Tabla";
import type {
  FilaRentabilidad,
  ProveedorRentabilidad,
  ResumenRentabilidad,
} from "@/lib/types";

/**
 * Rentabilidad y markup por proveedor.
 *
 * ---------------------------------------------------------------------------
 * LA PANTALLA CONTESTA UNA DISCUSIÓN, NO MUESTRA DATOS.
 *
 * Compras pregunta cuánto markup ponerle a cada proveedor. La objeción es que
 * sin precio competitivo no se vende. Las dos cosas son ciertas: son dos
 * columnas de la misma tabla, y la tabla se puede armar porque tenemos los dos
 * números.
 *
 *   NECESARIO   lo que hay que sumarle al costo para el margen mínimo,
 *               contando el flete y las cuotas
 *   MERCADO     lo que el mercado permite sumarle sin salirse de precio
 *
 * Donde MERCADO < NECESARIO ese proveedor no da, y la conversación cambia de
 * "poné más markup" —que no se puede— a "renegociamos el costo o lo sacamos".
 *
 * MARKUP NO ES MARGEN. Markup se mide sobre el costo, margen sobre la venta:
 * un markup del 100 % es un margen del 50 %. La planilla con la que se venía
 * discutiendo los confundía y además dividía un precio CON IVA por un costo
 * SIN IVA — daba 112,96 % donde el markup real era 76 %.
 * ---------------------------------------------------------------------------
 */

const CLASE_TARJETA = "border-line bg-panel-2/40 rounded-xl border p-3";

/** Un markup o un margen. Los nulos son "no sabemos", no cero. */
function Pct({ valor, tono }: { valor: number | null; tono?: "bien" | "mal" }) {
  if (valor === null) return <span className="text-muted">—</span>;
  const clase = tono === "mal" ? "text-negativo" : tono === "bien" ? "text-c1" : "";
  return <span className={`font-medium ${clase}`}>{fmtPct(valor)}</span>;
}

/**
 * Cuánto aire hay entre lo que el mercado permite y lo que necesitamos.
 *
 * ES LA COLUMNA QUE RESPONDE LA PREGUNTA, y por eso va la resta y no los dos
 * números sueltos: nadie hace una resta de porcentajes de memoria mirando una
 * tabla de quince filas. Negativa significa que a ese proveedor no le alcanza
 * el mercado, y ésa es la fila que hay que ir a mirar.
 */
function Holgura({ mercado, necesario }: { mercado: number | null; necesario: number | null }) {
  if (mercado === null || necesario === null) return <span className="text-muted">—</span>;
  const d = mercado - necesario;
  const mal = d < 0;
  return (
    <span className={`font-medium ${mal ? "text-negativo" : "text-c1"}`}>
      {d > 0 ? "+" : ""}
      {fmtPct(d)}
    </span>
  );
}

function columnasProveedores(
  abrir: (proveedor: string) => void,
  abierto: string | null,
): Columna<ProveedorRentabilidad>[] {
  return [
    {
      titulo: "Proveedor",
      ayuda:
        "Como viene en Sigma. Los artículos sin proveedor cargado se agrupan como " +
        "“sin proveedor”: son un dato de carga, no un proveedor real.",
      celda: (p) => (
        <button
          onClick={() => abrir(p.proveedor)}
          className="hover:text-c1 inline-flex items-center gap-1.5 text-left font-medium"
          title="Ver los artículos de este proveedor"
        >
          <span className="decoration-muted/50 underline decoration-dotted underline-offset-4">
            {p.proveedor}
          </span>
          <span className="text-muted/70 text-[10px]">
            {abierto === p.proveedor ? "▾" : "▸"}
          </span>
        </button>
      ),
      orden: (p) => p.proveedor,
    },
    {
      titulo: "Artículos",
      ayuda:
        "Con costo cargado Y con competencia detectada. Sin uno de los dos no se puede " +
        "hacer esta cuenta, y contarlos con cero arrastraría las medianas del proveedor.",
      celda: (p) => p.articulos.toLocaleString("es-AR"),
      numerica: true,
      orden: (p) => p.articulos,
    },
    {
      titulo: "Markup hoy",
      ayuda:
        "Lo que le sumamos al costo hoy, medido NETO CONTRA NETO: precio sin IVA sobre " +
        "costo sin IVA. Es la mediana del proveedor, no el promedio: un solo artículo con " +
        "un costo mal cargado mueve un promedio y no mueve una mediana.",
      celda: (p) => <Pct valor={p.markupActual} />,
      numerica: true,
      orden: (p) => p.markupActual,
    },
    {
      titulo: "Necesario",
      ayuda:
        "El markup que haría falta para llegar al margen mínimo, contando el flete que " +
        "absorbemos y las cuotas ponderadas por cuánto se usan. Es el piso, traducido a markup.",
      celda: (p) => <Pct valor={p.markupNecesario} />,
      numerica: true,
      orden: (p) => p.markupNecesario,
    },
    {
      titulo: "Permite el mercado",
      ayuda:
        "El markup que se puede poner sin salirse del precio del competidor más barato. " +
        "Sale de la misma comparación que alimenta el comparador de precios.",
      celda: (p) => <Pct valor={p.markupMercado} />,
      numerica: true,
      orden: (p) => p.markupMercado,
    },
    {
      titulo: "Holgura",
      ayuda:
        "Mercado menos necesario. Positiva: se puede competir y ganar. NEGATIVA: con este " +
        "proveedor no alcanza, y no se arregla poniendo más markup — hay que renegociar el " +
        "costo o dejar de traerlo.",
      celda: (p) => <Holgura mercado={p.markupMercado} necesario={p.markupNecesario} />,
      numerica: true,
      orden: (p) =>
        p.markupMercado === null || p.markupNecesario === null
          ? null
          : p.markupMercado - p.markupNecesario,
    },
    {
      titulo: "No dan",
      ayuda:
        "Cuántos artículos de este proveedor tienen el mercado por debajo de lo que " +
        "necesitan. Es el número con el que se va a una reunión de compras.",
      celda: (p) =>
        p.noDan === 0 ? (
          <span className="text-muted">—</span>
        ) : (
          <span className="text-negativo font-medium">
            {p.noDan} <span className="text-muted text-[10px]">de {p.articulos}</span>
          </span>
        ),
      numerica: true,
      orden: (p) => p.noDan,
    },
  ];
}

const columnasArticulos: Columna<FilaRentabilidad>[] = [
  {
    titulo: "Producto",
    celda: (f) => (
      <div>
        <span className="block max-w-[280px] truncate">{f.descripcion}</span>
        <span className="text-muted font-mono text-[10px]">
          {f.sku}
          {f.marca ? ` · ${f.marca}` : ""}
        </span>
      </div>
    ),
    orden: (f) => f.descripcion,
  },
  {
    titulo: "Costo neto",
    celda: (f) => <span className="text-muted">{fmtMoneda(f.costo)}</span>,
    numerica: true,
    orden: (f) => f.costo,
  },
  {
    titulo: "Precio hoy",
    celda: (f) => fmtMoneda(f.precioActual),
    numerica: true,
    orden: (f) => f.precioActual,
  },
  {
    titulo: "Competencia",
    celda: (f) => <span className="text-muted">{fmtMoneda(f.mejorCompetencia)}</span>,
    numerica: true,
    orden: (f) => f.mejorCompetencia,
  },
  {
    titulo: "Markup hoy",
    celda: (f) => <Pct valor={f.markupActual} />,
    numerica: true,
    orden: (f) => f.markupActual,
  },
  {
    titulo: "Necesario",
    celda: (f) => <Pct valor={f.markupNecesario} />,
    numerica: true,
    orden: (f) => f.markupNecesario,
  },
  {
    titulo: "Permite el mercado",
    celda: (f) => <Pct valor={f.markupMercado} />,
    numerica: true,
    orden: (f) => f.markupMercado,
  },
  {
    titulo: "Holgura",
    celda: (f) => <Holgura mercado={f.markupMercado} necesario={f.markupNecesario} />,
    numerica: true,
    orden: (f) =>
      f.markupMercado === null || f.markupNecesario === null
        ? null
        : f.markupMercado - f.markupNecesario,
  },
  {
    titulo: "Margen hoy",
    ayuda:
      "El margen de contribución al precio de hoy, con la cuenta COMPLETA: IVA, pasarela, " +
      "impuestos, flete y cuotas. Sobre la venta sin IVA. Es más bajo que el que muestra el " +
      "comparador, y la diferencia son justamente el flete y las cuotas.",
    celda: (f) => (
      <Pct valor={f.margenCompleto} tono={f.margenCompleto !== null && f.margenCompleto < 0.15 ? "mal" : undefined} />
    ),
    numerica: true,
    orden: (f) => f.margenCompleto,
  },
];

export default function DashboardRentabilidad() {
  const [resumen, setResumen] = useState<ResumenRentabilidad | null>(null);
  const [proveedores, setProveedores] = useState<ProveedorRentabilidad[]>([]);
  const [abierto, setAbierto] = useState<string | null>(null);
  const [articulos, setArticulos] = useState<FilaRentabilidad[]>([]);
  const [cargando, setCargando] = useState(true);
  const [aviso, setAviso] = useState<string | null>(null);

  useEffect(() => {
    let vigente = true;
    (async () => {
      const r = await fetch("/api/precios-tn/rentabilidad", { cache: "no-store" }).catch(
        () => null,
      );
      if (!vigente) return;
      if (!r?.ok) {
        setAviso("No se pudieron traer los datos.");
        setCargando(false);
        return;
      }
      const datos = await r.json();
      if (!vigente) return;
      setResumen(datos.resumen ?? null);
      setProveedores(datos.proveedores ?? []);
      setCargando(false);
    })();
    return () => {
      vigente = false;
    };
  }, []);

  const abrir = useCallback(
    async (proveedor: string) => {
      if (abierto === proveedor) {
        setAbierto(null);
        setArticulos([]);
        return;
      }
      setAbierto(proveedor);
      setArticulos([]);
      const r = await fetch(
        `/api/precios-tn/rentabilidad?proveedor=${encodeURIComponent(proveedor)}`,
        { cache: "no-store" },
      ).catch(() => null);
      if (!r?.ok) {
        setAviso(`No se pudo traer el detalle de ${proveedor}.`);
        return;
      }
      const datos = await r.json();
      setArticulos(datos.articulos ?? []);
    },
    [abierto],
  );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold">Rentabilidad por proveedor</h1>
        <p className="text-muted mt-0.5 text-[11px]">
          Cuánto markup necesita cada proveedor, y cuánto permite el mercado. Sobre la última
          comparación{resumen ? ` (corrida ${resumen.corridaId})` : ""}.
        </p>
      </div>

      {aviso && (
        <div className="border-line bg-panel-2/40 text-negativo rounded-xl border p-3 text-xs">
          {aviso}
        </div>
      )}

      {/* LO QUE ENTRA EN LA CUENTA, A LA VISTA.
          Una pantalla que dice "necesitás 49 % de markup" sin decir qué costos
          contó es una pantalla que hay que ir a verificar a mano cada vez. */}
      {resumen && (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <div className={CLASE_TARJETA}>
            <p className="text-muted text-[10px] uppercase">Artículos evaluados</p>
            <p className="text-base font-semibold">{resumen.articulos.toLocaleString("es-AR")}</p>
            <p className="text-muted mt-0.5 text-[10px]">
              en {resumen.proveedores} proveedores · con costo y competencia
            </p>
          </div>
          <div className={CLASE_TARJETA}>
            <p className="text-muted text-[10px] uppercase">No dan con el mercado</p>
            <p className="text-negativo text-base font-semibold">
              {resumen.noDan.toLocaleString("es-AR")}
            </p>
            <p className="text-muted mt-0.5 text-[10px]">
              el mercado no permite el markup que necesitan
            </p>
          </div>
          <div className={CLASE_TARJETA}>
            <p className="text-muted text-[10px] uppercase">Flete que absorbemos</p>
            <p className="text-base font-semibold">{fmtPct(resumen.fletePct)}</p>
            <p className="text-muted mt-0.5 text-[10px]">
              de lo facturado · entra en el markup necesario
            </p>
          </div>
          <div className={CLASE_TARJETA}>
            <p className="text-muted text-[10px] uppercase">Cuotas, ponderadas</p>
            <p className="text-base font-semibold">{fmtPct(resumen.cuotasPct)}</p>
            <p className="text-muted mt-0.5 text-[10px]">
              10,3 % sobre el {fmtPct(resumen.parteEnCuotas)} que se paga en cuotas
            </p>
          </div>
        </div>
      )}

      {/* EL TAMAÑO DE LA MUESTRA, DICHO Y NO ESCONDIDO.
          El flete y las cuotas salen de los pedidos reales, y hoy son pocos.
          Sirven para decidir; presentarlos como una ley sería mentir. */}
      {resumen && resumen.pedidosMedidos > 0 && (
        <p className="text-muted text-[11px]">
          El flete y las cuotas se miden sobre <b>{resumen.pedidosMedidos} pedidos</b> reales, no
          se configuran a mano. Con esa cantidad sirven para decidir y no para jurar: los
          porcentajes se van a mover cuando haya más historia, y el markup necesario se mueve con
          ellos.
        </p>
      )}

      {cargando ? (
        <div className={`${CLASE_TARJETA} text-muted p-6 text-center text-sm`}>Cargando…</div>
      ) : (
        <>
          <Tabla
            filas={proveedores}
            columnas={columnasProveedores(abrir, abierto)}
            clave={(p) => p.proveedor}
            vacio="No hay artículos con costo y competencia en la última corrida."
          />

          {abierto && (
            <div className="space-y-2">
              <h2 className="text-sm font-semibold">
                {abierto}
                <span className="text-muted ml-2 text-[11px] font-normal">
                  los que están más lejos de cumplir, primero
                </span>
              </h2>
              <Tabla
                filas={articulos}
                columnas={columnasArticulos}
                clave={(f) => f.sku}
                vacio="Cargando el detalle…"
              />
            </div>
          )}
        </>
      )}

      <p className="text-muted text-[11px]">
        <b>Markup no es margen.</b> El markup se mide sobre el costo —cuánto le sumo a lo que
        pagué— y el margen sobre la venta —cuánto me queda de lo que cobré—. Un markup del 100 %
        es un margen del 50 %. Todos los markups de esta pantalla van neto contra neto: precio sin
        IVA sobre costo sin IVA.
      </p>
    </div>
  );
}
