"use client";

import { useMemo, useState } from "react";
import { BotonLimpiar, SelectorMultiple } from "@/components/SelectorFiltro";
import { contarSkus, sumar, Tabla, type Columna } from "@/components/Tabla";
import { Aviso, Esqueleto, Panel, TarjetaKpi } from "@/components/ui";
import {
  aCsv,
  aTxt,
  aUnidades,
  cantidadSugerida,
  COLUMNAS_SIGMA,
  DESCUENTO_MAXIMO,
  descuentoValido,
  excelParaProveedor,
  lineasParaExportar,
  MESES_RENTABILIDAD,
  nombreArchivo,
  porQueSugerido,
  renglonInicial,
  UNIDADES_COMPRA,
  type ClaveUnidadCompra,
  type RenglonOrden,
} from "@/lib/compras";
import { vacio as sinValores } from "@/lib/filtros";
import {
  fmtFechaCorta,
  fmtFechaCortaConAnio,
  fmtMes,
  fmtMoneda,
  fmtNumero,
  fmtPct,
} from "@/lib/format";
import { PALETA, TEMA } from "@/lib/paleta";
import {
  COBERTURA_OBJETIVO_DIAS,
  PLAZO_REPOSICION_DIAS,
  VENTANAS_RITMO,
  VENTANA_POR_DEFECTO,
} from "@/lib/stock";
import { useDatosTablero } from "@/lib/useDatosTablero";
import { aXlsx } from "@/lib/xlsx";
import type { DashboardCompras, FilaCompra, FiltrosCompras } from "@/lib/types";

type Opciones = {
  proveedores: string[];
  marcas: string[];
  grupos: string[];
  meses: string[];
};
type Respuesta = DashboardCompras & { opciones: Opciones | null };

const CLASE_CELDA_EDITABLE =
  "border-line bg-panel-2 text-ink focus:border-c1 w-16 rounded-md border px-1.5 py-1 text-right text-xs tabular-nums outline-none";

