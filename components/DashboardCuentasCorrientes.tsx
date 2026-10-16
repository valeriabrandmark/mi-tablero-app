"use client";

import { useState } from "react";
import EncabezadoPagina from "@/components/EncabezadoPagina";
import BarrasCategoria from "@/components/charts/BarrasCategoria";
import TortaProveedores from "@/components/charts/TortaProveedores";
import { BotonLimpiar, SelectorMultiple } from "@/components/SelectorFiltro";
import { nombreEmpresa, nombreVendedor } from "@/lib/constantes";
import { alternar as alternarValor, vacio as sinValores } from "@/lib/filtros";
import { columnasVencidos } from "@/components/columnasVencidos";
import { sumar, Tabla, type Columna } from "@/components/Tabla";
import { Aviso, Esqueleto, Panel, TarjetaKpi } from "@/components/ui";
import {
  fmtFechaCortaConAnio,
  fmtMes,
  fmtMoneda,
  fmtMonedaCorta,
  fmtNumero,
  fmtPct,
} from "@/lib/format";
import {
  colorCategoria,
  COLOR_TRAMO_AGING,
  PALETA,
} from "@/lib/paleta";
import { useDatosTablero } from "@/lib/useDatosTablero";
import type {
  ComprobanteCliente,
  DashboardCuentas,
  FilaCliente,
  FiltrosCuentas,
  OpcionesCuentas,
  PuntoHistorial,
  PuntoRecupero,
} from "@/lib/types";

type Respuesta = DashboardCuentas & { opciones: OpcionesCuentas | null };

/**
 * Qué dice el pie del gráfico de evolución.
 *
 * DICE LA FECHA DE LA ÚLTIMA FOTO, no sólo cuántos períodos hay. Cada barra es
 * una foto de un día —la más nueva que se tomó ese mes— y no el cierre del mes:
 * la del mes en curso sale con lo que haya hasta hoy. Sin la fecha a la vista,
 * una barra más baja se lee como "bajó la mora" cuando puede ser "todavía no
 * terminó el mes".
 *
 * Y si la última foto quedó vieja —nadie subió cuentas corrientes en semanas—
 * la fecha es la única señal de que el gráfico no se está moviendo.
 */
function notaHistorial(historial: PuntoHistorial[]): string {
  if (historial.length === 0) return "Sin historial cargado";
  const ultima = historial[historial.length - 1].fecha;
  const periodos = `${historial.length} ${historial.length === 1 ? "período" : "períodos"}`;
  return ultima ? `${periodos} · última foto ${ultima}` : periodos;
}

/**
 * Qué dice el pie del gráfico de mora recuperada.
 *
 * ACLARA QUÉ MES ES EL DEL EJE, que es lo que más se puede leer mal: es el mes
 * en que el cliente adeudaba, no el mes en que pagó. Y da el total, porque la
 * suma de las barras es el número que interesa --cuánta plata volvió-- y
 * sumarlas a ojo no se puede.
 */
function notaRecupero(puntos: PuntoRecupero[]): string {
  if (puntos.length === 0) return "Sin cancelaciones registradas";
  const monto = puntos.reduce((a, d) => a + d.valor, 0);
  const clientes = puntos.reduce((a, d) => a + d.clientes, 0);
  return (
    `${fmtMoneda(monto)} de ${fmtNumero(clientes)} ` +
    `${clientes === 1 ? "cliente" : "clientes"} · por el mes en que adeudaban`
  );
}

/**
 * El desglose de un cliente: sus comprobantes impagos, uno por fila.
 *
 * POR QUE EXISTE. La fila del cliente dice "$ 751.451 · 246 días", que leído
 * junto suena a que todo está vencido hace ocho meses. Casi nunca es cierto:
 * el saldo está repartido en comprobantes de antigüedades muy distintas, y el
 * "246" es el del más viejo. Para decidir a quién llamar, eso es una lectura
 * falsa; acá cada comprobante trae SU plata y SUS días.
 *
 * VAN LOS QUE NO VENCIERON TAMBIEN, en gris y con el atraso en guión. Si sólo
 * estuvieran los vencidos, la suma de abajo no cerraría contra el saldo total
 * de la fila y haría dudar del número de arriba.
 */
