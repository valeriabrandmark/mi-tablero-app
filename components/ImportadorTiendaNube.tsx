"use client";

import { useEffect, useState } from "react";
import { Aviso, Panel, TarjetaKpi } from "@/components/ui";
import { fmtMoneda, fmtNumero } from "@/lib/format";
import { leerCsvTiendaNube, type ResultadoLectura } from "@/lib/importador-tn";
import { MARCAS, type ClaveMarca } from "@/lib/marketing-demo";

/**
 * Subir el CSV de Ventas de Tienda Nube de una marca.
 *
 * El archivo se lee ACÁ, en el navegador: se muestra qué se entendió antes de
 * mandar nada, y los emails se convierten en un hash sin salir de la
 * computadora. Al servidor llegan pedidos, no el archivo.
 */

type Importacion = {
  marca: ClaveMarca;
  archivo: string | null;
  pedidos: number;
  nuevos: number;
  actualizados: number;
  desde: string | null;
  hasta: string | null;
  importado_por: string | null;
  importado_en: string;
};

const fecha = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat("es-AR", {
        day: "2-digit",
        month: "2-digit",
        year: "2-digit",
        timeZone: "America/Argentina/Buenos_Aires",
      }).format(new Date(iso))
    : "—";

const nombreMarca = (k: string) => MARCAS.find((m) => m.clave === k)?.nombre ?? k;

