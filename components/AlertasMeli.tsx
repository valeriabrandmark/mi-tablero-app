"use client";

import { useState } from "react";
import BarraFiltrosMeli from "@/components/FiltrosMeli";
import { Tabla, type Columna } from "@/components/Tabla";
import { Aviso, Esqueleto, Panel, TarjetaKpi } from "@/components/ui";
import { alternar as alternarValor, vacio as sinValores } from "@/lib/filtros";
import { fmtFechaCorta, fmtMoneda, fmtNumero, fmtPct } from "@/lib/format";
import {
  CARGA_IMPOSITIVA,
  IMPUESTOS,
  NIVELES_ALERTA,
  NOMBRE_ALERTA,
  UMBRAL_BAJO,
  UMBRAL_MUY_BAJO,
  type NivelAlerta,
} from "@/lib/meli";
import { PALETA, TEMA } from "@/lib/paleta";
import { useDatosTablero } from "@/lib/useDatosTablero";
import type {
  DashboardAlertasMeli,
  FilaAlertaMeli,
  FiltrosMeli,
  OpcionesMeli,
} from "@/lib/types";

type Respuesta = DashboardAlertasMeli & { opciones: OpcionesMeli | null };

const COLOR_NIVEL: Record<NivelAlerta, string> = {
  "muy-bajo": TEMA.negativo,
  bajo: PALETA[2],
  ok: PALETA[1],
};

function esNivel(v: string): v is NivelAlerta {
  return NIVELES_ALERTA.some((n) => n === v);
}

function Etiqueta({ nivel }: { nivel: string }) {
  const color = esNivel(nivel) ? COLOR_NIVEL[nivel] : TEMA.muted;
  const texto = esNivel(nivel) ? NOMBRE_ALERTA[nivel] : nivel;
  return (
    <span
      className="rounded-full border px-2 py-0.5 text-[10px] whitespace-nowrap"
      style={{ color, borderColor: `${color}66`, backgroundColor: `${color}1a` }}
    >
      {texto}
    </span>
  );
}

/** Un importe que se lee mal en rojo cuando es negativo. */
function Importe({ valor }: { valor: number | null }) {
  return (
    <span style={(valor ?? 0) < 0 ? { color: TEMA.negativo } : undefined}>
      {fmtMoneda(valor)}
    </span>
  );
}

/**
 * Las columnas son las mismas de la pestaña "Alertas" de la planilla y en el
 * mismo orden, para poder cotejar fila contra fila. Las dos que no están son
 * "N° Pack" y "Oferta Prov %": el pack no viaja a Supabase, y la oferta no hace
 * falta porque `costo_unitario` YA viene con el descuento aplicado (verificado
 * contra la columna "Costo real s/IVA" de la planilla).
 */