function DetalleComprobantes({
  filas,
  cliente,
  fechaFoto,
}: {
  filas: ComprobanteCliente[];
  cliente: FilaCliente;
  fechaFoto: string | null;
}) {
  // SIN COMPROBANTES NO ES UN HUECO: es una respuesta, y hay tres distintas.
  // Dejar el panel vacío obligaría a adivinar cuál de las tres.
  if (filas.length === 0) {
    const aFavor = cliente.aFavor;

    return (
      <p className="text-muted px-3 py-2 text-[11px] leading-relaxed">
        {aFavor ? (
          <>
            Este cliente tiene <strong>saldo a favor</strong> (
            {fmtMoneda(cliente.saldoTotal)}): no hay comprobantes impagos que
            desglosar.
          </>
        ) : !cliente.vigente ? (
          // ACA SI VA EL MONTO VIEJO. En la columna de saldo sería una deuda
          // de hoy que no existe; dicho con la fecha al lado es el dato útil:
          // cuánto se cobró y cuándo.
          <>
            Este cliente <strong>ya no debe nada</strong>. Su último dato es del{" "}
            {cliente.fecha}
            {cliente.saldoAlCerrar != null && cliente.saldoAlCerrar > 0 && (
              <>
                , cuando debía {fmtMoneda(cliente.saldoAlCerrar)}
              </>
            )}
            {fechaFoto != null && <> y la foto más nueva es del {fechaFoto}</>}.
            Dejó de aparecer en el scoring —casi siempre porque canceló— así que
            sus comprobantes salieron del aging y no hay nada que desglosar.
            {moraConfiable(cliente) && (
              <>
                {" "}
                Mientras debía estuvo en promedio{" "}
                <strong>{cliente.moraPromedio} días</strong> de atraso
                {cliente.moraPeor != null && <> (peor: {cliente.moraPeor})</>}.
              </>
            )}
          </>
        ) : (
          <>
            No hay comprobantes con saldo pendiente para este cliente en la
            última carga del aging.
          </>
        )}
      </p>
    );
  }

  const vencido = filas
    .filter((f) => f.atraso > 0)
    .reduce((a, f) => a + f.pendiente, 0);
  const total = filas.reduce((a, f) => a + f.pendiente, 0);

  return (
    <div className="px-2 py-1">
      <table className="w-full text-[11px]">
        <thead className="text-muted">
          <tr className="border-line/60 border-b">
            <th className="py-1 pr-3 text-left font-normal">Comprobante</th>
            {/* LA EMPRESA VA SEGUNDA, pegada al comprobante: un mismo CUIT
                compra en varias del grupo, así que el desglose mezcla 0001 con
                0003 y sin esta columna dos renglones parecidos se leen como un
                duplicado cuando son de empresas distintas. */}
            <th className="py-1 pr-3 text-left font-normal">Empresa</th>
            <th className="py-1 pr-3 text-left font-normal">Fecha</th>
            <th className="py-1 pr-3 text-left font-normal">Vencimiento</th>
            <th className="py-1 pr-3 text-right font-normal">Total</th>
            <th className="py-1 pr-3 text-right font-normal">Pendiente</th>
            <th className="py-1 pr-3 text-right font-normal">Atraso</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((f, i) => {
            const alDia = f.atraso <= 0;
            return (
              <tr
                key={`${f.comprobante ?? "s/n"}-${i}`}
                className={`border-line/30 border-b last:border-0 ${alDia ? "text-muted" : ""}`}
              >
                <td className="py-1 pr-3">{f.comprobante ?? "—"}</td>
                <td className="py-1 pr-3">{nombreEmpresa(f.empresa ?? "")}</td>
                <td className="py-1 pr-3">{f.fecha ? fmtFechaCortaConAnio(f.fecha) : "—"}</td>
                <td className="py-1 pr-3">
                  {f.vencimiento ? fmtFechaCortaConAnio(f.vencimiento) : "—"}
                </td>
                <td className="py-1 pr-3 text-right tabular-nums">
                  {fmtMoneda(f.total)}
                </td>
                <td className="py-1 pr-3 text-right tabular-nums">
                  {fmtMoneda(f.pendiente)}
                </td>
                {/* Los que ya vencieron, en tinta plena; los que no, en gris
                    junto con toda su fila. El color del atraso no se escala
                    por tramos: para eso está la tabla de comprobantes
                    vencidos de más abajo, que es la que ordena por antigüedad. */}
                <td className="py-1 pr-3 text-right tabular-nums">
                  {alDia ? "—" : `${fmtNumero(f.atraso)} d`}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-line text-ink border-t">
            <td className="py-1 pr-3" colSpan={5}>
              {filas.length} {filas.length === 1 ? "comprobante" : "comprobantes"}
              {vencido > 0 && (
                <span className="text-muted">
                  {" "}
                  · {fmtMoneda(vencido)} vencido
                </span>
              )}
            </td>
            <td className="py-1 pr-3 text-right font-medium tabular-nums">
              {fmtMoneda(total)}
            </td>
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/* La escala vive en lib/paleta.ts, con el porqué de cada paso y las medidas
   de separación. Acá sólo se usa. */

/**
 * CUANTAS FOTOS DIARIAS HACEN FALTA para decir una mora promedio.
 *
 * Con menos de cinco, el promedio es el de un día o dos y no describe nada: un
 * cliente que apareció una sola vez, el día que no tenía nada vencido, daría
 * "0 d" --que se lee como "paga al día"-- sin que eso se haya medido. Son 4 de
 * 140 al 15/10. Esas filas dicen "—" y el motivo en el título, que es la
 * respuesta correcta a una pregunta que todavía no se puede contestar.
 */
const MINIMO_DIAS_MORA = 5;

/**
 * Si la mora de esta fila se midió lo suficiente para mostrarla.
 *
 * Devuelve un type predicate y no un boolean para que después de llamarla
 * `moraPromedio` sea un número y no `number | null`: así comparar contra
 * `moraPeor` no necesita un `!` que después nadie sabe si era seguro.
 */
function moraConfiable(
  f: FilaCliente,
): f is FilaCliente & { moraPromedio: number } {
  return f.moraPromedio != null && f.diasMedidos >= MINIMO_DIAS_MORA;
}

function columnas(filas: FilaCliente[]): Columna<FilaCliente>[] {
  return [
    {
      titulo: "Cliente",
      ayuda:
        "Las filas en gris ya no deben nada: ese cliente dejó de aparecer en el scoring —casi siempre porque canceló— así que sus columnas de saldo van vacías. Lo que debía el día que dice está en el desglose. La mora promedio sí se sigue mostrando: es su historia, no su deuda.",
      celda: (f) => (
        // QUIEN YA NO DEBE SE MARCA, NO SE ESCONDE. Su fila sigue acá con la
        // categoría y la mora --que es lo que dice cómo paga-- pero sin saldo.
        <span
          className={`block max-w-[116px] sm:max-w-[260px] truncate ${f.vigente ? "" : "text-muted"}`}
          title={f.vigente ? undefined : `Sin deuda desde el ${f.fecha}`}
        >
          {f.razonSocial}
          {!f.vigente && (
            <span className="text-muted ml-1.5 text-[10px]">· canceló</span>
          )}
        </span>
      ),
      orden: (f) => f.razonSocial,
    },
    {
      titulo: "Categoría",
      ayuda:
        "Clasificación de riesgo del cliente, calculada por el orquestador a partir de su deuda y su antigüedad.",
      celda: (f) => (
        <span
          style={{ color: colorCategoria(f.categoria) }}
        >
          {f.categoria ?? "—"}
        </span>
      ),
      orden: (f) => f.categoria,
    },
    {
      titulo: "Vendedor",
      ayuda:
        "El vendedor asignado al cliente en Sigma. La tabla lo guarda como código (007) y se traduce al nombre acá.",
      celda: (f) => nombreVendedor(f.vendedor),
      // Ordena por el NOMBRE que se ve y no por el código: una lista alfabética
      // que sale en el orden 006, 007, 004 se lee como si no estuviera ordenada.
      orden: (f) => nombreVendedor(f.vendedor),
    },
    {
      titulo: "Saldo total",
      ayuda: "Todo lo que el cliente debe hoy, vencido y a vencer.",
      celda: (f) => fmtMoneda(f.saldoTotal),
      numerica: true,
      orden: (f) => f.saldoTotal,
      total: fmtMoneda(sumar(filas, (f) => f.saldoTotal)),
    },
    {
      titulo: "Saldo vencido",
      ayuda: "La parte de la deuda cuyo vencimiento ya pasó.",
      celda: (f) => fmtMoneda(f.saldoVencido),
      numerica: true,
      orden: (f) => f.saldoVencido,
      total: fmtMoneda(sumar(filas, (f) => f.saldoVencido)),
    },
    {
      titulo: "Atraso máx.",
      ayuda:
        "Días del comprobante impago MÁS VIEJO de ese cliente, no de todo el " +
        "saldo de al lado: lo normal es que el saldo esté repartido en varios " +
        "comprobantes con antigüedades distintas. El detalle está en la tabla " +
        "de Comprobantes vencidos, acá abajo.",
      celda: (f) => (f.atrasoMax == null ? "—" : `${fmtNumero(f.atrasoMax)} d`),
      numerica: true,
      orden: (f) => f.atrasoMax,
      // El PEOR de la lista, no una suma ni un promedio: "atraso máximo" del
      // conjunto es el del cliente más atrasado. Sumar días de clientes distintos
      // no sería nada, y el promedio escondería justo al que hay que llamar.
      total: (() => {
        const conDato = filas.filter((f) => f.atrasoMax != null);
        return conDato.length === 0
          ? "—"
          : `${fmtNumero(Math.max(...conDato.map((f) => f.atrasoMax as number)))} d`;
      })(),
    },
    {
      titulo: "Mora prom.",
      ayuda:
        "QUÉ TAN VENCIDO SUELE ESTAR LO QUE DEBE, en días. Es el promedio de " +
        "todas las fotos diarias en que el cliente apareció, así que mide su " +
        "comportamiento y no su saldo de hoy: por eso también está en las " +
        "filas que ya cancelaron, que es justo donde sirve. " +
        "NO es 'días que tarda en pagar': Sigma nos da las facturas impagas, " +
        "no la fecha en que se cobró cada una, así que vencimiento-contra-pago " +
        "no se puede medir. Y promedia todas las facturas pendientes de cada " +
        "día, vencidas y por vencer, así que da más bajo que el atraso máximo: " +
        "quien tiene una factura vieja y diez nuevas queda en un número chico. " +
        "El peor momento que se le vio está entre paréntesis.",
      celda: (f) =>
        !moraConfiable(f) ? (
          <span
            title={
              f.moraPromedio == null
                ? "Este cliente no aparece en la foto diaria."
                : `Sólo ${f.diasMedidos} ${f.diasMedidos === 1 ? "día" : "días"} medido${f.diasMedidos === 1 ? "" : "s"}: muy poco para un promedio.`
            }
          >
            —
          </span>
        ) : (
          <span title={`${f.diasMedidos} días medidos`}>
            {fmtNumero(f.moraPromedio)} d
            {f.moraPeor != null && f.moraPeor > f.moraPromedio && (
              <span className="text-muted ml-1 text-[10px]">
                (peor {fmtNumero(f.moraPeor)})
              </span>
            )}
          </span>
        ),
      numerica: true,
      orden: (f) => f.moraPromedio,
      // PROMEDIO SIMPLE ENTRE CLIENTES, no ponderado por deuda: la pregunta
      // que contesta es "cómo paga la cartera", y ahí un cliente chico que
      // deja vencer todo cuenta igual que uno grande. Ponderar por saldo daría
      // otra cosa --cuántos días de vencido tiene cada peso a cobrar-- y
      // además dejaría afuera a los que ya cancelaron, que no tienen saldo.
      total: (() => {
        const conDato = filas.filter(moraConfiable);
        return conDato.length === 0
          ? "—"
          : `${fmtNumero(
              Math.round(
                sumar(conDato, (f) => f.moraPromedio) / conDato.length,
              ),
            )} d`;
      })(),
    },
  ];
}

/**
 * Cómo se arma el estado de cada cliente.
 *
 * La regla la calcula el Apps Script de Cuentas Corrientes al escribir
 * `bronze.cuentas_corrientes_scoring`; acá solo se explica. Si allá cambia el
 * criterio, esto queda mintiendo — ya pasó una vez.
 *
 * Son DOS pasos y después una grilla, y ese orden importa: la tolerancia de 15
 * días se evalúa ANTES que la exposición, así que un cliente con pocos días de
 * atraso queda "al día" aunque deba el 100 % del saldo.
 *
 * Ojo con los dos nombres, que se leen al revés de lo que parece: BUENO es el
 * mejor estado (no debe nada vencido) y AL DÍA es el que SÍ debe, pero dentro
 * de la tolerancia.
 *
 * Verificado contra los 122 clientes cargados: coinciden los 122.
 */
const PASOS_LEYENDA: {
  pregunta: string;
  detalle: string;
  estado: string;
  tono: keyof typeof TONO_ESTADO;
}[] = [
  {
    pregunta: "¿Sin facturas vencidas?",
    detalle: "no debe nada atrasado",
    estado: "Bueno",
    tono: "bueno",
  },
  {
    pregunta: "¿Atraso de 15 días o menos?",
    detalle: "tolerancia interna",
    estado: "Al día",
    tono: "aldia",
  },
];

const COLUMNAS_LEYENDA = ["Exposición ≤ 60 %", "Exposición > 60 %"] as const;

const FILAS_LEYENDA: {
  atraso: string;
  estados: [string, keyof typeof TONO_ESTADO][];
}[] = [
  {
    atraso: "Atraso 16 a 30 días",
    estados: [
      ["Observación", "observacion"],
      ["Riesgoso", "riesgoso"],
    ],
  },
  {
    atraso: "Atraso de más de 30 días",
    estados: [
      ["Riesgoso", "riesgoso"],
      ["Crítico", "critico"],
    ],
  },
];

/**
 * Los mismos cinco pasos de COLOR_CATEGORIA, en clases de Tailwind.
 *
 * TIENEN QUE SER LOS MISMOS. Antes "Al día" era celeste acá y "Riesgoso"
 * rosa: la leyenda que explica la escala usaba otros colores que los gráficos
 * que la aplican, así que enseñaba a leer mal justo el cuadro que viene a
 * enseñar a leer.
 *
 * Son clases y no los hex de la paleta porque acá hay tres capas --borde,
 * fondo y texto-- con opacidades distintas, y eso en Tailwind se escribe una
 * vez y en `style` serían tres interpolaciones por estado.
 */
const TONO_ESTADO = {
  bueno: "border-green-600/40 bg-green-600/10 text-green-400",
  aldia: "border-emerald-400/40 bg-emerald-400/10 text-emerald-300",
  observacion: "border-yellow-300/40 bg-yellow-300/10 text-yellow-200",
  riesgoso: "border-orange-400/40 bg-orange-400/10 text-orange-300",
  critico: "border-red-600/50 bg-red-600/15 text-red-300",
  // Fuera de la escala, por eso celeste. Ver COLOR_CATEGORIA en lib/paleta.ts.
  afavor: "border-sky-400/40 bg-sky-400/10 text-sky-300",
} as const;

function LeyendaEstados() {
  return (
    <div className="border-line mt-4 border-t pt-4">
      <p className="text-muted mb-3 text-[11px] leading-tight">
        Se pregunta en este orden. Los dos primeros cortan solos; recién si el
        cliente no entra en ninguno pesa <strong>cuánto</strong> del saldo tiene
        vencido.
      </p>

      <div className="mb-3 flex flex-col gap-1.5">
        {PASOS_LEYENDA.map((paso, i) => (
          <div
            key={paso.estado}
            className="flex items-center gap-2 text-[11px]"
          >
            <span className="text-muted w-4 shrink-0 tabular-nums">
              {i + 1}.
            </span>
            <span className="flex-1">
              {paso.pregunta}{" "}
              <span className="text-muted">— {paso.detalle}</span>
            </span>
            <span className="text-muted shrink-0">→</span>
            <span
              className={`w-28 shrink-0 rounded-lg border px-2 py-1 text-center font-medium ${TONO_ESTADO[paso.tono]}`}
            >
              {paso.estado}
            </span>
          </div>
        ))}
      </div>

      <p className="text-muted mb-2 text-[11px] leading-tight">
        Si el atraso pasa los 15 días, el estado sale de cruzar la antigüedad
        con la exposición:
      </p>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[440px] border-separate border-spacing-1 text-[11px]">
          <thead>
            <tr>
              <th className="w-40" />
              {COLUMNAS_LEYENDA.map((c) => (
                <th key={c} className="text-muted text-center font-normal">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {FILAS_LEYENDA.map((fila) => (
              <tr key={fila.atraso}>
                <th className="text-muted text-left font-normal whitespace-nowrap">
                  {fila.atraso}
                </th>
                {fila.estados.map(([nombre, tono], i) => (
                  <td key={i} className="p-0">
                    <div
                      className={`rounded-lg border px-2 py-2.5 text-center font-medium ${TONO_ESTADO[tono]}`}
                    >
                      {nombre}
                    </div>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-muted mt-3 text-[11px] leading-tight">
        La <strong>exposición</strong> es qué parte del saldo del cliente está
        vencida. Y ojo con los nombres: <strong>Bueno</strong> es el mejor
        estado — no debe nada vencido —, mientras que <strong>Al día</strong> sí
        debe, pero dentro de los 15 días de tolerancia.
      </p>

      {/* FUERA DE LA GRILLA A PROPOSITO. La grilla de arriba contesta "cuánto
          riesgo"; un cliente con saldo a favor no está en esa pregunta, así que
          ponerlo como un sexto casillero lo haría leer como "el mejor de los
          seis" en vez de "otra cosa". */}
      <p className="text-muted mt-2 text-[11px] leading-tight">
        <span
          className={`mr-1.5 inline-block rounded-lg border px-1.5 py-0.5 font-medium ${TONO_ESTADO.afavor}`}
        >
          A favor
        </span>
        queda afuera de la escala: es el cliente con saldo negativo, que no debe
        nada — le debemos nosotros. Antes salían <strong>Riesgoso</strong> con
        hasta 213 días de atraso, porque la planilla cuenta una nota de crédito
        vieja como una factura vencida. Esas filas van sin atraso y sin mora.
      </p>
    </div>
  );
}

export default function DashboardCuentasPage() {
  const [filtros, setFiltros] = useState<FiltrosCuentas>({});
  // Lo tecleado vive aparte del filtro aplicado: el filtro sólo cambia al
  // salir del campo o al dar Enter, así que mientras tanto hay que recordar
  // lo que la persona escribió.
  const [buscado, setBuscado] = useState("");

  const { data, cargando, error, recargar, empezarCarga } =
    useDatosTablero<Respuesta>("/api/cuentas-corrientes", filtros, {
      conOpciones: "1",
    });

  const opciones = data?.opciones ?? null;

  const cambiar = (f: FiltrosCuentas) => {
    empezarCarga();
    setFiltros(f);
  };

  /** Click en un gráfico: suma ese valor a la selección, o lo saca. */
  const alternar = (campo: "categoria" | "vendedor") => (valor: string) =>
    cambiar({ ...filtros, [campo]: alternarValor(filtros[campo], valor) });

  const k = data?.kpis;
  const vacio =
    sinValores(filtros.vendedor) &&
    sinValores(filtros.empresa) &&
    sinValores(filtros.categoria) &&
    !filtros.buscar;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <EncabezadoPagina pagina="cuentas-corrientes">
          <p className="text-muted mt-1 text-xs">
            {data
              ? `Actualizado ${new Date(data.generadoEn).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}`
              : "Cargando datos en vivo…"}
          </p>
        </EncabezadoPagina>
        <button
          onClick={recargar}
          disabled={cargando}
          className="border-line hover:bg-panel-2 text-muted hover:text-ink rounded-lg border px-3 py-1.5 text-xs disabled:opacity-40"
        >
          {cargando ? "Actualizando…" : "Actualizar"}
        </button>
      </div>

      {/* Va arriba de todo y no como nota al pie de un panel a propósito: la
          hora que muestra el encabezado es la de ESTA consulta, no la de los
          datos. Sin esta aclaración se lee que la deuda está al minuto, y no
          lo está — la planilla de cuentas corrientes se refresca una vez por
          día, y adentro de ese día lo que manda es cuándo se asentó cada
          cobranza. */}
      <div className="border-line bg-panel-2 text-muted flex items-start gap-2 rounded-xl border p-3 text-xs leading-tight">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          className="mt-px size-4 shrink-0"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M12 8h.01M11 12h1v4h1" />
        </svg>
        <span>
          El estado de los datos depende de cuándo se hayan asentado las
          cobranzas. La información se actualiza{" "}
          <strong>una vez al día, a primera hora</strong>.
        </span>
      </div>

      <div className="border-line bg-panel flex flex-wrap items-end gap-3 rounded-xl border p-3">
        <SelectorMultiple
          etiqueta="Vendedor"
          valores={filtros.vendedor}
          opciones={opciones?.vendedores ?? []}
          // El valor que viaja al filtro sigue siendo el CÓDIGO, que es lo que
          // guarda la tabla; `formato` sólo cambia lo que se lee. Igual que
          // Empresa, dos selectores más allá.
          formato={nombreVendedor}
          onChange={(v) => cambiar({ ...filtros, vendedor: v })}
        />
        <SelectorMultiple
          etiqueta="Empresa"
          valores={filtros.empresa}
          opciones={opciones?.empresas ?? []}
          formato={nombreEmpresa}
          onChange={(v) => cambiar({ ...filtros, empresa: v })}
        />
        <SelectorMultiple
          etiqueta="Categoría"
          valores={filtros.categoria}
          opciones={opciones?.categorias ?? []}
          onChange={(v) => cambiar({ ...filtros, categoria: v })}
        />
        {/* EL BUSCADOR CONFIRMA AL SALIR DEL CAMPO, no en cada tecla: cada
            cambio dispara el juego completo de consultas, y buscar "TORRES"
            serían seis pasadas por la base para ver la última. */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            cambiar({ ...filtros, buscar: buscado.trim() || undefined });
          }}
          className="flex flex-col gap-1"
        >
          <label className="text-muted text-[11px]" htmlFor="buscar-cuentas">
            Buscar
          </label>
          <input
            id="buscar-cuentas"
            value={buscado}
            onChange={(e) => setBuscado(e.target.value)}
            onBlur={() =>
              cambiar({ ...filtros, buscar: buscado.trim() || undefined })
            }
            placeholder="Cliente o CUIT"
            className="border-line bg-panel-2 text-ink placeholder:text-muted focus:border-c1 w-44 rounded-lg border px-2.5 py-1.5 text-xs outline-none"
          />
        </form>

        <BotonLimpiar
          onClick={() => {
            setBuscado("");
            cambiar({});
          }}
          deshabilitado={vacio}
        />

        <span className="text-muted ml-auto max-w-md text-[11px] leading-tight">
          Los clientes activos/inactivos cruzan ventas con deuda por nombre
          normalizado: cubre 118 de 129 clientes (96% de la deuda).
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

      {!k && !error ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => (
            <Esqueleto key={i} className="h-[86px]" />
          ))}
        </div>
      ) : k ? (
        <div
          className={`grid grid-cols-2 gap-3 transition-opacity sm:grid-cols-2 lg:grid-cols-4 ${cargando ? "opacity-50" : ""}`}
        >
          <TarjetaKpi
            titulo="Deuda Total"
            valor={fmtMoneda(k.deudaTotal)}
            detalle={`${fmtNumero(k.clientesTotales)} clientes`}
            acento={PALETA[0]}
          />
          <TarjetaKpi
            titulo="Deuda Vencida"
            valor={fmtMoneda(k.deudaVencida)}
            acento="#f43f5e"
          />
          <TarjetaKpi
            titulo="% Cartera Vencida"
            valor={fmtPct(k.pctCarteraVencida)}
            detalle="Vencida / total"
            acento={PALETA[2]}
          />
          <TarjetaKpi
            titulo="Clientes en Riesgo"
            valor={fmtNumero(k.clientesEnRiesgo)}
            detalle="Categoría CRÍTICO o RIESGOSO"
            acento={PALETA[5]}
          />
          <TarjetaKpi
            titulo="Clientes Activos (60d)"
            valor={fmtNumero(k.clientesActivos60d)}
            detalle="Compraron en los últimos 60 días"
            acento={PALETA[1]}
          />
          <TarjetaKpi
            titulo="Clientes Inactivos (60d)"
            valor={fmtNumero(k.clientesInactivos60d)}
            detalle="Sin compras hace más de 60 días"
          />
          <TarjetaKpi
            titulo="Vencidos que siguen comprando"
            valor={fmtNumero(k.clientesVencidosQueCompran)}
            detalle="Compraron después de entrar en mora"
            acento={PALETA[3]}
          />
          <TarjetaKpi
            titulo="Deuda por vencer"
            valor={fmtMoneda(k.deudaTotal - k.deudaVencida)}
            detalle="Todavía dentro del plazo"
            acento={PALETA[4]}
          />
        </div>
      ) : null}

      {data && (
        <div
          className={`space-y-4 transition-opacity ${cargando ? "opacity-50" : ""}`}
        >
          <div className="grid gap-4 xl:grid-cols-2">
            <Panel titulo="Cantidad de clientes por categoría">
              <TortaProveedores
                color={colorCategoria}
                datos={data.clientesPorCategoria.map((d) => ({
                  label: d.label,
                  total: d.valor,
                }))}
                totalGeneral={data.clientesPorCategoria.reduce(
                  (a, d) => a + d.valor,
                  0,
                )}
                seleccionados={filtros.categoria}
                onSeleccionar={alternar("categoria")}
              />
            </Panel>
            <Panel titulo="Deuda total por categoría">
              <BarrasCategoria
                datos={data.deudaPorCategoria}
                formato={fmtMonedaCorta}
                color={colorCategoria}
                seleccionados={filtros.categoria}
                onSeleccionar={alternar("categoria")}
              />
            </Panel>
            <Panel
              titulo="Antigüedad de la deuda"
              nota="Saldo pendiente por bucket de atraso"
            >
              {/* MISMA ESCALA QUE LAS CATEGORIAS, a propósito: es el mismo eje
                  --qué tan vencido está-- medido en días en vez de en
                  categorías. Con otra paleta, dos gráficos que dicen lo mismo
                  se leerían como si dijeran cosas distintas. */}
              <BarrasCategoria
                datos={data.aging}
                formato={fmtMonedaCorta}
                horizontal={false}
                alturaMinima={280}
                color={(l) => COLOR_TRAMO_AGING[l] ?? PALETA[2]}
              />
            </Panel>
            <Panel
              titulo="Saldo vencido cancelado por vendedor"
              nota="Clientes que salieron de mora"
            >
              {/* EL NOMBRE, NO EL CODIGO. La tabla guarda "007" y el resto de
                  la pantalla ya lo traduce; este gráfico era el único que
                  seguía mostrando el número.

                  El valor que viaja al filtro sigue siendo el CODIGO --es lo
                  que entiende la consulta-- así que `onSeleccionar` recibe la
                  etiqueta y la vuelve a convertir. Si se mandara el nombre, el
                  filtro cruzado no encontraría nada. */}
              <BarrasCategoria
                datos={data.cancelacionesPorVendedor.map((d) => ({
                  ...d,
                  label: nombreVendedor(d.label),
                }))}
                formato={fmtMonedaCorta}
                colorUnico={PALETA[1]}
                seleccionados={filtros.vendedor?.map(nombreVendedor)}
                onSeleccionar={(nombre) => {
                  const codigo =
                    data.cancelacionesPorVendedor.find(
                      (d) => nombreVendedor(d.label) === nombre,
                    )?.label ?? nombre;
                  alternar("vendedor")(codigo);
                }}
              />
            </Panel>
          </div>

          {/* VA PEGADO A "Evolución del saldo vencido" y los dos van por
              período, para que se lean como un par: en el mes X había tanto
              vencido, y de eso se terminó recuperando tanto. Separados por
              media pantalla la comparación se pierde.

              El eje es el mes en que el cliente ADEUDABA, no el mes en que
              pagó —la detección es siempre posterior— y la nota lo dice,
              porque leerlo al revés cambia el sentido del gráfico. */}
          <Panel
            titulo="Mora recuperada por mes"
            nota={notaRecupero(data.cancelacionesPorMes)}
          >
            <BarrasCategoria
              datos={data.cancelacionesPorMes.map((d) => ({
                label: fmtMes(d.label),
                valor: d.valor,
                clientes: d.clientes,
              }))}
              formato={fmtMonedaCorta}
              horizontal={false}
              alturaMinima={260}
              colorUnico={PALETA[1]}
              detalle={(d) => {
                const n = (d as { clientes?: number }).clientes ?? 0;
                return n ? `${fmtNumero(n)} ${n === 1 ? "cliente" : "clientes"}` : null;
              }}
              vacio="Todavía no hay cancelaciones registradas."
            />
          </Panel>

          <Panel
            titulo="Evolución del saldo vencido"
            nota={notaHistorial(data.historial)}
          >
            <BarrasCategoria
              datos={data.historial.map((d) => ({
                label: fmtMes(d.label),
                valor: d.valor,
              }))}
              formato={fmtMonedaCorta}
              horizontal={false}
              alturaMinima={260}
              colorUnico={PALETA[0]}
              vacio="Todavía no hay historial cargado."
            />
          </Panel>

          {/* SALE DE LA FOTO MENSUAL (`Historial_Scoring`) y no del scoring
              vivo. La nota dice de cuándo es la foto, porque una deuda de hace
              seis días leída como "ahora" hace llamar a quien ya pagó. */}
          <Panel
            titulo="Clientes y Saldos"
            nota={
              [
                `${data.clientes.length} ordenados por saldo vencido`,
                data.periodoClientes || null,
                // CUANTAS QUEDARON ATRAS, dicho en el pie. Es la respuesta a
                // "¿por qué algunos no se desglosan?": no tienen comprobantes
                // porque ya no deben nada, y su fila es de un día anterior.
                (() => {
                  const canceladas = data.clientes.filter((c) => !c.vigente).length;
                  return canceladas > 0
                    ? `${canceladas} ya sin deuda (en gris, sin saldo)`
                    : null;
                })(),
              ]
                .filter(Boolean)
                .join(" · ")
            }
          >
            {/* Click en una fila filtra por su CATEGORÍA, que es la dimensión de
                esta tabla que ya existe como filtro y a la que responden los
                KPIs de arriba. Filtrar por el cliente suelto dejaría un tablero
                de una fila, que es lo que ya se está mirando. */}
            {/* TODAS LAS FILAS SE ABREN, incluso las que no tienen
                comprobantes. Antes esas no mostraban flecha y el resultado era
                un dedo que no hace nada: la pregunta "¿por qué éste no se
                desglosa?" se la llevaba puesta quien miraba.

                Y la respuesta no es un error de datos, es información: al
                15/10 son 24, de los cuales 21 figuran en la tabla de
                cancelaciones --pagaron, y sus comprobantes salieron del
                aging-- y 2 tienen saldo A FAVOR. Decirlo es más útil que
                esconder la flecha. */}
            <Tabla
              filas={data.clientes}
              columnas={columnas(data.clientes)}
              clave={(f) => f.cuit || f.razonSocial}
              expandir={(f) => (
                <DetalleComprobantes
                  filas={data.comprobantesPorCuit[f.cuit] ?? []}
                  cliente={f}
                  fechaFoto={data.fechaClientes}
                />
              )}
              onClickFila={(f) =>
                f.categoria && alternar("categoria")(f.categoria)
              }
              activa={(f) =>
                filtros.categoria?.length
                  ? filtros.categoria.includes(f.categoria ?? "")
                  : false
              }
            />
            <LeyendaEstados />
          </Panel>

          {/* UNA FILA POR COMPROBANTE, y ésa es toda la razón de que exista.
              La tabla de arriba muestra una fila por cliente: la suma de lo
              vencido con, al lado, el atraso del comprobante más viejo. Leídas
              juntas dicen "debe todo esto desde hace tanto", que casi nunca es
              cierto — el saldo suele estar repartido en comprobantes de
              antigüedades muy distintas. Acá cada uno trae su plata y sus días. */}
          <Panel
            titulo="Comprobantes vencidos"
            nota={
              data.comprobantesVencidos.length === 0
                ? "Sin comprobantes vencidos"
                : `${fmtNumero(data.comprobantesVencidos.length)} comprobantes · uno por fila, con su propia antigüedad`
            }
          >
            <Tabla
              filas={data.comprobantesVencidos}
              columnas={columnasVencidos(data.comprobantesVencidos, {
                conVendedor: true,
              })}
              clave={(f, i) => `${f.comprobante ?? "s/n"}-${i}`}
            />
          </Panel>
        </div>
      )}
    </div>
  );
}
