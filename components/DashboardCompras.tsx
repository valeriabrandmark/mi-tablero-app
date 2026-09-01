"use client";

import { useMemo, useState } from "react";
import { BotonLimpiar, SelectorMultiple } from "@/components/SelectorFiltro";
import { sumar, Tabla, type Columna } from "@/components/Tabla";
import { Aviso, Esqueleto, Panel, TarjetaKpi } from "@/components/ui";
import {
  aCsv,
  aTxt,
  aUnidades,
  cantidadSugerida,
  COLUMNAS_SIGMA,
  DESCUENTO_MAXIMO,
  descuentoValido,
  lineasParaExportar,
  MESES_RENTABILIDAD,
  nombreArchivo,
  renglonInicial,
  UNIDADES_COMPRA,
  type ClaveUnidadCompra,
  type RenglonOrden,
} from "@/lib/compras";
import { vacio as sinValores } from "@/lib/filtros";
import { fmtFechaCorta, fmtMes, fmtMoneda, fmtNumero, fmtPct } from "@/lib/format";
import { PALETA, TEMA } from "@/lib/paleta";
import {
  COBERTURA_OBJETIVO_DIAS,
  PLAZO_REPOSICION_DIAS,
  VENTANAS_RITMO,
  VENTANA_POR_DEFECTO,
} from "@/lib/stock";
import { useDatosTablero } from "@/lib/useDatosTablero";
import type { DashboardCompras, FilaCompra, FiltrosCompras } from "@/lib/types";

type Opciones = { proveedores: string[]; marcas: string[]; meses: string[] };
type Respuesta = DashboardCompras & { opciones: Opciones | null };

const CLASE_CELDA_EDITABLE =
  "border-line bg-panel-2 text-ink focus:border-c1 w-16 rounded-md border px-1.5 py-1 text-right text-xs tabular-nums outline-none";

