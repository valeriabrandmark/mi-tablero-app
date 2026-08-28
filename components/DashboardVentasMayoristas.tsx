"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import BarraFiltros from "@/components/Filtros";
import EncabezadoPagina from "@/components/EncabezadoPagina";
import BarrasCategoria from "@/components/charts/BarrasCategoria";
import BarrasMargen from "@/components/charts/BarrasMargen";
import LineasPorVendedor from "@/components/charts/LineasPorVendedor";
import TortaProveedores from "@/components/charts/TortaProveedores";
import {
  promedioPonderado,
  sumar,
  Tabla,
  type Columna,
} from "@/components/Tabla";
import {
  Aviso,
  ConAlarmaMargen,
  Delta,
  Esqueleto,
  Panel,
  TarjetaKpi,
} from "@/components/ui";
import { fmtFechaCorta, fmtMoneda, fmtNumero, fmtPct } from "@/lib/format";
import { alternar as alternarValor, type ClaveLista } from "@/lib/filtros";
import {
  CRUZADOS,
  type FilaArticulo,
  type FilaComprobanteVenta,
  type RentabilidadCliente,
} from "@/lib/types";

const ETIQUETA_CRUZADO: Record<(typeof CRUZADOS)[number], string> = {
  proveedor: "Proveedor",
  cliente: "Cliente",
  sku: "SKU",
  comprobante: "Comprobante",
};
import { aQueryString } from "@/lib/filtros";
import { PALETA } from "@/lib/paleta";
import type {
  DashboardVentasMayoristas,
  Filtros,
  OpcionesFiltro,
} from "@/lib/types";

/**
 * Totales de la tabla de artículos.
 *
 * Las unidades y la facturación se suman. Los PROMEDIOS no: el precio y el
 * costo promedio se vuelven a ponderar por cantidad, y la rentabilidad por
 * facturación. Sumar promedios no significa nada, y promediarlos sin ponderar
 * deja que un SKU de una unidad pese lo mismo que uno de mil.
 */
/**
 * La diferencia entre dos porcentajes, en PUNTOS porcentuales.
 *
 * `fmtPct` no sirve para esto: mostraría "2,00 %" para una diferencia de dos
 * puntos, y eso se confunde con una variación del 2 %. Son cosas distintas y en
 * una reunión se repite la equivocada.
 */
function fmtPuntos(diferencia: number): string {
  const signo = diferencia >= 0 ? "+" : "−";
  return `${signo}${Math.abs(diferencia * 100).toLocaleString("es-AR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} pp`;
}

/**
 * Clientes que tienen un porcentaje que mostrar.
 *
 * Un cliente cuya facturación neteó a cero -- una factura anulada por su nota
 * de crédito dentro del mismo filtro -- no tiene rentabilidad que calcular, y
 * su barra sería un número inventado. Quedan afuera del gráfico y se cuentan
 * en la nota del panel, para que no desaparezcan en silencio.
 */
function clientesMedibles(
  filas: RentabilidadCliente[],
): (RentabilidadCliente & { valor: number })[] {
  return filas.filter(
    (c): c is RentabilidadCliente & { valor: number } => c.valor != null,
  );
}

function notaClientes(filas: RentabilidadCliente[]): string {
  const medibles = clientesMedibles(filas).length;
  const sinDato = filas.length - medibles;
  const base = `${medibles} clientes · sobre facturación s/IVA`;
  return sinDato > 0 ? `${base} · ${sinDato} sin venta neta` : base;
}

