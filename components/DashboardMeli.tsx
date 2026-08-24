"use client";

import { useEffect, useState } from "react";
import VentaRentabilidad from "@/components/charts/VentaRentabilidad";
import TortaProveedores from "@/components/charts/TortaProveedores";
import BarrasCategoria from "@/components/charts/BarrasCategoria";
import BarraFiltrosMeli from "@/components/FiltrosMeli";
import {
  promedioPonderado,
  sumar,
  Tabla,
  type Columna,
} from "@/components/Tabla";
import { Aviso, Delta, Esqueleto, Panel, TarjetaKpi } from "@/components/ui";
import { alternar as alternarValor, vacio as sinValores } from "@/lib/filtros";
import { fmtFechaCorta, fmtMoneda, fmtNumero, fmtPct } from "@/lib/format";
import { CARGA_IMPOSITIVA, TOPE_ARTICULOS } from "@/lib/meli";
import { PALETA, TEMA } from "@/lib/paleta";
import { useDatosTablero } from "@/lib/useDatosTablero";
import type {
  ArticuloMeli,
  CancelacionesMeli,
  DashboardMeli,
  FilaCancelacionMeli,
  FiltrosMeli,
  LineaVentaMeli,
  OpcionesMeli,
  RankingMeli,
  UltimaCargaMeli,
} from "@/lib/types";

type Respuesta = DashboardMeli & { opciones: OpcionesMeli | null };

/**
 * Los totales de una tabla de artículos.
 *
 * Los importes y las unidades se suman. El MARGEN no: es la rentabilidad total
 * sobre la venta total, o sea el promedio ponderado. Ver `promedioPonderado`
 * en Tabla.tsx — el promedio simple de los porcentajes deja que un artículo de
 * una unidad pese lo mismo que uno de mil.
 */
/**
 * El número de orden de Mercado Libre.
 *
 * Va en monoespaciada porque es un identificador que se copia y se pega en el
 * buscador de ML: con la tipografía del resto, un 0 y una O se confunden.
 */
function celdaOrden(nroOrden: string | null) {
  return nroOrden ? (
    <span className="font-mono text-[11px] tracking-tight">{nroOrden}</span>
  ) : (
    "—"
  );
}

function columnasArticulos(filas: LineaVentaMeli[]): Columna<LineaVentaMeli>[] {
  return [
    {
      titulo: "N° orden",
      celda: (a) => celdaOrden(a.nroOrden),
      orden: (a) => a.nroOrden,
    },
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
      titulo: "Comisión",
      celda: (a) => fmtMoneda(a.comision),
      numerica: true,
      orden: (a) => a.comision,
      total: fmtMoneda(sumar(filas, (a) => a.comision)),
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
      celda: (a) => (
        <span style={a.rentabilidad < 0 ? { color: TEMA.negativo } : undefined}>
          {fmtMoneda(a.rentabilidad)}
        </span>
      ),
      numerica: true,
      orden: (a) => a.rentabilidad,
      total: fmtMoneda(sumar(filas, (a) => a.rentabilidad)),
    },
    {
      titulo: "Margen",
      celda: (a) => (
        <span
          style={(a.margenPct ?? 0) < 0 ? { color: TEMA.negativo } : undefined}
        >
          {fmtPct(a.margenPct)}
        </span>
      ),
      numerica: true,
      orden: (a) => a.margenPct,
      total: fmtPct(
        promedioPonderado(
          filas,
          (a) => a.rentabilidad,
          (a) => a.ventaCiva,
        ),
      ),
    },
  ];
}

/**
 * Cancelaciones. NO tiene columna de costo ni de margen a propósito: no fue una
 * venta, así que no hay ganancia que calcular. La pregunta acá es otra — qué se
 * cancela y cuánto pesa.
 */