/** Descarga un contenido como archivo. Texto o bytes: al Blob le da igual. */
function bajar(contenido: BlobPart, nombre: string, tipo: string) {
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
      grupo: filtros.grupo,
      marca: filtros.marca,
      buscar: filtros.buscar ? [filtros.buscar] : undefined,
      ventana: [String(filtros.ventana ?? VENTANA_POR_DEFECTO)],
      mes: filtros.mes ? [filtros.mes] : undefined,
      todos: filtros.todos ? ["1"] : undefined,
      // RED DE SEGURIDAD. `satisfies` obliga a que estén TODAS las claves
      // de FiltrosCompras: si mañana se agrega un filtro y se olvida acá, esto
      // rompe el build.
      //
      // Existe porque ya pasó. El filtro de Empresa se cableó en el tipo, en
      // la ruta de API, en el SQL y en el selector -- y faltó esta línea, que
      // es la que lo mete en la query string. Sin ella el filtro cambiaba pero
      // la URL no, el efecto no se volvía a disparar y la pantalla quedaba
      // sombreada para siempre. Ni tsc, ni eslint, ni el build lo veían: para
      // todos ellos era un objeto válido al que le faltaba una clave.
    } satisfies Record<keyof FiltrosCompras, string | string[] | undefined>,
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
    // Renglones a los que el maestro no les tiene cargado el código con el que
    // el proveedor los vende. No rompen nada —van al Excel con la celda
    // vacía— pero el que recibe el mail no los va a poder identificar.
    let sinCodigo = 0;
    for (const f of filas) {
      const r = orden.get(f.sku);
      if (!r || !(r.cantidad > 0)) continue;
      renglones += 1;
      if (!f.codigoCompra) sinCodigo += 1;
      const u = aUnidades(r.cantidad, r.unidad, f.unidadesPorBulto);
      unidades += u;
      if (r.unidad === "bulto") bultos += r.cantidad;
      const lista = f.costoLista > 0 ? f.costoLista : f.costo;
      const desc = descuentoValido(r.descuento);
      if (r.descuento > DESCUENTO_MAXIMO) recortados += 1;
      bruto += u * lista;
      neto += u * lista * (1 - desc / 100);
    }
    return { renglones, unidades, bultos, bruto, neto, recortados, sinCodigo };
  }, [filas, orden]);

  // LAS ÓRDENES SON POR PROVEEDOR. Con dos elegidos el archivo mezclaría
  // proveedores en una sola orden, que es algo que no existe.
  const proveedorUnico =
    filtros.proveedor?.length === 1 ? filtros.proveedor[0] : null;

  const descargar = (formato: "txt" | "csv" | "xlsx") => {
    if (!proveedorUnico) return;
    if (formato === "xlsx") {
      // El Excel se arma de las FILAS y no de las líneas de Sigma: necesita el
      // costo, el EAN y el nombre del artículo, que a ese archivo no van.
      const libro = excelParaProveedor(filas, orden, proveedorUnico);
      if (libro.filas.length === 0) return;
      bajar(
        aXlsx(libro),
        nombreArchivo(proveedorUnico, "xlsx"),
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
      return;
    }
    const lineas = lineasParaExportar(filas, orden);
    if (lineas.length === 0) return;
    if (formato === "txt") {
      bajar(aTxt(lineas), nombreArchivo(proveedorUnico, "txt"), "text/plain;charset=utf-8");
    } else {
      bajar(aCsv(lineas), nombreArchivo(proveedorUnico, "csv"), "text/csv;charset=utf-8");
    }
  };

  // Hay sell in del proveedor cargado para ese mes, o todavía no.
  const sellInHayDatos = (data?.sellInCargado ?? 0) > 0;

  const sinCambios =
    sinValores(filtros.grupo) &&
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
      // El recuento va en esta columna y no en la del SKU para no pisar
      // la etiqueta "Total", que es la que dice si la tabla está recortada.
      total: `${fmtNumero(contarSkus(filas, (f) => f.sku))} SKU`,
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
      // El número solo no alcanza para firmar una compra: el que decide tiene
      // que poder ver de dónde salió sin preguntarle a nadie. Por eso el
      // tooltip trae la cuenta entera, paso por paso.
      celda: (f) => {
        const texto = porQueSugerido(f).join("\n");
        if (f.sugerido <= 0) {
          return (
            <span className="text-muted" title={texto}>
              —
            </span>
          );
        }
        return (
          <span
            title={texto}
            // Subrayado punteado: la señal de que hay algo para leer al pasar
            // por encima. Sin eso el tooltip existe y nadie se entera.
            className={
              f.factorOferta > 1
                ? "decoration-dotted underline underline-offset-2"
                : "decoration-dotted underline underline-offset-2 opacity-90"
            }
            style={f.factorOferta > 1 ? { color: PALETA[1] } : undefined}
          >
            {fmtNumero(f.sugerido)}
            {f.factorOferta > 1 ? ` ×${f.factorOferta.toFixed(1)}` : ""}
          </span>
        );
      },
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
              f.sellInPct == null
                ? "El sell in del proveedor no está cargado para este mes: arranca en 0 y hay que ponerlo a mano"
                : `Sell in del proveedor en el mes elegido: ${f.sellInPct.toFixed(2)} %`
            }
            aria-label={`Descuento de ${f.sku}`}
          />
        );
      },
      numerica: true,
      orden: (f) => orden.get(f.sku)?.descuento ?? 0,
    },
    {
      // REFERENCIA, NO VIAJA AL ARCHIVO. Es el sell in calculado con nuestras
      // compras (costos_historicos.oferta_pct), con el que se viene costeando.
      // Se muestra para poder comparar contra el del proveedor, y el título dice
      // qué es: puesto como "oferta" a secas se copiaría a la orden pensando
      // que es el descuento con el que se pide.
      titulo: "s/ n. compras %",
      celda: (f) => (
        <span className="text-muted" title="Sell in calculado con nuestras compras. No va al archivo.">
          {f.ofertaCalculadaPct == null ? "—" : f.ofertaCalculadaPct.toFixed(2)}
        </span>
      ),
      numerica: true,
      orden: (f) => f.ofertaCalculadaPct,
    },
    {
      // De dónde sale depende de qué haya: el sell in del proveedor cuando esté
      // cargado, el calculado mientras tanto. EL TÍTULO DICE CUÁL, que es lo que
      // evita leer un número como si fuera el otro.
      titulo: sellInHayDatos ? "Sell in últ. 6 m" : "s/ n. compras 6 m",
      celda: (f) => {
        const h = sellInHayDatos ? f.histSellIn : f.histCalculado;
        if (h.length === 0) return <span className="text-muted">—</span>;
        return (
          <span
            className="tabular-nums whitespace-nowrap"
            title={h.map((x) => `${fmtMes(x.mes)}: ${x.pct.toFixed(2)} %`).join("\n")}
          >
            {h.map((x) => Math.round(x.pct)).join(" · ")}
          </span>
        );
      },
      // Ordena por el más viejo de la serie contra el actual: lo que interesa
      // es si HOY estamos mejor o peor que el promedio de los últimos meses.
      orden: (f) => {
        const h = sellInHayDatos ? f.histSellIn : f.histCalculado;
        if (h.length === 0) return null;
        return h.reduce((a, x) => a + x.pct, 0) / h.length;
      },
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
      // La del mes que acaba de cerrar, aparte de la ventana móvil: es contra
      // ésta que se mira si la oferta que el proveedor ofrece ahora conviene.
      titulo: `Rent. ${data ? fmtMes(data.mesPasado) : "mes pasado"}`,
      celda: (f) =>
        f.rentMesPasado == null ? (
          <span className="text-muted">sin venta</span>
        ) : (
          <span
            style={{
              color:
                f.rentMesPasado < 0
                  ? TEMA.negativo
                  : f.rentMesPasado < 0.1
                    ? PALETA[3]
                    : undefined,
            }}
            title={`${fmtNumero(f.udsMesPasado)} unidades vendidas`}
          >
            {fmtPct(f.rentMesPasado)}
          </span>
        ),
      numerica: true,
      orden: (f) => f.rentMesPasado,
    },
    {
      // TRES ESTADOS Y NO DOS, porque el detalle de renglones casi no viene: de
      // los 173 comprobantes de agosto, 14 traen items. Un "no" a secas sería
      // mentira la mayoría de las veces.
      titulo: "¿Comprado el mes pasado?",
      celda: (f) => {
        if (f.compradoMesPasado)
          return <span style={{ color: PALETA[1] }}>sí</span>;
        if (f.proveedorComproMesPasado)
          return (
            <span
              className="text-muted"
              title="Se le compró al proveedor, pero ese comprobante no trae el detalle de renglones: no se puede saber si incluía este artículo."
            >
              no consta
            </span>
          );
        return (
          <span title="No hubo ninguna compra a este proveedor el mes pasado.">no</span>
        );
      },
      // Ordena por lo seguro primero: sí (2), no consta (1), no (0).
      orden: (f) => (f.compradoMesPasado ? 2 : f.proveedorComproMesPasado ? 1 : 0),
    },
    {
      titulo: "Última compra",
      celda: (f) => (f.ultimaCompra ? fmtFechaCortaConAnio(f.ultimaCompra) : "—"),
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
          {/* Antes que Proveedor: es el corte más grueso. Y en esta pantalla
              importa más todavía, porque la orden de compra se arma por
              proveedor y conviene llegar al de la empresa correcta. */}
          <SelectorMultiple
            etiqueta="Empresa"
            valores={filtros.grupo}
            opciones={data?.opciones?.grupos ?? []}
            onChange={(v) => cambiar({ ...filtros, grupo: v })}
          />
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
              Sell in del mes
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
          <strong>descuento</strong> es el <strong>sell in vigente del proveedor</strong> del
          mes elegido y se puede corregir fila por fila.
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
            titulo="Ahorro por el descuento"
            valor={fmtMoneda(resumen.bruto - resumen.neto)}
            detalle={
              data.sellInCargado > 0
                ? `Sell in de ${fmtMes(data.mes)} · ${fmtNumero(data.sellInCargado)} artículos`
                : "Sell in sin cargar: los descuentos van a mano"
            }
            acento={data.sellInCargado === 0 ? PALETA[3] : undefined}
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
                onClick={() => descargar("xlsx")}
                disabled={!proveedorUnico || resumen.renglones === 0}
                title="Excel valorizado, con el código y el EAN del proveedor, para mandarle por mail"
                className="border-c1 bg-c1/15 text-c1 hover:bg-c1/25 rounded-lg border px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-40"
              >
                Bajar Excel para el proveedor
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
              (data.mes ? ` · sell in de ${fmtMes(data.mes)}` : "")
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
              En <span className="font-mono text-xs">UNICOM</span> va exactamente{" "}
              {UNIDADES_COMPRA.map((u, i) => (
                <span key={u.clave}>
                  {i > 0 ? " o " : ""}
                  <span className="font-mono text-xs">{u.unicom}</span>
                </span>
              ))}
              . Está escrito acá para poder compararlo con lo que espera Sigma sin abrir el
              archivo: si alguna vez rechaza la importación, es lo primero para mirar.
            </p>
            <p className="mt-1">
              <strong>Una orden, un proveedor.</strong> Por eso la descarga pide que haya
              exactamente uno elegido: no existe la orden que mezcla dos.
            </p>
            <p className="mt-1">
              <strong>El Excel para el proveedor es otro archivo, no otro formato.</strong>{" "}
              Sale de los mismos renglones —si acá está en cero, no está en ninguno de los
              dos— pero habla el idioma del que lo recibe: lleva su{" "}
              <strong>código de compra</strong> y el <strong>EAN</strong> en vez de nuestro
              SKU, el nombre del artículo, y el costo <em>de la unidad que se le pide</em>:
              si el renglón va por bulto, el costo que se muestra es el del bulto. Cierra
              con el total de la orden. Es para adjuntar a un mail, no para importar en
              ningún lado.
              {resumen.sinCodigo > 0 && (
                <>
                  {" "}
                  <strong>
                    {fmtNumero(resumen.sinCodigo)} de los {fmtNumero(resumen.renglones)}{" "}
                    renglones no tienen cargado el código de compra del proveedor
                  </strong>{" "}
                  en el maestro de Sigma, así que en el Excel esa celda va vacía. El
                  artículo se pide igual —el proveedor lo va a reconocer por el EAN y por
                  el nombre— pero es algo para cargar en Sigma, no acá.
                </>
              )}
            </p>
            <p className="mt-1">
              <strong>
                El descuento es el sell in VIGENTE DEL PROVEEDOR, y hoy no está cargado.
              </strong>{" "}
              Vive en la planilla de Google y todavía no se sincroniza sola, así que la
              columna arranca en <strong>0 y hay que ponerla a mano</strong>. Cero acá
              quiere decir «no lo sabemos», no «sin descuento».
            </p>
            <p className="mt-1">
              La columna <strong>«s/ n. compras %»</strong> es otra cosa y{" "}
              <strong>no va al archivo</strong>: es el sell in{" "}
              <em>calculado con nuestras compras</em> (
              <span className="font-mono text-xs">costos_historicos.oferta_pct</span>), el
              que se usa para valorizar el costo real y trasladarlo a las ofertas del mes.
              Sirve para comparar, no para pedir: mandarlo en una orden sería pedirle al
              proveedor con un descuento inventado.
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
              <strong>«¿Comprado el mes pasado?» tiene tres respuestas y no dos.</strong>{" "}
              <em>Sí</em> es que el artículo aparece en un renglón de compra. <em>No</em> es
              que no hubo ninguna compra a ese proveedor, y eso sí es seguro.{" "}
              <em>No consta</em> es que al proveedor se le compró pero ese comprobante llegó
              sin el detalle de renglones — de los 173 comprobantes de agosto, 14 traen
              items—, así que no se puede saber. Un «no» ahí sería mentira la mayoría de las
              veces.
            </p>
            <p className="mt-1">
              La columna de los <strong>últimos 6 meses de descuento</strong> es para ver si
              la oferta de este mes es buena o es la de siempre. Muestra el{" "}
              {sellInHayDatos
                ? "sell in del proveedor"
                : "sell in calculado con nuestras compras, porque el del proveedor todavía no está cargado"}
              , y el título de la columna dice cuál de los dos se está viendo.
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