const COLUMNAS: Columna<FilaAlertaMeli>[] = [
  { titulo: "Alerta", celda: (f) => <Etiqueta nivel={f.nivel} />, orden: (f) => f.nivel },
  { titulo: "Fecha", celda: (f) => (f.fecha ? fmtFechaCorta(f.fecha) : "—"), orden: (f) => f.fecha },
  {
    titulo: "N° Orden",
    celda: (f) => (
      <span className="flex items-center gap-1.5 whitespace-nowrap">
        <span className="font-mono text-[11px]">{f.nroOrden ?? "—"}</span>
        {/* Una devolución parcial SÍ es venta —el cliente se quedó con parte—
            pero entra por el importe completo, porque la API no informa cuánto
            se devolvió. Su rentabilidad queda algo sobreestimada, y quien mire
            esta fila para decidir un precio tiene que saberlo. */}
        {f.parcial && (
          <span
            title="Devolución parcial: cuenta como venta, pero por el importe completo — la API no informa cuánto se devolvió, así que la rentabilidad está algo sobreestimada."
            className="rounded-full border px-1.5 py-0.5 text-[9px] whitespace-nowrap"
            style={{
              color: PALETA[2],
              borderColor: `${PALETA[2]}66`,
              backgroundColor: `${PALETA[2]}1a`,
            }}
          >
            parcial
          </span>
        )}
      </span>
    ),
    orden: (f) => (f.nroOrden == null ? null : Number(f.nroOrden)),
  },
  {
    // Columna propia y no solo la marquita: sin esto no habría forma de juntar
    // todas las parciales, que es justo lo que uno quiere al revisarlas.
    titulo: "Tipo",
    celda: (f) => (f.parcial ? "Parcial" : "Venta"),
    orden: (f) => (f.parcial ? 0 : 1),
  },
  { titulo: "SKU", celda: (f) => f.sku ?? "—", orden: (f) => f.sku },
  {
    titulo: "Descripción",
    celda: (f) => <span className="block max-w-[260px] truncate">{f.producto ?? "—"}</span>,
    orden: (f) => f.producto,
  },
  {
    titulo: "Proveedor",
    celda: (f) => <span className="block max-w-[180px] truncate">{f.proveedor ?? "—"}</span>,
    orden: (f) => f.proveedor,
  },
  {
    titulo: "Marca",
    celda: (f) => <span className="block max-w-[130px] truncate">{f.marca ?? "—"}</span>,
    orden: (f) => f.marca,
  },
  { titulo: "Cant.", celda: (f) => fmtNumero(f.cantidad), numerica: true, orden: (f) => f.cantidad },
  { titulo: "Venta c/IVA", celda: (f) => fmtMoneda(f.ventaCiva), numerica: true, orden: (f) => f.ventaCiva },
  { titulo: "Venta s/IVA", celda: (f) => fmtMoneda(f.ventaSiva), numerica: true, orden: (f) => f.ventaSiva },
  { titulo: "Costo unit.", celda: (f) => fmtMoneda(f.costoUnitario), numerica: true, orden: (f) => f.costoUnitario },
  { titulo: "Costo total", celda: (f) => fmtMoneda(f.costo), numerica: true, orden: (f) => f.costo },
  { titulo: "Comisión", celda: (f) => fmtMoneda(f.comision), numerica: true, orden: (f) => f.comision },
  { titulo: "Envío", celda: (f) => fmtMoneda(f.envio), numerica: true, orden: (f) => f.envio },
  { titulo: "Rent. bruta", celda: (f) => <Importe valor={f.rentabilidad} />, numerica: true, orden: (f) => f.rentabilidad },
  {
    titulo: "Margen bruto c/IVA",
    celda: (f) => (
      <span style={(f.margenPct ?? 0) < 0 ? { color: TEMA.negativo } : undefined}>
        {fmtPct(f.margenPct)}
      </span>
    ),
    numerica: true,
    orden: (f) => f.margenPct,
  },
  { titulo: "IIBB", celda: (f) => fmtMoneda(f.iibb), numerica: true, orden: (f) => f.iibb },
  { titulo: "Imp. cheque", celda: (f) => fmtMoneda(f.cheque), numerica: true, orden: (f) => f.cheque },
  { titulo: "Imp. municipal", celda: (f) => fmtMoneda(f.municipal), numerica: true, orden: (f) => f.municipal },
  { titulo: "Rent. neta", celda: (f) => <Importe valor={f.rentabilidadNeta} />, numerica: true, orden: (f) => f.rentabilidadNeta },
  {
    titulo: "Margen neto c/IVA",
    celda: (f) => (
      <span style={(f.margenNetoPct ?? 0) < 0 ? { color: TEMA.negativo } : undefined}>
        {fmtPct(f.margenNetoPct)}
      </span>
    ),
    numerica: true,
    orden: (f) => f.margenNetoPct,
  },
  { titulo: "Acción", celda: (f) => <span className="whitespace-nowrap">{f.accion}</span>, orden: (f) => f.accion },
];

