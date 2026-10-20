"use client";

import { useState } from "react";
import EncabezadoPagina from "@/components/EncabezadoPagina";
import BarrasCategoria from "@/components/charts/BarrasCategoria";
import TortaProveedores from "@/components/charts/TortaProveedores";
import { BotonLimpiar, SelectorMultiple } from "@/components/SelectorFiltro";
import { alternar as alternarValor, vacio as sinValores } from "@/lib/filtros";
import {
  promedioPonderado,
  sumar,
  Tabla,
  type Columna,
} from "@/components/Tabla";
import {
  Aviso,
  ConAlarmaMargen,
  Esqueleto,
  Panel,
  TarjetaKpi,
} from "@/components/ui";
import {
  fmtMes,
  fmtMoneda,
  fmtMonedaCorta,
  fmtNumero,
  fmtPct,
} from "@/lib/format";
import {
  destino,
  origenDelFlete,
  repartoDelEnvio,
  resumenEmpresas,
} from "@/lib/logistica";
import { PALETA } from "@/lib/paleta";
import { useDatosTablero } from "@/lib/useDatosTablero";
import type {
  DashboardLogistica,
  FilaEnvio,
  FiltrosLogistica,
  OpcionesLogistica,
} from "@/lib/types";

type Respuesta = DashboardLogistica & { opciones: OpcionesLogistica | null };

/**
 * Cuántos envíos trae la tabla. Tiene que ser el mismo número que el `limit`
 * de `getTablaEnvios`: acá sólo decide qué dice la etiqueta del total, y si se
 * desfasara diría "Total" sobre una tabla recortada -- o al revés.
 */
const TOPE_ENVIOS = 100;

const ESTILO_ORIGEN = {
  real: "border-emerald-500/40 text-emerald-300",
  mixto: "border-amber-500/40 text-amber-300",
  estimado: "border-rose-500/40 text-rose-300",
} as const;

