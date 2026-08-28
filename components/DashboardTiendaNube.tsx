"use client";

import { useState } from "react";
import EncabezadoCanal from "@/components/EncabezadoCanal";
import VentaRentabilidad from "@/components/charts/VentaRentabilidad";
import TortaProveedores from "@/components/charts/TortaProveedores";
import BarraFiltrosTiendaNube from "@/components/FiltrosTiendaNube";
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
import { alternar as alternarValor, vacio as sinValores } from "@/lib/filtros";
import { fmtFechaCorta, fmtMoneda, fmtNumero, fmtPct } from "@/lib/format";
import { PALETA, TEMA } from "@/lib/paleta";
import {
  CARGA_IMPOSITIVA,
  CRITERIO_VENTA,
  medioDePago,
  mesComercialComoRango,
} from "@/lib/tiendanube";
import { useDatosTablero } from "@/lib/useDatosTablero";
import type {
  ArticuloTiendaNube,
  ClienteTiendaNube,
  DashboardTiendaNube,
  FiltrosTiendaNube,
  OpcionesTiendaNube,
  PedidoTiendaNube,
  RankingTiendaNube,
} from "@/lib/types";

type Respuesta = DashboardTiendaNube & { opciones: OpcionesTiendaNube | null };

/** Un importe que se lee mal en rojo cuando es negativo. */
function Importe({ valor }: { valor: number | null }) {
  return (
    <span style={(valor ?? 0) < 0 ? { color: TEMA.negativo } : undefined}>
      {fmtMoneda(valor)}
    </span>
  );
}

function Porcentaje({ valor }: { valor: number | null }) {
  return (
    <span style={(valor ?? 0) < 0 ? { color: TEMA.negativo } : undefined}>
      {fmtPct(valor)}
    </span>
  );
}

/**
 * Los pedidos, uno por uno. Es el panel que define este tablero.
 *
 * En Mercado Libre esta lista existe pero hay que filtrarla por nivel de alerta
 * para que sea legible; acá son treinta filas en cuatro meses y se leen todas.
 * El margen que se muestra es el NETO, ya con impuestos: es el número con el
 * que se decide si esa venta convino.
 */
