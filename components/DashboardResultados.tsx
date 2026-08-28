"use client";

import { useState } from "react";
import { BotonLimpiar, SelectorMultiple } from "@/components/SelectorFiltro";
import {
  promedioPonderado,
  sumar,
  Tabla,
  type Columna,
} from "@/components/Tabla";
import {
  Aviso,
  ConAlarmaMargen,
  Esqueleto,
  Panel,
  TarjetaKpi,
} from "@/components/ui";
import {
  BANDAS,
  EXPERIMENTO_FIN,
  EXPERIMENTO_INICIO,
  SEMANAS,
  bandaDeMargen,
  diaMes,
  labelBanda,
  semanaEmpezada,
} from "@/lib/elasticidad";
import { alternar as alternarValor, vacio as sinValores } from "@/lib/filtros";
import { fmtMoneda, fmtMonedaCorta, fmtNumero, fmtPct } from "@/lib/format";
import { PALETA, TEMA } from "@/lib/paleta";
import { hoyArgentina } from "@/lib/rangos";
import { useDatosTablero } from "@/lib/useDatosTablero";
import type {
  DashboardResultados,
  FilaResultado,
  FiltrosElasticidad,
  ResumenSemana,
} from "@/lib/types";

type Opciones = { proveedores: string[]; marcas: string[] };
type Respuesta = DashboardResultados & { opciones: Opciones | null };

const COLOR_BANDA: Record<string, string> = {
  "<10": TEMA.muted,
  "10-18": PALETA[0],
  "18-25": PALETA[1],
  "25-35": PALETA[3],
  ">35": TEMA.muted,
};

/**
 * El %margen se pinta con el color de la banda en la que cae.
 *
 * Es lo que convierte la tabla en la lectura del experimento: si un artículo
 * pasó de azul a violeta entre la semana 1 y la 2, se le subió el margen, y al
 * lado están las unidades que hizo con cada uno. Sin el color habría que
 * comparar porcentajes a ojo, columna contra columna.
 */
function PctBanda({ pct }: { pct: number | null }) {
  if (pct == null) return <span className="text-muted">—</span>;
  const banda = bandaDeMargen(pct);
  return (
    <span
      style={banda ? { color: COLOR_BANDA[banda] } : undefined}
      title={banda ? `Cae en la banda ${labelBanda(banda)}` : undefined}
    >
      {fmtPct(pct)}
    </span>
  );
}

function columnasResumen(semanas: ResumenSemana[]): Columna<ResumenSemana>[] {
  return [
    {
      titulo: "Semana",
      celda: (s) => (
        <span>
          <strong>Semana {s.numero}</strong>{" "}
          <span className="text-muted">· {s.label}</span>
        </span>
      ),
      orden: (s) => s.numero,
    },
    {
      titulo: "Artículos con venta",
      celda: (s) => fmtNumero(s.skus),
      numerica: true,
      orden: (s) => s.skus,
      // No se suman: el mismo artículo vende en varias semanas.
      total: <span className="text-muted">sin sumar</span>,
    },
    {
      titulo: "Unidades",
      celda: (s) => fmtNumero(s.unidades),
      numerica: true,
      orden: (s) => s.unidades,
      total: fmtNumero(sumar(semanas, (s) => s.unidades)),
    },
    {
      titulo: "Margen bruto $",
      celda: (s) => <strong>{fmtMoneda(s.margen)}</strong>,
      numerica: true,
      orden: (s) => s.margen,
      total: fmtMoneda(sumar(semanas, (s) => s.margen)),
    },
    {
      titulo: "Facturación",
      celda: (s) => fmtMoneda(s.facturacion),
      numerica: true,
      orden: (s) => s.facturacion,
      total: fmtMoneda(sumar(semanas, (s) => s.facturacion)),
    },
    {
      titulo: "%margen bruto",
      celda: (s) => <PctBanda pct={s.margenPct} />,
      numerica: true,
      orden: (s) => s.margenPct,
      // Ponderado: margen total sobre facturación total. El promedio simple
      // dejaría que una semana a medio correr pese lo mismo que una completa.
      total: fmtPct(
        promedioPonderado(
          semanas,
          (s) => s.margen,
          (s) => s.facturacion,
        ),
      ),
    },
    {
      titulo: "Días medidos",
      // La columna que hace legible a la semana 1. La historia de stock arrancó
      // el 21/08, así que sus primeros días no se miraron: sus quiebres no se
      // pueden conocer y no hay forma de reconstruirlos.
      celda: (s) => (
        <span style={s.diasMirados < 7 ? { color: PALETA[2] } : undefined}>
          {fmtNumero(s.diasMirados)} de 7
        </span>
      ),
      numerica: true,
      orden: (s) => s.diasMirados,
    },
    {
      titulo: "Quebraron stock",
      celda: (s) => (
        <span
          style={s.skusQuebrados > 0 ? { color: TEMA.negativo } : undefined}
        >
          {s.skusQuebrados === 0 ? "—" : fmtNumero(s.skusQuebrados)}
        </span>
      ),
      numerica: true,
      orden: (s) => s.skusQuebrados,
      total: <span className="text-muted">sin sumar</span>,
    },
  ];
}

