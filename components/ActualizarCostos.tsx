"use client";

import { useEffect, useState } from "react";
import { Aviso, Panel, TarjetaKpi } from "@/components/ui";
import { fmtMoneda, fmtNumero } from "@/lib/format";
import type { Snapshot } from "@/lib/costos-snapshot";

/* -------------------------------------------------------------------------
   ACTUALIZAR LOS COSTOS

   PRIMERO SE MIRA Y DESPUES SE APLICA, y ese orden es todo el punto. Lo que
   sale de acá es el denominador de cada margen del tablero, y un costo mal
   cargado no se ve donde se carga: se ve semanas después, como un número raro
   que nadie sabe explicar.

   El 07/09/2026 entró un archivo con la coma decimal borrada en el 63 % de los
   artículos y el margen del día dio -$42.421 millones. Nadie lo vio en la
   carga. Esta pantalla existe para que se vea antes.
   ------------------------------------------------------------------------- */

const BOTON =
  "border-line hover:bg-panel-2 text-muted hover:text-ink rounded-lg border px-3 py-1.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40";
const BOTON_ACTIVO =
  "border-c1 bg-c1 text-panel hover:bg-c1/85 rounded-lg border px-3 py-1.5 text-xs font-medium disabled:opacity-40";
const CAMPO =
  "border-line bg-panel-2 text-ink placeholder:text-muted/60 rounded-lg border px-2.5 py-1.5 text-sm focus:border-c1 focus:outline-none";

type Preparado = {
  snapshot: Snapshot;
  ofertas: { filas: number; sinSku: number; conOferta: number; problemas: string[] };
  foto: { recibida: string; filas: number } | null;
  mes: string;
  vigenteDesde: string;
  tramoVigente: { mes: string; vigenteDesde: string; nota: string | null } | null;
  tramos: TramoGuardado[];
};

type TramoGuardado = {
  mes: string;
  vigenteDesde: string;
  vigenteDesdeTexto: string;
  origen: string;
  articulos: number;
  conCosto: number;
  nota: string | null;
  aplicadoPor: string | null;
  aplicadoEn: string | null;
  cambian: number | null;
  sinCostoTeorico: number | null;
  faltantes: number | null;
  conOferta: number | null;
  vigente: boolean;
};

/**
 * EL ENLACE DE DESCARGA ES UN <a>, no un fetch con Blob.
 *
 * El servidor ya manda el `Content-Disposition` con el nombre, así que el
 * navegador baja el archivo solo: sin estado de "bajando", sin tener que
 * sostener ocho mil filas en memoria, y andando igual si se abre en otra
 * pestaña o se copia el enlace.
 */
function enlaceDeTramo(t: TramoGuardado): string {
  const p = new URLSearchParams({
    mes: t.mes,
    desde: t.vigenteDesde,
    origen: t.origen,
  });
  return `/api/compras/costos/archivo?${p}`;
}