function columnasCancelaciones(
  totales: CancelacionesMeli,
): Columna<FilaCancelacionMeli>[] {
  return [
    { titulo: "SKU", celda: (c) => c.sku ?? "—", orden: (c) => c.sku },
    {
      titulo: "Producto",
      celda: (c) => (
        <span className="block max-w-[320px] truncate">
          {c.producto ?? "—"}
        </span>
      ),
      orden: (c) => c.producto,
    },
    {
      titulo: "Marca",
      celda: (c) => (
        <span className="block max-w-[140px] truncate">{c.marca ?? "—"}</span>
      ),
      orden: (c) => c.marca,
    },
    // Los tres totales vienen del servidor y NO de sumar las filas. Las órdenes
    // porque una orden de tres productos ocupa tres filas y sumarlas la contaría
    // tres veces; los otros dos porque la tabla está recortada al top 100 y la
    // suma de lo que se ve sería menos de lo que se canceló de verdad.
    // Antes acá iba la CANTIDAD de órdenes de ese SKU. Desde que hay una fila por
    // orden y SKU esa cuenta valdría siempre 1, así que la columna pasa a ser el
    // número. El total de abajo sigue siendo las órdenes DISTINTAS del recorte.
    {
      titulo: "N° orden",
      celda: (c) => celdaOrden(c.nroOrden),
      orden: (c) => c.nroOrden,
      total: `${fmtNumero(totales.ordenes)} órdenes`,
    },
    {
      titulo: "Unid.",
      celda: (c) => fmtNumero(c.unidades),
      numerica: true,
      orden: (c) => c.unidades,
      total: fmtNumero(totales.unidades),
    },
    {
      titulo: "Monto cancelado",
      celda: (c) => (
        <span style={{ color: TEMA.negativo }}>{fmtMoneda(c.monto)}</span>
      ),
      numerica: true,
      orden: (c) => c.monto,
      total: (
        <span style={{ color: TEMA.negativo }}>{fmtMoneda(totales.monto)}</span>
      ),
    },
  ];
}

/** El top por rentabilidad va con menos columnas: se lee de un vistazo. */
function columnasTop(filas: ArticuloMeli[]): Columna<ArticuloMeli>[] {
  return [
    { titulo: "SKU", celda: (a) => a.sku ?? "—", orden: (a) => a.sku },
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
      celda: (a) => fmtPct(a.margenPct),
      numerica: true,
      orden: (a) => a.margenPct,
      total: fmtPct(
        promedioPonderado(
          filas,
          (a) => a.rentabilidad,
          (a) => a.ventaCiva,
        ),
      ),
    },
  ];
}

/**
 * La última orden cargada, y cuánto hace de eso.
 *
 * Reemplaza al "Actualizado HH:MM" que había antes, que era la hora en que se
 * armó la página: se renovaba en cada visita aunque el orquestador llevara tres
 * horas caído. Decía cuándo miraste, no cuán viejo es lo que estás mirando.
 *
 * El "hace N min" se recalcula solo cada 30 segundos. Sin eso, dejar la pestaña
 * abierta congelaría el atraso en el valor que tenía al abrirla — que es
 * exactamente el error que este cartel viene a corregir.
 */