export default function AlertasMeliPage({ diaInicial }: { diaInicial: string }) {
  // Abre en EL DÍA, igual que el Tablero. `diaInicial` lo resuelve el servidor:
  // es hoy, o el último día con ventas si hoy todavía no cargó.
  //
  // Antes abría en el mes comercial, con el argumento de que un solo día son
  // pocas filas y se lee como si no hubiera nada que mirar. La contra pesa más:
  // el uso real de esta página es revisar lo de HOY para corregir un precio
  // antes de seguir vendiéndolo, y abrir en el mes obliga a achicar el recorte
  // todas las veces. Para cerrar el mes está el atajo "Mes comercial".
  const rangoInicial = { desde: diaInicial, hasta: diaInicial };
  const inicial: FiltrosMeli = { ...rangoInicial, alerta: ["muy-bajo"] };
  const [filtros, setFiltros] = useState<FiltrosMeli>(inicial);

  const { data, cargando, error, recargar, empezarCarga } = useDatosTablero<Respuesta>(
    "/api/meli",
    filtros as unknown as Record<string, string[] | undefined>,
    { vista: "alertas", conOpciones: "1" },
  );

  const cambiar = (f: FiltrosMeli) => {
    empezarCarga();
    setFiltros(f);
  };

  const sinCambios =
    filtros.desde === rangoInicial.desde &&
    filtros.hasta === rangoInicial.hasta &&
    filtros.alerta?.length === 1 &&
    filtros.alerta[0] === "muy-bajo" &&
    sinValores(filtros.proveedor) &&
    sinValores(filtros.marca) &&
    sinValores(filtros.sku);

  // El resumen viene solo con los niveles que existen en el recorte; se
  // completan los tres para que la fila de tarjetas no cambie de tamaño al
  // filtrar (y para que un "0 líneas muy bajo" se pueda ver, que es un dato).
  const resumen = NIVELES_ALERTA.map((nivel) => {
    const fila = data?.resumen.find((r) => r.nivel === nivel);
    return {
      nivel,
      lineas: fila?.lineas ?? 0,
      ventaSiva: fila?.ventaSiva ?? 0,
      rentabilidadNeta: fila?.rentabilidadNeta ?? 0,
    };
  });

  const total = data?.lineasTotales ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">
            Alertas de margen <span className="text-muted text-sm font-normal">· Mercado Libre</span>
          </h1>
          <p className="text-muted mt-1 text-xs">
            Ventas individuales ordenadas por margen neto, de la peor a la mejor.
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

      <BarraFiltrosMeli
        filtros={filtros}
        opciones={data?.opciones ?? null}
        onChange={cambiar}
        onLimpiar={() => cambiar(inicial)}
        sinCambios={!!sinCambios}
        conAlerta
        nota={`Márgenes sobre venta c/IVA. El neto descuenta IIBB ${fmtPct(IMPUESTOS.iibb)}, cheque ${fmtPct(IMPUESTOS.cheque)} y municipal ${fmtPct(IMPUESTOS.municipal)}, que se liquidan sobre la venta s/IVA. Muy bajo = menos de ${fmtPct(UMBRAL_MUY_BAJO)}; bajo = hasta ${fmtPct(UMBRAL_BAJO)}.`}
      />

      {error && (
        <Aviso>
          <p className="font-medium">No se pudieron leer los datos.</p>
          <p className="mt-1 font-mono text-xs break-words opacity-80">{error}</p>
        </Aviso>
      )}

      {error ? null : !data ? (
        <div className="grid gap-3 sm:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
            <Esqueleto key={i} className="h-[86px]" />
          ))}
        </div>
      ) : (
        <div className={`grid gap-3 transition-opacity sm:grid-cols-3 ${cargando ? "opacity-50" : ""}`}>
          {resumen.map((r) => (
            <TarjetaKpi
              key={r.nivel}
              titulo={NOMBRE_ALERTA[r.nivel]}
              valor={`${fmtNumero(r.lineas)} ${r.lineas === 1 ? "venta" : "ventas"}`}
              detalle={`${total > 0 ? fmtPct(r.lineas / total) : "—"} de las líneas · ${fmtMoneda(r.rentabilidadNeta)} de rentabilidad neta`}
              acento={COLOR_NIVEL[r.nivel]}
            />
          ))}
        </div>
      )}

      {data && (
        <div className={`transition-opacity ${cargando ? "opacity-50" : ""}`}>
          <Panel
            titulo="Ventas individuales"
            nota={
              data.recortada
                ? `Se muestran las ${data.filas.length} peores de ${fmtNumero(total)} líneas`
                : `${fmtNumero(data.filas.length)} de ${fmtNumero(total)} líneas del recorte`
            }
          >
            {/* La tabla es ancha a propósito: es la misma grilla de la planilla,
                pensada para revisar una venta puntual con todos sus componentes
                a la vista. Scrollea dentro del panel. */}
            <Tabla
              filas={data.filas}
              columnas={COLUMNAS}
              clave={(f, i) => `${f.nroOrden ?? "s"}-${f.sku ?? "s"}-${i}`}
              vacio="Ninguna venta cae en los niveles elegidos. Buena noticia."
              onClickFila={(f) =>
                f.sku && cambiar({ ...filtros, sku: alternarValor(filtros.sku, f.sku) })
              }
              activa={(f) => (filtros.sku?.length ? filtros.sku.includes(f.sku ?? "") : false)}
            />
          </Panel>

          <p className="text-muted mt-3 text-[11px] leading-relaxed">
            Rentabilidad bruta = venta s/IVA − costo (ya con descuento de proveedor) − comisión
            de Mercado Libre − costo de envío. Rentabilidad neta = bruta − {fmtPct(CARGA_IMPOSITIVA)}{" "}
            de impuestos sobre la venta s/IVA. Los dos <strong>porcentajes</strong> se calculan
            sobre la venta <strong>c/IVA</strong>, igual que en el Tablero.
          </p>
        </div>
      )}
    </div>
  );
}
