"use client";

import { useState } from "react";
import BarrasCategoria from "@/components/charts/BarrasCategoria";
import { BotonLimpiar, SelectorMultiple } from "@/components/SelectorFiltro";
import { sumar, Tabla, type Columna } from "@/components/Tabla";
import { Aviso, Esqueleto, Panel, TarjetaKpi } from "@/components/ui";
import { alternar as alternarValor, vacio as sinValores } from "@/lib/filtros";
import { fmtFechaCorta, fmtMoneda, fmtNumero } from "@/lib/format";
import { PALETA, TEMA } from "@/lib/paleta";
import {
  COBERTURA_OBJETIVO_DIAS,
  DEPOSITOS,
  DEPOSITO_POR_DEFECTO,
  PLAZO_REPOSICION_DIAS,
  TRAMOS_COBERTURA,
  VENTANAS_RITMO,
  VENTANA_POR_DEFECTO,
  tramoCobertura,
} from "@/lib/stock";
import { useDatosTablero } from "@/lib/useDatosTablero";
import type { DashboardStock, FilaStock, FiltrosStock } from "@/lib/types";

/**
 * El tope de filas lo aplica el servidor (`TOPE` en lib/queries-stock.ts); acá
 * sólo se lo nombra en la etiqueta del total. No se importa de allá porque ese
 * módulo trae `pg` y no puede entrar al navegador.
 */
const TOPE_TEXTO = 500;

type Opciones = { proveedores: string[]; marcas: string[] };
type Respuesta = DashboardStock & { opciones: Opciones | null };

/** El color de la cobertura: rojo si se está por quebrar, rojo si sobra mucho. */
function colorCobertura(dias: number | null): string | undefined {
  const tramo = tramoCobertura(dias);
  if (tramo === "quiebre") return TEMA.negativo;
  if (tramo === "sin_venta" || tramo === "excedido") return PALETA[2];
  if (tramo === "ajustado") return PALETA[3];
  return undefined;
}

/**
 * La cobertura de un artículo que no vendió no es "infinita", es desconocida.
 * Escribirla como un número enorme haría creer que se midió algo.
 */
function textoCobertura(dias: number | null): string {
  if (dias == null) return "sin venta";
  if (dias > 999) return "+999 d";
  return `${fmtNumero(Math.round(dias))} d`;
}

