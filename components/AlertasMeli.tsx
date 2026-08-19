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
  mesComercialComoRango,
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
  { titulo: "Alerta", celda: (f) => <Etiqueta nivel={f.nivel} /> },
  { titulo: "Fecha", celda: (f) => (f.fecha ? fmtFechaCorta(f.fecha) : "—") },
  {
    titulo: "N° Orden",
    celda: (f) => <span className="font-mono text-[11px]">{f.nroOrden ?? "—"}</span>,
  },
  { titulo: "SKU", celda: (f) => f.sku ?? "—" },
  {
    titulo: "Descripción",
    celda: (f) => <span className="block max-w-[260px] truncate">{f.producto ?? "—"}</span>,
  },
  {
    titulo: "Proveedor",
    celda: (f) => <span className="block max-w-[180px] truncate">{f.proveedor ?? "—"}</span>,
  },
  {
    titulo: "Marca",
    celda: (f) => <span className="block max-w-[130px] truncate">{f.marca ?? "—"}</span>,
  },
  { titulo: "Cant.", celda: (f) => fmtNumero(f.cantidad), numerica: true },
  { titulo: "Venta c/IVA", celda: (f) => fmtMoneda(f.ventaCiva), numerica: true },
  { titulo: "Venta s/IVA", celda: (f) => fmtMoneda(f.ventaSiva), numerica: true },
  { titulo: "Costo unit.", celda: (f) => fmtMoneda(f.costoUnitario), numerica: true },
  { titulo: "Costo total", celda: (f) => fmtMoneda(f.costo), numerica: true },
  { titulo: "Comisión", celda: (f) => fmtMoneda(f.comision), numerica: true },
  { titulo: "Envío", celda: (f) => fmtMoneda(f.envio), numerica: true },
  { titulo: "Rent. bruta", celda: (f) => <Importe valor={f.rentabilidad} />, numerica: true },
  {
    titulo: "Margen bruto c/IVA",
    celda: (f) => (
      <span style={(f.margenPct ?? 0) < 0 ? { color: TEMA.negativo } : undefined}>
        {fmtPct(f.margenPct)}
      </span>
    ),
    numerica: true,
  },
  { titulo: "IIBB", celda: (f) => fmtMoneda(f.iibb), numerica: true },
  { titulo: "Imp. cheque", celda: (f) => fmtMoneda(f.cheque), numerica: true },
  { titulo: "Imp. municipal", celda: (f) => fmtMoneda(f.municipal), numerica: true },
  { titulo: "Rent. neta", celda: (f) => <Importe valor={f.rentabilidadNeta} />, numerica: true },
  {
    titulo: "Margen neto c/IVA",
    celda: (f) => (
      <span style={(f.margenNetoPct ?? 0) < 0 ? { color: TEMA.negativo } : undefined}>
        {fmtPct(f.margenNetoPct)}
      </span>
    ),
    numerica: true,
  },
  { titulo: "Acción", celda: (f) => <span className="whitespace-nowrap">{f.accion}</span> },
];

export default function AlertasMeliPage({ diaInicial }: { diaInicial: string }) {
  // Acá el default NO es el día, como en el Tablero: esta página es para
  // revisar ventas problemáticas, y con un solo día suelen ser tres filas —
  // se lee como si no hubiera nada que mirar. Abre en el mes comercial, que es
  // el recorte sobre el que se decide corregir un precio.
  const rangoInicial = mesComercialComoRango(diaInicial);
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
