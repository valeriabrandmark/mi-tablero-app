"use client";

import { useState } from "react";
import { sumar, Tabla, type Columna } from "@/components/Tabla";
import { Aviso, Esqueleto, Panel, TarjetaKpi } from "@/components/ui";
import {
  DIAS_PARA_LLEGAR_A_FIXY,
  estadoDeDiferencia,
  UMBRAL_DIFERENCIA_UNIDADES,
} from "@/lib/fixy";
import { fmtFechaHora, fmtNumero } from "@/lib/format";
import { TEMA } from "@/lib/paleta";
import type {
  DashboardFixy as Datos,
  EnvioDigip,
  FilaControl,
  FilaPublicado,
  Recepcion,
  Transferencia,
} from "@/lib/queries-fixy";
import { useDatosTablero } from "@/lib/useDatosTablero";

type Respuesta = Datos & { puedeAvisar: boolean; apiConfigurada: boolean };

/** Hoy + n días, en AAAA-MM-DD y en hora local. */
function enDias(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function avisar(cuerpo: Record<string, unknown>): Promise<string> {
  const res = await fetch("/api/fixy/recepciones", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(cuerpo),
  });
  const j = await res.json().catch(() => null);
  if (!res.ok) {
    const extra = j?.errores?.join("\n") ?? j?.detalle ?? "";
    throw new Error(`${j?.error ?? `Error ${res.status}`}${extra ? `\n${extra}` : ""}`);
  }
  return j.resultado === "incierto"
    ? `FIXY contestó con error al remito ${j.remito}: puede haber entrado igual. Revisalo en el sistema de FIXY antes de volver a mandarlo.`
    : `Remito ${j.remito} avisado a FIXY: ${fmtNumero(j.renglones)} artículos, ${fmtNumero(j.unidades)} unidades.`;
}

function signo(n: number) {
  return `${n > 0 ? "+" : ""}${fmtNumero(n)}`;
}