function columnas(filas: FilaStock[]): Columna<FilaStock>[] {
  return [
    { titulo: "SKU", celda: (f) => f.sku, orden: (f) => f.sku },
    {
      titulo: "Artículo",
      celda: (f) => (
        <span
          className="block max-w-[136px] truncate sm:max-w-[280px]"
          title={f.producto ?? undefined}
        >
          {f.producto ?? "—"}
        </span>
      ),
      orden: (f) => f.producto,
    },
    {
      titulo: "Proveedor",
      celda: (f) => (
        <span className="block max-w-[110px] truncate sm:max-w-[180px]">
          {f.proveedor ?? "—"}
        </span>
      ),
      orden: (f) => f.proveedor,
    },
    {
      titulo: "Tucumán",
      celda: (f) => fmtNumero(f.tuc),
      numerica: true,
      orden: (f) => f.tuc,
      total: fmtNumero(sumar(filas, (f) => f.tuc)),
    },
    {
      titulo: "Full",
      celda: (f) => fmtNumero(f.full),
      numerica: true,
      orden: (f) => f.full,
      total: fmtNumero(sumar(filas, (f) => f.full)),
    },
    {
      titulo: "Total u.",
      celda: (f) => fmtNumero(f.total),
      numerica: true,
      orden: (f) => f.total,
      total: fmtNumero(sumar(filas, (f) => f.total)),
    },
    {
      titulo: "Costo neto",
      // Cero de verdad y no un guión: son testers y exhibidores, que no se
      // compran. Un "—" haría pensar que falta el dato.
      celda: (f) => fmtMoneda(f.costo),
      numerica: true,
      orden: (f) => f.costo,
    },
    {
      titulo: "Valor neto",
      celda: (f) => fmtMoneda(f.valor),
      numerica: true,
      orden: (f) => f.valor,
      total: fmtMoneda(sumar(filas, (f) => f.valor)),
    },
    {
      titulo: "Vendidas",
      celda: (f) => fmtNumero(f.uds),
      numerica: true,
      orden: (f) => f.uds,
      total: fmtNumero(sumar(filas, (f) => f.uds)),
    },
    {
      titulo: "Por día",
      celda: (f) => (f.ritmoDiario > 0 ? f.ritmoDiario.toFixed(2) : "—"),
      numerica: true,
      orden: (f) => f.ritmoDiario,
    },
    {
      titulo: "Cobertura",
      celda: (f) => (
        <span style={{ color: colorCobertura(f.cobertura) }}>
          {textoCobertura(f.cobertura)}
        </span>
      ),
      numerica: true,
      // Los que no vendieron ordenan como el peor caso, junto a los excedidos:
      // con `null` quedarían al final, que es donde nadie los mira.
      orden: (f) => f.cobertura ?? 999_999,
      total: (() => {
        const conVenta = filas.filter((f) => f.cobertura != null);
        const sin = filas.length - conVenta.length;
        if (conVenta.length === 0) return sin > 0 ? `${fmtNumero(sin)} sin venta` : "—";
        // El promedio se pondera por unidades: un SKU de una unidad no puede
        // mover la cobertura del conjunto igual que uno de mil.
        const u = sumar(conVenta, (f) => f.total);
        const prom = u > 0 ? sumar(conVenta, (f) => (f.cobertura ?? 0) * f.total) / u : 0;
        return (
          `${fmtNumero(Math.round(prom))} d prom.` +
          (sin > 0 ? ` · ${fmtNumero(sin)} sin venta` : "")
        );
      })(),
    },
    {
      titulo: "Exceso $",
      celda: (f) => (
        <span style={f.exceso > 0 ? { color: PALETA[2] } : undefined}>
          {f.exceso > 0 ? fmtMoneda(f.exceso) : "—"}
        </span>
      ),
      numerica: true,
      orden: (f) => f.exceso,
      total: fmtMoneda(sumar(filas, (f) => f.exceso)),
    },
    {
      titulo: "Comprar u.",
      celda: (f) => (
        <span style={f.sugerido > 0 ? { color: PALETA[1] } : undefined}>
          {f.sugerido > 0 ? fmtNumero(f.sugerido) : "—"}
        </span>
      ),
      numerica: true,
      orden: (f) => f.sugerido,
      total: fmtNumero(sumar(filas, (f) => f.sugerido)),
    },
    {
      titulo: "Última venta",
      celda: (f) => (f.ultimaVenta ? fmtFechaCorta(f.ultimaVenta) : "—"),
      orden: (f) => f.ultimaVenta,
    },
    {
      titulo: "Días en Full",
      // Sólo existe para lo que está en el depósito de Mercado Libre: en
      // Tucumán no hay historia de movimientos con la que reconstruirlo. Un
      // guión es "no se sabe", no "es nuevo".
      celda: (f) =>
        f.diasEnFull == null ? (
          <span className="text-muted">—</span>
        ) : (
          <span
            style={f.uMas120 > 0 ? { color: PALETA[2] } : undefined}
            title={
              f.uMas120 > 0
                ? `${fmtNumero(f.uMas120)} unidades con más de 120 días`
                : undefined
            }
          >
            {fmtNumero(Math.round(f.diasEnFull))} d
          </span>
        ),
      numerica: true,
      orden: (f) => f.diasEnFull,
      total: (() => {
        const con = filas.filter((f) => f.diasEnFull != null && f.full > 0);
        if (con.length === 0) return "—";
        const u = sumar(con, (f) => f.full);
        const prom = u > 0 ? sumar(con, (f) => (f.diasEnFull ?? 0) * f.full) / u : 0;
        return `${fmtNumero(Math.round(prom))} d prom.`;
      })(),
    },
    {
      titulo: "+120 días u.",
      celda: (f) => (
        <span style={f.uMas120 > 0 ? { color: TEMA.negativo } : undefined}>
          {f.uMas120 > 0 ? fmtNumero(f.uMas120) : "—"}
        </span>
      ),
      numerica: true,
      orden: (f) => f.uMas120,
      total: fmtNumero(sumar(filas, (f) => f.uMas120)),
    },
    {
      titulo: "Última compra",
      celda: (f) => (f.ultimaCompra ? fmtFechaCorta(f.ultimaCompra) : "—"),
      // Sin fecha ordena al final, que es lo que hace `Tabla` con los `null`:
      // no saber cuándo se compró no es lo mismo que haber comprado hace mucho.
      orden: (f) => f.ultimaCompra,
    },
  ];
}

