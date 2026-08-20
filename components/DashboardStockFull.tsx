"use client";

import { useState } from "react";
import BarrasCategoria from "@/components/charts/BarrasCategoria";
import { BotonLimpiar, SelectorMultiple } from "@/components/SelectorFiltro";
import { sumar, Tabla, type Columna } from "@/components/Tabla";
import { Aviso, Esqueleto, Panel, TarjetaKpi } from "@/components/ui";
import { alternar as alternarValor, vacio as sinValores } from "@/lib/filtros";
import { fmtFechaCorta, fmtMoneda, fmtNumero, fmtPct } from "@/lib/format";
import { PALETA, TEMA } from "@/lib/paleta";
import { TRAMOS, UMBRALES_TARJETAS, UMBRAL_PARADO } from "@/lib/stock-full";
import { useDatosTablero } from "@/lib/useDatosTablero";
import type { DashboardStockFull, FilaStockFull, FiltrosStockFull } from "@/lib/types";

type Opciones = { proveedores: string[]; marcas: string[] };
type Respuesta = DashboardStockFull & { opciones: Opciones | null };

/** El color se pone más rojo cuanto más tiempo lleva parado. */
function colorDias(dias: number | null): string {
  if (dias == null) return TEMA.negativo;
  if (dias > 30) return TEMA.negativo;
  if (dias > UMBRAL_PARADO) return PALETA[2];
  if (dias > 10) return PALETA[3];
  return PALETA[1];
}

function columnas(filas: FilaStockFull[]): Columna<FilaStockFull>[] {
  return [
    { titulo: "SKU", celda: (f) => f.sku ?? "—", orden: (f) => f.sku },
    {
      titulo: "Producto",
      celda: (f) => (
        <span
          className="block max-w-[300px] truncate"
          title={f.producto ?? undefined}
        >
          {f.producto ?? "—"}
        </span>
      ),
      orden: (f) => f.producto,
    },
    {
      titulo: "Marca",
      celda: (f) => (
        <span className="block max-w-[130px] truncate">{f.marca ?? "—"}</span>
      ),
      orden: (f) => f.marca,
    },
    {
      titulo: "Días sin venta",
      // "Nunca" y un número grande son cosas distintas y se escriben distinto:
      // un artículo que jamás rotó puede ser nuevo, y merece otra conversación
      // que uno que vendía y dejó de vender.
      celda: (f) => (
        <span style={{ color: colorDias(f.diasSinVenta) }}>
          {f.diasSinVenta == null ? "nunca vendió" : fmtNumero(f.diasSinVenta)}
        </span>
      ),
      numerica: true,
      // Los que nunca vendieron ordenan como el peor caso posible, no como null,
      // para que queden arriba junto a los más parados.
      orden: (f) => f.diasSinVenta ?? 99_999,
      // El PROMEDIO de días, y solo sobre los que alguna vez vendieron. Sumar
      // días de artículos distintos no da nada, y meter a los que nunca vendieron
      // como si fueran un número inventaría un promedio.
      total: (() => {
        const conVenta = filas.filter((f) => f.diasSinVenta != null);
        const nunca = filas.length - conVenta.length;
        if (conVenta.length === 0)
          return nunca > 0 ? `${fmtNumero(nunca)} nunca` : "—";
        const prom = Math.round(
          sumar(conVenta, (f) => f.diasSinVenta) / conVenta.length,
        );
        return (
          `${fmtNumero(prom)} prom.` +
          (nunca > 0 ? ` · ${fmtNumero(nunca)} nunca` : "")
        );
      })(),
    },
    {
      titulo: "Última venta",
      celda: (f) => (f.ultimaVenta ? fmtFechaCorta(f.ultimaVenta) : "—"),
      orden: (f) => f.ultimaVenta,
    },
    {
      titulo: "En Full",
      celda: (f) => fmtNumero(f.disponible),
      numerica: true,
      orden: (f) => f.disponible,
      total: fmtNumero(sumar(filas, (f) => f.disponible)),
    },
    {
      titulo: "No disponible",
      celda: (f) => (
        <span style={f.noDisponible > 0 ? { color: TEMA.negativo } : undefined}>
          {fmtNumero(f.noDisponible)}
        </span>
      ),
      numerica: true,
      orden: (f) => f.noDisponible,
      total: fmtNumero(sumar(filas, (f) => f.noDisponible)),
    },
    {
      titulo: "Vendidas 30d",
      celda: (f) => fmtNumero(f.uds30),
      numerica: true,
      orden: (f) => f.uds30,
      total: fmtNumero(sumar(filas, (f) => f.uds30)),
    },
    {
      titulo: "Valorización",
      celda: (f) => fmtMoneda(f.valorizacion),
      numerica: true,
      orden: (f) => f.valorizacion,
      total: fmtMoneda(sumar(filas, (f) => f.valorizacion)),
    },
  ];
}