function columnasPedidos(
  filas: PedidoTiendaNube[],
): Columna<PedidoTiendaNube>[] {
  return [
    {
      titulo: "Fecha",
      celda: (p) => (p.fecha ? fmtFechaCorta(p.fecha) : "—"),
      orden: (p) => p.fecha,
    },
    {
      titulo: "N° Pedido",
      celda: (p) => (
        <span className="font-mono text-[11px]">{p.nroOrden ?? "—"}</span>
      ),
      // Por número y no por texto: como texto, el pedido 9 iría después del 100.
      orden: (p) => (p.nroOrden == null ? null : Number(p.nroOrden)),
    },
    {
      titulo: "Cliente",
      celda: (p) => (
        <span className="block max-w-[200px] truncate">{p.cliente ?? "—"}</span>
      ),
      orden: (p) => p.cliente,
    },
    {
      titulo: "Prod.",
      celda: (p) => fmtNumero(p.lineas),
      numerica: true,
      orden: (p) => p.lineas,
      total: fmtNumero(sumar(filas, (p) => p.lineas)),
    },
    {
      titulo: "Unid.",
      celda: (p) => fmtNumero(p.unidades),
      numerica: true,
      orden: (p) => p.unidades,
      total: fmtNumero(sumar(filas, (p) => p.unidades)),
    },
    {
      // Va ANTES de la venta y no después: se lee "se bonificó tanto, quedó
      // tanto". Al revés obliga a volver sobre la fila para entender el número.
      titulo: "Descuento",
      celda: (p) =>
        p.descuento > 0 ? (
          <span className="text-c1" title={p.cupon ? `Cupón ${p.cupon}` : undefined}>
            −{fmtMoneda(p.descuento)}
            {p.cupon && (
              <span className="text-muted ml-1 font-mono text-[10px]">{p.cupon}</span>
            )}
          </span>
        ) : (
          <span className="text-muted">—</span>
        ),
      numerica: true,
      orden: (p) => p.descuento,
      total: fmtMoneda(sumar(filas, (p) => p.descuento)),
    },
    {
      titulo: "Venta c/IVA",
      celda: (p) => fmtMoneda(p.ventaCiva),
      numerica: true,
      orden: (p) => p.ventaCiva,
      total: fmtMoneda(sumar(filas, (p) => p.ventaCiva)),
    },
    {
      titulo: "Costo s/IVA",
      celda: (p) => fmtMoneda(p.costo),
      numerica: true,
      orden: (p) => p.costo,
      total: fmtMoneda(sumar(filas, (p) => p.costo)),
    },
    {
      titulo: "Envío",
      celda: (p) => fmtMoneda(p.envio),
      numerica: true,
      orden: (p) => p.envio,
      total: fmtMoneda(sumar(filas, (p) => p.envio)),
    },
    {
      titulo: "Comisión c/IVA",
      // Al lado del monto va DE QUIÉN es, igual que el cupón al lado del
      // descuento: la comisión no viene de la API, se calcula con el arancel de
      // esa pasarela y ese medio, y sin verlos el número no se puede auditar.
      // Dos pedidos del mismo importe pagan distinto según cómo se cobraron.
      celda: (p) => {
        const medio = medioDePago(p.pasarela, p.metodoPago);
        return (
          <span title={medio ?? undefined}>
            {fmtMoneda(p.comision)}
            {medio && (
              <span className="text-muted ml-1 text-[10px]">{medio}</span>
            )}
          </span>
        );
      },
      numerica: true,
      orden: (p) => p.comision,
      total: fmtMoneda(sumar(filas, (p) => p.comision)),
    },
    {
      // Al lado de Comisión porque son las dos mitades de la MISMA tarifa: lo
      // que se descuenta de un cobro por Nave es la suma de las dos. Separadas
      // se ve lo que sumadas queda escondido — que Pago Nube bonifica ésta y
      // Nave no—, que es justo lo que hace falta para elegir pasarela.
      titulo: "Plataforma",
      celda: (p) =>
        p.costoTransaccion > 0 ? (
          fmtMoneda(p.costoTransaccion)
        ) : (
          <span className="text-muted" title="Pago Nube bonifica el costo de plataforma">
            —
          </span>
        ),
      numerica: true,
      orden: (p) => p.costoTransaccion,
      total: fmtMoneda(sumar(filas, (p) => p.costoTransaccion)),
    },
    {
      titulo: "Rent. bruta",
      celda: (p) => <Importe valor={p.rentabilidad} />,
      numerica: true,
      orden: (p) => p.rentabilidad,
      total: <Importe valor={sumar(filas, (p) => p.rentabilidad)} />,
    },
    {
      titulo: "Rent. neta",
      celda: (p) => <Importe valor={p.rentabilidadNeta} />,
      numerica: true,
      orden: (p) => p.rentabilidadNeta,
      total: <Importe valor={sumar(filas, (p) => p.rentabilidadNeta)} />,
    },
    {
      titulo: "Margen neto",
      celda: (p) => <Porcentaje valor={p.margenNetoPct} />,
      numerica: true,
      orden: (p) => p.margenNetoPct,
      total: (
        <Porcentaje
          valor={promedioPonderado(
            filas,
            (p) => p.rentabilidadNeta,
            (p) => p.ventaCiva,
          )}
        />
      ),
    },
  ];
}

function columnasClientes(
  filas: ClienteTiendaNube[],
): Columna<ClienteTiendaNube>[] {
  return [
    {
      titulo: "Cliente",
      celda: (c) => (
        <span className="block max-w-[220px] truncate">{c.cliente}</span>
      ),
      orden: (c) => c.cliente,
    },
    {
      titulo: "Pedidos",
      // Un cliente que volvió se marca: en un canal de treinta pedidos, el que
      // compra dos veces es el dato más accionable que hay.
      celda: (c) => (
        <span style={c.pedidos > 1 ? { color: PALETA[1] } : undefined}>
          {fmtNumero(c.pedidos)}
          {c.pedidos > 1 ? " ↻" : ""}
        </span>
      ),
      numerica: true,
      orden: (c) => c.pedidos,
      total: fmtNumero(sumar(filas, (c) => c.pedidos)),
    },
    {
      titulo: "Unid.",
      celda: (c) => fmtNumero(c.unidades),
      numerica: true,
      orden: (c) => c.unidades,
      total: fmtNumero(sumar(filas, (c) => c.unidades)),
    },
    {
      titulo: "Venta c/IVA",
      celda: (c) => fmtMoneda(c.ventaCiva),
      numerica: true,
      orden: (c) => c.ventaCiva,
      total: fmtMoneda(sumar(filas, (c) => c.ventaCiva)),
    },
    {
      titulo: "Rent. bruta",
      celda: (c) => <Importe valor={c.rentabilidad} />,
      numerica: true,
      orden: (c) => c.rentabilidad,
      total: <Importe valor={sumar(filas, (c) => c.rentabilidad)} />,
    },
    {
      titulo: "Margen bruto",
      celda: (c) => <Porcentaje valor={c.margenPct} />,
      numerica: true,
      orden: (c) => c.margenPct,
      total: (
        <Porcentaje
          valor={promedioPonderado(
            filas,
            (c) => c.rentabilidad,
            (c) => c.ventaCiva,
          )}
        />
      ),
    },
    {
      titulo: "Última",
      celda: (c) => (c.ultima ? fmtFechaCorta(c.ultima) : "—"),
      orden: (c) => c.ultima,
    },
  ];
}