export default function DashboardStockPage() {
  const inicial: FiltrosStock = {
    ventana: VENTANA_POR_DEFECTO,
    deposito: DEPOSITO_POR_DEFECTO,
  };
  const [filtros, setFiltros] = useState<FiltrosStock>(inicial);
  const [buscado, setBuscado] = useState("");

  const { data, cargando, error, recargar, empezarCarga } = useDatosTablero<Respuesta>(
    "/api/stock",
    {
      proveedor: filtros.proveedor,
      marca: filtros.marca,
      sku: filtros.sku,
      tramo: filtros.tramo ? [filtros.tramo] : undefined,
      buscar: filtros.buscar ? [filtros.buscar] : undefined,
      ventana: [String(filtros.ventana ?? VENTANA_POR_DEFECTO)],
      deposito: [filtros.deposito ?? DEPOSITO_POR_DEFECTO],
    },
    { conOpciones: "1" },
  );

  const cambiar = (f: FiltrosStock) => {
    empezarCarga();
    setFiltros(f);
  };

  const alternarEn = (clave: "proveedor" | "marca" | "sku") => (valor: string) =>
    cambiar({ ...filtros, [clave]: alternarValor(filtros[clave], valor) });

  const k = data?.kpis;
  const ventana = filtros.ventana ?? VENTANA_POR_DEFECTO;
  const deposito = filtros.deposito ?? DEPOSITO_POR_DEFECTO;
  const sinCambios =
    sinValores(filtros.proveedor) &&
    sinValores(filtros.marca) &&
    sinValores(filtros.sku) &&
    !filtros.tramo &&
    !filtros.buscar &&
    ventana === VENTANA_POR_DEFECTO &&
    deposito === DEPOSITO_POR_DEFECTO;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">
            Stock{" "}
            <span className="text-muted text-sm font-normal">
              · Tucumán y Mercado Libre Full
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
          {/* La ventana del ritmo es un filtro de primer orden y no un detalle:
              cambia la cobertura de todos los artículos a la vez. */}
          <div className="flex flex-col gap-1">
            <span className="text-muted text-[11px]">Ritmo medido sobre</span>
            <div className="flex flex-wrap gap-1">
              {VENTANAS_RITMO.map((v) => {
                const activo = ventana === v;
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

          {/* El depósito cambia QUÉ STOCK se mira, no sólo qué filas se ven:
              con "Full" elegido, la plata, la cobertura y el sugerido son los
              de Mercado Libre solo. */}
          <div className="flex flex-col gap-1">
            <span className="text-muted text-[11px]">Depósito</span>
            <div className="flex flex-wrap gap-1">
              {DEPOSITOS.map((d) => {
                const activo = deposito === d.clave;
                return (
                  <button
                    key={d.clave}
                    type="button"
                    onClick={() => cambiar({ ...filtros, deposito: d.clave })}
                    aria-pressed={activo}
                    className={`rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${
                      activo
                        ? "border-c1 bg-c1/15 text-c1"
                        : "border-line text-muted hover:bg-panel-2 hover:text-ink"
                    }`}
                  >
                    {d.label}
                  </button>
                );
              })}
            </div>
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

          <form
            onSubmit={(e) => {
              e.preventDefault();
              cambiar({ ...filtros, buscar: buscado.trim() || undefined });
            }}
            className="flex flex-col gap-1"
          >
            <label className="text-muted text-[11px]" htmlFor="buscar-stock">
              Buscar
            </label>
            <input
              id="buscar-stock"
              value={buscado}
              onChange={(e) => setBuscado(e.target.value)}
              onBlur={() => cambiar({ ...filtros, buscar: buscado.trim() || undefined })}
              placeholder="SKU o artículo"
              className="border-line bg-panel-2 text-ink placeholder:text-muted focus:border-c1 w-40 rounded-lg border px-2.5 py-1.5 text-xs outline-none"
            />
          </form>

          <BotonLimpiar
            onClick={() => {
              setBuscado("");
              cambiar(inicial);
            }}
            deshabilitado={sinCambios}
          />
        </div>

        <span className="text-muted text-[11px] leading-tight">
          La <strong>cobertura</strong> es cuántos días dura el stock al ritmo de los últimos{" "}
          {ventana} días. El objetivo es <strong>{COBERTURA_OBJETIVO_DIAS} días</strong> y la
          reposición tarda <strong>{PLAZO_REPOSICION_DIAS}</strong>, así que{" "}
          <strong>Comprar u.</strong> es lo que falta para cubrir los{" "}
          {COBERTURA_OBJETIVO_DIAS + PLAZO_REPOSICION_DIAS} días. Todos los pesos son{" "}
          <strong>netos, a costo</strong>.
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
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {Array.from({ length: 5 }, (_, i) => (
            <Esqueleto key={i} className="h-[86px]" />
          ))}
        </div>
      ) : (
        <div
          className={`grid grid-cols-2 gap-3 transition-opacity sm:grid-cols-2 lg:grid-cols-5 ${cargando ? "opacity-50" : ""}`}
        >
          <TarjetaKpi
            titulo="Stock valorizado neto"
            valor={fmtMoneda(k.valor)}
            detalle={`${fmtNumero(k.unidades)} unidades · ${fmtNumero(k.skus)} SKU`}
          />
          <TarjetaKpi
            titulo={`Sin venta en ${ventana} días`}
            valor={fmtMoneda(k.valorSinVenta)}
            detalle={`${fmtNumero(k.skusSinVenta)} SKU quietos`}
            acento={k.valorSinVenta > 0 ? TEMA.negativo : undefined}
          />
          <TarjetaKpi
            titulo={`Excedido sobre ${COBERTURA_OBJETIVO_DIAS} días`}
            valor={fmtMoneda(k.exceso)}
            detalle="Plata por encima de la cobertura objetivo"
            acento={k.exceso > 0 ? PALETA[2] : undefined}
          />
          {/* La tarjeta que obliga a hacer algo hoy: si la reposición tarda 10
              días, lo que cubre menos de 10 ya se quebró aunque se pida ahora. */}
          <TarjetaKpi
            titulo="En riesgo de quiebre"
            valor={fmtNumero(k.skusQuiebre)}
            detalle={`SKU que no llegan a los ${PLAZO_REPOSICION_DIAS} días de reposición`}
            acento={k.skusQuiebre > 0 ? PALETA[3] : undefined}
          />
          {/* Sólo de Full, y la tarjeta lo dice: en Tucumán no se puede saber
              hace cuánto que una unidad está ahí. */}
          <TarjetaKpi
            titulo="+120 días en Full"
            valor={fmtMoneda(k.valorMas120)}
            detalle={
              data?.antiguedadAl
                ? `${fmtNumero(k.uMas120)} unidades · al ${fmtFechaCorta(data.antiguedadAl)}`
                : "Todavía sin calcular"
            }
            acento={k.valorMas120 > 0 ? TEMA.negativo : undefined}
          />
        </div>
      )}

      {data && (
        <div className={`space-y-4 transition-opacity ${cargando ? "opacity-50" : ""}`}>
          <div className="grid gap-4 xl:grid-cols-2">
            <Panel
              titulo="Cuánta plata hay en cada tramo"
              nota="Valor neto a costo · click para filtrar"
            >
              <BarrasCategoria
                datos={TRAMOS_COBERTURA.map((t) => ({
                  label: t.label,
                  valor: data.tramos.find((x) => x.tramo === t.clave)?.valor ?? 0,
                }))}
                formato={fmtMoneda}
                horizontal={false}
                alturaMinima={220}
                vacio="Sin stock para el filtro elegido."
                seleccionados={
                  filtros.tramo
                    ? [TRAMOS_COBERTURA.find((t) => t.clave === filtros.tramo)?.label ?? ""]
                    : undefined
                }
                onSeleccionar={(label) => {
                  const t = TRAMOS_COBERTURA.find((x) => x.label === label);
                  if (!t) return;
                  cambiar({
                    ...filtros,
                    tramo: filtros.tramo === t.clave ? undefined : t.clave,
                  });
                }}
              />

              {/* La leyenda va DEBAJO del gráfico y no en un tooltip: los
                  nombres de los tramos son decisiones ("quiebre", "excedido"),
                  no categorías obvias, y sin el rango al lado hay que
                  acordarse de memoria qué quiere decir cada uno. */}
              <dl className="text-muted mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] sm:grid-cols-3">
                {TRAMOS_COBERTURA.map((t) => (
                  <div key={t.clave} className="flex items-baseline gap-1.5">
                    <dt className="text-ink font-medium whitespace-nowrap">{t.label}</dt>
                    <dd className="m-0 truncate">{t.desc}</dd>
                  </div>
                ))}
              </dl>
            </Panel>

            <Panel titulo="Stock por proveedor" nota="Top 15 por valor · click para filtrar">
              <BarrasCategoria
                datos={data.proveedores.slice(0, 15).map((p) => ({
                  label: p.proveedor,
                  valor: p.valor,
                }))}
                formato={fmtMoneda}
                vacio="Sin stock para el filtro elegido."
                seleccionados={filtros.proveedor}
                onSeleccionar={alternarEn("proveedor")}
              />
            </Panel>
          </div>

          <Panel
            titulo="Artículos"
            nota={
              (data.recortada
                ? `Los ${data.filas.length} de mayor valor`
                : `${fmtNumero(data.filas.length)} SKU con stock`) +
              ` · ritmo de ${ventana} días · click para filtrar`
            }
          >
            <Tabla
              filas={data.filas}
              columnas={columnas(data.filas)}
              etiquetaTotal={data.recortada ? `Total (los ${TOPE_TEXTO} mostrados)` : "Total"}
              clave={(f) => f.sku}
              onClickFila={(f) => alternarEn("sku")(f.sku)}
              activa={(f) => (filtros.sku?.length ? filtros.sku.includes(f.sku) : false)}
              vacio="Ningún artículo con stock para el filtro elegido."
            />
          </Panel>

          {/* Lo que el tablero NO sabe todavía, dicho en la pantalla. Sin esto,
              "Comprar u." se leería como una orden de compra cerrada. */}
          <Aviso tono="info">
            <p className="font-medium">Qué le falta a la sugerencia de compra.</p>
            <p className="mt-1">
              <strong>No descuenta la mercadería en tránsito.</strong> Digip informa las
              columnas de tránsito y recepción en cero, así que un pedido ya hecho y todavía
              no recibido no se ve por ningún lado y el sugerido lo vuelve a pedir.
            </p>
            <p className="mt-1">
              Tampoco distingue si un artículo vendió <em>porque gusta</em> o{" "}
              <em>porque estaba en oferta</em>: al ritmo le da lo mismo. Eso sale del
              descuento propio por mes, que ya está en la base, y es lo próximo que se suma.
            </p>
            <p className="mt-1">
              El plazo de reposición es un promedio de {PLAZO_REPOSICION_DIAS} días para
              todos los proveedores. Con los plazos reales cargados, cada uno usa el suyo.
            </p>
            <p className="mt-1">
              <strong>«Días en Full» son días en el depósito, no el cargo de Mercado
              Libre.</strong> El cargo por almacenamiento prolongado usa un umbral que{" "}
              <em>depende de la categoría</em> —un perfume puede entrar a los 60 días y
              una crema a los 120—, y ese umbral no viene por API. Acá el corte es 120
              para todos, así que en las categorías que cobran antes el número queda
              corto. Sirve para saber qué mover; no para saber qué te facturaron.
            </p>
            <p className="mt-1">
              Sólo existe para <strong>Mercado Libre Full</strong>. En Tucumán no hay
              historia de movimientos con la que reconstruirlo, así que un artículo que
              está sólo allá muestra un guión — que es «no se sabe», no «es nuevo».
            </p>
            <p className="mt-1">
              <strong>La columna «Última compra» es un piso, no la verdad.</strong> Sólo
              hay comprobantes cargados
              {data.comprasHasta ? ` hasta el ${fmtFechaCorta(data.comprasHasta)}` : ""}, y
              dos de cada tres llegan sin el detalle de renglones, así que no se sabe qué
              SKU traían. Un artículo comprado después figura con la fecha vieja o sin
              fecha. Se arregla del lado del orquestador.
            </p>
          </Aviso>
        </div>
      )}
    </div>
  );
}