function columnasArticulo(
  filas: FilaResultado[],
  hoy: string,
): Columna<FilaResultado>[] {
  const pct = (f: FilaResultado, n: number) => {
    const c = f.semanas[n];
    return c && c.facturacion > 0 ? c.margen / c.facturacion : null;
  };

  return [
    { titulo: "SKU", celda: (f) => f.sku, orden: (f) => f.sku },
    {
      titulo: "Producto",
      celda: (f) => (
        <span
          className="block max-w-[104px] sm:max-w-[230px] truncate"
          title={f.producto ?? undefined}
        >
          {f.producto ?? "—"}
        </span>
      ),
      orden: (f) => f.producto,
    },
    // Cuatro columnas por semana. Las semanas que todavía no empezaron se
    // muestran igual: una columna que falta se lee como "no la medimos", y una
    // vacía y rotulada dice la verdad.
    ...SEMANAS.flatMap((s): Columna<FilaResultado>[] => {
      const futura = !semanaEmpezada(s, hoy);
      const apagado = futura ? { opacity: 0.45 } : undefined;
      return [
        {
          titulo: `S${s.numero} · uds`,
          celda: (f) => (
            <span style={apagado}>
              {fmtNumero(f.semanas[s.numero]?.unidades)}
            </span>
          ),
          numerica: true,
          orden: (f) => f.semanas[s.numero]?.unidades ?? null,
          total: fmtNumero(sumar(filas, (f) => f.semanas[s.numero]?.unidades)),
        },
        {
          titulo: `S${s.numero} · margen`,
          celda: (f) => (
            <span style={apagado}>
              {fmtMonedaCorta(f.semanas[s.numero]?.margen)}
            </span>
          ),
          numerica: true,
          orden: (f) => f.semanas[s.numero]?.margen ?? null,
          total: fmtMoneda(sumar(filas, (f) => f.semanas[s.numero]?.margen)),
        },
        {
          titulo: `S${s.numero} · %`,
          celda: (f) => (
            <span style={apagado}>
              <PctBanda pct={pct(f, s.numero)} />
            </span>
          ),
          numerica: true,
          orden: (f) => pct(f, s.numero),
          total: fmtPct(
            promedioPonderado(
              filas,
              (f) => f.semanas[s.numero]?.margen,
              (f) => f.semanas[s.numero]?.facturacion,
            ),
          ),
        },
        {
          titulo: `S${s.numero} · s/stock`,
          celda: (f) => {
            const d = f.semanas[s.numero]?.diasSinStock ?? 0;
            return (
              <span
                style={d > 0 ? { color: TEMA.negativo } : { color: TEMA.muted }}
              >
                {d === 0 ? "—" : `${fmtNumero(d)} d`}
              </span>
            );
          },
          numerica: true,
          orden: (f) => f.semanas[s.numero]?.diasSinStock ?? null,
          total: (
            <span className="text-muted">
              {fmtNumero(
                filas.filter(
                  (f) => (f.semanas[s.numero]?.diasSinStock ?? 0) > 0,
                ).length,
              )}
            </span>
          ),
        },
      ];
    }),
    {
      titulo: "Uds total",
      celda: (f) => <strong>{fmtNumero(f.unidades)}</strong>,
      numerica: true,
      orden: (f) => f.unidades,
      total: fmtNumero(sumar(filas, (f) => f.unidades)),
    },
    {
      titulo: "Margen bruto total",
      celda: (f) => <strong>{fmtMoneda(f.margen)}</strong>,
      numerica: true,
      orden: (f) => f.margen,
      total: fmtMoneda(sumar(filas, (f) => f.margen)),
    },
  ];
}