function columnasArticulos(
  filas: ArticuloTiendaNube[],
): Columna<ArticuloTiendaNube>[] {
  return [
    { titulo: "SKU", celda: (a) => a.sku ?? "—", orden: (a) => a.sku },
    {
      titulo: "Producto",
      celda: (a) => (
        <span className="block max-w-[320px] truncate">
          {a.producto ?? "—"}
        </span>
      ),
      orden: (a) => a.producto,
    },
    {
      titulo: "Marca",
      celda: (a) => (
        <span className="block max-w-[140px] truncate">{a.marca ?? "—"}</span>
      ),
      orden: (a) => a.marca,
    },
    {
      titulo: "Unid.",
      celda: (a) => fmtNumero(a.unidades),
      numerica: true,
      orden: (a) => a.unidades,
      total: fmtNumero(sumar(filas, (a) => a.unidades)),
    },
    {
      titulo: "Venta c/IVA",
      celda: (a) => fmtMoneda(a.ventaCiva),
      numerica: true,
      orden: (a) => a.ventaCiva,
      total: fmtMoneda(sumar(filas, (a) => a.ventaCiva)),
    },
    {
      titulo: "Costo s/IVA",
      celda: (a) => fmtMoneda(a.costo),
      numerica: true,
      orden: (a) => a.costo,
      total: fmtMoneda(sumar(filas, (a) => a.costo)),
    },
    {
      titulo: "Envío",
      celda: (a) => fmtMoneda(a.envio),
      numerica: true,
      orden: (a) => a.envio,
      total: fmtMoneda(sumar(filas, (a) => a.envio)),
    },
    {
      titulo: "Rent. bruta",
      celda: (a) => <Importe valor={a.rentabilidad} />,
      numerica: true,
      orden: (a) => a.rentabilidad,
      total: fmtMoneda(sumar(filas, (a) => a.rentabilidad)),
    },
    {
      titulo: "Margen bruto",
      celda: (a) => <Porcentaje valor={a.margenPct} />,
      numerica: true,
      orden: (a) => a.margenPct,
      total: (
        <Porcentaje
          valor={promedioPonderado(
            filas,
            (a) => a.rentabilidad,
            (a) => a.ventaCiva,
          )}
        />
      ),
    },
  ];
}

/** El top por rentabilidad va con menos columnas: se lee de un vistazo. */
function columnasTop(
  filas: ArticuloTiendaNube[],
): Columna<ArticuloTiendaNube>[] {
  return [
    {
      titulo: "Producto",
      celda: (a) => (
        <span
          className="block max-w-[260px] truncate"
          title={a.producto ?? undefined}
        >
          {a.producto ?? a.sku ?? "—"}
        </span>
      ),
    },
    {
      titulo: "Unid.",
      celda: (a) => fmtNumero(a.unidades),
      numerica: true,
      orden: (a) => a.unidades,
      total: fmtNumero(sumar(filas, (a) => a.unidades)),
    },
    {
      titulo: "Rent. bruta",
      celda: (a) => (
        <span
          style={
            a.rentabilidad < 0 ? { color: TEMA.negativo } : { color: PALETA[1] }
          }
        >
          {fmtMoneda(a.rentabilidad)}
        </span>
      ),
      numerica: true,
      orden: (a) => a.rentabilidad,
      total: fmtMoneda(sumar(filas, (a) => a.rentabilidad)),
    },
    {
      titulo: "Margen bruto",
      celda: (a) => <Porcentaje valor={a.margenPct} />,
      numerica: true,
      orden: (a) => a.margenPct,
      total: (
        <Porcentaje
          valor={promedioPonderado(
            filas,
            (a) => a.rentabilidad,
            (a) => a.ventaCiva,
          )}
        />
      ),
    },
  ];
}