function UltimaCarga({
  carga,
  cargando,
}: {
  carga: UltimaCargaMeli | null;
  cargando: boolean;
}) {
  const [ahora, setAhora] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setAhora(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  if (cargando)
    return <p className="text-muted text-xs">Cargando datos en vivo…</p>;
  if (!carga)
    return (
      <p className="text-muted text-xs">Todavía no hay órdenes cargadas.</p>
    );

  const minutos = Math.max(
    0,
    Math.round((ahora - Date.parse(carga.iso)) / 60_000),
  );
  const atraso =
    minutos < 60
      ? `hace ${minutos} min`
      : minutos < 60 * 24
        ? `hace ${Math.floor(minutos / 60)} h ${minutos % 60} min`
        : `hace ${Math.floor(minutos / 1440)} días`;

  // Más de dos horas sin una orden nueva no siempre es una falla —de madrugada
  // no se vende— pero es lo único que se puede decir sin saber la hora. Se
  // marca en ámbar y no en rojo justo por eso: es "mirá esto", no "está roto".
  const viejo = minutos > 120;
  const [fecha, hora] = carga.local.split(" ");

  return (
    <p className="text-muted text-xs">
      Última venta cargada{" "}
      <strong className="text-ink font-medium">
        {fmtFechaCorta(fecha)} {hora}
      </strong>{" "}
      · orden <span className="text-ink font-mono">{carga.nroOrden}</span> ·{" "}
      <span style={viejo ? { color: PALETA[2] } : undefined}>{atraso}</span>
    </p>
  );
}

/** Ranking en tabla y no en gráfico: son cuatro números por fila, no uno. */
function TablaRanking({
  filas,
  titulo,
  seleccionados,
  onSeleccionar,
}: {
  filas: RankingMeli[];
  titulo: string;
  seleccionados?: string[];
  onSeleccionar: (v: string) => void;
}) {
  const columnas: Columna<RankingMeli>[] = [
    {
      titulo,
      celda: (r) => <span className="block max-w-[220px] truncate">{r.label}</span>,
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
      celda: (r) => (
        <span style={r.rentabilidad < 0 ? { color: TEMA.negativo } : undefined}>
          {fmtMoneda(r.rentabilidad)}
        </span>
      ),
      numerica: true,
      orden: (r) => r.rentabilidad,
      total: fmtMoneda(sumar(filas, (r) => r.rentabilidad)),
    },
    {
      titulo: "Margen",
      celda: (r) => (
        <span style={(r.margenPct ?? 0) < 0 ? { color: TEMA.negativo } : undefined}>
          {fmtPct(r.margenPct)}
        </span>
      ),
      numerica: true,
      orden: (r) => r.margenPct,
      total: fmtPct(
        promedioPonderado(
          filas,
          (r) => r.rentabilidad,
          (r) => r.venta,
        ),
      ),
    },
  ];

  return (
    <Tabla
      filas={filas}
      columnas={columnas}
      clave={(r) => r.label}
      onClickFila={(r) => onSeleccionar(r.label)}
      activa={(r) => (seleccionados?.length ? seleccionados.includes(r.label) : false)}
    />
  );
}

export default function DashboardMeliPage({ diaInicial }: { diaInicial: string }) {
  // Abre en un solo día, como el reporte de Data Studio. `diaInicial` lo resuelve
  // el servidor: es hoy, o el último día con ventas si hoy todavía no cargó.
  const inicial: FiltrosMeli = { desde: diaInicial, hasta: diaInicial };
  const [filtros, setFiltros] = useState<FiltrosMeli>(inicial);

  const { data, cargando, error, recargar, empezarCarga } = useDatosTablero<Respuesta>(
    "/api/meli",
    filtros as unknown as Record<string, string[] | undefined>,
    { conOpciones: "1" },
  );

  /**
   * Qué se cuenta como "venta". No es un filtro: los dos números vienen
   * siempre del servidor y el switch solo elige cuál mostrar, así que cambiarlo
   * no dispara una consulta ni hace parpadear la pantalla.
   */
  const [conCanceladas, setConCanceladas] = useState(false);

  const cambiar = (f: FiltrosMeli) => {
    empezarCarga();
    setFiltros(f);
  };

  const alternarEn = (clave: "proveedor" | "marca" | "sku" | "hora") => (valor: string) =>
    cambiar({ ...filtros, [clave]: alternarValor(filtros[clave], valor) });

  const k = data?.kpis;
  const comp = data?.comparacion ?? null;
  const canc = data?.cancelaciones ?? null;

  // Con el switch en "todo lo transaccionado" se le suma lo cancelado a los
  // números de VOLUMEN —plata, órdenes, unidades—, que son los únicos que
  // tienen sentido sumados.
  //
  // El costo, la comisión, el envío y por lo tanto la rentabilidad y el margen
  // NO cambian nunca: una orden cancelada no tiene costo ni deja ganancia, así
  // que meterla en el margen daría un margen falso. Las tarjetas de margen lo
  // dicen en su bajada cuando el switch está prendido.
  const extra =
    conCanceladas && canc ? canc : { monto: 0, ordenes: 0, unidades: 0 };
  const ventaMostrada = (k?.ventaCiva ?? 0) + extra.monto;
  const ordenesMostradas = (k?.ordenes ?? 0) + extra.ordenes;
  const unidadesMostradas = (k?.unidades ?? 0) + extra.unidades;
  const ticketMostrado =
    ordenesMostradas === 0 ? null : ventaMostrada / ordenesMostradas;
  const sinCambios =
    filtros.desde === diaInicial &&
    filtros.hasta === diaInicial &&
    sinValores(filtros.proveedor) &&
    sinValores(filtros.marca) &&
    sinValores(filtros.sku) &&
    sinValores(filtros.hora);

  /** Texto del período anterior para las tarjetas, o null si no hay con qué comparar. */
  // Si el período anterior se midió hasta una hora, la etiqueta LO DICE. Un
  // "−12 % vs 18/08" y un "−12 % vs 18/08 hasta 16:05" son dos afirmaciones
  // distintas, y la segunda es la única que se puede interpretar cuando el día
  // de hoy está a medio pasar.
  const hasta = comp?.hastaHora ? ` hasta ${comp.hastaHora.slice(0, 5)}` : "";
  const contra = comp
    ? comp.desde === comp.hasta
      ? `vs ${fmtFechaCorta(comp.desde)}${hasta}`
      : `vs ${fmtFechaCorta(comp.desde)}–${fmtFechaCorta(comp.hasta)}${hasta}`
    : null;

  return (
    <div className="space-y-4">
      {/* Sin título: el logo y la pestaña activa, los dos arriba de esto, ya
          dicen dónde estás. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <UltimaCarga carga={data?.ultimaCarga ?? null} cargando={!data} />
        <button
          onClick={recargar}
          disabled={cargando}
          className="border-line hover:bg-panel-2 text-muted hover:text-ink rounded-lg border px-3 py-1.5 text-xs disabled:opacity-40"
        >
          {cargando ? "Actualizando…" : "Actualizar"}
        </button>
      </div>

      <BarraFiltrosMeli
        filtros={filtros}
        opciones={data?.opciones ?? null}
        onChange={cambiar}
        onLimpiar={() => cambiar(inicial)}
        sinCambios={!!sinCambios}
        nota="Solo canal Mercado Libre. Todos los márgenes son sobre venta c/IVA — Ventas Mayoristas los mide s/IVA, ojo al comparar."
      />

      {/* Los chips solo aparecen para los filtros que no tienen selector arriba:
          proveedor y marca ya se ven en su desplegable. */}
      {(!sinValores(filtros.sku) || !sinValores(filtros.hora)) && (
        <div className="flex flex-wrap items-center gap-2">
          {filtros.hora?.map((h) => (
            <button
              key={`hora-${h}`}
              onClick={() => alternarEn("hora")(h)}
              className="border-c1/40 bg-c1/10 text-c1 hover:bg-c1/20 rounded-full border px-3 py-1 text-xs"
            >
              {h}:00 a {h}:59 ✕
            </button>
          ))}
          {filtros.sku?.map((s) => (
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

      {/* El switch va acá arriba y no adentro de la barra de filtros a
          propósito: no es un filtro. Un filtro recorta qué órdenes se miran;
          esto cambia qué cuenta como venta, que es una definición. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="border-line inline-flex rounded-lg border p-0.5">
          {[
            { on: false, label: "Ventas efectivas" },
            { on: true, label: "Todo lo transaccionado" },
          ].map((op) => (
            <button
              key={op.label}
              type="button"
              onClick={() => setConCanceladas(op.on)}
              aria-pressed={conCanceladas === op.on}
              className={`rounded-md px-3 py-1.5 text-xs transition-colors ${
                conCanceladas === op.on
                  ? "bg-c1/15 text-c1 font-medium"
                  : "text-muted hover:text-ink"
              }`}
            >
              {op.label}
            </button>
          ))}
        </div>
        <span className="text-muted text-[11px] leading-tight">
          {conCanceladas
            ? "Pagadas + canceladas. El margen sigue midiéndose solo sobre lo pagado."
            : "Solo órdenes pagadas. Lo cancelado queda afuera de todas las tarjetas."}
        </span>
      </div>

      {error && (
        <Aviso>
          <p className="font-medium">No se pudieron leer los datos.</p>
          <p className="mt-1 font-mono text-xs break-words opacity-80">{error}</p>
        </Aviso>
      )}

      {error ? null : !k ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => (
            <Esqueleto key={i} className="h-[86px]" />
          ))}
        </div>
      ) : (
        <div
          className={`grid gap-3 transition-opacity sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 ${cargando ? "opacity-50" : ""}`}
        >
          <TarjetaKpi
            titulo={conCanceladas ? "Transaccionado c/IVA" : "Venta c/IVA"}
            valor={fmtMoneda(ventaMostrada)}
            // Con canceladas NO se compara contra el período anterior. El
            // período anterior se mide solo sobre ventas efectivas, así que un
            // "−12 % vs ayer" estaría restando dos cosas distintas. En su lugar
            // se muestra de qué se compone el número.
            detalle={
              conCanceladas ? (
                `${fmtMoneda(k.ventaCiva)} vendido + ${fmtMoneda(extra.monto)} cancelado`
              ) : contra && comp ? (
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
              conCanceladas ? (
                "Solo de las órdenes pagadas"
              ) : contra && comp ? (
                <Delta
                  actual={k.rentabilidad}
                  anterior={comp.rentabilidad}
                  contra={contra}
                />
              ) : (
                "Venta s/IVA − costo − comisión − envío"
              )
            }
            acento={k.rentabilidad < 0 ? TEMA.negativo : PALETA[1]}
          />
          <TarjetaKpi
            titulo="Margen bruto"
            valor={fmtPct(k.margenPct)}
            detalle={
              conCanceladas
                ? "Sobre venta efectiva: lo cancelado no deja margen"
                : contra &&
                    comp &&
                    comp.margenPct != null &&
                    k.margenPct != null
                  ? `${comp.margenPct < k.margenPct ? "▲" : "▼"} era ${fmtPct(comp.margenPct)} ${contra}`
                  : "Rentabilidad sobre venta c/IVA"
            }
            acento={(k.margenPct ?? 0) < 0 ? TEMA.negativo : undefined}
          />
          {/* La neta va al lado de la bruta a propósito: la diferencia entre las
              dos es el 7,4 % de impuestos, y verlas separadas es lo que hace
              que una venta "con margen" se lea como lo que es. */}
          <TarjetaKpi
            titulo="Rentabilidad neta"
            valor={fmtMoneda(k.rentabilidadNeta)}
            detalle={`${fmtPct(k.margenNetoPct)} sobre venta c/IVA · ${fmtMoneda(k.impuestos)} de impuestos`}
            acento={k.rentabilidadNeta < 0 ? TEMA.negativo : undefined}
          />

          <TarjetaKpi
            titulo="Órdenes"
            valor={fmtNumero(ordenesMostradas)}
            detalle={
              conCanceladas ? (
                `${fmtNumero(k.ordenes)} pagadas + ${fmtNumero(extra.ordenes)} canceladas`
              ) : contra && comp ? (
                <Delta
                  actual={k.ordenes}
                  anterior={comp.ordenes}
                  contra={contra}
                />
              ) : (
                `${fmtNumero(k.lineas)} líneas · ${fmtNumero(k.unidades)} unidades`
              )
            }
          />
          <TarjetaKpi
            titulo={conCanceladas ? "Unidades" : "Unidades vendidas"}
            valor={fmtNumero(unidadesMostradas)}
            detalle={
              conCanceladas ? (
                `${fmtNumero(k.unidades)} vendidas + ${fmtNumero(extra.unidades)} canceladas`
              ) : contra && comp ? (
                <Delta
                  actual={k.unidades}
                  anterior={comp.unidades}
                  contra={contra}
                />
              ) : (
                `${fmtNumero(k.lineas)} líneas de venta`
              )
            }
          />
          <TarjetaKpi
            titulo="Ticket promedio"
            valor={fmtMoneda(ticketMostrado)}
            detalle={
              conCanceladas ? (
                "Transaccionado c/IVA por orden"
              ) : contra && comp && comp.ordenes > 0 ? (
                <Delta
                  actual={k.ticketPromedio ?? 0}
                  anterior={comp.ventaCiva / comp.ordenes}
                  contra={contra}
                />
              ) : (
                "Venta c/IVA por orden"
              )
            }
          />
          {/* La tarjeta que pidió el switch: cuánto de lo transaccionado se
              cayó. Solo aparece con el switch prendido — en modo "ventas
              efectivas" lo cancelado no forma parte de ningún número de arriba,
              y una tarjeta suelta ahí daría a entender que sí. */}
          {conCanceladas && (
            <TarjetaKpi
              titulo="Cancelado"
              valor={fmtMoneda(extra.monto)}
              detalle={
                ventaMostrada > 0
                  ? `${fmtPct(extra.monto / ventaMostrada)} de lo transaccionado · ${fmtNumero(extra.ordenes)} ${extra.ordenes === 1 ? "orden" : "órdenes"}`
                  : `${fmtNumero(extra.ordenes)} ${extra.ordenes === 1 ? "orden" : "órdenes"}`
              }
              acento={TEMA.negativo}
            />
          )}
          <TarjetaKpi
            titulo="Costo mercadería"
            valor={fmtMoneda(k.costo)}
            detalle="Sin IVA, ya con el descuento del proveedor"
          />
          <TarjetaKpi
            titulo="Comisión Mercado Libre"
            valor={fmtMoneda(k.comision)}
            detalle={`${fmtPct(k.pctComision)} de la venta c/IVA`}
          />
          <TarjetaKpi
            titulo="Costo de envío"
            valor={fmtMoneda(k.envio)}
            detalle={
              k.envio === 0
                ? "Sin envíos cargados en este recorte"
                : `${fmtPct(k.envio / k.ventaCiva)} de la venta c/IVA`
            }
          />
        </div>
      )}

      {data && (
        <div className={`space-y-4 transition-opacity ${cargando ? "opacity-50" : ""}`}>
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
              titulo="Facturación por hora del día"
              nota={
                (conCanceladas
                  ? "Pagado en celeste, cancelado en rojo"
                  : "Venta c/IVA · solo órdenes pagadas") +
                " · hora argentina · click para filtrar el tablero por esa hora"
              }
            >
              {/* Facturación y no cantidad de órdenes. La diferencia importa:
                  la hora con más órdenes puede no ser la que más factura, y a
                  la hora de decidir cuándo empujar una publicación lo que pesa
                  son los pesos. Ojo con el otro lado de la moneda: una sola
                  venta grande puede mover el pico de lugar, sobre todo en
                  recortes de un día. */}
              <BarrasCategoria
                datos={data.porHora.map((h) => ({
                  label: `${h.hora}`,
                  valor: h.venta,
                  valor2: conCanceladas ? h.cancelado : undefined,
                }))}
                formato={fmtMoneda}
                horizontal={false}
                colorUnico={PALETA[4]}
                alturaMinima={220}
                vacio="Sin ventas en el recorte elegido."
                seleccionados={filtros.hora}
                onSeleccionar={alternarEn("hora")}
                apilado={
                  conCanceladas
                    ? {
                        titulo: "Cancelado",
                        color: TEMA.negativo,
                        tituloBase: "Pagado",
                      }
                    : undefined
                }
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
                activa={(a) => (filtros.sku?.length ? filtros.sku.includes(a.sku ?? "") : false)}
                vacio="Sin ventas en el recorte elegido."
              />
            </Panel>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <Panel titulo="Venta por proveedor" nota="Top 12 · click para filtrar">
              <TortaProveedores
                datos={data.porProveedor.map((p) => ({ label: p.label, total: p.venta }))}
                totalGeneral={data.ventaTotalProveedores}
                seleccionados={filtros.proveedor}
                onSeleccionar={alternarEn("proveedor")}
              />
            </Panel>
            <Panel titulo="Rentabilidad por proveedor" nota="Top 12 por venta · click para filtrar">
              <TablaRanking
                filas={data.porProveedor}
                titulo="Proveedor"
                seleccionados={filtros.proveedor}
                onSeleccionar={alternarEn("proveedor")}
              />
            </Panel>
          </div>

          {/* Las cancelaciones van al FINAL y en su propio panel, no mezcladas
              con las ventas. Es una decisión, no una comodidad: una cancelación
              no es una venta, así que no entra en ningún KPI de arriba ni en
              gold.fact_ventas. Acá se mira otra cosa —qué se cancela y cuánto
              pesa— y por eso la tabla no tiene costo ni margen. */}
          {data.cancelaciones.ordenes > 0 && (
            <Panel
              titulo="Canceladas"
              nota={
                `${fmtNumero(data.cancelaciones.ordenes)} ${data.cancelaciones.ordenes === 1 ? "orden cancelada" : "órdenes canceladas"}` +
                ` · ${fmtMoneda(data.cancelaciones.monto)}` +
                (k && k.ventaCiva + data.cancelaciones.monto > 0
                  ? ` · ${fmtPct(data.cancelaciones.monto / (k.ventaCiva + data.cancelaciones.monto))} de lo transaccionado`
                  : "") +
                (data.cancelaciones.recortada ? " · se muestran los 100 mayores" : "")
              }
            >
              <Tabla
                filas={data.cancelaciones.filas}
                columnas={columnasCancelaciones(data.cancelaciones)}
                etiquetaTotal={
                  data.cancelaciones.recortada ? "Total (todas)" : "Total"
                }
                clave={(c, i) => `${c.sku ?? "sin-sku"}-${i}`}
                onClickFila={(c) => c.sku && alternarEn("sku")(c.sku)}
                activa={(c) => (filtros.sku?.length ? filtros.sku.includes(c.sku ?? "") : false)}
                vacio="Ninguna orden cancelada en el recorte elegido."
              />
              <p className="text-muted mt-3 text-[11px] leading-relaxed">
                El monto es lo que se habría facturado, por eso no hay costo ni
                margen. El porcentaje se mide sobre todo lo transaccionado
                (vendido + cancelado).
              </p>
              <p className="text-muted mt-1 text-[11px] leading-relaxed">
                En la fila de totales, las <strong>órdenes</strong> no son la
                suma de la columna: una orden de tres productos ocupa tres filas
                y sumarlas la contaría tres veces. El total son órdenes
                distintas, y sale de su propia consulta.
              </p>
              <p className="text-muted mt-1 text-[11px] leading-relaxed">
                Acá entran solo las ventas que <strong>de verdad se cayeron</strong>: el
                comprador se arrepintió, hubo un reclamo, no se pudo entregar o fue fraude.
                Quedan afuera las que Mercado Libre marca como canceladas para partir un
                carrito y volver a crearlo —dos tercios del total—, porque esa mercadería se
                despacha y se cobra igual. Mercado Libre tampoco las cuenta como canceladas.
              </p>
            </Panel>
          )}

          <Panel
            titulo="Artículos"
            nota={`${data.articulos.length} SKUs · click para filtrar · impuestos aparte (${fmtPct(CARGA_IMPOSITIVA)})`}
          >
            <Tabla
              filas={data.articulos}
              columnas={columnasArticulos(data.articulos)}
              // La consulta trae hasta TOPE_ARTICULOS líneas. Si llegó al tope, el
              // total es el de lo que se ve y NO el del recorte entero, así que
              // la etiqueta lo dice en vez de dejar creer que es todo.
              etiquetaTotal={
                data.articulos.length === TOPE_ARTICULOS
                  ? `Total (top ${TOPE_ARTICULOS})`
                  : "Total"
              }
              clave={(a, i) => `${a.sku ?? "sin-sku"}-${i}`}
              onClickFila={(a) => a.sku && alternarEn("sku")(a.sku)}
              activa={(a) => (filtros.sku?.length ? filtros.sku.includes(a.sku ?? "") : false)}
            />
          </Panel>
        </div>
      )}
    </div>
  );
}