export default function ActualizarCostos() {
  /**
   * LA FOTO, ATADA AL PEDIDO QUE LA TRAJO.
   *
   * Se guarda con la clave de la recarga que la pidió y "cargando" se deriva
   * de comparar las dos, en vez de poner la foto en null al empezar el efecto.
   * Es el patrón del resto del tablero, y existe porque resetear adentro del
   * efecto dispara renders en cascada (`react-hooks/set-state-in-effect`).
   */
  const [traido, setTraido] = useState<
    { clave: number; datos: Preparado } | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [nota, setNota] = useState("");
  const [confirmando, setConfirmando] = useState(false);
  const [aplicando, setAplicando] = useState(false);
  const [listo, setListo] = useState<string | null>(null);
  const [recargas, setRecargas] = useState(0);

  useEffect(() => {
    let vivo = true;
    const clave = recargas;
    fetch("/api/compras/costos")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: Preparado) => vivo && setTraido({ clave, datos: j }))
      .catch(() => {
        if (!vivo) return;
        setError("No se pudo armar la foto de costos.");
      });
    return () => {
      vivo = false;
    };
  }, [recargas]);

  const datos = traido?.clave === recargas ? traido.datos : null;

  const aplicar = async () => {
    setAplicando(true);
    setError(null);
    try {
      const r = await fetch("/api/compras/costos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nota }),
      });
      const j = await r.json();
      if (!r.ok) {
        throw new Error(
          [j.error, ...(j.problemas ?? [])].filter(Boolean).join(" · "),
        );
      }
      setListo(
        `Quedaron ${fmtNumero(j.filas)} artículos con costo nuevo, vigentes desde el ${j.vigenteDesde}.`,
      );
      setConfirmando(false);
      setNota("");
      setRecargas((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo aplicar");
    } finally {
      setAplicando(false);
    }
  };

  const s = datos?.snapshot;
  const sePuede = !!s && s.problemas.length === 0 && nota.trim().length > 0;

  return (
    <div className="max-w-4xl space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Actualizar costos</h1>
        <p className="text-muted mt-1 text-xs">
          El costo teórico sale del maestro de Sigma y las ofertas del
          Consolidador. Primero se mira qué cambia, después se aplica.
        </p>
      </div>

      {listo && <Aviso tono="info">{listo}</Aviso>}
      {error && <Aviso>{error}</Aviso>}

      {!datos ? (
        <p className="text-muted text-sm">Armando la foto…</p>
      ) : (
        <>
          <Panel
            titulo="La foto de ahora"
            nota={datos.foto ? `planilla del ${datos.foto.recibida}` : "sin planilla"}
          >
            {/* DE CUANDO ES LA FOTO. Si la planilla se mandó hace una semana,
                lo que se está por aplicar es de hace una semana -- y eso hay
                que saberlo ANTES, no después de pisar los costos. */}
            {datos.foto ? (
              <p className="text-muted text-xs">
                La planilla llegó el <strong className="text-ink">{datos.foto.recibida}</strong> con{" "}
                {fmtNumero(datos.ofertas.filas)} filas:{" "}
                {fmtNumero(datos.ofertas.conOferta)} con oferta,{" "}
                {fmtNumero(datos.ofertas.sinSku)} sin SKU (las de fórmula, se descartan).
                {" "}Si editaste algo recién, mandala de nuevo desde el menú{" "}
                <strong className="text-ink">Tablero → Mandar las ofertas ahora</strong>.
              </p>
            ) : (
              <Aviso tono="alerta">
                Todavía no llegó ninguna foto del Consolidador.
              </Aviso>
            )}

            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <TarjetaKpi
                titulo="Artículos"
                valor={fmtNumero(s!.filas.length)}
                detalle="activos del maestro"
                compacta
              />
              <TarjetaKpi
                titulo="Con oferta"
                valor={fmtNumero(s!.conOferta)}
                detalle="el resto queda a precio de lista"
                compacta
              />
              <TarjetaKpi
                titulo="Cambian de costo"
                valor={fmtNumero(s!.cambian)}
                detalle="contra lo que rige hoy"
                acento={s!.cambian ? "#f59e0b" : undefined}
                compacta
              />
              <TarjetaKpi
                titulo="Faltan en la planilla"
                valor={fmtNumero(s!.faltantes.length)}
                detalle="quedan en 0 % de oferta"
                acento={s!.faltantes.length ? "#f43f5e" : undefined}
                compacta
              />
            </div>

            <p className="text-muted mt-3 text-xs">
              Va al mes comercial <strong className="text-ink">{datos.mes}</strong>,
              vigente desde el <strong className="text-ink">{datos.vigenteDesde}</strong>.
              {datos.tramoVigente && (
                <>
                  {" "}Hoy rige el tramo del {datos.tramoVigente.vigenteDesde}
                  {datos.tramoVigente.nota ? ` — ${datos.tramoVigente.nota}` : ""}.
                </>
              )}
            </p>

            {/* BAJARLA ANTES DE APLICAR. Ocho mil filas se revisan en Excel y
                no en una pantalla: ordenar por diferencia, filtrar un
                proveedor, buscar un SKU. La pantalla muestra lo que frena; el
                archivo deja mirar todo lo demás. */}
            <div className="border-line mt-3 flex flex-wrap items-center gap-3 border-t pt-3">
              <a className={BOTON} href="/api/compras/costos/archivo">
                Bajar esta foto en Excel
              </a>
              <span className="text-muted text-xs">
                Las {fmtNumero(s!.filas.length)} filas con el costo anterior al
                lado, para revisarlas antes de aplicar.
              </span>
            </div>
          </Panel>

          {/* LO QUE FRENA. Ver el guard en lib/costos-snapshot. */}
          {s!.problemas.length > 0 && (
            <Aviso>
              <p className="font-medium">No se puede aplicar:</p>
              <ul className="mt-1 list-disc pl-5 text-xs">
                {s!.problemas.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            </Aviso>
          )}

          {s!.saltos.length > 0 && (
            <Panel
              titulo="Costos que saltaron"
              nota={`${fmtNumero(s!.saltos.length)} de golpe`}
            >
              <p className="text-muted mb-3 text-xs">
                Saltaron 50 veces o más contra el costo que rige hoy. Uno suelto
                puede ser un costo que estaba mal antes; muchos juntos es un
                archivo mal leído.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[520px] text-xs">
                  <thead>
                    <tr className="border-line text-muted border-b text-left">
                      <th className="py-2 pr-2 font-normal">Artículo</th>
                      <th className="py-2 pr-2 text-right font-normal">Antes</th>
                      <th className="py-2 pr-2 text-right font-normal">Después</th>
                      <th className="py-2 text-right font-normal">Veces</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s!.saltos.slice(0, 10).map((x) => (
                      <tr key={x.sku} className="border-line/60 border-b">
                        <td className="py-1.5 pr-2">
                          <span className="font-mono">{x.sku}</span>
                          <span className="text-muted block">{x.descripcion}</span>
                        </td>
                        <td className="py-1.5 pr-2 text-right tabular-nums">{fmtMoneda(x.antes)}</td>
                        <td className="py-1.5 pr-2 text-right tabular-nums">{fmtMoneda(x.despues)}</td>
                        <td className="py-1.5 text-right tabular-nums text-rose-300">
                          {fmtNumero(Math.round(x.veces))}x
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          )}

          {s!.sinCostoTeorico.length > 0 && (
            <Panel
              titulo="Se quedan sin costo teórico"
              nota={`${fmtNumero(s!.sinCostoTeorico.length)} artículos`}
            >
              {/* EL COSTO VIEJO NO SE PIERDE: las consultas saltean los ceros
                  y se quedan con el último tramo que tenga costo. Por eso esto
                  avisa y no frena. Pero conviene mirarlo: si Sigma dejó de
                  cotizar un artículo que se sigue comprando, el margen se
                  calcula contra un costo cada vez más viejo. */}
              <p className="text-muted mb-3 text-xs">
                Tienen costo cargado hoy, pero el maestro de Sigma no les da
                costo teórico, así que en esta foto quedan en 0. El costo
                anterior sigue rigiendo —el tablero saltea los ceros— pero si
                alguno se sigue comprando, hay que darle precio en Sigma.
              </p>
              <ul className="text-muted space-y-1 text-xs">
                {s!.sinCostoTeorico.slice(0, 20).map((x) => (
                  <li key={x.sku}>
                    <span className="text-ink font-mono">{x.sku}</span>
                    {x.descripcion ? ` · ${x.descripcion}` : ""}
                    {" · hoy "}
                    <span className="text-ink">{fmtMoneda(x.antes)}</span>
                  </li>
                ))}
              </ul>
              {s!.sinCostoTeorico.length > 20 && (
                <p className="text-muted mt-2 text-xs">
                  …y {fmtNumero(s!.sinCostoTeorico.length - 20)} más.
                </p>
              )}
            </Panel>
          )}

          {s!.faltantes.length > 0 && (
            <Panel
              titulo="No están en la planilla"
              nota={`${fmtNumero(s!.faltantes.length)} artículos`}
            >
              {/* QUEDAN EN CERO, NO AFUERA. Sin oferta se paga la lista, así
                  que el costo no queda subestimado. Pero se avisa: un artículo
                  que debería tener oferta y no está es plata que se paga de
                  más sin que nadie lo decida. */}
              <p className="text-muted mb-3 text-xs">
                Quedan a precio de lista, con 0 % de oferta. Si alguno debería
                tener descuento, agregalo al Consolidador y volvé a mandar la
                planilla antes de aplicar.
              </p>
              <ul className="text-muted space-y-1 text-xs">
                {s!.faltantes.slice(0, 20).map((f) => (
                  <li key={f.sku}>
                    <span className="text-ink font-mono">{f.sku}</span>
                    {f.proveedor ? ` · ${f.proveedor}` : ""}
                    {f.descripcion ? ` · ${f.descripcion}` : ""}
                  </li>
                ))}
              </ul>
              {s!.faltantes.length > 20 && (
                <p className="text-muted mt-2 text-xs">
                  …y {fmtNumero(s!.faltantes.length - 20)} más.
                </p>
              )}
            </Panel>
          )}

          <Panel titulo="Aplicar">
            <label className="text-muted block space-y-1 text-xs">
              <span>Qué cambia</span>
              <input
                className={`${CAMPO} w-full`}
                placeholder="Aumento de Rofina · cierre de octubre · corrección de Coty…"
                value={nota}
                onChange={(e) => setNota(e.target.value)}
                disabled={aplicando}
              />
              {/* LA NOTA NO ES DECORACION. Hoy el "qué cambió" vive en el
                  nombre del archivo y se pierde: dos meses después, mirando un
                  tramo a mitad de mes, no hay cómo saber qué fue. */}
              <span className="block">
                Es lo que va a explicar este tramo dentro de dos meses.
              </span>
            </label>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              {!confirmando ? (
                <>
                  <button
                    type="button"
                    className={sePuede ? BOTON_ACTIVO : BOTON}
                    disabled={!sePuede}
                    onClick={() => setConfirmando(true)}
                  >
                    Actualizar los costos
                  </button>
                  <button
                    type="button"
                    className={BOTON}
                    onClick={() => setRecargas((n) => n + 1)}
                    disabled={aplicando}
                  >
                    Volver a armar la foto
                  </button>
                  {!nota.trim() && s!.problemas.length === 0 && (
                    <span className="text-xs text-amber-300">
                      Escribí qué cambia para poder aplicar.
                    </span>
                  )}
                </>
              ) : (
                <>
                  <span className="text-ink text-xs">
                    Se van a reescribir{" "}
                    <strong>{fmtNumero(s!.filas.length)} costos</strong>, de los
                    que sale el margen de todo el tablero.{" "}
                    <strong>{fmtNumero(s!.cambian)}</strong> cambian de verdad.
                  </span>
                  <button
                    type="button"
                    className={BOTON_ACTIVO}
                    onClick={() => void aplicar()}
                    disabled={aplicando}
                  >
                    {aplicando ? "Aplicando…" : "Confirmo, actualizar"}
                  </button>
                  <button
                    type="button"
                    className={BOTON}
                    onClick={() => setConfirmando(false)}
                    disabled={aplicando}
                  >
                    Cancelar
                  </button>
                </>
              )}
            </div>
          </Panel>

          {/* LAS FOTOS GUARDADAS. El respaldo ya existía --`costos_historicos`
              guarda cada tramo entero y nada los borra-- y nadie lo veía.
              Acá se ven, y cada uno se baja como Excel.

              EL ARCHIVO ES EL RESPALDO QUE SIRVE: uno que vive en la misma
              base que el dato respaldado no es un respaldo. Bajado al Drive,
              sí. */}
          <Panel
            titulo="Fotos guardadas"
            nota={`${fmtNumero(datos.tramos.length)} tramos`}
          >
            <p className="text-muted mb-3 text-xs">
              Cada actualización queda guardada entera y no se pisa. Bajá la que
              quieras como Excel: trae el costo teórico, la oferta, el costo
              real y <strong className="text-ink">contra qué cambió</strong>.
            </p>
            <div className="-mx-1 overflow-x-auto">
              <table className="w-full min-w-[640px] text-xs">
                <thead>
                  <tr className="text-muted border-line border-b text-left">
                    <th className="px-1 py-1.5 font-medium">Desde</th>
                    <th className="px-1 py-1.5 font-medium">Mes</th>
                    <th className="px-1 py-1.5 font-medium">Origen</th>
                    <th className="px-1 py-1.5 text-right font-medium">Artículos</th>
                    <th className="px-1 py-1.5 font-medium">Qué cambió</th>
                    <th className="px-1 py-1.5" />
                  </tr>
                </thead>
                <tbody>
                  {datos.tramos.map((t) => (
                    <tr
                      key={`${t.mes}-${t.vigenteDesde}-${t.origen}`}
                      className="border-line/60 border-b last:border-0"
                    >
                      <td className="text-ink px-1 py-1.5 whitespace-nowrap">
                        {t.vigenteDesdeTexto}
                        {t.vigente && (
                          <span className="text-c1 ml-1.5 text-[10px]">rige hoy</span>
                        )}
                      </td>
                      <td className="text-muted px-1 py-1.5">{t.mes}</td>
                      <td className="text-muted px-1 py-1.5">
                        {t.origen === "tablero" ? "Tablero" : "Excel"}
                      </td>
                      <td className="text-ink px-1 py-1.5 text-right whitespace-nowrap">
                        {fmtNumero(t.articulos)}
                        <span className="text-muted">
                          {" "}
                          · {fmtNumero(t.conCosto)} con costo
                        </span>
                      </td>
                      <td className="text-muted px-1 py-1.5">
                        {/* LOS DEL EXCEL NO TIENEN NOTA, y eso también dice
                            algo: salieron del camino viejo, donde el motivo
                            vivía en el nombre del archivo. */}
                        {t.nota ?? (
                          <span className="text-muted/60">
                            {t.origen === "tablero" ? "—" : "vino del Excel"}
                          </span>
                        )}
                        {t.aplicadoPor && (
                          <span className="text-muted/60 block text-[10px]">
                            {t.aplicadoPor}
                            {t.aplicadoEn ? ` · ${t.aplicadoEn}` : ""}
                          </span>
                        )}
                      </td>
                      <td className="px-1 py-1.5 text-right">
                        <a className={BOTON} href={enlaceDeTramo(t)}>
                          Excel
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}