export default function DashboardResultadosPage() {
  const hoy = hoyArgentina();
  const inicial: FiltrosElasticidad = {
    desde: EXPERIMENTO_INICIO,
    hasta: EXPERIMENTO_FIN,
  };
  const [filtros, setFiltros] = useState<FiltrosElasticidad>(inicial);
  const [buscado, setBuscado] = useState("");

  const { data, cargando, error, recargar, empezarCarga } =
    useDatosTablero<Respuesta>(
      "/api/resultados-elasticidad",
      {
        proveedor: filtros.proveedor,
        marca: filtros.marca,
        sku: filtros.sku,
      },
      { conOpciones: "1" },
    );

  const cambiar = (f: FiltrosElasticidad) => {
    empezarCarga();
    setFiltros(f);
  };
  const alternarSku = (sku: string) =>
    cambiar({ ...filtros, sku: alternarValor(filtros.sku, sku) });

  const buscar = () => {
    const sku = buscado.trim().toUpperCase();
    if (!sku) return;
    setBuscado("");
    if (!filtros.sku?.includes(sku)) alternarSku(sku);
  };

  const sinCambios =
    sinValores(filtros.proveedor) &&
    sinValores(filtros.marca) &&
    sinValores(filtros.sku);
  const enCurso = SEMANAS.find((s) => hoy >= s.desde && hoy < s.hasta);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          {/* h2 y no h1: el h1 de la página es el logo, que vive en el layout. */}
          <h2 className="text-lg font-semibold tracking-tight">
            Resultados por semana{" "}
            <span className="text-muted text-sm font-normal">
              · experimento de margen
            </span>
          </h2>
          <p className="text-muted mt-1 text-xs">
            {diaMes(EXPERIMENTO_INICIO)} al {diaMes(EXPERIMENTO_FIN)}
            {enCurso
              ? ` · corriendo la semana ${enCurso.numero}`
              : " · experimento terminado"}
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

      <div className="border-line bg-panel flex flex-col gap-3 rounded-xl border p-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-muted text-[11px]">Buscar SKU</span>
            <input
              type="search"
              value={buscado}
              placeholder="AL27003"
              onChange={(e) => setBuscado(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && buscar()}
              onBlur={buscar}
              className="border-line bg-panel-2 text-ink placeholder:text-muted w-32 rounded-lg border px-2.5 py-1.5 text-xs uppercase"
            />
          </label>
          <SelectorMultiple
            etiqueta="Proveedor"
            valores={filtros.proveedor}
            opciones={data?.opciones?.proveedores ?? []}
            onChange={(v) => cambiar({ ...filtros, proveedor: v })}
          />
          <SelectorMultiple
            etiqueta="Marca"
            valores={filtros.marca}
            opciones={data?.opciones?.marcas ?? []}
            onChange={(v) => cambiar({ ...filtros, marca: v })}
          />
          <BotonLimpiar
            onClick={() => cambiar(inicial)}
            deshabilitado={sinCambios}
          />
        </div>

        {/* El período NO se puede mover, y hay que decir por qué: si se pudiera,
            las columnas "semana 1, 2 y 3" pasarían a ser una etiqueta que no
            corresponde con lo que muestran. */}
        <span className="text-muted text-[11px] leading-tight">
          Las tres semanas son fijas y de 7 días cada una. El día de corte
          pertenece a la semana siguiente: lo vendido el{" "}
          {diaMes(SEMANAS[1].desde)} entra en la semana 2, no en la 1, así que
          ninguna venta se cuenta dos veces. Para mirar otro período está la
          pestaña <em>Elasticidad de precios</em>.
        </span>
      </div>

      {!sinValores(filtros.sku) && (
        <div className="flex flex-wrap items-center gap-2">
          {filtros.sku!.map((s) => (
            <button
              key={s}
              onClick={() => alternarSku(s)}
              className="border-c1/40 bg-c1/10 text-c1 hover:bg-c1/20 rounded-full border px-3 py-1 text-xs"
            >
              SKU {s} ✕
            </button>
          ))}
        </div>
      )}

      {error && (
        <Aviso>
          <p className="font-medium">No se pudieron leer los datos.</p>
          <p className="mt-1 font-mono text-xs break-words opacity-80">
            {error}
          </p>
        </Aviso>
      )}

      {!error && cargando && !data && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {SEMANAS.map((s) => (
            <Esqueleto key={s.numero} className="h-[86px]" />
          ))}
        </div>
      )}

      {!error && data && (
        <div
          className={`space-y-4 transition-opacity ${cargando ? "opacity-50" : ""}`}
        >
          <ConAlarmaMargen
            activa={data.semanas.reduce((t, s) => t + s.margen, 0) < 0}
          >
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {data.semanas.map((s) => {
                const futura = !semanaEmpezada(SEMANAS[s.numero - 1], hoy);
                const corriendo = enCurso?.numero === s.numero;
                return (
                  <TarjetaKpi
                    key={s.numero}
                    titulo={`Semana ${s.numero} · ${s.label}${corriendo ? " · en curso" : ""}`}
                    valor={futura ? "—" : fmtMoneda(s.margen)}
                    detalle={
                      futura
                        ? "Todavía no empezó"
                        : `${fmtNumero(s.unidades)} unidades · ${fmtPct(s.margenPct)} de margen · ${fmtNumero(s.skusQuebrados)} quebraron stock`
                    }
                    acento={corriendo ? PALETA[1] : undefined}
                  />
                );
              })}
            </div>
          </ConAlarmaMargen>

          <Panel
            titulo="Las tres semanas"
            nota="Se llenan solas a medida que entran las ventas"
          >
            <Tabla
              filas={data.semanas}
              columnas={columnasResumen(data.semanas)}
              clave={(s) => String(s.numero)}
              etiquetaTotal="Total del experimento"
              vacio="Todavía no hay ventas en el experimento."
            />
          </Panel>

          <Panel
            titulo="Artículo por artículo"
            nota={
              (data.recortada
                ? `Los ${data.articulos.length} de mayor margen`
                : `${fmtNumero(data.articulos.length)} artículos`) +
              " · el color del % dice en qué banda cayó esa semana"
            }
          >
            <Tabla
              filas={data.articulos}
              columnas={columnasArticulo(data.articulos, hoy)}
              clave={(f) => f.sku}
              onClickFila={(f) => alternarSku(f.sku)}
              activa={(f) => Boolean(filtros.sku?.includes(f.sku))}
              etiquetaTotal={data.recortada ? "Total (los mostrados)" : "Total"}
              vacio="Ningún artículo con ventas para el filtro elegido."
            />
          </Panel>

          <Aviso tono="info">
            <p className="font-medium">
              La semana 1 se lee distinto que las otras dos.
            </p>
            <p className="mt-1">
              Las ventas de la semana 1 están completas —salen de{" "}
              <code>gold.fact_ventas</code>, que tiene la historia desde mayo—,
              pero <strong>sus quiebres de stock no</strong>. La medición de
              disponibilidad empezó el 21/08, así que de los 7 días de esa
              semana sólo se miraron los últimos. Un &ldquo;—&rdquo; en{" "}
              <em>S1 · s/stock</em> no quiere decir &ldquo;nunca quebró&rdquo;:
              quiere decir que no lo estábamos mirando.
            </p>
            <p className="mt-1">
              La columna <em>Días medidos</em> de la tabla de arriba dice
              exactamente cuántos días de cada semana se llegaron a observar. De
              la semana 2 en adelante son los 7.
            </p>
            <p className="mt-1">
              <strong>El color del porcentaje</strong> es la banda en la que
              cayó esa semana:{" "}
              {BANDAS.filter((b) => b.delExperimento).map((b, i) => (
                <span key={b.clave}>
                  {i > 0 && " · "}
                  <span style={{ color: COLOR_BANDA[b.clave] }}>{b.label}</span>
                </span>
              ))}
              . Si un artículo cambia de color entre semanas, es que se le movió
              el margen — y al lado están las unidades que hizo con cada uno.
            </p>
          </Aviso>
        </div>
      )}
    </div>
  );
}
