"use client";

import { useState } from "react";
import { ListaAvance } from "@/components/BarraAvance";
import LineaFacturacion from "@/components/charts/LineaFacturacion";
import { BotonLimpiar, SelectorMultiple } from "@/components/SelectorFiltro";
import { alternar as alternarValor, vacio as sinValores } from "@/lib/filtros";
import { sumar, Tabla, type Columna } from "@/components/Tabla";
import { Aviso, Esqueleto, Panel, TarjetaKpi } from "@/components/ui";
import { fmtMes, fmtMetrica, fmtMoneda, fmtNumero, fmtPct } from "@/lib/format";
import { PALETA, TEMA } from "@/lib/paleta";
import { useDatosTablero } from "@/lib/useDatosTablero";
import type {
  DashboardObjetivos,
  FilaComprobanteObjetivo,
  FiltrosObjetivos,
  Metrica,
  OpcionesObjetivos,
} from "@/lib/types";

type Respuesta = DashboardObjetivos & { opciones: OpcionesObjetivos | null };

// "Objetivos de producto" y no "Unidades", para que se lea igual que el panel
// de abajo: la tarjeta mide el avance contra las metas por producto, no las
// unidades vendidas en total.
const NOMBRE_METRICA: Record<Metrica, string> = {
  unidades: "Objetivos de producto",
  facturacion: "Facturación",
  clientes: "Clientes con compra",
};

function columnasComprobantes(
  filas: FilaComprobanteObjetivo[],
): Columna<FilaComprobanteObjetivo>[] {
  return [
    {
      titulo: "Comprobante",
      celda: (f) => f.comprobante ?? "—",
      orden: (f) => f.comprobante,
    },
    { titulo: "Fecha", celda: (f) => f.fecha ?? "—", orden: (f) => f.fecha },
    {
      titulo: "Cliente",
      celda: (f) => (
        <span className="block max-w-[126px] sm:max-w-[280px] truncate">{f.cliente ?? "—"}</span>
      ),
      orden: (f) => f.cliente,
    },
    {
      titulo: "Empresa",
      celda: (f) => f.empresa ?? "—",
      orden: (f) => f.empresa,
    },
    {
      titulo: "Unidades",
      celda: (f) => fmtNumero(f.unidades),
      numerica: true,
      orden: (f) => f.unidades,
      total: fmtNumero(sumar(filas, (f) => f.unidades)),
    },
    {
      titulo: "Facturación",
      celda: (f) => fmtMoneda(f.facturacion),
      numerica: true,
      orden: (f) => f.facturacion,
      total: fmtMoneda(sumar(filas, (f) => f.facturacion)),
    },
  ];
}