function colArticulos(filas: FilaArticulo[]): Columna<FilaArticulo>[] {
  return [
    { titulo: "SKU", celda: (a) => a.sku ?? "—", orden: (a) => a.sku },
    {
      titulo: "Producto",
      celda: (a) => (
        <span className="block max-w-[126px] sm:max-w-[280px] truncate">
          {a.producto ?? "—"}
        </span>
      ),
      orden: (a) => a.producto,
    },
    {
      titulo: "Unidades",
      celda: (a) => fmtNumero(a.cantidad),
      numerica: true,
      orden: (a) => a.cantidad,
      total: fmtNumero(sumar(filas, (a) => a.cantidad)),
    },
    {
      // Se llamaba "Oferta %" y confundía con las dos de al lado. Este es el
      // descuento que se le hizo al cliente en la venta; los otros dos salen
      // del Excel de costos y son del proveedor y nuestro.
      titulo: "Dto. venta %",
      celda: (a) => (a.ofertaPct == null ? "—" : fmtPct(a.ofertaPct / 100)),
      numerica: true,
      orden: (a) => a.ofertaPct,
      // Los SKUs SIN oferta quedan afuera del promedio, no entran como cero:
      // no tener descuento no es tener un descuento del 0 %, y contarlos
      // hundiría el promedio de los que sí lo tuvieron.
      total: fmtPct(
        promedioPonderado(
          filas.filter((a) => a.ofertaPct != null),
          (a) => ((a.ofertaPct ?? 0) / 100) * a.cantidad,
          (a) => a.cantidad,
        ),
      ),
    },
    {
      titulo: "Oferta prov. %",
      celda: (a) =>
        a.ofertaProveedorPct == null ? "—" : fmtPct(a.ofertaProveedorPct / 100),
      numerica: true,
      orden: (a) => a.ofertaProveedorPct,
      // Acá el cero SÍ entra: la oferta del proveedor está cargada para casi
      // todos los SKUs y "0 %" quiere decir que ese mes no hubo oferta, que es
      // un dato. Solo quedan afuera los que no tienen el costo cargado.
      total: fmtPct(
        promedioPonderado(
          filas.filter((a) => a.ofertaProveedorPct != null),
          (a) => ((a.ofertaProveedorPct ?? 0) / 100) * a.cantidad,
          (a) => a.cantidad,
        ),
      ),
    },
    {
      titulo: "Oferta propia %",
      celda: (a) =>
        a.ofertaPropiaPct == null ? "—" : fmtPct(a.ofertaPropiaPct / 100),
      numerica: true,
      orden: (a) => a.ofertaPropiaPct,
      total: fmtPct(
        promedioPonderado(
          filas.filter((a) => a.ofertaPropiaPct != null),
          (a) => ((a.ofertaPropiaPct ?? 0) / 100) * a.cantidad,
          (a) => a.cantidad,
        ),
      ),
    },
    {
      titulo: "Precio prom.",
      celda: (a) => fmtMoneda(a.precioPromedio),
      numerica: true,
      orden: (a) => a.precioPromedio,
      total: fmtMoneda(
        promedioPonderado(
          filas,
          (a) => a.facturacion,
          (a) => a.cantidad,
        ),
      ),
    },
    {
      titulo: "Costo prom. s/IVA",
      celda: (a) => fmtMoneda(a.costoPromedio),
      numerica: true,
      orden: (a) => a.costoPromedio,
      total: fmtMoneda(
        promedioPonderado(
          filas,
          (a) => (a.costoPromedio ?? 0) * a.cantidad,
          (a) => a.cantidad,
        ),
      ),
    },
    {
      titulo: "Facturación",
      celda: (a) => fmtMoneda(a.facturacion),
      numerica: true,
      orden: (a) => a.facturacion,
      total: fmtMoneda(sumar(filas, (a) => a.facturacion)),
    },
    {
      titulo: "% Rentab. neta",
      celda: (a) => fmtPct(a.rentabilidadPct),
      numerica: true,
      orden: (a) => a.rentabilidadPct,
      // `rentabilidadPct` ya viene sobre la facturación de esa fila, así que
      // multiplicarla por la facturación reconstruye los pesos de rentabilidad
      // y la división devuelve el margen del conjunto.
      total: fmtPct(
        promedioPonderado(
          filas,
          (a) => (a.rentabilidadPct ?? 0) * a.facturacion,
          (a) => a.facturacion,
        ),
      ),
    },
  ];
}

function colComprobantes(
  filas: FilaComprobanteVenta[],
): Columna<FilaComprobanteVenta>[] {
  return [
    { titulo: "Fecha", celda: (c) => c.fecha ?? "—", orden: (c) => c.fecha },
    {
      titulo: "Comprobante",
      celda: (c) => c.comprobante ?? "—",
      orden: (c) => c.comprobante,
    },
    {
      titulo: "Cliente",
      celda: (c) => (
        <span className="block max-w-[116px] sm:max-w-[260px] truncate">{c.cliente ?? "—"}</span>
      ),
      orden: (c) => c.cliente,
    },
    {
      titulo: "Unidades",
      celda: (c) => fmtNumero(c.unidades),
      numerica: true,
      orden: (c) => c.unidades,
      total: fmtNumero(sumar(filas, (c) => c.unidades)),
    },
    {
      titulo: "Facturación",
      celda: (c) => fmtMoneda(c.facturacion),
      numerica: true,
      orden: (c) => c.facturacion,
      total: fmtMoneda(sumar(filas, (c) => c.facturacion)),
    },
  ];
}