export default function DashboardFixy() {
  const { data, cargando, error, recargar } = useDatosTablero<Respuesta>("/api/fixy", {});
  const [fecha, setFecha] = useState(enDias(3));
  const [enviando, setEnviando] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<{ tono: "info" | "error"; texto: string } | null>(null);
  const [remito, setRemito] = useState("");
  const [texto, setTexto] = useState("");
  const [soloAlertas, setSoloAlertas] = useState(true);

  if (error) return <Aviso>{error}</Aviso>;
  if (cargando && !data) return <Esqueleto className="h-96" />;
  if (!data) return null;

  const puedeMandar = data.puedeAvisar && data.apiConfigurada;

  async function correr(clave: string, cuerpo: Record<string, unknown>) {
    setEnviando(clave);
    setMensaje(null);
    try {
      const t = await avisar({ ...cuerpo, fechaPactada: fecha });
      setMensaje({ tono: "info", texto: t });
      if (clave === "manual") {
        setRemito("");
        setTexto("");
      }
      recargar();
    } catch (e) {
      setMensaje({ tono: "error", texto: e instanceof Error ? e.message : "Error" });
    } finally {
      setEnviando(null);
    }
  }

  const sinAvisar = data.envios.filter((e) => e.recepcionId === null);
  const faltantes = data.control.filas.filter(
    (f) => estadoDeDiferencia(f.diferencia, f.enTransito) === "faltante",
  );
  const sobreventa = data.publicado.filter((p) => p.alerta === "sobreventa");
  const stockFixy = data.publicado.filter((p) => p.fixy !== null);

  // ---- Columnas ------------------------------------------------------------
  const colEnvios: Columna<EnvioDigip>[] = [
    { titulo: "Pedido Digip", celda: (e) => e.pedido, orden: (e) => e.pedido },
    { titulo: "Fecha", celda: (e) => e.fecha ?? "—", orden: (e) => e.fecha },
    { titulo: "Estado", celda: (e) => e.estado ?? "—" },
    { titulo: "Artículos", celda: (e) => fmtNumero(e.renglones), numerica: true },
    {
      titulo: "Unidades",
      ayuda: "Unidades que Digip efectivamente preparó (satisfechas), no las pedidas.",
      celda: (e) => fmtNumero(e.unidades),
      numerica: true,
      total: fmtNumero(sumar(data.envios, (e) => e.unidades)),
    },
    {
      titulo: "Aviso a FIXY",
      celda: (e) =>
        e.recepcionId !== null ? (
          <span style={{ color: e.resultado === "incierto" ? TEMA.negativo : undefined }}>
            {e.resultado === "incierto" ? "Incierto · " : "Avisado · "}
            {fmtFechaHora(e.avisadaEn)}
          </span>
        ) : puedeMandar ? (
          <button
            type="button"
            disabled={enviando !== null}
            onClick={() => correr(e.pedido, { origen: "digip", pedido: e.pedido })}
            className="border-line bg-panel-2 rounded-md border px-2 py-1 text-xs disabled:opacity-50"
          >
            {enviando === e.pedido ? "Avisando…" : "Avisar a FIXY"}
          </button>
        ) : (
          <span style={{ color: TEMA.negativo }}>Sin avisar</span>
        ),
    },
  ];

  const colTransferencias: Columna<Transferencia>[] = [
    { titulo: "Comprobante", celda: (t) => t.comprobante, orden: (t) => t.comprobante },
    { titulo: "Fecha", celda: (t) => t.fecha, orden: (t) => t.fecha },
    { titulo: "Cliente", celda: (t) => t.cliente },
    { titulo: "Artículos", celda: (t) => fmtNumero(t.renglones), numerica: true },
    {
      titulo: "Unidades",
      ayuda: "Las notas de crédito restan.",
      celda: (t) => (
        <span style={{ color: t.unidades < 0 ? TEMA.negativo : undefined }}>{fmtNumero(t.unidades)}</span>
      ),
      numerica: true,
      total: fmtNumero(sumar(data.transferencias, (t) => t.unidades)),
    },
  ];

  const colRecepciones: Columna<Recepcion>[] = [
    { titulo: "Remito", celda: (r) => r.remito, orden: (r) => r.remito },
    { titulo: "Origen", celda: (r) => (r.origen === "digip" ? "Tucumán (Digip)" : "Manual / importación") },
    { titulo: "Avisada", celda: (r) => fmtFechaHora(r.creadaEn), orden: (r) => r.creadaEn },
    { titulo: "Llega", celda: (r) => r.fechaPactada, orden: (r) => r.fechaPactada },
    { titulo: "Artículos", celda: (r) => fmtNumero(r.renglones), numerica: true },
    {
      titulo: "Unidades",
      celda: (r) => fmtNumero(r.unidades),
      numerica: true,
      total: fmtNumero(sumar(data.recepciones, (r) => r.unidades)),
    },
    {
      titulo: "Resultado",
      celda: (r) =>
        r.resultado === "ok" ? "OK" : <span style={{ color: TEMA.negativo }}>Incierto</span>,
    },
    { titulo: "Quién", celda: (r) => r.usuario ?? "—" },
  ];

  const colControl: Columna<FilaControl>[] = [
    { titulo: "SKU", celda: (f) => f.sku, orden: (f) => f.sku },
    {
      titulo: "Artículo",
      celda: (f) => (
        <span className="block max-w-[160px] truncate sm:max-w-[280px]" title={f.producto ?? undefined}>
          {f.producto ?? "—"}
        </span>
      ),
      orden: (f) => f.producto,
    },
    {
      titulo: "Ingresado",
      ayuda:
        "Lo que entró a FIXY en el período: transferencias desde Tucumán (facturas a \"... - DEP BUENOS AIRES\" menos notas de crédito) más importaciones avisadas a mano.",
      celda: (f) => fmtNumero(f.ingresado),
      numerica: true,
      orden: (f) => f.ingresado,
    },
    {
      titulo: "Vendido",
      ayuda: "Ventas por Tienda Nube y Mercado Libre Flex: todos los canales que descuentan del stock de FIXY.",
      celda: (f) => fmtNumero(f.vendido),
      numerica: true,
      orden: (f) => f.vendido,
    },
    { titulo: "En FIXY hoy", celda: (f) => fmtNumero(f.stockHoy), numerica: true, orden: (f) => f.stockHoy },
    {
      titulo: "Viajando",
      ayuda: `Ingresado hace menos de ${DIAS_PARA_LLEGAR_A_FIXY} días: puede no haber llegado todavía.`,
      celda: (f) => (f.enTransito ? fmtNumero(f.enTransito) : "—"),
      numerica: true,
      orden: (f) => f.enTransito,
    },
    {
      titulo: "Diferencia",
      ayuda:
        "Lo que se movió el stock de FIXY que no explican ni las ventas ni los ingresos. Negativo: falta mercadería. Positivo: entró algo sin transferencia ni aviso, o una venta no se descontó.",
      celda: (f) => {
        const e = estadoDeDiferencia(f.diferencia, f.enTransito);
        return (
          <span style={{ color: e === "en_orden" ? undefined : TEMA.negativo }}>{signo(f.diferencia)}</span>
        );
      },
      numerica: true,
      orden: (f) => f.diferencia,
      total: signo(sumar(data.control.filas, (f) => f.diferencia)),
    },
  ];

  const colPublicado: Columna<FilaPublicado>[] = [
    { titulo: "SKU", celda: (p) => p.sku, orden: (p) => p.sku },
    {
      titulo: "Artículo",
      celda: (p) => (
        <span className="block max-w-[160px] truncate sm:max-w-[280px]" title={p.producto ?? undefined}>
          {p.producto ?? "—"}
        </span>
      ),
      orden: (p) => p.producto,
    },
    {
      titulo: "FIXY",
      ayuda: "Lo que FIXY dice que tiene. Es el stock de TODOS los canales juntos.",
      celda: (p) => (p.fixy === null ? "—" : fmtNumero(p.fixy)),
      numerica: true,
      orden: (p) => p.fixy,
    },
    {
      titulo: "ML Flex",
      ayuda: "Lo que muestra la publicación Flex activa. Si hay varias, la que más muestra.",
      celda: (p) =>
        p.flex === null ? "—" : `${fmtNumero(p.flex)}${p.publicacionesFlex > 1 ? ` (${p.publicacionesFlex} pub.)` : ""}`,
      numerica: true,
      orden: (p) => p.flex,
    },
    {
      titulo: "Tienda Nube",
      ayuda: "Stock publicado en la Tienda Nube que entra por API. Las otras tiendas todavía no están conectadas.",
      celda: (p) => (p.tiendaNube === null ? "—" : fmtNumero(p.tiendaNube)),
      numerica: true,
      orden: (p) => p.tiendaNube,
    },
    {
      titulo: "Alerta",
      celda: (p) =>
        p.alerta === "sobreventa" ? (
          <span style={{ color: TEMA.negativo }}>Publica más de lo que hay</span>
        ) : p.alerta === "sin_publicar" ? (
          <span className="text-amber-500">Hay stock y no se muestra</span>
        ) : (
          "—"
        ),
      orden: (p) => (p.alerta === "sobreventa" ? 0 : p.alerta ? 1 : 2),
    },
  ];

  const publicadoVisible = soloAlertas ? data.publicado.filter((p) => p.alerta) : data.publicado;

  return (
    <div className="space-y-4">
      {!data.apiConfigurada && (
        <Aviso tono="alerta">
          El tablero todavía no está conectado a FIXY: falta el token de la API (FIXY_API_TOKEN). Hasta
          entonces no hay foto de stock ni se pueden avisar ingresos. Lo que se ve abajo sale de Digip y de
          Mercado Libre.
        </Aviso>
      )}
      {(data.faltan.recepciones || data.faltan.eventos) && (
        <Aviso tono="alerta">Falta aplicar la migración migraciones/fixy.sql en la base.</Aviso>
      )}
      {mensaje && (
        <Aviso tono={mensaje.tono === "error" ? "error" : "info"}>
          <span className="whitespace-pre-line">{mensaje.texto}</span>
        </Aviso>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <TarjetaKpi
          titulo="Unidades en FIXY"
          valor={stockFixy.length ? fmtNumero(sumar(stockFixy, (p) => p.fixy ?? 0)) : "—"}
          detalle={stockFixy.length ? `${fmtNumero(stockFixy.length)} SKU` : "sin foto todavía"}
        />
        <TarjetaKpi
          titulo="Envíos sin avisar"
          valor={fmtNumero(sinAvisar.length)}
          detalle={`${fmtNumero(sumar(sinAvisar, (e) => e.unidades))} u. salidas de Tucumán`}
          acento={sinAvisar.length ? TEMA.negativo : undefined}
        />
        <TarjetaKpi
          titulo="SKU con faltante"
          valor={data.control.dias >= 2 ? fmtNumero(faltantes.length) : "—"}
          detalle={
            data.control.dias >= 2
              ? `${fmtNumero(-sumar(faltantes, (f) => f.diferencia + f.enTransito))} u. sin explicar`
              : `hacen falta 2 días de foto (hay ${data.control.dias})`
          }
          ayuda={`Diferencias de ${UMBRAL_DIFERENCIA_UNIDADES} unidades o más, descontando lo que puede estar viajando.`}
          acento={faltantes.length ? TEMA.negativo : undefined}
        />
        <TarjetaKpi
          titulo="Riesgo de sobreventa"
          valor={fmtNumero(sobreventa.length)}
          detalle="SKU que un canal publica de más"
          acento={sobreventa.length ? TEMA.negativo : undefined}
        />
        <TarjetaKpi
          titulo="Recepciones avisadas"
          valor={fmtNumero(data.recepciones.length)}
          detalle={`${fmtNumero(sumar(data.recepciones, (r) => r.unidades))} u.`}
        />
        <TarjetaKpi
          titulo="Guías (30 días)"
          valor={fmtNumero(data.eventos.guias)}
          detalle={
            data.eventos.ultimo
              ? `${fmtNumero(data.eventos.entregadas)} entregadas · último aviso ${fmtFechaHora(data.eventos.ultimo)}`
              : "FIXY todavía no mandó avisos"
          }
        />
      </div>

      <Panel
        titulo="Transferencias de Tucumán a FIXY"
        nota="Facturas y notas de crédito de Sigma a «... - DEP BUENOS AIRES». Es lo que el control cuenta como ingreso desde Tucumán."
      >
        <Tabla
          filas={data.transferencias}
          columnas={colTransferencias}
          clave={(t) => `${t.comprobante}-${t.fecha}`}
          vacio="No hay transferencias a FIXY en Sigma."
        />
      </Panel>

      <Panel
        titulo="Envíos de Tucumán a FIXY"
        nota="Pedidos de Digip con despacho a FIXY. Cada uno se avisa a FIXY para que espere la mercadería."
      >
        <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
          <label htmlFor="fixy-fecha" className="text-muted">
            Fecha pactada de llegada
          </label>
          <input
            id="fixy-fecha"
            type="date"
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
            className="border-line bg-panel-2 rounded-md border px-2 py-1"
          />
          {!data.puedeAvisar && <span className="text-muted">No tenés permiso para avisar ingresos.</span>}
        </div>
        <Tabla
          filas={data.envios}
          columnas={colEnvios}
          clave={(e) => e.pedido}
          vacio={
            data.faltan.enviosDigip
              ? "Todavía no hay envíos a FIXY registrados desde Digip."
              : "No hay envíos a FIXY."
          }
        />
      </Panel>

      {data.puedeAvisar && (
        <Panel
          titulo="Avisar un ingreso a mano"
          nota="Para las importaciones, que llegan directo a FIXY. Lo que sale de Tucumán no se carga acá: entra solo, con la transferencia de Sigma."
        >
          <div className="grid gap-3 text-sm sm:grid-cols-[220px_1fr]">
            <div className="space-y-2">
              <label className="block">
                <span className="text-muted block text-xs">Remito / despacho</span>
                <input
                  value={remito}
                  onChange={(e) => setRemito(e.target.value)}
                  placeholder="IMP-2026-014"
                  className="border-line bg-panel-2 mt-1 w-full rounded-md border px-2 py-1"
                />
              </label>
              <p className="text-muted text-xs">Llega el {fecha} (se cambia arriba).</p>
              <button
                type="button"
                disabled={!puedeMandar || enviando !== null || !remito.trim() || !texto.trim()}
                onClick={() => correr("manual", { origen: "manual", remito, texto })}
                className="border-line bg-panel-2 rounded-md border px-3 py-1.5 disabled:opacity-50"
              >
                {enviando === "manual" ? "Avisando…" : "Avisar a FIXY"}
              </button>
            </div>
            <label className="block">
              <span className="text-muted block text-xs">
                Una línea por artículo: SKU, cantidad y (opcional) cajas. Se puede pegar desde una planilla.
              </span>
              <textarea
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                rows={6}
                placeholder={"SS03006 120 10\nDG01001 48"}
                className="border-line bg-panel-2 mt-1 w-full rounded-md border px-2 py-1 font-mono text-xs"
              />
            </label>
          </div>
        </Panel>
      )}

      <Panel
        titulo="Control de stock"
        nota={
          data.control.dias >= 2
            ? `Foto de FIXY del ${data.control.desde} al ${data.control.hasta}. Lo más negativo primero.`
            : "Hacen falta al menos dos días de foto de stock de FIXY."
        }
      >
        <Tabla
          filas={data.control.filas}
          columnas={colControl}
          clave={(f) => f.sku}
          vacio="Todavía no hay historia de stock de FIXY para comparar."
        />
      </Panel>

      <Panel
        titulo="Lo publicado contra lo que hay en FIXY"
        nota="El stock es uno para todos los canales: ningún canal debería mostrar más de lo que tiene FIXY."
      >
        <label className="mb-3 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={soloAlertas} onChange={(e) => setSoloAlertas(e.target.checked)} />
          Sólo los que tienen alerta
        </label>
        <Tabla
          filas={publicadoVisible}
          columnas={colPublicado}
          clave={(p) => p.sku}
          vacio={soloAlertas ? "Ningún SKU con alerta." : "Sin datos."}
        />
      </Panel>

      <Panel titulo="Recepciones avisadas" nota="Lo que le dijimos a FIXY que iba a entrar.">
        <Tabla
          filas={data.recepciones}
          columnas={colRecepciones}
          clave={(r) => String(r.id)}
          vacio="Todavía no se avisó ninguna recepción."
        />
      </Panel>
    </div>
  );
}