/** Ranking en tabla y no en gráfico: son cuatro números por fila, no uno. */
function TablaRanking({
  filas,
  titulo,
  seleccionados,
  onSeleccionar,
}: {
  filas: RankingTiendaNube[];
  titulo: string;
  seleccionados?: string[];
  onSeleccionar: (v: string) => void;
}) {
  const columnas: Columna<RankingTiendaNube>[] = [
    {
      titulo,
      celda: (r) => (
        <span className="block max-w-[220px] truncate">{r.label}</span>
      ),
      orden: (r) => r.label,
    },
    {
      titulo: "Venta c/IVA",
      celda: (r) => fmtMoneda(r.venta),
      numerica: true,
      orden: (r) => r.venta,
      total: fmtMoneda(sumar(filas, (r) => r.venta)),
    },
    {
      titulo: "Unid.",
      celda: (r) => fmtNumero(r.unidades),
      numerica: true,
      orden: (r) => r.unidades,
      total: fmtNumero(sumar(filas, (r) => r.unidades)),
    },
    {
      titulo: "Rent. bruta",
      celda: (r) => <Importe valor={r.rentabilidad} />,
      numerica: true,
      orden: (r) => r.rentabilidad,
      total: <Importe valor={sumar(filas, (r) => r.rentabilidad)} />,
    },
    {
      titulo: "Margen bruto",
      celda: (r) => <Porcentaje valor={r.margenPct} />,
      numerica: true,
      orden: (r) => r.margenPct,
      total: (
        <Porcentaje
          valor={promedioPonderado(
            filas,
            (r) => r.rentabilidad,
            (r) => r.venta,
          )}
        />
      ),
    },
  ];

  return (
    <Tabla
      filas={filas}
      columnas={columnas}
      clave={(r) => r.label}
      onClickFila={(r) => onSeleccionar(r.label)}
      activa={(r) =>
        seleccionados?.length ? seleccionados.includes(r.label) : false
      }
      vacio="Sin ventas en el recorte elegido."
    />
  );
}