export default function DashboardObjetivosPage({
  vendedor,
  mesInicial,
}: {
  vendedor: string;
  /** Mes con el que abre, resuelto en el servidor (ver getMesInicialObjetivos). */
  mesInicial: string;
}) {
  const [filtros, setFiltros] = useState<FiltrosObjetivos>({
    vendedor,
    mes: [mesInicial],
  });

  const { data, cargando, error, recargar, empezarCarga } =
    useDatosTablero<Respuesta>(
      "/api/objetivos",
      filtros as unknown as Record<string, string | undefined>,
      { conOpciones: "1" },
    );

  const opciones = data?.opciones ?? null;

  const cambiar = (f: FiltrosObjetivos) => {
    empezarCarga();
    setFiltros(f);
  };

  /** Click en una barra: suma ese grupo a la selección, o lo saca. */
  const alternarGrupo = (valor: string) =>
    cambiar({ ...filtros, grupo: alternarValor(filtros.grupo, valor) });

  const alternarCliente = (valor: string) =>
    cambiar({ ...filtros, cliente: alternarValor(filtros.cliente, valor) });

  const resumen = data?.resumen ?? [];
  const vencido = data?.vencido ?? null;
  const sinCambios =
    filtros.mes?.length === 1 &&
    filtros.mes[0] === mesInicial &&
    sinValores(filtros.grupo) &&
    sinValores(filtros.cliente);

  const porProducto =
    data?.porGrupo.filter((g) => g.metrica === "unidades") ?? [];
  const porEmpresa =
    data?.porGrupo.filter((g) => g.metrica !== "unidades") ?? [];

  // La nota es lo único que dice qué se está viendo, así que tiene que nombrar
  // los dos recortes. Y el del cliente lleva la advertencia pegada: recorta las
  // VENTAS pero no el objetivo, así que el avance deja de ser "cuánto llevo" y
  // pasa a ser "cuánto de la meta puso este cliente". Sin decirlo, un 8 % se
  // lee como que el vendedor está muy atrasado.
  const recortes = [
    sinValores(filtros.grupo)
      ? null
      : `las líneas de ${filtros.grupo!.join(", ")}`,
    sinValores(filtros.cliente)
      ? null
      : `las ventas a ${filtros.cliente!.join(", ")}`,
  ].filter(Boolean);

  const notaRecorte =
    recortes.length === 0
      ? "Todas las ventas mayoristas del mes"
      : `Solo ${recortes.join(" y ")}` +
        (sinValores(filtros.cliente)
          ? ""
          : " — el objetivo sigue siendo el del mes entero");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">
            Objetivos <span className="text-c1">{vendedor}</span>
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

      <div className="border-line bg-panel flex flex-wrap items-end gap-3 rounded-xl border p-3">
        <SelectorMultiple
          etiqueta="Mes comercial"
          valores={filtros.mes}
          opciones={opciones?.meses ?? []}
          onChange={(v) => cambiar({ ...filtros, mes: v })}
          formato={fmtMes}
          todos="Todos los meses"
        />
        <BotonLimpiar
          onClick={() => cambiar({ vendedor, mes: [mesInicial] })}
          deshabilitado={sinCambios}
        />

        <span className="text-muted ml-auto max-w-md text-[11px] leading-tight">
          Solo canal Mayorista, presupuestos incluidos. Un MIX se mide sobre la
          suma de sus SKUs, no SKU por SKU. El mes comercial va del 6 al 5.
        </span>
      </div>

      {error && (
        <Aviso>
          <p className="font-medium">No se pudieron leer los datos.</p>
          <p className="mt-1 font-mono text-xs break-words opacity-80">
            {error}
          </p>
        </Aviso>
      )}

      {/* Con error no se dibuja ninguna tarjeta: si no, quedaba la de "%
          facturación vencida" sola con un guión, que se lee como un dato real
          y no como lo que es (no se pudo consultar nada). */}
      {error ? null : resumen.length === 0 ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Esqueleto key={i} className="h-[86px]" />
          ))}
        </div>
      ) : (
        // Una tarjeta por métrica: sumar pesos con unidades no significaría nada.
        <div
          className={`grid grid-cols-2 gap-3 transition-opacity sm:grid-cols-2 lg:grid-cols-4 ${cargando ? "opacity-50" : ""}`}
        >
          {resumen.map((r) => {
            const fmt = fmtMetrica(r.metrica);
            return (
              <TarjetaKpi
                key={r.metrica}
                titulo={NOMBRE_METRICA[r.metrica]}
                valor={fmtPct(r.avancePct)}
                detalle={
                  <>
                    {fmt(r.vendidoComputable)} de {fmt(r.objetivo)} ·{" "}
                    {fmtNumero(r.cumplidos)}/{fmtNumero(r.pares)} cumplidos
                    {/* El excedente se nombra pero no se suma: es venta real y
                        el vendedor la hizo, pero no acerca al objetivo que
                        todavía está en cero. */}
                    {r.vendido > r.vendidoComputable && (
                      <>
                        {" · "}
                        <span title="Vendido de más en objetivos ya cumplidos: no cuenta para el avance">
                          +{fmt(r.vendido - r.vendidoComputable)} de excedente
                        </span>
                      </>
                    )}
                  </>
                }
                acento={
                  r.avancePct != null && r.avancePct >= 1
                    ? PALETA[1]
                    : PALETA[0]
                }
              />
            );
          })}

          {/* No es un objetivo sino una alerta, y sobre todo NO es del mes: es
              una foto de la cartera al momento de la última carga. Por eso dice
              la fecha y no se mueve al cambiar el filtro de mes. */}
          <TarjetaKpi
            titulo="% facturación vencida"
            valor={vencido ? fmtPct(vencido.pctVencida) : "—"}
            detalle={
              vencido && vencido.deudaTotal !== 0
                ? `${fmtMoneda(vencido.deudaVencida)} de ${fmtMoneda(vencido.deudaTotal)} · foto al ${vencido.fechaCarga ?? "—"}`
                : "Sin cuenta corriente cargada"
            }
            acento={vencido?.pctVencida != null ? TEMA.negativo : undefined}
          />
        </div>
      )}

      {data && (
        <div
          className={`space-y-4 transition-opacity ${cargando ? "opacity-50" : ""}`}
        >
          <div className="grid gap-4 xl:grid-cols-2">
            <Panel
              titulo="Objetivos por empresa"
              nota="Brandmark y NOA · click para filtrar"
            >
              <ListaAvance
                filas={porEmpresa}
                etiqueta={(f) => f.grupo ?? "—"}
                seleccionados={filtros.grupo}
                onSeleccionar={alternarGrupo}
              />
            </Panel>
            <Panel
              titulo="Objetivos de producto"
              nota="En unidades · click para filtrar"
            >
              <ListaAvance
                filas={porProducto}
                etiqueta={(f) => f.grupo ?? "—"}
                seleccionados={filtros.grupo}
                onSeleccionar={alternarGrupo}
              />
            </Panel>
          </div>

          <Panel titulo="Facturación por fecha" nota={notaRecorte}>
            <LineaFacturacion datos={data.serieFacturacion} />
          </Panel>

          <Panel
            titulo="Comprobantes involucrados"
            nota={`${data.comprobantes.length} comprobantes · ${notaRecorte.toLowerCase()}`}
          >
            {/* Click en una fila filtra por su CLIENTE. Ojo con lo que eso
                significa acá: recorta las VENTAS, no el objetivo. El objetivo
                del mes es el mismo tenga uno o veinte clientes, así que el
                avance pasa a leerse como "cuánto de la meta puso este cliente".
                Es un dato útil y por eso el chip lo dice explícitamente. */}
            <Tabla
              filas={data.comprobantes}
              columnas={columnasComprobantes(data.comprobantes)}
              clave={(f, i) => `${f.comprobante}-${i}`}
              vacio="Sin comprobantes en el recorte elegido."
              onClickFila={(f) => f.cliente && alternarCliente(f.cliente)}
              activa={(f) =>
                filtros.cliente?.length
                  ? filtros.cliente.includes(f.cliente ?? "")
                  : false
              }
            />
          </Panel>
        </div>
      )}
    </div>
  );
}