export default function DashboardStockFullPage() {
  const inicial: FiltrosStockFull = {};
  const [filtros, setFiltros] = useState<FiltrosStockFull>(inicial);

  const { data, cargando, error, recargar, empezarCarga } = useDatosTablero<Respuesta>(
    "/api/stock-full",
    {
      proveedor: filtros.proveedor,
      marca: filtros.marca,
      sku: filtros.sku,
      minDias: filtros.minDias == null ? undefined : [String(filtros.minDias)],
    },
    { conOpciones: "1" },
  );

  const cambiar = (f: FiltrosStockFull) => {
    empezarCarga();
    setFiltros(f);
  };

  const alternarEn = (clave: "proveedor" | "marca" | "sku") => (valor: string) =>
    cambiar({ ...filtros, [clave]: alternarValor(filtros[clave], valor) });

  const k = data?.kpis;
  const sinCambios =
    sinValores(filtros.proveedor) &&
    sinValores(filtros.marca) &&
    sinValores(filtros.sku) &&
    filtros.minDias == null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          {/* h2 y no h1: el h1 de la página es el logo, que vive en el layout. */}
          <h2 className="text-lg font-semibold tracking-tight">
            Stock Full <span className="text-muted text-sm font-normal">· días sin venta</span>
          </h2>
          <p className="text-muted mt-1 text-xs">
            {data
              ? `Actualizado ${new Date(data.generadoEn).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}`
              : "Cargando datos en vivo…"}
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
          {/* Los umbrales son los mismos del reporte de Data Studio, y son
              ACUMULATIVOS: "+21" incluye a los de 35 días. La pregunta es
              "cuánto llevo parado hace más de X", no "cuánto cae en la franja". */}
          <div className="flex flex-wrap gap-1">
            {UMBRALES_TARJETAS.map((d) => {
              const activo = filtros.minDias === d;
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => cambiar({ ...filtros, minDias: activo ? undefined : d })}
                  aria-pressed={activo}
                  className={`rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${
                    activo
                      ? "border-c1 bg-c1/15 text-c1"
                      : "border-line text-muted hover:bg-panel-2 hover:text-ink"
                  }`}
                >
                  +{d} días sin vender
                  <span className="ml-1.5 opacity-70">
                    {data ? fmtNumero(data.umbrales[d] ?? 0) : "…"}
                  </span>
                </button>
              );
            })}
          </div>

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
          <BotonLimpiar onClick={() => cambiar(inicial)} deshabilitado={sinCambios} />
        </div>

        <span className="text-muted text-[11px] leading-tight">
          Mide <strong>días desde la última venta</strong> de cada SKU con stock en el depósito
          de Mercado Libre. Toma la historia completa de ventas, sin tope: &ldquo;nunca
          vendió&rdquo; es su propia categoría y no un número grande.
        </span>
      </div>

      {!sinValores(filtros.sku) && (
        <div className="flex flex-wrap items-center gap-2">
          {filtros.sku!.map((s) => (
            <button
              key={s}
              onClick={() => alternarEn("sku")(s)}
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
          <p className="mt-1 font-mono text-xs break-words opacity-80">{error}</p>
        </Aviso>
      )}

      {error ? null : !k ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Esqueleto key={i} className="h-[86px]" />
          ))}
        </div>
      ) : (
        <div className={`grid gap-3 transition-opacity sm:grid-cols-2 lg:grid-cols-4 ${cargando ? "opacity-50" : ""}`}>
          <TarjetaKpi
            titulo="Unidades en Full"
            valor={fmtNumero(k.disponible)}
            detalle={`${fmtNumero(k.skus)} SKU · ${fmtNumero(k.uds30)} vendidas en 30 días`}
          />
          <TarjetaKpi
            titulo="Valorizado"
            valor={fmtMoneda(k.valorizacion)}
            detalle="Al precio de venta, o al publicado si nunca vendió"
          />
          {/* La tarjeta que da la respuesta: cuánta plata está quieta. */}
          <TarjetaKpi
            titulo={`Parado +${UMBRAL_PARADO} días`}
            valor={fmtMoneda(k.valorizacionParada)}
            detalle={
              k.valorizacion > 0
                ? `${fmtNumero(k.skusParados)} SKU · ${fmtPct(k.valorizacionParada / k.valorizacion)} del stock`
                : `${fmtNumero(k.skusParados)} SKU`
            }
            acento={TEMA.negativo}
          />
          <TarjetaKpi
            titulo="No disponible"
            valor={fmtNumero(k.noDisponible)}
            detalle="En el depósito pero ML no las puede vender"
            acento={k.noDisponible > 0 ? PALETA[2] : undefined}
          />
        </div>
      )}

      {data && (
        <div className={`space-y-4 transition-opacity ${cargando ? "opacity-50" : ""}`}>
          <Panel
            titulo="Cuánto stock hay en cada tramo"
            nota="Valorizado · por días desde la última venta"
          >
            <BarrasCategoria
              datos={TRAMOS.map((t) => ({
                label: t.label,
                valor: data.tramos
                  .filter((x) => x.tramo === t.clave)
                  .reduce((a, x) => a + x.valorizacion, 0),
              }))}
              formato={fmtMoneda}
              horizontal={false}
              colorUnico={PALETA[4]}
              alturaMinima={220}
              vacio="Sin stock en Full."
            />
          </Panel>

          <Panel
            titulo="Artículos"
            nota={
              (data.recortada
                ? `Se muestran los ${data.filas.length} más parados`
                : `${fmtNumero(data.filas.length)} SKU con stock`) +
              " · los que nunca vendieron van primero · click para filtrar"
            }
          >
            <Tabla
              filas={data.filas}
              columnas={columnas(data.filas)}
              etiquetaTotal={
                data.recortada ? "Total (los 500 mostrados)" : "Total"
              }
              clave={(f, i) => `${f.sku ?? "sin-sku"}-${i}`}
              onClickFila={(f) => f.sku && alternarEn("sku")(f.sku)}
              activa={(f) => (filtros.sku?.length ? filtros.sku.includes(f.sku ?? "") : false)}
              vacio="Ningún artículo con stock para el filtro elegido."
            />
          </Panel>

          {/* Lo que este tablero NO dice, dicho en la pantalla. Sin esto, "60
              días sin venta" se leería como "60 días parado en el depósito", y
              son dos cosas distintas. */}
          <Aviso tono="info">
            <p className="font-medium">Qué mide exactamente este número.</p>
            <p className="mt-1">
              <strong>Días desde la última venta del SKU</strong>, no días que la mercadería
              lleva parada en el depósito. Un artículo que llegó ayer puede figurar con 60 días
              si ese SKU se vendió por última vez hace 60 desde otra publicación.
            </p>
            <p className="mt-1">
              Para lo segundo hace falta saber si había stock <em>cada día</em>, y esa historia
              recién{" "}
              {data.historiaDesde
                ? `empezó a guardarse el ${fmtFechaCorta(data.historiaDesde)}`
                : "va a empezar a guardarse cuando el orquestador corra el catálogo"}
              . Cuando haya algunas semanas acumuladas, se agrega la métrica buena al lado de
              ésta.
            </p>
          </Aviso>
        </div>
      )}
    </div>
  );
}