function ChipOrigen({
  fila,
}: {
  fila: { lineasReales: string; lineasTotales: string };
}) {
  const o = origenDelFlete(fila);
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[11px] whitespace-nowrap ${ESTILO_ORIGEN[o.clave]}`}
      title={
        o.clave === "real"
          ? "Factura del transportista cargada"
          : o.clave === "mixto"
            ? "Parte con factura del transportista, parte prorrateada al 5%"
            : "Prorrateo al 5% de la facturación: todavía sin factura del transportista"
      }
    >
      {o.texto}
    </span>
  );
}

/**
 * EL REPARTO DEL FLETE DE UN ENVIO entre los comprobantes que viajaron en él.
 *
 * Es el detalle que se abre al clickear la flecha, y es lo que esta tabla venía
 * a contestar: el transportista facturó UN número por la preparación, y acá
 * está a dónde fue a parar cada peso de ese número.
 */
function RepartoDelFlete({ envio }: { envio: FilaEnvio }) {
  const filas = repartoDelEnvio(envio);

  if (filas.length === 0) {
    return (
      <p className="text-muted text-xs">
        Este envío no tiene comprobantes asociados.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-muted text-[11px]">
        Los <strong className="text-ink">{fmtMoneda(envio.flete)}</strong> de
        flete de la preparación {envio.preparacionId}, repartidos entre{" "}
        {filas.length === 1
          ? "el comprobante que viajó en ella"
          : `los ${fmtNumero(filas.length)} comprobantes que viajaron en ella`}
        .
      </p>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-muted text-left">
            <th className="py-1 pr-3 font-medium">Comprobante</th>
            <th className="py-1 pr-3 font-medium">Empresa</th>
            <th className="py-1 pr-3 text-right font-medium">Facturación</th>
            <th className="py-1 pr-3 text-right font-medium">Flete</th>
            <th
              className="py-1 pr-3 text-right font-medium"
              title="Qué parte del flete de este envío se llevó el comprobante. Suman 100%."
            >
              % del envío
            </th>
            <th
              className="py-1 text-right font-medium"
              title="Cuánto pesa ese flete sobre lo que facturó el comprobante."
            >
              % s/ su facturación
            </th>
          </tr>
        </thead>
        <tbody>
          {filas.map((c) => (
            <tr key={c.comprobante ?? "—"} className="border-line border-t">
              <td className="py-1 pr-3 font-mono">{c.comprobante ?? "—"}</td>
              <td className="text-muted py-1 pr-3">{c.empresa ?? "—"}</td>
              <td className="py-1 pr-3 text-right tabular-nums">
                {fmtMoneda(c.facturacion)}
              </td>
              <td className="py-1 pr-3 text-right tabular-nums">
                {fmtMoneda(c.flete)}
              </td>
              <td className="py-1 pr-3 text-right tabular-nums">
                {fmtPct(c.reparto)}
              </td>
              <td className="py-1 text-right tabular-nums">
                {fmtPct(c.pctFlete)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function columnas(filas: FilaEnvio[]): Columna<FilaEnvio>[] {
  return [
    {
      titulo: "Preparación",
      ayuda:
        "El número de preparación del envío. Es el grano en el que el transportista factura, y por eso la tabla va por acá y no por comprobante.",
      celda: (f) => <span className="font-mono">{f.preparacionId}</span>,
      orden: (f) => f.preparacionId,
    },
    { titulo: "Fecha", celda: (f) => f.fecha ?? "—", orden: (f) => f.fecha },
    {
      titulo: "Cliente",
      ayuda:
        "El cliente del envío. El buscador de arriba también pega contra su CUIT.",
      celda: (f) => (
        <span
          className="block max-w-[140px] truncate sm:max-w-[240px]"
          title={[f.cliente, f.documento].filter(Boolean).join(" · ")}
        >
          {f.cliente ?? "—"}
        </span>
      ),
      orden: (f) => f.cliente,
    },
    {
      titulo: "Destino",
      celda: (f) => (
        <span className="block max-w-[140px] truncate sm:max-w-[220px]">
          {destino(f)}
        </span>
      ),
      orden: (f) => f.provincia,
    },
    {
      titulo: "Transporte",
      celda: (f) => (
        <span className="block max-w-[120px] truncate sm:max-w-[180px]">
          {f.transporte ?? "—"}
        </span>
      ),
      orden: (f) => f.transporte,
    },
    {
      titulo: "Empresa",
      ayuda:
        "Quién facturó. Un mismo envío puede llevar comprobantes de Quo y de Noa a la vez; cuáles son está en el detalle.",
      celda: (f) => (
        <span className="block max-w-[120px] truncate sm:max-w-[200px]">
          {resumenEmpresas(f.empresas)}
        </span>
      ),
      orden: (f) => resumenEmpresas(f.empresas),
    },
    {
      titulo: "Comprobantes",
      ayuda: "Cuántos comprobantes viajaron en este envío. Abrí la fila para verlos.",
      celda: (f) => fmtNumero(f.comprobantes.length),
      numerica: true,
      orden: (f) => f.comprobantes.length,
    },
    {
      titulo: "Facturación",
      ayuda: "Venta neta de todo lo que viajó en el envío, sin IVA.",
      celda: (f) => fmtMoneda(f.facturacion),
      numerica: true,
      orden: (f) => f.facturacion,
      total: fmtMoneda(sumar(filas, (f) => f.facturacion)),
    },
    {
      titulo: "Flete",
      ayuda:
        "Lo que costó el envío. Puede ser real (factura del transportista cargada) o estimado; lo dice la columna Origen.",
      celda: (f) => fmtMoneda(f.flete),
      numerica: true,
      orden: (f) => f.flete,
      total: fmtMoneda(sumar(filas, (f) => f.flete)),
    },
    {
      titulo: "% Flete",
      ayuda: "Cuánto pesa el flete sobre lo que se facturó en ese envío.",
      celda: (f) => fmtPct(f.pctFlete),
      numerica: true,
      orden: (f) => f.pctFlete,
      // Flete total sobre facturación total. El promedio simple de los
      // porcentajes daría otro número: un envío chico con un flete caro
      // pesaría igual que uno de un millón.
      total: fmtPct(
        promedioPonderado(
          filas,
          (f) => f.flete,
          (f) => f.facturacion,
        ),
      ),
    },
    {
      titulo: "Kg",
      ayuda:
        "Kilos del envío. Salen del reporte de logística, que los lleva a nivel preparación: por eso esta columna existe acá y no existía en la tabla por comprobante.",
      celda: (f) => (f.kg == null ? "—" : fmtNumero(f.kg)),
      numerica: true,
      orden: (f) => f.kg,
      total: fmtNumero(sumar(filas, (f) => f.kg ?? 0)),
    },
    {
      titulo: "Origen",
      ayuda:
        "Si el flete es la factura real del transportista o una estimación al 5%. Un envío con renglones de los dos tipos aparece como mezcla.",
      celda: (f) => <ChipOrigen fila={f} />,
      // Ordena por qué tan cargado está: primero lo estimado, que es lo que
      // hay que ir a buscar a la planilla de logística.
      orden: (f) => origenDelFlete(f).peso,
      total: (() => {
        const cuenta = filas.filter(
          (f) => origenDelFlete(f).clave !== "real",
        ).length;
        return cuenta === 0 ? "todo real" : `${fmtNumero(cuenta)} sin factura`;
      })(),
    },
  ];
}

export default function DashboardLogisticaPage() {
  const [filtros, setFiltros] = useState<FiltrosLogistica>({});
  // Lo tipeado, que todavía no se confirmó. Ver el campo más abajo.
  const [buscado, setBuscado] = useState("");

  const { data, cargando, error, recargar, empezarCarga } =
    useDatosTablero<Respuesta>(
      "/api/logistica",
      filtros as Record<string, string | undefined>,
      { conOpciones: "1" },
    );

  // Mientras recarga se conserva el `data` anterior, así que los selectores
  // nunca se quedan vacíos entre consultas.
  const opciones = data?.opciones ?? null;

  const cambiar = (f: FiltrosLogistica) => {
    empezarCarga();
    setFiltros(f);
  };

  /** Click en un gráfico: suma ese valor a la selección, o lo saca. */
  const alternar = (campo: "proveedor" | "provincia") => (valor: string) =>
    cambiar({ ...filtros, [campo]: alternarValor(filtros[campo], valor) });

  const k = data?.kpis;
  const vacio =
    sinValores(filtros.vendedor) &&
    sinValores(filtros.empresa) &&
    sinValores(filtros.mes) &&
    sinValores(filtros.transporte) &&
    sinValores(filtros.provincia) &&
    sinValores(filtros.estadoFlete) &&
    sinValores(filtros.proveedor) &&
    !filtros.buscar;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <EncabezadoPagina pagina="logistica">
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

      <div className="border-line bg-panel flex flex-wrap items-end gap-3 rounded-xl border p-3">
        <SelectorMultiple
          etiqueta="Vendedor"
          valores={filtros.vendedor}
          opciones={opciones?.vendedores ?? []}
          onChange={(v) => cambiar({ ...filtros, vendedor: v })}
        />
        <SelectorMultiple
          etiqueta="Empresa"
          valores={filtros.empresa}
          opciones={opciones?.empresas ?? []}
          onChange={(v) => cambiar({ ...filtros, empresa: v })}
        />
        <SelectorMultiple
          etiqueta="Mes comercial"
          valores={filtros.mes}
          opciones={opciones?.meses ?? []}
          onChange={(v) => cambiar({ ...filtros, mes: v })}
          formato={fmtMes}
        />
        <SelectorMultiple
          etiqueta="Transporte"
          valores={filtros.transporte}
          opciones={opciones?.transportes ?? []}
          onChange={(v) => cambiar({ ...filtros, transporte: v })}
        />
        <SelectorMultiple
          etiqueta="Provincia"
          valores={filtros.provincia}
          opciones={opciones?.provincias ?? []}
          onChange={(v) => cambiar({ ...filtros, provincia: v })}
        />
        <SelectorMultiple
          etiqueta="Estado flete"
          valores={filtros.estadoFlete}
          opciones={[
            ["real", "Real"],
            ["estimado", "Estimado"],
          ]}
          onChange={(v) => cambiar({ ...filtros, estadoFlete: v })}
        />
        {/* EL BUSCADOR CONFIRMA AL SALIR DEL CAMPO, no en cada tecla: cada
            cambio dispara el juego completo de consultas de la página, y
            escribir "NETFARMA" serían ocho pasadas por la base para ver la
            última. */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            cambiar({ ...filtros, buscar: buscado.trim() || undefined });
          }}
          className="flex flex-col gap-1"
        >
          <label className="text-muted text-[11px]" htmlFor="buscar-logistica">
            Buscar
          </label>
          <input
            id="buscar-logistica"
            value={buscado}
            onChange={(e) => setBuscado(e.target.value)}
            onBlur={() =>
              cambiar({ ...filtros, buscar: buscado.trim() || undefined })
            }
            placeholder="Cliente, CUIT, comprobante, preparación o pedido"
            title="Pega contra el nombre del cliente, su CUIT (con o sin guiones), el comprobante, el número de preparación y el de pedido."
            className="border-line bg-panel-2 text-ink placeholder:text-muted focus:border-c1 w-64 rounded-lg border px-2.5 py-1.5 text-xs outline-none"
          />
        </form>

        <BotonLimpiar
          onClick={() => {
            setBuscado("");
            cambiar({});
          }}
          deshabilitado={vacio}
        />

        <span className="text-muted ml-auto max-w-sm text-[11px] leading-tight">
          Solo envíos con provincia cargada, igual que el filtro de página del
          tablero de Power BI.
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
        <ConAlarmaMargen activa={k.margenAjustado < 0}>
          <div
            className={`grid grid-cols-2 gap-3 transition-opacity sm:grid-cols-2 lg:grid-cols-4 ${cargando ? "opacity-50" : ""}`}
          >
            <TarjetaKpi
              titulo="Cantidad de Envíos"
              valor={fmtNumero(k.cantidadEnvios)}
              acento={PALETA[0]}
            />
            <TarjetaKpi titulo="Kg Totales" valor={fmtNumero(k.kgTotales)} />
            <TarjetaKpi
              titulo="Flete Total"
              valor={fmtMoneda(k.fleteTotal)}
              detalle={`Real ${fmtMoneda(k.fleteRealFiltrado)} · Estimado ${fmtMoneda(k.fleteEstimadoFiltrado)}`}
              acento={PALETA[4]}
            />
            <TarjetaKpi
              titulo="Costo por Kg"
              valor={fmtMoneda(k.costoPorKg)}
              detalle="Flete total / kg"
              acento={PALETA[2]}
            />
            <TarjetaKpi
              titulo="% Líneas con Flete Real"
              valor={fmtPct(k.pctLineasFleteReal)}
              detalle="El resto es prorrateo"
            />
            <TarjetaKpi
              titulo="% Flete sobre Facturación"
              valor={fmtPct(k.pctFleteSobreFacturacion)}
              acento={PALETA[3]}
            />
            <TarjetaKpi
              titulo="Facturación Neta (sin IVA)"
              valor={fmtMoneda(k.facturacionNeta)}
              detalle="Solo líneas con envío"
            />
            <TarjetaKpi
              titulo="% Rentabilidad Ajustada"
              valor={fmtPct(k.rentabilidadAjustadaPct)}
              detalle={`Margen ajustado ${fmtMoneda(k.margenAjustado)}`}
              acento={PALETA[1]}
            />
          </div>
        </ConAlarmaMargen>
      ) : null}

      {data && (
        <div
          className={`space-y-4 transition-opacity ${cargando ? "opacity-50" : ""}`}
        >
          <div className="grid gap-4 xl:grid-cols-2">
            <Panel titulo="Unidades por proveedor" nota="Top 12">
              <TortaProveedores
                datos={data.unidadesPorProveedor.map((d) => ({
                  label: d.label,
                  total: d.valor,
                }))}
                totalGeneral={data.totalesProveedor.unidades}
                seleccionados={filtros.proveedor}
                onSeleccionar={alternar("proveedor")}
              />
            </Panel>
            <Panel titulo="Flete por proveedor" nota="Top 12">
              <TortaProveedores
                datos={data.fletePorProveedor.map((d) => ({
                  label: d.label,
                  total: d.valor,
                }))}
                totalGeneral={data.totalesProveedor.flete}
                seleccionados={filtros.proveedor}
                onSeleccionar={alternar("proveedor")}
              />
            </Panel>
            <Panel
              titulo="Margen por proveedor"
              nota="Ajustado según el flete elegido arriba"
            >
              <BarrasCategoria
                datos={data.margenPorProveedor}
                formato={fmtMonedaCorta}
                colorUnico={PALETA[1]}
                seleccionados={filtros.proveedor}
                onSeleccionar={alternar("proveedor")}
              />
            </Panel>
            <Panel
              titulo="% Flete sobre facturación por provincia"
              nota="Top 15"
            >
              <BarrasCategoria
                datos={data.pctFletePorProvincia}
                formato={(n) => fmtPct(n)}
                colorUnico={PALETA[2]}
                seleccionados={filtros.provincia}
                onSeleccionar={alternar("provincia")}
              />
            </Panel>
          </div>

          <Panel
            titulo="Envíos"
            nota={
              data.envios.length >= TOPE_ENVIOS
                ? `${fmtNumero(TOPE_ENVIOS)} de mayor flete`
                : `${fmtNumero(data.envios.length)} envíos`
            }
          >
            {/* LA TABLA VA POR ENVIO Y NO POR COMPROBANTE, que es el cambio.
                El flete se PAGA por preparación y se COBRA por comprobante: con
                una fila por comprobante, un envío partido en cinco facturas se
                veía como cinco fletes sueltos y lo que salió el envío no estaba
                en ningún lado. Ahora el reparto es el detalle de la fila. */}
            <Tabla
              filas={data.envios}
              columnas={columnas(data.envios)}
              clave={(f) => f.preparacionId}
              fijas={1}
              // La tabla trae los 100 de mayor flete. Cuando llegan menos
              // de 100 no hay recorte, y decir "los 100" daría a entender que
              // falta algo; cuando sí hay, callarlo daría a entender que ese es
              // el total de todo.
              etiquetaTotal={
                data.envios.length >= TOPE_ENVIOS
                  ? `Total de los ${fmtNumero(TOPE_ENVIOS)} de mayor flete`
                  : "Total"
              }
              expandir={(f) => <RepartoDelFlete envio={f} />}
              onClickFila={(f) =>
                f.provincia && alternar("provincia")(f.provincia)
              }
              activa={(f) =>
                filtros.provincia?.length
                  ? filtros.provincia.includes(f.provincia ?? "")
                  : false
              }
            />
          </Panel>
        </div>
      )}
    </div>
  );
}