export default function DashboardTiendaNubePage({
  diaInicial,
}: {
  diaInicial: string;
}) {
  // Abre en el MES COMERCIAL y no en el día, al revés que Mercado Libre: acá
  // entran unos ocho pedidos por mes, así que abrir en "hoy" daría vacío tres
  // de cada cuatro días y se leería como que no vendimos.
  const rangoInicial = mesComercialComoRango(diaInicial);
  const inicial: FiltrosTiendaNube = { ...rangoInicial };
  const [filtros, setFiltros] = useState<FiltrosTiendaNube>(inicial);

  const { data, cargando, error, recargar, empezarCarga } =
    useDatosTablero<Respuesta>(
      "/api/tienda-nube",
      filtros as unknown as Record<string, string[] | undefined>,
      { conOpciones: "1" },
    );

  const cambiar = (f: FiltrosTiendaNube) => {
    empezarCarga();
    setFiltros(f);
  };

  const alternarEn =
    (clave: "proveedor" | "marca" | "sku" | "cliente") => (valor: string) =>
      cambiar({ ...filtros, [clave]: alternarValor(filtros[clave], valor) });

  const k = data?.kpis;
  const comp = data?.comparacion ?? null;
  const sinCambios =
    filtros.desde === rangoInicial.desde &&
    filtros.hasta === rangoInicial.hasta &&
    sinValores(filtros.proveedor) &&
    sinValores(filtros.marca) &&
    sinValores(filtros.sku) &&
    sinValores(filtros.cliente);

  /**
   * ¿Hay algún filtro de dimensión puesto? Importa sólo para el equilibrio: el
   * abono del plan no baja porque uno mire un proveedor, pero la contribución
   * sí, así que con un filtro puesto se estaría comparando una parte de la
   * venta contra el costo fijo entero. El panel lo avisa en vez de mostrar una
   * cobertura que no significa nada.
   */
  const filtradoPorDimension =
    !sinValores(filtros.proveedor) ||
    !sinValores(filtros.marca) ||
    !sinValores(filtros.sku) ||
    !sinValores(filtros.cliente);

  /** Texto del período anterior para las tarjetas, o null si no hay con qué comparar. */
  const contra = comp
    ? comp.desde === comp.hasta
      ? `vs ${fmtFechaCorta(comp.desde)}`
      : `vs ${fmtFechaCorta(comp.desde)}–${fmtFechaCorta(comp.hasta)}`
    : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1>
            <EncabezadoCanal canal="tienda-nube" />
          </h1>
          <p className="text-muted mt-1 text-xs">
            {data
              ? `Actualizado ${new Date(data.generadoEn).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}` +
                (data.ultimaVenta
                  ? ` · última venta cargada ${fmtFechaCorta(data.ultimaVenta)}`
                  : "")
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

      <BarraFiltrosTiendaNube
        filtros={filtros}
        opciones={data?.opciones ?? null}
        onChange={cambiar}
        onLimpiar={() => cambiar(inicial)}
        sinCambios={!!sinCambios}
        nota={`${CRITERIO_VENTA} Márgenes sobre venta c/IVA, igual que Mercado Libre — Ventas Mayoristas los mide s/IVA.`}
      />

      {/* Chips de los filtros cruzados, que no tienen selector en la barra.
          Sin esto un filtro puesto de un click quedaría invisible: el tablero
          mostraría un recorte y no habría nada en pantalla diciendo por qué. */}
      {(!sinValores(filtros.sku) || !sinValores(filtros.cliente)) && (
        <div className="flex flex-wrap items-center gap-2">
          {filtros.cliente?.map((c) => (
            <button
              key={`cli-${c}`}
              onClick={() => alternarEn("cliente")(c)}
              className="border-c1/40 bg-c1/10 text-c1 hover:bg-c1/20 rounded-full border px-3 py-1 text-xs"
            >
              {c} ✕
            </button>
          ))}
          {filtros.sku?.map((s) => (
            <button
              key={`sku-${s}`}
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
          <p className="mt-1 font-mono text-xs break-words opacity-80">
            {error}
          </p>
        </Aviso>
      )}

      {/* Hay ventas pero ninguna tiene número de pedido.
          Pasa cuando `gold.fact_ventas` todavía tiene las filas viejas: hasta
          agosto de 2026 `modelo.py` guardaba Tienda Nube con `nro_orden` en
          null, así que el panel de pedidos queda vacío y el KPI marca 0 al lado
          de una venta de seis cifras. Sin este aviso eso se lee como "no
          vendimos", que es exactamente lo contrario de lo que pasó. */}
      {k && k.lineas > 0 && k.pedidos === 0 && (
        <Aviso tono="info">
          <p className="font-medium">
            Los pedidos todavía no están reconstruidos.
          </p>
          <p className="mt-1">
            Hay {fmtNumero(k.lineas)} líneas de venta cargadas, pero ninguna
            trae número de pedido, así que el panel de pedidos y el conteo
            aparecen vacíos. Los importes de arriba sí son correctos. Se arregla
            corriendo el orquestador: <code>python tiendanube.py</code> y
            después <code>python modelo.py --todo</code>.
          </p>
        </Aviso>
      )}

      {error ? null : !k ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 11 }, (_, i) => (
            <Esqueleto key={i} className="h-[74px]" />
          ))}
        </div>
      ) : (
        <ConAlarmaMargen activa={k.rentabilidadNeta < 0}>
          <div
            // Seis columnas para que las once tarjetas entren en dos filas y no
            // en tres. Abajo de `lg` bajan a tres y dos: apretar seis en una
            // pantalla chica no ahorra scroll, sólo hace ilegibles los importes.
            className={`grid gap-2.5 transition-opacity sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 ${cargando ? "opacity-50" : ""}`}
          >
            <TarjetaKpi
              compacta
              titulo="Venta c/IVA"
              valor={fmtMoneda(k.ventaCiva)}
              detalle={
                contra && comp ? (
                  <Delta
                    actual={k.ventaCiva}
                    anterior={comp.ventaCiva}
                    contra={contra}
                  />
                ) : (
                  `${fmtMoneda(k.ventaSiva)} sin IVA`
                )
              }
            />
            <TarjetaKpi
              compacta
              titulo="Rentabilidad bruta"
              valor={fmtMoneda(k.rentabilidad)}
              detalle={
                contra && comp ? (
                  <Delta
                    actual={k.rentabilidad}
                    anterior={comp.rentabilidad}
                    contra={contra}
                  />
                ) : (
                  "Venta s/IVA − costo − envío − comisión"
                )
              }
              acento={k.rentabilidad < 0 ? TEMA.negativo : PALETA[1]}
            />
            <TarjetaKpi
              compacta
              titulo="Margen bruto"
              valor={fmtPct(k.margenPct)}
              detalle={
                contra && comp && comp.margenPct != null && k.margenPct != null
                  ? `${comp.margenPct < k.margenPct ? "▲" : "▼"} era ${fmtPct(comp.margenPct)} ${contra}`
                  : "Rentabilidad sobre venta c/IVA"
              }
              acento={(k.margenPct ?? 0) < 0 ? TEMA.negativo : undefined}
            />
            {/* La neta al lado de la bruta a propósito: la diferencia entre las dos
              es el 7,4 % de impuestos, y verlas separadas es lo que hace que una
              venta "con margen" se lea como lo que es. */}
            <TarjetaKpi
              compacta
              titulo="Rentabilidad neta"
              valor={fmtMoneda(k.rentabilidadNeta)}
              detalle={`${fmtPct(k.margenNetoPct)} sobre venta c/IVA · ${fmtMoneda(k.impuestos)} de impuestos`}
              acento={k.rentabilidadNeta < 0 ? TEMA.negativo : undefined}
            />

            <TarjetaKpi
              compacta
              titulo="Pedidos"
              valor={fmtNumero(k.pedidos)}
              detalle={
                contra && comp ? (
                  <Delta
                    actual={k.pedidos}
                    anterior={comp.pedidos}
                    contra={contra}
                  />
                ) : (
                  `${fmtNumero(k.unidades)} unidades en ${fmtNumero(k.lineas)} líneas`
                )
              }
            />
            <TarjetaKpi
              compacta
              titulo="Clientes"
              valor={fmtNumero(k.clientes)}
              detalle={
                // El orden de los casos importa: sin pedidos no se puede decir
                // nada sobre repetición, y decir "nadie compró dos veces" cuando
                // en realidad falta el dato sería inventar una conclusión.
                k.pedidos === 0
                  ? `${fmtNumero(k.lineas)} líneas sin pedido asociado`
                  : k.pedidos > k.clientes
                    ? `${fmtNumero(k.pedidos - k.clientes)} ${k.pedidos - k.clientes === 1 ? "pedido repetido" : "pedidos repetidos"} · ${(k.pedidos / k.clientes).toFixed(2)} por cliente`
                    : "Uno por pedido: nadie compró dos veces en el recorte"
              }
            />
            <TarjetaKpi
              compacta
              titulo="Ticket promedio"
              valor={fmtMoneda(k.ticketPromedio)}
              detalle={
                contra && comp && comp.pedidos > 0 ? (
                  <Delta
                    actual={k.ticketPromedio ?? 0}
                    anterior={comp.ventaCiva / comp.pedidos}
                    contra={contra}
                  />
                ) : (
                  `${fmtMoneda(k.costo)} de costo de mercadería`
                )
              }
            />
            {/* El envío que absorbe LA TIENDA, no el que paga el comprador. Son dos
              campos distintos en Tienda Nube y solo este es un costo. */}
            <TarjetaKpi
              compacta
              titulo="Envío a cargo nuestro"
              valor={fmtMoneda(k.envio)}
              detalle={
                k.envio === 0
                  ? "Sin envíos con costo en este recorte"
                  : `${fmtPct(k.envio / k.ventaCiva)} de la venta c/IVA`
              }
            />
            {/* Va al lado del envío porque son los dos costos del canal que no
              son mercadería, y se leen juntos cuando uno se pregunta por qué el
              margen es el que es. */}
            <TarjetaKpi
              compacta
              titulo="Comisión de pasarela"
              valor={fmtMoneda(k.comision)}
              detalle={
                k.comision === 0
                  ? "Sin comisiones en este recorte"
                  : "Calculada con el arancel de cada medio de pago"
              }
            />
            {/* NO se suma a la comisión: es la otra mitad de la misma tarifa.
              Está separada porque Pago Nube bonifica esta parte y Nave no, y
              sumadas esa diferencia —que es la que decide con qué pasarela
              conviene cobrar— queda escondida. */}
            <TarjetaKpi
              compacta
              titulo="Costo de plataforma"
              valor={fmtMoneda(k.costoTransaccion)}
              detalle={
                k.costoTransaccion === 0
                  ? "Todo se cobró con Pago Nube, que lo bonifica"
                  : "Parte de la comisión que se queda Tienda Nube"
              }
            />
            <TarjetaKpi
              compacta
              titulo="Comisión sobre venta"
              valor={fmtPct(k.comisionPct)}
              detalle={
                // La aclaración no es un tecnicismo: sin ella este número se lee
                // como "el arancel que nos cobran" y da más alto que cualquier
                // tarifa de la tabla, porque la pasarela cobra sobre el total
                // pagado —que incluye el envío— y acá el denominador no lo tiene.
                k.comision === 0
                  ? "Sin comisiones en este recorte"
                  : "Sobre venta c/IVA, que no incluye el envío cobrado"
              }
            />
          </div>
        </ConAlarmaMargen>
      )}

      {data && (
        <div className={cargando ? "opacity-50 transition-opacity" : "transition-opacity"}>
          <PanelEquilibrio
            eq={data.equilibrio}
            filtrado={filtradoPorDimension}
          />
        </div>
      )}

      {data && (
        <div
          className={`space-y-4 transition-opacity ${cargando ? "opacity-50" : ""}`}
        >
          {/* El panel de pedidos va PRIMERO, antes que cualquier ranking: en un
              canal de treinta pedidos la venta individual es la unidad de
              análisis, no un detalle al que se baja después. */}
          <Panel
            titulo="Pedidos"
            nota={
              data.pedidosRecortados
                ? `Se muestran los ${data.pedidos.length} más recientes`
                : `${fmtNumero(data.pedidos.length)} ${data.pedidos.length === 1 ? "pedido" : "pedidos"} · click para filtrar por cliente`
            }
          >
            <Tabla
              filas={data.pedidos}
              columnas={columnasPedidos(data.pedidos)}
              clave={(p, i) => `${p.nroOrden ?? "s"}-${i}`}
              onClickFila={(p) => p.cliente && alternarEn("cliente")(p.cliente)}
              activa={(p) =>
                filtros.cliente?.length
                  ? filtros.cliente.includes(p.cliente ?? "")
                  : false
              }
              vacio="Ningún pedido pagado en el recorte elegido."
            />
          </Panel>

          {/* Artículos va PEGADO a Pedidos y no al final: son las dos tablas de
              detalle del canal, y la pregunta que sigue a "qué pedidos entraron"
              es "qué se vendió". Los rankings y gráficos van después, que es
              donde se mira el agregado. */}
          <Panel
            titulo="Artículos"
            nota={`${data.articulos.length} SKUs · click para filtrar · impuestos aparte (${fmtPct(CARGA_IMPOSITIVA)})`}
          >
            <Tabla
              filas={data.articulos}
              columnas={columnasArticulos(data.articulos)}
              clave={(a, i) => `${a.sku ?? "sin-sku"}-${i}`}
              onClickFila={(a) => a.sku && alternarEn("sku")(a.sku)}
              activa={(a) =>
                filtros.sku?.length ? filtros.sku.includes(a.sku ?? "") : false
              }
              vacio="Sin ventas en el recorte elegido."
            />
          </Panel>

          {data.rango.dias > 1 && (
            <Panel
              titulo="Venta y rentabilidad por día"
              nota="Venta c/IVA contra rentabilidad bruta"
            >
              <VentaRentabilidad datos={data.porDia} />
            </Panel>
          )}

          <div className="grid gap-4 xl:grid-cols-2">
            <Panel
              titulo="Clientes"
              nota="Top 50 por venta · ↻ marca al que volvió · click para filtrar"
            >
              <Tabla
                filas={data.clientes}
                columnas={columnasClientes(data.clientes)}
                clave={(c) => c.cliente}
                onClickFila={(c) => alternarEn("cliente")(c.cliente)}
                activa={(c) =>
                  filtros.cliente?.length
                    ? filtros.cliente.includes(c.cliente)
                    : false
                }
                vacio="Sin ventas en el recorte elegido."
              />
            </Panel>

            <Panel
              titulo="Top artículos por rentabilidad"
              nota="Los que más plata dejaron · no son los que más vendieron"
            >
              <Tabla
                filas={data.topRentabilidad}
                columnas={columnasTop(data.topRentabilidad)}
                clave={(a, i) => `${a.sku ?? "sin-sku"}-${i}`}
                onClickFila={(a) => a.sku && alternarEn("sku")(a.sku)}
                activa={(a) =>
                  filtros.sku?.length
                    ? filtros.sku.includes(a.sku ?? "")
                    : false
                }
                vacio="Sin ventas en el recorte elegido."
              />
            </Panel>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <Panel
              titulo="Venta por proveedor"
              nota="Top 12 · click para filtrar"
            >
              <TortaProveedores
                datos={data.porProveedor.map((p) => ({
                  label: p.label,
                  total: p.venta,
                }))}
                totalGeneral={data.ventaTotalProveedores}
                seleccionados={filtros.proveedor}
                onSeleccionar={alternarEn("proveedor")}
              />
            </Panel>
            <Panel
              titulo="Rentabilidad por proveedor"
              nota="Top 12 por venta · click para filtrar"
            >
              <TablaRanking
                filas={data.porProveedor}
                titulo="Proveedor"
                seleccionados={filtros.proveedor}
                onSeleccionar={alternarEn("proveedor")}
              />
            </Panel>
          </div>


          {/* Lo que el tablero NO sabe, dicho en la pantalla y no solo en el
              código: un margen que se lee sin esta aclaración es un margen
              equivocado, y quien lo mire no tiene por qué saberlo. */}
          <p className="text-muted mt-3 text-[11px] leading-relaxed">
            Rentabilidad bruta = venta s/IVA − costo (ya con descuento de
            proveedor) − envío a cargo nuestro − comisión de la pasarela.
            Rentabilidad neta = bruta − {fmtPct(CARGA_IMPOSITIVA)} de impuestos
            sobre la venta s/IVA.{" "}
            <strong>
              La comisión no viene en la API: se calcula con el arancel de cada
              pasarela y medio de pago, tomado del panel de la tienda
            </strong>
            . Las tasas van con IVA incluido. El débito se cobra como crédito
            porque la API manda el mismo valor para los dos.
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * El canal contra su costo fijo.
 *
 * Está aparte de la grilla de tarjetas y no es un capricho de layout: TODAS las
 * tarjetas responden a los filtros y ésta no del todo —el abono del plan se
 * paga igual—, así que ponerla al lado insinuaría que se comporta como las
 * demás. Separada, la diferencia se ve.
 */
function PanelEquilibrio({
  eq,
  filtrado,
}: {
  eq: DashboardTiendaNube["equilibrio"];
  filtrado: boolean;
}) {
  const resultado = eq.contribucion - eq.costosFijos;
  // La barra se corta en 100 %: pasado el equilibrio lo que importa es que se
  // llegó, y una barra que sigue creciendo achica visualmente el tramo que de
  // verdad se mira, que es el de abajo.
  const avance = eq.coberturaPct == null ? 0 : Math.min(Math.max(eq.coberturaPct, 0), 1);
  const cubierto = eq.coberturaPct != null && eq.coberturaPct >= 1;

  return (
    <Panel
      titulo="Equilibrio del canal"
      nota={
        filtrado
          ? "Con filtros puestos: el plan no baja, la contribución sí"
          : "Abono del plan prorrateado por día sobre el rango"
      }
    >
      {!eq.costosFijosCargados ? (
        <div className="space-y-2">
          <p className="text-2xl font-semibold">{fmtMoneda(eq.contribucion)}</p>
          <p className="text-muted text-sm">
            Es lo que deja la operación antes del abono del plan: venta s/IVA
            menos costo, envío, comisión y costo de plataforma.
          </p>
          {/* `info` y no `error`: que todavía no se haya cargado el abono no es
            una falla del tablero, es un dato que falta. */}
          <Aviso tono="info">
            Falta cargar cuánto sale el plan del mes. Va en{" "}
            <span className="font-mono text-xs">bronze.costos_plataforma_tn</span>,
            columna <span className="font-mono text-xs">abono_mensual</span>. Hasta
            entonces no se puede decir si el canal gana o pierde — sólo cuánto
            genera.
          </Aviso>
        </div>
      ) : (
        <div className="space-y-4">
          {/* "Bruta" y "bruto" son la misma palabra que en la tarjeta
            "Rentabilidad bruta", y significan lo mismo: ANTES de la carga
            impositiva. La contribución de acá es ese mismo número, así que
            llamarla de otra forma haría pensar que son dos cuentas distintas. */}
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <p className="text-muted text-xs">Contribución bruta</p>
              <p className="text-lg font-semibold">{fmtMoneda(eq.contribucion)}</p>
            </div>
            <div>
              <p className="text-muted text-xs">Costos fijos (pago de plan)</p>
              <p className="text-lg font-semibold">−{fmtMoneda(eq.costosFijos)}</p>
            </div>
            <div>
              <p className="text-muted text-xs">Resultado bruto del canal</p>
              <p
                className="text-lg font-semibold"
                style={{ color: resultado < 0 ? TEMA.negativo : undefined }}
              >
                {fmtMoneda(resultado)}
              </p>
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="bg-line h-2.5 w-full overflow-hidden rounded-full">
              <div
                className="h-full rounded-full transition-[width]"
                style={{
                  width: `${avance * 100}%`,
                  background: cubierto ? PALETA[1] : TEMA.negativo,
                }}
              />
            </div>
            <p className="text-sm">
              {cubierto ? (
                <>
                  Cubre el <strong>{fmtPct(eq.coberturaPct)}</strong> del pago del
                  plan: el canal ya pasó el equilibrio.
                </>
              ) : (
                <>
                  Cubre el <strong>{fmtPct(eq.coberturaPct)}</strong> del pago del
                  plan. Faltan {fmtMoneda(eq.costosFijos - eq.contribucion)} para
                  empatar.
                </>
              )}
            </p>
            {eq.ventaEquilibrio != null && !cubierto && (
              <p className="text-muted text-sm">
                Al margen de contribución de este recorte, el equilibrio está en{" "}
                {fmtMoneda(eq.ventaEquilibrio)} de venta c/IVA.
              </p>
            )}
          </div>
        </div>
      )}
    </Panel>
  );
}