async function traer<T>(url: string, signal: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal, cache: "no-store" });
  if (res.status === 401) throw new Error("401");
  if (!res.ok) {
    const cuerpo = await res.json().catch(() => null);
    throw new Error(cuerpo?.error ?? `Error ${res.status} al consultar ${url}`);
  }
  return res.json() as Promise<T>;
}

/**
 * Interruptor entre las dos formas de mirar la rentabilidad.
 *
 * CON flete es el margen ajustado de siempre: lo que queda después de pagar el
 * transporte. SIN flete queda el margen de mercadería solo — precio neto menos
 * costo con la oferta del proveedor.
 *
 * Las dos hacen falta y responden preguntas distintas: si un cliente rinde poco
 * con flete pero bien sin flete, el problema es el envío (una provincia lejana,
 * pedidos chicos y frecuentes) y no el precio al que se le vende. Apagarlo
 * recalcula TODO — tarjetas, proveedores, clientes y artículos — porque si no
 * quedarían dos criterios mezclados en la misma pantalla.
 */
function InterruptorFlete({
  conFlete,
  onChange,
}: {
  conFlete: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={conFlete}
      onClick={() => onChange(!conFlete)}
      title={
        conFlete
          ? "El margen descuenta el flete de venta. Click para ver solo el margen de mercadería."
          : "El margen NO descuenta el flete: es precio neto menos costo con la oferta del proveedor."
      }
      className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs transition-colors ${
        conFlete
          ? "border-c1/40 bg-c1/15 text-c1"
          : "border-line text-muted hover:text-ink hover:bg-panel-2"
      }`}
    >
      <span
        aria-hidden
        className={`relative h-3.5 w-7 shrink-0 rounded-full transition-colors ${
          conFlete ? "bg-c1/60" : "bg-panel-2 border-line border"
        }`}
      >
        <span
          className={`absolute top-0.5 size-2.5 rounded-full bg-white transition-all ${
            conFlete ? "left-3.5" : "left-0.5"
          }`}
        />
      </span>
      {conFlete ? "Rentabilidad con flete" : "Rentabilidad sin flete"}
    </button>
  );
}

export default function Dashboard() {
  const router = useRouter();
  const [filtros, setFiltros] = useState<Filtros>({});
  // MODO DE CÁLCULO, no filtro: no recorta filas, cambia la fórmula del margen.
  // Por eso vive en su propio estado y no adentro de `filtros`.
  const [conFlete, setConFlete] = useState(true);
  const [opciones, setOpciones] = useState<OpcionesFiltro | null>(null);
  const [data, setData] = useState<DashboardVentasMayoristas | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [recargas, setRecargas] = useState(0);

  const manejarError = useCallback(
    (e: unknown) => {
      if (e instanceof DOMException && e.name === "AbortError") return;
      if (e instanceof Error && e.message === "401") {
        router.replace("/login");
        return;
      }
      setError(e instanceof Error ? e.message : "Error desconocido");
    },
    [router],
  );

  useEffect(() => {
    const ac = new AbortController();
    traer<OpcionesFiltro>("/api/filtros", ac.signal)
      .then(setOpciones)
      .catch(manejarError);
    return () => ac.abort();
  }, [manejarError]);

  // `cargando` / `error` se resetean en los handlers, no acá: hacerlo dentro
  // del efecto dispara un render en cascada.
  const cambiarFiltros = useCallback((f: Filtros) => {
    setCargando(true);
    setError(null);
    setFiltros(f);
  }, []);

  /** Click en un gráfico o en una tabla: filtra el resto del tablero.
   *  Volver a clickear lo mismo (o el chip) limpia la selección. */
  const alternar = useCallback((campo: ClaveLista, valor: string) => {
    setCargando(true);
    setError(null);
    setFiltros((f) => ({ ...f, [campo]: alternarValor(f[campo], valor) }));
  }, []);

  const alternarProveedor = useCallback(
    (proveedor: string) => alternar("proveedor", proveedor),
    [alternar],
  );

  const recargar = useCallback(() => {
    setCargando(true);
    setError(null);
    setRecargas((n) => n + 1);
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    const sp = new URLSearchParams(aQueryString(filtros));
    if (!conFlete) sp.set("conFlete", "0");
    const qs = sp.toString();
    traer<DashboardVentasMayoristas>(
      `/api/ventas-mayoristas${qs ? `?${qs}` : ""}`,
      ac.signal,
    )
      .then((d) => {
        setData(d);
        setCargando(false);
      })
      .catch((e) => {
        manejarError(e);
        if (!(e instanceof DOMException && e.name === "AbortError"))
          setCargando(false);
      });

    return () => ac.abort();
  }, [filtros, conFlete, recargas, manejarError]);

  const k = data?.kpis;
  const comp = data?.comparacion ?? null;

  // La etiqueta dice hasta qué día se midió el mes anterior. Cuando el mes
  // elegido está corriendo, el actual va por la mitad: compararlo contra un mes
  // entero mostraría una caída que no existe, y sin decirlo el porcentaje no se
  // puede interpretar.
  const contra = comp
    ? comp.hasta
      ? `vs ${comp.mes} hasta ${fmtFechaCorta(comp.hasta)}`
      : `vs ${comp.mes}`
    : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <EncabezadoPagina pagina="ventas">
          <p className="text-muted mt-1 text-xs">
            {data
              ? `Actualizado ${new Date(data.generadoEn).toLocaleTimeString(
                  "es-AR",
                  {
                    hour: "2-digit",
                    minute: "2-digit",
                  },
                )}`
              : "Cargando datos en vivo…"}
          </p>
        </EncabezadoPagina>
        <div className="flex items-center gap-2">
          <InterruptorFlete conFlete={conFlete} onChange={setConFlete} />
          <button
            onClick={recargar}
            disabled={cargando}
            className="border-line hover:bg-panel-2 text-muted hover:text-ink rounded-lg border px-3 py-1.5 text-xs disabled:opacity-40"
          >
            {cargando ? "Actualizando…" : "Actualizar"}
          </button>
        </div>
      </div>

      <BarraFiltros
        filtros={filtros}
        opciones={opciones}
        onChange={cambiarFiltros}
      />

      {CRUZADOS.some((c) => filtros[c]?.length) && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted">Filtrado por:</span>
          {/* Un chip por VALOR elegido, no por campo: con selección múltiple un
              solo chip por campo escondería cuántos valores hay puestos. */}
          {CRUZADOS.flatMap((campo) =>
            (filtros[campo] ?? []).map((valor) => (
              <button
                key={`${campo}-${valor}`}
                onClick={() => alternar(campo, valor)}
                className="border-c1/40 bg-c1/15 text-c1 hover:bg-c1/25 flex items-center gap-1.5 rounded-full border px-3 py-1 font-medium"
              >
                <span className="opacity-70">{ETIQUETA_CRUZADO[campo]}</span>
                {valor}
                <span aria-hidden className="text-sm leading-none">
                  ×
                </span>
              </button>
            )),
          )}
          <span className="text-muted max-w-md">
            Todo se filtra por lo elegido, salvo el propio gráfico o tabla de
            donde salió, que mantiene su lista completa con el resto atenuado.
          </span>
        </div>
      )}

      {error && (
        <Aviso>
          <p className="font-medium">No se pudieron leer los datos.</p>
          <p className="mt-1 font-mono text-xs break-words opacity-80">
            {error}
          </p>
          <p className="mt-2 text-xs opacity-80">
            Revisá que <code>DB_HOST</code>, <code>DB_PORT</code>,{" "}
            <code>DB_USER</code>, <code>DB_PASS</code> y <code>DB_NAME</code>{" "}
            estén cargadas.
          </p>
        </Aviso>
      )}

      {!k && !error ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {Array.from({ length: 10 }, (_, i) => (
            <Esqueleto key={i} className="h-[86px]" />
          ))}
        </div>
      ) : k ? (
        <ConAlarmaMargen activa={k.margenAjustado < 0}>
          <div
            className={`grid grid-cols-2 gap-3 transition-opacity sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 ${
              cargando ? "opacity-50" : ""
            }`}
          >
            <TarjetaKpi
              titulo="Facturación Neta (sin IVA)"
              valor={fmtMoneda(k.facturacionNeta)}
              detalle={
                contra && comp ? (
                  <Delta
                    actual={k.facturacionNeta}
                    anterior={comp.facturacionNeta}
                    contra={contra}
                  />
                ) : undefined
              }
              acento={PALETA[0]}
            />
            <TarjetaKpi
              titulo="Costo Mercadería s/IVA"
              valor={fmtMoneda(k.costoMercaderia)}
              detalle={
                contra && comp ? (
                  <Delta
                    actual={k.costoMercaderia}
                    anterior={comp.costoMercaderia}
                    contra={contra}
                  />
                ) : k.costoMercaderia < 0 ? (
                  // Un costo NEGATIVO no es un costo: es mercadería que volvió
                  // al depósito, casi siempre por una nota de crédito. Dicho
                  // como "costo" a secas se lee como un error de signo, y no lo
                  // es. Ver también la nota de Unidades acá abajo.
                  `Se recuperó ${fmtMoneda(-k.costoMercaderia)} de mercadería devuelta`
                ) : undefined
              }
            />
            <TarjetaKpi
              titulo="Unidades"
              valor={fmtNumero(k.unidades)}
              detalle={
                contra && comp ? (
                  <Delta
                    actual={k.unidades}
                    anterior={comp.unidades}
                    contra={contra}
                  />
                ) : k.unidades < 0 ? (
                  `${fmtNumero(-k.unidades)} unidades devueltas`
                ) : undefined
              }
            />
            <TarjetaKpi
              titulo="Clientes con Compra"
              valor={fmtNumero(k.clientesConCompra)}
              detalle={
                contra && comp ? (
                  <Delta
                    actual={k.clientesConCompra}
                    anterior={comp.clientesConCompra}
                    contra={contra}
                  />
                ) : (
                  `${fmtNumero(k.cantidadPedidos)} pedidos`
                )
              }
            />
            <TarjetaKpi
              // El título sigue al modo: llamar "ajustado" a un número que no
              // descuenta nada sería mentir sobre lo que se está mirando.
              titulo={
                conFlete ? "Margen Ajustado" : "Margen sin considerar flete"
              }
              valor={fmtMoneda(k.margenAjustado)}
              detalle={
                contra && comp ? (
                  <Delta
                    actual={k.margenAjustado}
                    anterior={comp.margenAjustado}
                    contra={contra}
                  />
                ) : conFlete ? (
                  // Con el flete descontado el número baja bastante, así que la
                  // resta va escrita: si no, el primer reflejo es pensar que se
                  // rompió algo.
                  `${fmtMoneda(k.margenTotal)} de margen − ${fmtMoneda(
                    k.fleteTotalReal + k.fleteEstimadoFiltrado,
                  )} de flete`
                ) : (
                  `Sin descontar ${fmtMoneda(
                    k.fleteTotalReal + k.fleteEstimadoFiltrado,
                  )} de flete`
                )
              }
              acento={k.margenAjustado >= 0 ? PALETA[1] : "#f43f5e"}
            />
            <TarjetaKpi
              titulo={
                conFlete ? "% Rentabilidad Ajustada" : "% Rentabilidad s/ flete"
              }
              valor={fmtPct(k.rentabilidadAjustadaPct)}
              detalle={
                contra &&
                comp &&
                comp.rentabilidadAjustadaPct != null &&
                k.rentabilidadAjustadaPct != null
                  ? // En PUNTOS y no en variación porcentual. Pasar de 10 % a 12 %
                    // es "+2 pp"; decir "+20 %" es cierto pero se lee como que la
                    // rentabilidad es del 20.
                    `${comp.rentabilidadAjustadaPct < k.rentabilidadAjustadaPct ? "▲" : "▼"} ${fmtPuntos(k.rentabilidadAjustadaPct - comp.rentabilidadAjustadaPct)} vs ${fmtPct(comp.rentabilidadAjustadaPct)} ${contra}`
                  : conFlete
                    ? "(Margen − flete) / facturación neta (s/IVA)"
                    : "Margen de mercadería / facturación neta (s/IVA)"
              }
              acento={PALETA[1]}
            />
            <TarjetaKpi
              titulo="Ticket Promedio"
              valor={fmtMoneda(k.ticketPromedio)}
              detalle={
                contra && comp && comp.cantidadPedidos > 0 ? (
                  <Delta
                    actual={k.ticketPromedio ?? 0}
                    anterior={comp.facturacionNeta / comp.cantidadPedidos}
                    contra={contra}
                  />
                ) : (
                  "Facturación / pedidos distintos"
                )
              }
            />
            <TarjetaKpi
              titulo="% Facturación Top 10 Clientes"
              valor={fmtPct(k.pctTop10Clientes)}
              detalle="Concentración de cartera"
              acento={PALETA[3]}
            />
            <TarjetaKpi
              titulo="Flete Total (real)"
              valor={fmtMoneda(k.fleteTotalReal)}
              detalle="Factura del transportista ya cargada"
              acento={PALETA[4]}
            />
            <TarjetaKpi
              titulo="Flete Estimado (filtrado)"
              valor={fmtMoneda(k.fleteEstimadoFiltrado)}
              detalle="Prorrateo, todavía sin factura real"
              acento={PALETA[2]}
            />
          </div>
        </ConAlarmaMargen>
      ) : null}

      {data && (
        <div
          className={`space-y-4 transition-opacity ${cargando ? "opacity-50" : ""}`}
        >
          <Panel
            titulo="Facturación Neta por Día y Vendedor"
            nota={`${data.serieDiaria.vendedores.length} vendedores`}
          >
            <LineasPorVendedor
              serie={data.serieDiaria}
              onSeleccionar={(v) =>
                cambiarFiltros({
                  ...filtros,
                  vendedor: alternarValor(filtros.vendedor, v),
                })
              }
            />
          </Panel>

          <div className="grid gap-4 xl:grid-cols-2">
            <Panel
              titulo="Facturación Neta por proveedor"
              nota={`${data.facturacionPorProveedor.length} proveedores`}
            >
              <TortaProveedores
                datos={data.facturacionPorProveedor}
                totalGeneral={data.facturacionTotalProveedores}
                seleccionados={filtros.proveedor}
                onSeleccionar={alternarProveedor}
              />
            </Panel>

            <Panel
              titulo="Margen % por proveedor"
              nota={`${data.margenPorProveedor.length} proveedores · sobre facturación s/IVA`}
            >
              {/* Alto acotado con scroll propio: sin el piso de unidades entran
                  todos los proveedores y el panel se estiraría metros. */}
              <div className="max-h-[420px] overflow-y-auto pr-1">
                <BarrasMargen
                  datos={data.margenPorProveedor}
                  seleccionados={filtros.proveedor}
                  onSeleccionar={alternarProveedor}
                />
              </div>
            </Panel>
          </div>

          <Panel
            titulo="% Rentabilidad Ajustada por cliente"
            nota={notaClientes(data.rentabilidadPorCliente)}
          >
            {/* Igual que el de proveedores: están todos y el panel scrollea. */}
            <div className="max-h-[420px] overflow-y-auto pr-1">
              <BarrasCategoria
                datos={clientesMedibles(data.rentabilidadPorCliente)}
                formato={(n) => fmtPct(n)}
                colorUnico={PALETA[3]}
                seleccionados={filtros.cliente}
                onSeleccionar={(c) => alternar("cliente", c)}
              />
            </div>
          </Panel>

          {/* Comprobantes va PRIMERO: se mira "que se facturo" antes que "de que
              articulos se compuso". */}
          <div className="grid gap-4 xl:grid-cols-2">
            <Panel
              titulo="Comprobantes"
              nota={`${data.comprobantes.length} por facturación`}
            >
              <Tabla
                filas={data.comprobantes}
                columnas={colComprobantes(data.comprobantes)}
                clave={(c, i) => `${c.comprobante}-${i}`}
                onClickFila={(c) =>
                  c.comprobante && alternar("comprobante", c.comprobante)
                }
                activa={(c) =>
                  !!c.comprobante &&
                  !!filtros.comprobante?.includes(c.comprobante)
                }
              />
            </Panel>
            <Panel
              titulo="Artículos incluídos"
              nota={`${data.articulos.length} SKUs`}
            >
              <Tabla
                filas={data.articulos}
                columnas={colArticulos(data.articulos)}
                clave={(a, i) => `${a.sku}-${i}`}
                onClickFila={(a) => a.sku && alternar("sku", a.sku)}
                activa={(a) => !!a.sku && !!filtros.sku?.includes(a.sku)}
              />
            </Panel>
          </div>
        </div>
      )}
    </div>
  );
}
