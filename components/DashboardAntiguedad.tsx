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
  DIAS_ANTIGUEDAD_ALERTA,
  DIAS_POR_VENCER_ALERTA,
  TRAMOS_ANTIGUEDAD,
  TRAMOS_VENCIMIENTO,
  VENTANA_VENTAS_DIAS,
} from "@/lib/stock-antiguedad";
import { useDatosTablero } from "@/lib/useDatosTablero";
import type { DashboardAntiguedad, FilaAntiguedad, FiltrosAntiguedad } from "@/lib/types";

/** El tope lo aplica el servidor (`TOPE` en lib/queries-stock-antiguedad.ts). */
const TOPE_TEXTO = 500;

type Opciones = { proveedores: string[]; marcas: string[] };
type Respuesta = DashboardAntiguedad & { opciones: Opciones | null };

/**
 * El color de un vencimiento. Rojo cuando ya pasó, naranja cuando entra en el
 * plazo de alarma, y nada cuando falta mucho: si todo tiene color, el que
 * importa no se ve.
 */
function colorVencimiento(dias: number | null): string | undefined {
  if (dias == null) return undefined;
  if (dias < 0) return TEMA.negativo;
  if (dias <= DIAS_POR_VENCER_ALERTA) return PALETA[2];
  return undefined;
}

function columnas(filas: FilaAntiguedad[]): Columna<FilaAntiguedad>[] {
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
      titulo: "Full aptas",
      celda: (f) => (f.aptas > 0 ? fmtNumero(f.aptas) : "—"),
      numerica: true,
      orden: (f) => f.aptas,
      total: fmtNumero(sumar(filas, (f) => f.aptas)),
    },
    {
      // Lo que está en Full y Mercado Libre no deja vender: perdido, en proceso
      // interno o esperando un retiro. No es antigüedad, pero es stock que
      // figura y no se puede vender, así que se cuenta acá.
      titulo: "No aptas",
      celda: (f) => (
        <span style={f.noAptas > 0 ? { color: TEMA.negativo } : undefined}>
          {f.noAptas > 0 ? fmtNumero(f.noAptas) : "—"}
        </span>
      ),
      numerica: true,
      orden: (f) => f.noAptas,
      total: fmtNumero(sumar(filas, (f) => f.noAptas)),
    },
    {
      titulo: "Días en Full",
      // Un guión es "no se sabe", no "es nuevo": o el SKU no está en Full, o la
      // foto de antigüedad todavía no se calculó.
      celda: (f) =>
        f.diasEnFull == null ? (
          <span className="text-muted">—</span>
        ) : (
          <span
            style={
              f.diasEnFull >= DIAS_ANTIGUEDAD_ALERTA ? { color: TEMA.negativo } : undefined
            }
            title={f.parcial ? "El libro de operaciones no explicaba todas las unidades: es un piso." : undefined}
          >
            {fmtNumero(Math.round(f.diasEnFull))} d{f.parcial ? " *" : ""}
          </span>
        ),
      numerica: true,
      orden: (f) => f.diasEnFull,
      total: (() => {
        const con = filas.filter((f) => f.diasEnFull != null && f.uMedidas > 0);
        if (con.length === 0) return "—";
        const u = sumar(con, (f) => f.uMedidas);
        const prom = u > 0 ? sumar(con, (f) => (f.diasEnFull ?? 0) * f.uMedidas) / u : 0;
        return `${fmtNumero(Math.round(prom))} d prom.`;
      })(),
    },
    {
      titulo: `+${DIAS_ANTIGUEDAD_ALERTA} días u.`,
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
      titulo: "Tucumán",
      celda: (f) => (f.tuc > 0 ? fmtNumero(f.tuc) : "—"),
      numerica: true,
      orden: (f) => f.tuc,
      total: fmtNumero(sumar(filas, (f) => f.tuc)),
    },
    {
      titulo: "Vencidas u.",
      celda: (f) => (
        <span style={f.uVencido > 0 ? { color: TEMA.negativo } : undefined}>
          {f.uVencido > 0 ? fmtNumero(f.uVencido) : "—"}
        </span>
      ),
      numerica: true,
      orden: (f) => f.uVencido,
      total: fmtNumero(sumar(filas, (f) => f.uVencido)),
    },
    {
      titulo: `Vencen en ${DIAS_POR_VENCER_ALERTA} d`,
      celda: (f) => (
        <span style={f.uPorVencer > 0 ? { color: PALETA[2] } : undefined}>
          {f.uPorVencer > 0 ? fmtNumero(f.uPorVencer) : "—"}
        </span>
      ),
      numerica: true,
      orden: (f) => f.uPorVencer,
      total: fmtNumero(sumar(filas, (f) => f.uPorVencer)),
    },
    {
      titulo: "Próximo vto.",
      celda: (f) =>
        f.proxVto ? (
          <span style={{ color: colorVencimiento(f.diasAVencer) }}>
            {fmtFechaCorta(f.proxVto)}
          </span>
        ) : (
          <span className="text-muted">—</span>
        ),
      // Sin fecha ordena al final, que es lo que hace `Tabla` con los `null`.
      orden: (f) => f.proxVto,
    },
    {
      titulo: "Vendidas",
      celda: (f) => fmtNumero(f.uds),
      numerica: true,
      orden: (f) => f.uds,
      total: fmtNumero(sumar(filas, (f) => f.uds)),
    },
    {
      titulo: "Hasta agotar",
      celda: (f) =>
        f.diasAgotar == null ? (
          <span className="text-muted">sin venta</span>
        ) : f.diasAgotar > 999 ? (
          "+999 d"
        ) : (
          `${fmtNumero(Math.round(f.diasAgotar))} d`
        ),
      numerica: true,
      // Los que no vendieron ordenan como el peor caso: con `null` quedarían al
      // final, que es donde nadie los mira.
      orden: (f) => f.diasAgotar ?? 999_999,
    },
    {
      titulo: "Valor neto",
      celda: (f) => fmtMoneda(f.valor),
      numerica: true,
      orden: (f) => f.valor,
      total: fmtMoneda(sumar(filas, (f) => f.valor)),
    },
  ];
}

