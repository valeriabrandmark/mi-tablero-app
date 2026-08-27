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
      titulo: "Costo",
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
      titulo: "Comisión",
      celda: (p) => fmtMoneda(p.comision),
      numerica: true,
      orden: (p) => p.comision,
      total: fmtMoneda(sumar(filas, (p) => p.comision)),
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
      titulo: "Rentab.",
      celda: (c) => <Importe valor={c.rentabilidad} />,
      numerica: true,
      orden: (c) => c.rentabilidad,
      total: <Importe valor={sumar(filas, (c) => c.rentabilidad)} />,
    },
    {
      titulo: "Margen",
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
      titulo: "Costo",
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
      titulo: "Rentabilidad",
      celda: (a) => <Importe valor={a.rentabilidad} />,
      numerica: true,
      orden: (a) => a.rentabilidad,
      total: fmtMoneda(sumar(filas, (a) => a.rentabilidad)),
    },
    {
      titulo: "Margen",
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
      titulo: "Rentabilidad",
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
      titulo: "Margen",
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
      titulo: "Rentab.",
      celda: (r) => <Importe valor={r.rentabilidad} />,
      numerica: true,
      orden: (r) => r.rentabilidad,
      total: <Importe valor={sumar(filas, (r) => r.rentabilidad)} />,
    },
    {
      titulo: "Margen",
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
          {Array.from({ length: 8 }, (_, i) => (
            <Esqueleto key={i} className="h-[86px]" />
          ))}
        </div>
      ) : (
        <ConAlarmaMargen activa={k.rentabilidadNeta < 0}>
          <div
            className={`grid gap-3 transition-opacity sm:grid-cols-2 lg:grid-cols-4 ${cargando ? "opacity-50" : ""}`}
          >
            <TarjetaKpi
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
                  "Venta s/IVA − costo − envío"
                )
              }
              acento={k.rentabilidad < 0 ? TEMA.negativo : PALETA[1]}
            />
            <TarjetaKpi
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
              titulo="Rentabilidad neta"
              valor={fmtMoneda(k.rentabilidadNeta)}
              detalle={`${fmtPct(k.margenNetoPct)} sobre venta c/IVA · ${fmtMoneda(k.impuestos)} de impuestos`}
              acento={k.rentabilidadNeta < 0 ? TEMA.negativo : undefined}
            />

            <TarjetaKpi
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
              titulo="Envío a cargo nuestro"
              valor={fmtMoneda(k.envio)}
              detalle={
                k.envio === 0
                  ? "Sin envíos con costo en este recorte"
                  : `${fmtPct(k.envio / k.ventaCiva)} de la venta c/IVA`
              }
            />
          </div>
        </ConAlarmaMargen>
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