export default function ImportadorTiendaNube() {
  const [marca, setMarca] = useState<ClaveMarca | "">("");
  const [archivo, setArchivo] = useState<string | null>(null);
  const [lectura, setLectura] = useState<ResultadoLectura | null>(null);
  const [leyendo, setLeyendo] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [historial, setHistorial] = useState<Importacion[]>([]);
  const [errorHistorial, setErrorHistorial] = useState<string | null>(null);

  async function cargarHistorial() {
    try {
      const r = await fetch("/api/marketing/tienda-nube");
      const j = (await r.json()) as { importaciones?: Importacion[]; error?: string };
      setHistorial(j.importaciones ?? []);
      setErrorHistorial(j.error ?? null);
    } catch (e) {
      setErrorHistorial(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    let vivo = true;
    fetch("/api/marketing/tienda-nube")
      .then((r) => r.json() as Promise<{ importaciones?: Importacion[]; error?: string }>)
      .then((j) => {
        if (!vivo) return;
        setHistorial(j.importaciones ?? []);
        setErrorHistorial(j.error ?? null);
      })
      .catch((e: unknown) => vivo && setErrorHistorial(e instanceof Error ? e.message : String(e)));
    return () => {
      vivo = false;
    };
  }, []);

  async function elegirArchivo(f: File | undefined) {
    setLectura(null);
    setResultado(null);
    setError(null);
    if (!f) return;
    setArchivo(f.name);
    setLeyendo(true);
    try {
      setLectura(await leerCsvTiendaNube(await f.arrayBuffer()));
    } catch (e) {
      setError(`No se pudo leer el archivo: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLeyendo(false);
    }
  }

  async function importar() {
    if (!lectura || !marca) return;
    setEnviando(true);
    setError(null);
    try {
      const r = await fetch("/api/marketing/tienda-nube", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ marca, archivo, pedidos: lectura.pedidos }),
      });
      const j = (await r.json()) as {
        error?: string;
        pedidos?: number;
        nuevos?: number;
        actualizados?: number;
        descartados?: number;
      };
      if (!r.ok) throw new Error(j.error ?? `Error ${r.status}`);
      setResultado(
        `Listo: ${j.pedidos} pedidos de ${nombreMarca(marca)} (${j.nuevos} nuevos, ${j.actualizados} actualizados` +
          `${j.descartados ? `, ${j.descartados} descartados` : ""}).`,
      );
      setLectura(null);
      setArchivo(null);
      await cargarHistorial();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setEnviando(false);
    }
  }

  const ventas = lectura?.pedidos.filter((p) => p.esVenta) ?? [];
  const fechas = lectura?.pedidos.map((p) => p.fecha).sort() ?? [];
  const conCupon = ventas.filter((p) => p.cupon).length;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Importar Tienda Nube</h1>
        <p className="text-muted text-sm">
          Pedidos de la tienda de cada marca para el Tablero de Marca. Reimportar es seguro: los
          pedidos que ya estaban se actualizan, no se duplican.
        </p>
      </div>

      <Panel titulo="Cómo bajar el archivo" nota="Una vez por semana alcanza">
        <ol className="text-muted list-decimal space-y-1 pl-5 text-sm">
          <li>
            En el administrador de la tienda: <b className="text-ink">Ventas → Exportar listado</b>{" "}
            (arriba a la derecha).
          </li>
          <li>Elegí el rango de fechas (el mes en curso, o desde la última importación) y todas las ventas.</li>
          <li>Tienda Nube manda el CSV por mail o lo descarga. Subilo acá abajo eligiendo la marca.</li>
        </ol>
      </Panel>

      <Panel titulo="Subir archivo">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="text-muted mb-1 block text-xs">Marca de la tienda</span>
            <select
              value={marca}
              onChange={(e) => setMarca(e.target.value as ClaveMarca)}
              className="border-line bg-panel-2 rounded-lg border px-3 py-2 text-sm"
            >
              <option value="">Elegí la marca…</option>
              {MARCAS.map((m) => (
                <option key={m.clave} value={m.clave}>
                  {m.nombre}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="text-muted mb-1 block text-xs">CSV de ventas</span>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => {
                const f = e.target.files?.[0];
                // Se vacía para que volver a elegir EL MISMO archivo (la
                // semana siguiente, o después de un error) dispare de nuevo.
                e.target.value = "";
                void elegirArchivo(f);
              }}
              className="text-muted file:border-line file:bg-panel-2 file:text-ink text-sm file:mr-3 file:rounded-lg file:border file:px-3 file:py-2"
            />
          </label>
          {leyendo && <span className="text-muted text-sm">Leyendo…</span>}
          {archivo && !leyendo && <span className="text-muted text-sm">{archivo}</span>}
        </div>

        {error && (
          <div className="mt-3">
            <Aviso>{error}</Aviso>
          </div>
        )}
        {resultado && (
          <div className="mt-3">
            <Aviso tono="info">{resultado}</Aviso>
          </div>
        )}

        {lectura && (
          <div className="mt-4 space-y-3">
            {lectura.columnasFaltantes.length > 0 ? (
              <Aviso>
                Faltan columnas obligatorias: {lectura.columnasFaltantes.join(", ")}. {lectura.avisos.join(" ")}
              </Aviso>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
                  <TarjetaKpi titulo="Filas del archivo" valor={fmtNumero(lectura.filas)} />
                  <TarjetaKpi titulo="Pedidos" valor={fmtNumero(lectura.pedidos.length)} />
                  <TarjetaKpi
                    titulo="Ventas (pagadas)"
                    valor={fmtNumero(ventas.length)}
                    detalle={fmtMoneda(ventas.reduce((s, p) => s + p.total, 0))}
                  />
                  <TarjetaKpi titulo="Con cupón" valor={fmtNumero(conCupon)} />
                  <TarjetaKpi
                    titulo="Período"
                    valor={`${fecha(fechas[0] ?? null)} → ${fecha(fechas.at(-1) ?? null)}`}
                  />
                </div>
                {lectura.avisos.map((a) => (
                  <Aviso key={a} tono="alerta">
                    {a}
                  </Aviso>
                ))}
                <p className="text-muted text-xs">
                  Columnas reconocidas: {lectura.columnasEncontradas.join(", ")}. Nombres, emails,
                  DNI y direcciones no se suben.
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-muted border-line border-b text-left text-xs">
                        {["Pedido", "Fecha", "Estado", "Pago", "Total", "Cupón", "Provincia", "Cuenta como venta"].map((c) => (
                          <th key={c} className="px-2 py-2 font-medium whitespace-nowrap">
                            {c}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-line divide-y">
                      {lectura.pedidos.slice(0, 15).map((p) => (
                        <tr key={p.numero}>
                          <td className="px-2 py-1.5">#{p.numero}</td>
                          <td className="px-2 py-1.5">{fecha(p.fecha)}</td>
                          <td className="text-muted px-2 py-1.5">{p.estado ?? "—"}</td>
                          <td className="text-muted px-2 py-1.5">{p.estadoPago ?? "—"}</td>
                          <td className="px-2 py-1.5 tabular-nums">{fmtMoneda(p.total)}</td>
                          <td className="px-2 py-1.5 font-mono text-xs">{p.cupon ?? ""}</td>
                          <td className="text-muted px-2 py-1.5">{p.provincia ?? ""}</td>
                          <td className="px-2 py-1.5">{p.esVenta ? "Sí" : "No"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {lectura.pedidos.length > 15 && (
                    <p className="text-muted mt-1 text-xs">
                      … y {lectura.pedidos.length - 15} pedidos más.
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  disabled={!marca || enviando || lectura.pedidos.length === 0}
                  onClick={importar}
                  className="bg-c1 rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
                >
                  {enviando
                    ? "Importando…"
                    : marca
                      ? `Importar ${lectura.pedidos.length} pedidos a ${nombreMarca(marca)}`
                      : "Elegí la marca para importar"}
                </button>
              </>
            )}
          </div>
        )}
      </Panel>

      <Panel titulo="Últimas importaciones">
        {errorHistorial && historial.length === 0 ? (
          <p className="text-muted text-sm">
            {/does not exist|no existe/.test(errorHistorial)
              ? "Falta crear las tablas: correr migraciones/marketing_tienda_nube.sql en Supabase."
              : errorHistorial}
          </p>
        ) : historial.length === 0 ? (
          <p className="text-muted text-sm">Todavía no se importó nada.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted border-line border-b text-left text-xs">
                  {["Cuándo", "Marca", "Archivo", "Pedidos", "Nuevos", "Actualizados", "Período", "Quién"].map((c) => (
                    <th key={c} className="px-2 py-2 font-medium whitespace-nowrap">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-line divide-y">
                {historial.map((h, i) => (
                  <tr key={i}>
                    <td className="px-2 py-1.5 whitespace-nowrap">{fecha(h.importado_en)}</td>
                    <td className="px-2 py-1.5">{nombreMarca(h.marca)}</td>
                    <td className="text-muted px-2 py-1.5 text-xs">{h.archivo ?? "—"}</td>
                    <td className="px-2 py-1.5 tabular-nums">{h.pedidos}</td>
                    <td className="px-2 py-1.5 tabular-nums">{h.nuevos}</td>
                    <td className="px-2 py-1.5 tabular-nums">{h.actualizados}</td>
                    <td className="px-2 py-1.5 whitespace-nowrap">
                      {fecha(h.desde)} → {fecha(h.hasta)}
                    </td>
                    <td className="text-muted px-2 py-1.5 text-xs">{h.importado_por ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