export default function DashboardAntiguedadPage() {
  const inicial: FiltrosAntiguedad = {};
  const [filtros, setFiltros] = useState<FiltrosAntiguedad>(inicial);
  const [buscado, setBuscado] = useState("");

  const { data, cargando, error, recargar, empezarCarga } = useDatosTablero<Respuesta>(
    "/api/stock-antiguedad",
    {
      proveedor: filtros.proveedor,
      marca: filtros.marca,
      sku: filtros.sku,
      tramo: filtros.tramo ? [filtros.tramo] : undefined,
      vencimiento: filtros.vencimiento ? [filtros.vencimiento] : undefined,
      buscar: filtros.buscar ? [filtros.buscar] : undefined,
    },
    { conOpciones: "1" },
  );

  const cambiar = (f: FiltrosAntiguedad) => {
    empezarCarga();
    setFiltros(f);
  };

  const alternarEn = (clave: "proveedor" | "marca" | "sku") => (valor: string) =>
    cambiar({ ...filtros, [clave]: alternarValor(filtros[clave], valor) });

  const k = data?.kpis;
  // DOS MANERAS DE NO TENER ANTIGÜEDAD, y la pantalla las dice distinto: o el
  // paso no corrió todavía, o corrió pero la foto quedó con el inventario de
  // Mercado Libre sin enlazar a nuestro SKU. En los dos casos mostrar ceros
  // sería peor que no mostrar nada: se leen como "no hay mercadería vieja".
  const sinCalcular = data != null && data.antiguedadAl == null;
  const sinEnlazar = data != null && data.antiguedadAl != null && data.antiguedadSkus === 0;
  const sinFoto = sinCalcular || sinEnlazar;
  const sinCambios =
    sinValores(filtros.proveedor) &&
    sinValores(filtros.marca) &&
    sinValores(filtros.sku) &&
    !filtros.tramo &&
    !filtros.vencimiento &&
    !filtros.buscar;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">
            Antigüedad de stock{" "}
            <span className="text-muted text-sm font-normal">
              · días en Full y vencimientos en Tucumán
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

          <form
            onSubmit={(e) => {
              e.preventDefault();
              cambiar({ ...filtros, buscar: buscado.trim() || undefined });
            }}
            className="flex flex-col gap-1"
          >
            <label className="text-muted text-[11px]" htmlFor="buscar-antiguedad">
              Buscar
            </label>
            <input
              id="buscar-antiguedad"
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
          Cada depósito contesta una pregunta distinta:{" "}
          <strong>en Full, hace cuánto que la mercadería está parada</strong> —Mercado Libre
          no informa vencimientos— y <strong>en Tucumán, cuándo se vence</strong> —Digip no
          guarda la historia de movimientos—. Las unidades de Tucumán son las de ubicaciones
          activas sin apartar para un pedido. Todos los pesos son <strong>netos, a costo</strong>.
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
            titulo="Stock mirado acá"
            valor={fmtMoneda(k.valor)}
            detalle={`${fmtNumero(k.uFull)} u. en Full · ${fmtNumero(k.uTucuman)} en Tucumán`}
          />
          {/* La plata que ya se perdió: esa mercadería no se vende más. */}
          <TarjetaKpi
            titulo="Vencido en Tucumán"
            valor={fmtMoneda(k.valorVencido)}
            detalle={`${fmtNumero(k.uVencido)} unidades en ubicación activa`}
            acento={k.valorVencido > 0 ? TEMA.negativo : undefined}
          />
          {/* La que todavía se puede salvar, que es donde se puede hacer algo. */}
          <TarjetaKpi
            titulo={`Vence en ${DIAS_POR_VENCER_ALERTA} días`}
            valor={fmtMoneda(k.valorPorVencer)}
            detalle={`${fmtNumero(k.uPorVencer)} unidades para liquidar a tiempo`}
            acento={k.valorPorVencer > 0 ? PALETA[2] : undefined}
          />
          <TarjetaKpi
            titulo={`+${DIAS_ANTIGUEDAD_ALERTA} días en Full`}
            valor={sinFoto ? "—" : fmtMoneda(k.valorMas120)}
            detalle={
              sinEnlazar
                ? "Calculada, sin enlazar a nuestros SKU"
                : sinFoto
                  ? "Todavía sin calcular"
                  : `${fmtNumero(k.uMas120)} unidades · al ${fmtFechaCorta(data!.antiguedadAl!)}`
            }
            acento={!sinFoto && k.valorMas120 > 0 ? TEMA.negativo : undefined}
          />
          <TarjetaKpi
            titulo="Antigüedad promedio en Full"
            valor={
              k.diasPromedio == null ? "—" : `${fmtNumero(Math.round(k.diasPromedio))} d`
            }
            detalle={
              k.diasPromedio == null
                ? sinEnlazar
                  ? "Calculada, sin enlazar a nuestros SKU"
                  : "Todavía sin calcular"
                : `Ponderado por unidad · ${fmtNumero(k.uFull)} unidades`
            }
          />
        </div>
      )}

      {data && (
        <div className={`space-y-4 transition-opacity ${cargando ? "opacity-50" : ""}`}>
          <div className="grid gap-4 xl:grid-cols-2">
            <Panel
              titulo="Hace cuánto que está en Full"
              nota={
                sinFoto
                  ? sinEnlazar
                    ? "Sin enlazar a nuestros SKU"
                    : "Sin calcular todavía"
                  : `Al ${fmtFechaCorta(data.antiguedadAl!)} · click para filtrar`
              }
            >
              {sinFoto ? (
                // Un gráfico en cero se leería como "no hay mercadería vieja",
                // que es la lectura opuesta a la verdadera.
                <p className="text-muted mx-auto max-w-md py-10 text-center text-sm">
                  {sinEnlazar
                    ? `La foto del ${fmtFechaCorta(data.antiguedadAl!)} está calculada, pero por inventario de Mercado Libre: todavía no está enlazada a nuestros códigos de artículo, así que no se puede repartir por SKU.`
                    : "La antigüedad todavía no se calculó. La arma un paso aparte del orquestador, que corre una vez por día y tarda unos 35 minutos."}
                </p>
              ) : (
                <>
                  <BarrasCategoria
                    datos={TRAMOS_ANTIGUEDAD.map((t) => ({
                      label: t.label,
                      valor: data.antiguedad.find((x) => x.tramo === t.clave)?.valor ?? 0,
                    }))}
                    formato={fmtMoneda}
                    horizontal={false}
                    alturaMinima={220}
                    vacio="Sin stock en Full para el filtro elegido."
                    seleccionados={
                      filtros.tramo
                        ? [TRAMOS_ANTIGUEDAD.find((t) => t.clave === filtros.tramo)?.label ?? ""]
                        : undefined
                    }
                    onSeleccionar={(label) => {
                      const t = TRAMOS_ANTIGUEDAD.find((x) => x.label === label);
                      if (!t) return;
                      cambiar({
                        ...filtros,
                        tramo: filtros.tramo === t.clave ? undefined : t.clave,
                      });
                    }}
                  />
                  {/* Las unidades debajo del gráfico: las barras son plata, y
                      cuántas unidades hay que mover es otra pregunta. */}
                  <dl className="text-muted mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] sm:grid-cols-3">
                    {TRAMOS_ANTIGUEDAD.map((t) => (
                      <div key={t.clave} className="flex items-baseline gap-1.5">
                        <dt className="text-ink font-medium whitespace-nowrap">{t.label}</dt>
                        <dd className="m-0 truncate">
                          {fmtNumero(
                            data.antiguedad.find((x) => x.tramo === t.clave)?.unidades ?? 0,
                          )}{" "}
                          u.
                        </dd>
                      </div>
                    ))}
                  </dl>
                </>
              )}
            </Panel>

            <Panel
              titulo="Cuándo se vence lo de Tucumán"
              nota="Lo que vence dentro de 180 días · click para filtrar"
            >
              {/* Sólo los tramos accionables: ver la nota en lib/stock-antiguedad.ts.
                  Con el "más de 180 días" adentro, las barras que importan
                  quedan pegadas al piso. */}
              <BarrasCategoria
                datos={TRAMOS_VENCIMIENTO.filter((t) => t.accionable).map((t) => ({
                  label: t.label,
                  valor: data.vencimiento.find((x) => x.tramo === t.clave)?.valor ?? 0,
                }))}
                formato={fmtMoneda}
                horizontal={false}
                alturaMinima={220}
                vacio="Sin stock en Tucumán para el filtro elegido."
                seleccionados={
                  filtros.vencimiento
                    ? [
                        TRAMOS_VENCIMIENTO.find((t) => t.clave === filtros.vencimiento)
                          ?.label ?? "",
                      ]
                    : undefined
                }
                onSeleccionar={(label) => {
                  const t = TRAMOS_VENCIMIENTO.find((x) => x.label === label);
                  if (!t) return;
                  cambiar({
                    ...filtros,
                    vencimiento: filtros.vencimiento === t.clave ? undefined : t.clave,
                  });
                }}
              />
              <dl className="text-muted mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] sm:grid-cols-3">
                {TRAMOS_VENCIMIENTO.map((t) => (
                  <div key={t.clave} className="flex items-baseline gap-1.5">
                    <dt className="text-ink font-medium whitespace-nowrap">{t.label}</dt>
                    <dd className="m-0 truncate">
                      {fmtNumero(
                        data.vencimiento.find((x) => x.tramo === t.clave)?.unidades ?? 0,
                      )}{" "}
                      u.
                    </dd>
                  </div>
                ))}
              </dl>
            </Panel>
          </div>

          <Panel
            titulo="Artículos"
            nota={
              (data.recortada
                ? `Los ${data.filas.length} más urgentes`
                : `${fmtNumero(data.filas.length)} SKU con stock`) +
              ` · ventas de ${VENTANA_VENTAS_DIAS} días · click para filtrar`
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

          <Aviso tono="info">
            <p className="font-medium">Qué mide cada número, y qué no.</p>
            <p className="mt-1">
              <strong>«Días en Full» son días en el depósito, no el cargo de Mercado
              Libre.</strong> El cargo por almacenamiento prolongado usa un umbral que{" "}
              <em>depende de la categoría</em> —un perfume puede entrar a los 60 días y una
              crema a los 120—, y ese umbral no viene por API. Acá el corte es{" "}
              {DIAS_ANTIGUEDAD_ALERTA} para todos, así que en las categorías que cobran
              antes el número queda corto. Sirve para saber qué mover; no para saber qué te
              facturaron.
            </p>
            <p className="mt-1">
              La antigüedad no es un dato de Mercado Libre: se reconstruye por FIFO desde el
              libro de operaciones de cada inventario. Cuando el libro no explica todas las
              unidades, las que sobran se cuentan como viejas —el lado conservador— y el
              artículo queda marcado con un asterisco: ese número es un piso.
              {k && k.skusParciales > 0
                ? ` Hoy son ${fmtNumero(k.skusParciales)} artículos.`
                : ""}
            </p>
            {data.antiguedadSkusFull > data.antiguedadSkus && data.antiguedadSkus > 0 && (
              <p className="mt-1">
                <strong>
                  La foto de antigüedad cubre {fmtNumero(data.antiguedadSkus)} de los{" "}
                  {fmtNumero(data.antiguedadSkusFull)} artículos con stock en Full.
                </strong>{" "}
                Los {fmtNumero(data.antiguedadSkusFull - data.antiguedadSkus)} que faltan
                son inventarios que Mercado Libre no contestó ese día. Muestran un guión
                en «Días en Full», que acá quiere decir «no se pudo medir» — no «recién
                llegó».
              </p>
            )}
            <p className="mt-1">
              <strong>Los vencimientos son sólo de Tucumán.</strong> Mercado Libre no informa
              la fecha de vencimiento de lo que guarda en Full, así que de esas unidades no
              se sabe. Un guión en «Próximo vto.» es «no se sabe», no «no vence».
            </p>
            <p className="mt-1">
              <strong>Lo vencido no está en el tablero de Stock.</strong> Digip lo descuenta
              del stock disponible sin decirlo: la diferencia entre lo que hay en las
              ubicaciones activas y lo que declara disponible son, unidad por unidad, las
              vencidas. Acá se ven porque siguen ocupando lugar y ya costaron plata.
            </p>
            <p className="mt-1">
              La columna <strong>«No aptas»</strong> son unidades que están en Full y
              Mercado Libre no deja vender: perdidas, en un proceso interno o esperando un
              retiro.
              {k && k.noAptas > 0 ? ` Hoy son ${fmtNumero(k.noAptas)}.` : ""} No es
              antigüedad, pero es stock que figura y no se puede vender.
            </p>
            <p className="mt-1">
              Quedan afuera las ubicaciones bloqueadas (SCRAP y «eliminar») y lo que ya está
              apartado para un pedido: esa mercadería tiene dueño y su vencimiento no es una
              decisión de compras.
            </p>
          </Aviso>
        </div>
      )}
    </div>
  );
}