/** Descarga un texto como archivo. */
function bajar(contenido: string, nombre: string, tipo: string) {
  const url = URL.createObjectURL(new Blob([contenido], { type: tipo }));
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function DashboardComprasPage() {
  const inicial: FiltrosCompras = { ventana: VENTANA_POR_DEFECTO };
  const [filtros, setFiltros] = useState<FiltrosCompras>(inicial);
  const [buscado, setBuscado] = useState("");

  /**
   * LO QUE EL USUARIO CAMBIÓ A MANO, por SKU. Sólo eso.
   *
   * SE GUARDAN LAS EDICIONES Y NO LA ORDEN ENTERA, que es la diferencia que
   * importa: la orden se deriva de las filas que llegaron más lo que la persona
   * tocó encima. Guardando la orden completa habría que copiarla cada vez que
   * el servidor manda filas nuevas —y eso es un `setState` adentro de un
   * efecto, que además de estar prohibido por el lint es una copia que se puede
   * desincronizar del cálculo. Así, un artículo que nadie tocó siempre muestra
   * el sugerido de HOY.
   *
   * Es un borrador y vive en la pantalla: hasta que no se baja el archivo no
   * existe en ningún lado. Va por SKU —y no por posición— para que sobreviva a
   * cambiar un filtro o a reordenar la tabla.
   */
  const [ediciones, setEdiciones] = useState<Map<string, RenglonOrden>>(new Map());

  const { data, cargando, error, recargar, empezarCarga } = useDatosTablero<Respuesta>(
    "/api/compras",
    {
      proveedor: filtros.proveedor,
      marca: filtros.marca,
      buscar: filtros.buscar ? [filtros.buscar] : undefined,
      ventana: [String(filtros.ventana ?? VENTANA_POR_DEFECTO)],
      mes: filtros.mes ? [filtros.mes] : undefined,
      todos: filtros.todos ? ["1"] : undefined,
    },
    { conOpciones: "1" },
  );

  const filas = useMemo(() => data?.filas ?? [], [data]);

  /**
   * La orden como está ahora: el sugerido de cada artículo, con lo editado
   * encima. Un artículo que nadie tocó arranca con la cantidad sugerida y con
   * la oferta del proveedor del mes elegido.
   */
  const orden = useMemo(
    () =>
      new Map(filas.map((f) => [f.sku, ediciones.get(f.sku) ?? renglonInicial(f)])),
    [filas, ediciones],
  );

  const cambiar = (f: FiltrosCompras) => {
    empezarCarga();
    setFiltros(f);
  };

  const editar = (sku: string, parche: Partial<RenglonOrden>) => {
    const actual = orden.get(sku);
    if (!actual) return;
    setEdiciones((previo) => {
      const siguiente = new Map(previo);
      siguiente.set(sku, { ...actual, ...parche });
      return siguiente;
    });
  };

  /** Cambia la unidad de TODAS las filas visibles, recalculando la cantidad. */
  const todasEnUnidad = (unidad: ClaveUnidadCompra) =>
    setEdiciones((previo) => {
      const siguiente = new Map(previo);
      for (const f of filas) {
        const actual = orden.get(f.sku);
        if (!actual) continue;
        // La cantidad se recalcula desde las UNIDADES que ya había pedido, no
        // desde el sugerido: si pidió 5 bultos y pasa a unidades, tiene que ver
        // esas mismas unidades, no volver al cálculo original.
        const unidades = aUnidades(actual.cantidad, actual.unidad, f.unidadesPorBulto);
        siguiente.set(f.sku, {
          ...actual,
          unidad,
          cantidad: cantidadSugerida(unidades, unidad, f.unidadesPorBulto),
        });
      }
      return siguiente;
    });

  // Borrar las ediciones ES volver al sugerido: como la orden se deriva, sin
  // nada encima cada artículo vuelve a mostrar lo que el cálculo pide hoy.
  const volverAlSugerido = () =>
    setEdiciones((previo) => {
      const siguiente = new Map(previo);
      for (const f of filas) siguiente.delete(f.sku);
      return siguiente;
    });

  const vaciar = () =>
    setEdiciones((previo) => {
      const siguiente = new Map(previo);
      for (const f of filas) {
        const actual = orden.get(f.sku);
        if (actual) siguiente.set(f.sku, { ...actual, cantidad: 0 });
      }
      return siguiente;
    });

  // --- Los totales de la orden, que es lo que se está por comprar ----------
  const resumen = useMemo(() => {
    let renglones = 0;
    let unidades = 0;
    let bultos = 0;
    let bruto = 0;
    let neto = 0;
    let recortados = 0;
    for (const f of filas) {
      const r = orden.get(f.sku);
      if (!r || !(r.cantidad > 0)) continue;
      renglones += 1;
      const u = aUnidades(r.cantidad, r.unidad, f.unidadesPorBulto);
      unidades += u;
      if (r.unidad === "bulto") bultos += r.cantidad;
      const lista = f.costoLista > 0 ? f.costoLista : f.costo;
      const desc = descuentoValido(r.descuento);
      if (r.descuento > DESCUENTO_MAXIMO) recortados += 1;
      bruto += u * lista;
      neto += u * lista * (1 - desc / 100);
    }
    return { renglones, unidades, bultos, bruto, neto, recortados };
  }, [filas, orden]);

  // LAS ÓRDENES SON POR PROVEEDOR. Con dos elegidos el archivo mezclaría
  // proveedores en una sola orden, que es algo que no existe.
  const proveedorUnico =
    filtros.proveedor?.length === 1 ? filtros.proveedor[0] : null;

  const descargar = (formato: "txt" | "csv") => {
    if (!proveedorUnico) return;
    const lineas = lineasParaExportar(filas, orden);
    if (lineas.length === 0) return;
    if (formato === "txt") {
      bajar(aTxt(lineas), nombreArchivo(proveedorUnico, "txt"), "text/plain;charset=utf-8");
    } else {
      bajar(aCsv(lineas), nombreArchivo(proveedorUnico, "csv"), "text/csv;charset=utf-8");
    }
  };

  const sinCambios =
    sinValores(filtros.proveedor) &&
    sinValores(filtros.marca) &&
    !filtros.buscar &&
    !filtros.todos &&
    !filtros.mes &&
    (filtros.ventana ?? VENTANA_POR_DEFECTO) === VENTANA_POR_DEFECTO;

  const columnas: Columna<FilaCompra>[] = [
    { titulo: "SKU", celda: (f) => f.sku, orden: (f) => f.sku },
    {
      titulo: "Artículo",
      celda: (f) => (
        <span
          className="block max-w-[136px] truncate sm:max-w-[240px]"
          title={f.producto ?? undefined}
        >
          {f.producto ?? "—"}
        </span>
      ),
      orden: (f) => f.producto,
    },
    {
      titulo: "U. x bulto",
      celda: (f) => (f.unidadesPorBulto > 1 ? fmtNumero(f.unidadesPorBulto) : "—"),
      numerica: true,
      orden: (f) => f.unidadesPorBulto,
    },
    {
      titulo: "Stock",
      celda: (f) => fmtNumero(f.total),
      numerica: true,
      orden: (f) => f.total,
      total: fmtNumero(sumar(filas, (f) => f.total)),
    },
    {
      titulo: "Cobertura",
      celda: (f) =>
        f.cobertura == null ? (
          <span className="text-muted">sin venta</span>
        ) : (
          <span
            style={
              f.cobertura < PLAZO_REPOSICION_DIAS ? { color: TEMA.negativo } : undefined
            }
          >
            {fmtNumero(Math.round(f.cobertura))} d
          </span>
        ),
      numerica: true,
      orden: (f) => f.cobertura ?? 999_999,
    },
    {
      titulo: "Sugerido u.",
      celda: (f) => (f.sugerido > 0 ? fmtNumero(f.sugerido) : "—"),
      numerica: true,
      orden: (f) => f.sugerido,
      total: fmtNumero(sumar(filas, (f) => f.sugerido)),
    },
    {
      // La decisión que el usuario pidió poder tomar fila por fila: la mayoría
      // se compra por bulto, pero hay excepciones.
      titulo: "Unidad",
      celda: (f) => {
        const r = orden.get(f.sku);
        return (
          <select
            value={r?.unidad ?? "unidad"}
            onChange={(e) => {
              const unidad = e.target.value as ClaveUnidadCompra;
              const actual = orden.get(f.sku);
              if (!actual) return;
              const unidades = aUnidades(actual.cantidad, actual.unidad, f.unidadesPorBulto);
              editar(f.sku, {
                unidad,
                cantidad: cantidadSugerida(unidades, unidad, f.unidadesPorBulto),
              });
            }}
            className="border-line bg-panel-2 text-ink focus:border-c1 rounded-md border px-1.5 py-1 text-xs outline-none"
          >
            {UNIDADES_COMPRA.map((u) => (
              <option key={u.clave} value={u.clave}>
                {u.label}
              </option>
            ))}
          </select>
        );
      },
      orden: (f) => orden.get(f.sku)?.unidad ?? "",
    },
    {
      titulo: "Cantidad",
      celda: (f) => {
        const r = orden.get(f.sku);
        return (
          <input
            type="number"
            min={0}
            step={1}
            value={r?.cantidad ?? 0}
            onChange={(e) =>
              editar(f.sku, { cantidad: Math.max(0, Math.floor(Number(e.target.value) || 0)) })
            }
            className={CLASE_CELDA_EDITABLE}
            aria-label={`Cantidad a comprar de ${f.sku}`}
          />
        );
      },
      numerica: true,
      orden: (f) => orden.get(f.sku)?.cantidad ?? 0,
    },
    {
      titulo: "Unidades",
      // Cuántas unidades físicas son, que es lo único comparable entre una fila
      // en bultos y otra en unidades.
      celda: (f) => {
        const r = orden.get(f.sku);
        if (!r || r.cantidad <= 0) return <span className="text-muted">—</span>;
        return fmtNumero(aUnidades(r.cantidad, r.unidad, f.unidadesPorBulto));
      },
      numerica: true,
      orden: (f) => {
        const r = orden.get(f.sku);
        return r ? aUnidades(r.cantidad, r.unidad, f.unidadesPorBulto) : 0;
      },
      total: fmtNumero(resumen.unidades),
    },
    {
      titulo: "Desc. %",
      celda: (f) => {
        const r = orden.get(f.sku);
        const excedido = (r?.descuento ?? 0) > DESCUENTO_MAXIMO;
        return (
          <input
            type="number"
            min={0}
            max={DESCUENTO_MAXIMO}
            step={0.5}
            value={r?.descuento ?? 0}
            onChange={(e) => editar(f.sku, { descuento: Number(e.target.value) || 0 })}
            className={`${CLASE_CELDA_EDITABLE} ${excedido ? "border-rose-500/60" : ""}`}
            title={
              f.ofertaPct == null
                ? "El mes elegido no tiene este artículo cargado: arranca en 0"
                : `Oferta del proveedor en el mes elegido: ${f.ofertaPct.toFixed(2)} %`
            }
            aria-label={`Descuento de ${f.sku}`}
          />
        );
      },
      numerica: true,
      orden: (f) => orden.get(f.sku)?.descuento ?? 0,
    },
    {
      titulo: "A pagar",
      celda: (f) => {
        const r = orden.get(f.sku);
        if (!r || r.cantidad <= 0) return <span className="text-muted">—</span>;
        const lista = f.costoLista > 0 ? f.costoLista : f.costo;
        const u = aUnidades(r.cantidad, r.unidad, f.unidadesPorBulto);
        return fmtMoneda(u * lista * (1 - descuentoValido(r.descuento) / 100));
      },
      numerica: true,
      orden: (f) => {
        const r = orden.get(f.sku);
        if (!r) return 0;
        const lista = f.costoLista > 0 ? f.costoLista : f.costo;
        return (
          aUnidades(r.cantidad, r.unidad, f.unidadesPorBulto) *
          lista *
          (1 - descuentoValido(r.descuento) / 100)
        );
      },
      total: fmtMoneda(resumen.neto),
    },
    {
      // Para saber si se vende bien o si se estaba liquidando. Son dos motivos
      // distintos para el mismo ritmo de venta, y llevan a comprar distinto.
      titulo: `Rent. ${MESES_RENTABILIDAD} meses`,
      celda: (f) =>
        f.rentabilidad == null ? (
          <span className="text-muted">sin venta</span>
        ) : (
          <span
            style={{
              color: f.rentabilidad < 0 ? TEMA.negativo : f.rentabilidad < 0.1 ? PALETA[3] : undefined,
            }}
            title={`${fmtNumero(f.udsRentabilidad)} unidades vendidas`}
          >
            {fmtPct(f.rentabilidad)}
          </span>
        ),
      numerica: true,
      orden: (f) => f.rentabilidad,
    },
    {
      titulo: "Última compra",
      celda: (f) => (f.ultimaCompra ? fmtFechaCorta(f.ultimaCompra) : "—"),
      orden: (f) => f.ultimaCompra,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">
            Compras{" "}
            <span className="text-muted text-sm font-normal">
              · armar la orden y bajarla para Sigma
            </span>
          </h1>
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

          {/* El mes de la oferta: de acá sale el descuento que va al archivo. */}
          <div className="flex flex-col gap-1">
            <label className="text-muted text-[11px]" htmlFor="mes-oferta">
              Oferta del mes
            </label>
            <select
              id="mes-oferta"
              value={data?.mes ?? ""}
              onChange={(e) => cambiar({ ...filtros, mes: e.target.value })}
              className="border-line bg-panel-2 text-ink focus:border-c1 rounded-lg border px-2.5 py-1.5 text-xs outline-none"
            >
              {(data?.meses ?? []).map((m) => (
                <option key={m} value={m}>
                  {fmtMes(m)}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-muted text-[11px]">Ritmo medido sobre</span>
            <div className="flex flex-wrap gap-1">
              {VENTANAS_RITMO.map((v) => {
                const activo = (filtros.ventana ?? VENTANA_POR_DEFECTO) === v;
                return (
                  <button
                    key={v}
                    type="button"
                    onClick={() => cambiar({ ...filtros, ventana: v })}
                    aria-pressed={activo}
                    className={`rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${
                      activo
                        ? "border-c1 bg-c1/15 text-c1"
                        : "border-line text-muted hover:bg-panel-2 hover:text-ink"
                    }`}
                  >
                    {v} días
                  </button>
                );
              })}
            </div>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              cambiar({ ...filtros, buscar: buscado.trim() || undefined });
            }}
            className="flex flex-col gap-1"
          >
            <label className="text-muted text-[11px]" htmlFor="buscar-compras">
              Buscar
            </label>
            <input
              id="buscar-compras"
              value={buscado}
              onChange={(e) => setBuscado(e.target.value)}
              onBlur={() => cambiar({ ...filtros, buscar: buscado.trim() || undefined })}
              placeholder="SKU o artículo"
              className="border-line bg-panel-2 text-ink placeholder:text-muted focus:border-c1 w-40 rounded-lg border px-2.5 py-1.5 text-xs outline-none"
            />
          </form>

          <button
            type="button"
            onClick={() => cambiar({ ...filtros, todos: !filtros.todos })}
            aria-pressed={filtros.todos ?? false}
            className={`self-end rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${
              filtros.todos
                ? "border-c1 bg-c1/15 text-c1"
                : "border-line text-muted hover:bg-panel-2 hover:text-ink"
            }`}
          >
            {filtros.todos ? "Todos los artículos" : "Sólo los que hay que comprar"}
          </button>

          <BotonLimpiar
            onClick={() => {
              setBuscado("");
              cambiar(inicial);
            }}
            deshabilitado={sinCambios}
          />
        </div>

        <span className="text-muted text-[11px] leading-tight">
          El <strong>sugerido</strong> es lo que falta para cubrir{" "}
          {COBERTURA_OBJETIVO_DIAS + PLAZO_REPOSICION_DIAS} días de venta
          ({COBERTURA_OBJETIVO_DIAS} de objetivo más {PLAZO_REPOSICION_DIAS} que tarda la
          reposición) al ritmo de los últimos {filtros.ventana ?? VENTANA_POR_DEFECTO} días,
          contando el stock de <strong>los dos depósitos</strong>. El{" "}
          <strong>descuento</strong> viene de la oferta del proveedor del mes elegido y se
          puede corregir fila por fila.
        </span>
      </div>

      {error && (
        <Aviso>
          <p className="font-medium">No se pudieron leer los datos.</p>
          <p className="mt-1 font-mono text-xs break-words opacity-80">{error}</p>
        </Aviso>
      )}

      {error ? null : !data ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Esqueleto key={i} className="h-[86px]" />
          ))}
        </div>
      ) : (
        <div
          className={`grid grid-cols-2 gap-3 transition-opacity sm:grid-cols-2 lg:grid-cols-4 ${cargando ? "opacity-50" : ""}`}
        >
          <TarjetaKpi
            titulo="Renglones en la orden"
            valor={fmtNumero(resumen.renglones)}
            detalle={`de ${fmtNumero(filas.length)} artículos a la vista`}
          />
          <TarjetaKpi
            titulo="Unidades a pedir"
            valor={fmtNumero(resumen.unidades)}
            detalle={
              resumen.bultos > 0 ? `${fmtNumero(resumen.bultos)} bultos` : "todo por unidad"
            }
          />
          <TarjetaKpi
            titulo="A pagar con descuento"
            valor={fmtMoneda(resumen.neto)}
            detalle={`Sin descuento serían ${fmtMoneda(resumen.bruto)}`}
            acento={resumen.neto > 0 ? PALETA[1] : undefined}
          />
          <TarjetaKpi
            titulo="Ahorro por las ofertas"
            valor={fmtMoneda(resumen.bruto - resumen.neto)}
            detalle={
              data.mes ? `Oferta de ${fmtMes(data.mes)}` : "Sin mes de oferta cargado"
            }
          />
        </div>
      )}

      {data && (
        <div className={`space-y-4 transition-opacity ${cargando ? "opacity-50" : ""}`}>
          {/* La barra de la orden: acciones sobre todo lo que se ve, y la
              descarga. Va arriba de la tabla porque es lo que se hace al final
              y tiene que estar a mano sin scrollear 500 filas. */}
          <div className="border-line bg-panel flex flex-wrap items-center gap-2 rounded-xl border p-3">
            <span className="text-muted mr-1 text-[11px]">Toda la lista:</span>
            {UNIDADES_COMPRA.map((u) => (
              <button
                key={u.clave}
                type="button"
                onClick={() => todasEnUnidad(u.clave)}
                className="border-line hover:bg-panel-2 text-muted hover:text-ink rounded-lg border px-2.5 py-1.5 text-xs"
              >
                Pasar a {u.label.toLowerCase()}
              </button>
            ))}
            <button
              type="button"
              onClick={volverAlSugerido}
              className="border-line hover:bg-panel-2 text-muted hover:text-ink rounded-lg border px-2.5 py-1.5 text-xs"
            >
              Volver al sugerido
            </button>
            <button
              type="button"
              onClick={vaciar}
              className="border-line hover:bg-panel-2 text-muted hover:text-ink rounded-lg border px-2.5 py-1.5 text-xs"
            >
              Vaciar cantidades
            </button>

            <div className="ml-auto flex flex-wrap items-center gap-2">
              {!proveedorUnico && (
                <span className="text-muted text-[11px]">
                  Elegí <strong>un</strong> proveedor para bajar la orden
                </span>
              )}
              <button
                type="button"
                onClick={() => descargar("txt")}
                disabled={!proveedorUnico || resumen.renglones === 0}
                className="border-c1 bg-c1/15 text-c1 hover:bg-c1/25 rounded-lg border px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-40"
              >
                Bajar TXT para Sigma
              </button>
              <button
                type="button"
                onClick={() => descargar("csv")}
                disabled={!proveedorUnico || resumen.renglones === 0}
                className="border-line hover:bg-panel-2 text-muted hover:text-ink rounded-lg border px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-40"
              >
                Bajar CSV
              </button>
            </div>
          </div>

          <Panel
            titulo="Artículos"
            nota={
              (data.recortada
                ? `Los ${filas.length} de mayor peso`
                : `${fmtNumero(filas.length)} artículos`) +
              ` · ritmo de ${data.ventana} días` +
              (data.mes ? ` · oferta de ${fmtMes(data.mes)}` : "")
            }
          >
            <Tabla
              filas={filas}
              columnas={columnas}
              etiquetaTotal="Total de la orden"
              clave={(f) => f.sku}
              vacio={
                filtros.todos
                  ? "Ningún artículo para el filtro elegido."
                  : "Nada que comprar con este filtro: ningún artículo está por debajo de la cobertura objetivo."
              }
            />
          </Panel>

          <Aviso tono="info">
            <p className="font-medium">Qué lleva el archivo, y qué mirar antes de mandarlo.</p>
            <p className="mt-1">
              El archivo tiene las cuatro columnas de la grilla de Sigma —
              <span className="font-mono text-xs">{COLUMNAS_SIGMA.join(" · ")}</span>— y
              sólo los renglones con cantidad: un cero no es «comprar cero», es un artículo
              que decidiste no pedir. El <strong>TXT va separado por tabulaciones</strong> y
              el CSV por punto y coma, porque el descuento lleva coma decimal («15,00») y
              con coma separadora Excel lo parte al medio.
            </p>
            <p className="mt-1">
              <strong>Una orden, un proveedor.</strong> Por eso la descarga pide que haya
              exactamente uno elegido: no existe la orden que mezcla dos.
            </p>
            <p className="mt-1">
              <strong>El descuento sale de la oferta del proveedor del mes elegido</strong>{" "}
              (<span className="font-mono text-xs">costos_historicos.oferta_pct</span>), que
              es la misma con la que se valoriza el costo real. Un artículo que ese mes no
              esté cargado arranca en 0 — que quiere decir «no sabemos», no «sin
              descuento»—, y se puede corregir a mano.
              {resumen.recortados > 0 && (
                <>
                  {" "}
                  <strong>
                    Hay {fmtNumero(resumen.recortados)} con descuento mayor a{" "}
                    {DESCUENTO_MAXIMO} %
                  </strong>
                  : se recortan a {DESCUENTO_MAXIMO} antes de exportar. Un descuento así es
                  un error de carga, y en una orden de compra deja de ser un número raro en
                  una pantalla.
                </>
              )}
            </p>
            <p className="mt-1">
              <strong>El sugerido no descuenta la mercadería en tránsito.</strong> Digip
              informa las columnas de tránsito y recepción en cero, así que un pedido ya
              hecho y todavía no recibido no se ve por ningún lado y el sugerido lo vuelve a
              pedir. Es lo primero para revisar antes de mandar la orden.
            </p>
            <p className="mt-1">
              <strong>La rentabilidad es de los últimos {MESES_RENTABILIDAD} meses</strong>,
              de todos los canales, sobre la facturación neta y sin descontar flete. Sirve
              para separar «se vende porque gusta» de «se vendía porque estaba liquidado»:
              son el mismo ritmo y llevan a comprar distinto.
            </p>
            <p className="mt-1">
              La columna «Última compra» es un piso: sólo hay comprobantes cargados
              {data.comprasHasta ? ` hasta el ${fmtFechaCorta(data.comprasHasta)}` : ""}, y
              dos de cada tres llegan sin el detalle de renglones.
            </p>
          </Aviso>
        </div>
      )}
    </div>
  );
}
