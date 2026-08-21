"use client";

import { useState } from "react";
import BarrasCategoria from "@/components/charts/BarrasCategoria";
import { BotonLimpiar, SelectorMultiple } from "@/components/SelectorFiltro";
import { Tabla, type Columna } from "@/components/Tabla";
import { Aviso, Esqueleto, Panel, TarjetaKpi } from "@/components/ui";
import {
  BANDAS,
  PASOS_PREVIOS,
  UDS_MINIMAS_SKU,
  labelBanda,
} from "@/lib/elasticidad";
import { vacio as sinValores } from "@/lib/filtros";
import { fmtMoneda, fmtMonedaCorta, fmtNumero, fmtPct } from "@/lib/format";
import { PALETA, TEMA } from "@/lib/paleta";
import { useDatosTablero } from "@/lib/useDatosTablero";
import type {
  DashboardElasticidad,
  FilaElasticidad,
  FiltrosElasticidad,
  ResumenBanda,
} from "@/lib/types";

type Opciones = { proveedores: string[]; marcas: string[] };
type Respuesta = DashboardElasticidad & { opciones: Opciones | null };

/** Un color fijo por banda, el mismo en los dos gráficos y en la tabla. */
const COLOR_BANDA: Record<string, string> = {
  "10-18": PALETA[0],
  "18-25": PALETA[1],
  "25-35": PALETA[3],
};

/** Tasa por día: dos decimales. La mediana del catálogo es 0,58 uds/semana, así
 *  que con cero decimales la mitad de los artículos se mostraría como "0". */
const fmtTasa = (n: number | null | undefined): string =>
  n == null || !Number.isFinite(n) ? "—" : n.toFixed(2);

/**
 * La banda ganadora del agregado: la de mayor margen por día a la venta.
 *
 * Se elige por margen y no por unidades a propósito. Bajando el markup se vende
 * más siempre; la pregunta del negocio no es cuánto se vende sino cuánto queda,
 * y ese máximo es el punto de equilibrio que el experimento busca.
 */
function ganadora(bandas: ResumenBanda[]): ResumenBanda | null {
  const medidas = bandas.filter((b) => b.margenPorDia != null);
  if (medidas.length < 2) return null;
  return medidas.reduce((a, b) => (b.margenPorDia! > a.margenPorDia! ? b : a));
}

function columnasBanda(): Columna<ResumenBanda>[] {
  return [
    {
      titulo: "Banda de markup",
      celda: (b) => (
        <span style={{ color: COLOR_BANDA[b.banda] }}>{labelBanda(b.banda)}</span>
      ),
      orden: (b) => b.banda,
    },
    {
      titulo: "Markup real",
      // El markup que se APLICÓ, que no es el de la banda: el repricer sigue al
      // competidor, así que dentro de 25-35 % el número real se mueve. Si esta
      // columna se aleja mucho de su banda, el experimento no midió lo que dice.
      celda: (b) => fmtPct(b.markupRealizado),
      numerica: true,
      orden: (b) => b.markupRealizado,
    },
    {
      titulo: "Margen / día a la venta",
      celda: (b) => (
        <strong style={{ color: COLOR_BANDA[b.banda] }}>
          {b.margenPorDia == null ? "—" : fmtMoneda(b.margenPorDia)}
        </strong>
      ),
      numerica: true,
      orden: (b) => b.margenPorDia,
    },
    {
      titulo: "Uds / día a la venta",
      celda: (b) => fmtTasa(b.udsPorDia),
      numerica: true,
      orden: (b) => b.udsPorDia,
    },
    {
      titulo: "Días a la venta",
      celda: (b) => fmtNumero(Math.round(b.horasVendible / 24)),
      numerica: true,
      orden: (b) => b.horasVendible,
    },
    {
      titulo: "Perdido por quiebre",
      // Puesto al lado de la tasa a propósito: es el recordatorio de que el
      // denominador NO es la semana. Si esta columna es alta, la diferencia
      // entre bandas medida en unidades crudas no significaría nada.
      celda: (b) => {
        const obs = b.horasVentana - b.horasSinDato;
        return (
          <span style={b.horasSinStock > 0 ? { color: TEMA.negativo } : undefined}>
            {obs > 0 ? fmtPct(b.horasSinStock / obs) : "—"}
          </span>
        );
      },
      numerica: true,
      orden: (b) => (b.horasVentana > 0 ? b.horasSinStock / b.horasVentana : null),
    },
    {
      titulo: "Ganando la caja",
      celda: (b) => (b.ganandoBb == null ? "—" : fmtPct(b.ganandoBb)),
      numerica: true,
      orden: (b) => b.ganandoBb,
    },
    {
      titulo: "SKU · semanas",
      celda: (b) => `${fmtNumero(b.skus)} · ${fmtNumero(b.skuSemanas)}`,
      numerica: true,
      orden: (b) => b.skuSemanas,
    },
  ];
}

function columnasSku(): Columna<FilaElasticidad>[] {
  return [
    { titulo: "SKU", celda: (f) => f.sku, orden: (f) => f.sku },
    {
      titulo: "Producto",
      celda: (f) => (
        <span className="block max-w-[260px] truncate" title={f.producto ?? undefined}>
          {f.producto ?? "—"}
        </span>
      ),
      orden: (f) => f.producto,
    },
    {
      titulo: "Uds",
      celda: (f) => fmtNumero(f.unidades),
      numerica: true,
      orden: (f) => f.unidades,
    },
    // Una columna por banda, con el margen por día que rindió cada una. Puestas
    // al lado se lee de un vistazo si el artículo responde al precio o no.
    ...BANDAS.map(
      (banda): Columna<FilaElasticidad> => ({
        titulo: banda.label,
        celda: (f) => {
          const valor = f.porBanda[banda.clave];
          if (valor == null) return <span className="text-muted">—</span>;
          const gana = f.mejor === banda.clave;
          return (
            <span
              style={gana ? { color: COLOR_BANDA[banda.clave], fontWeight: 600 } : undefined}
              title={`${fmtTasa(f.udsPorBanda[banda.clave])} uds/día a la venta`}
            >
              {fmtMonedaCorta(valor)}
            </span>
          );
        },
        numerica: true,
        orden: (f) => f.porBanda[banda.clave] ?? null,
      }),
    ),
    {
      titulo: "Mejor",
      celda: (f) =>
        f.mejor == null ? (
          <span className="text-muted">sin comparar</span>
        ) : (
          <span style={{ color: COLOR_BANDA[f.mejor] }}>{labelBanda(f.mejor)}</span>
        ),
      orden: (f) => f.mejor,
    },
    {
      titulo: "Se puede leer solo",
      // La columna más importante de esta tabla, y la que más incomoda. Con la
      // mediana del catálogo en 0,58 unidades por semana, para la mayoría de
      // los artículos la "mejor banda" es el resultado de un tiro de dados.
      celda: (f) =>
        f.confiable ? (
          <span style={{ color: PALETA[1] }}>sí</span>
        ) : (
          <span className="text-muted" title={`Necesita ${UDS_MINIMAS_SKU} unidades y al menos dos bandas medidas`}>
            no — poco volumen
          </span>
        ),
      orden: (f) => (f.confiable ? 1 : 0),
    },
  ];
}

/** Lo que hay que hacer antes de que esta pantalla tenga algo que mostrar. */
function TodaviaNo({ falta }: { falta: string | null }) {
  const indice = PASOS_PREVIOS.findIndex((p) => p.clave === falta);
  return (
    <Aviso tono="info">
      <p className="font-medium">El experimento todavía no tiene datos que leer.</p>
      <p className="mt-1">
        Esta pantalla queda vacía a propósito en vez de mostrar todo en cero: un tablero
        lleno de ceros se lee como &ldquo;no vendimos nada&rdquo;, que sería una conclusión
        falsa y bastante grave. Lo que pasa es otra cosa —el experimento no arrancó—, y
        estos son los pasos:
      </p>
      <ol className="mt-3 space-y-2">
        {PASOS_PREVIOS.map((paso, i) => (
          <li key={paso.clave} className="flex gap-2">
            <span
              className="mt-0.5 shrink-0 tabular-nums"
              style={{ color: i === indice ? PALETA[2] : undefined }}
            >
              {i < indice ? "✓" : `${i + 1}.`}
            </span>
            <span>
              <strong style={{ color: i === indice ? PALETA[2] : undefined }}>
                {paso.titulo}
              </strong>
              <span className="block text-xs opacity-80">{paso.detalle}</span>
            </span>
          </li>
        ))}
      </ol>
    </Aviso>
  );
}

export default function DashboardElasticidadPage() {
  const inicial: FiltrosElasticidad = {};
  const [filtros, setFiltros] = useState<FiltrosElasticidad>(inicial);

  const { data, cargando, error, recargar, empezarCarga } = useDatosTablero<Respuesta>(
    "/api/elasticidad",
    {
      proveedor: filtros.proveedor,
      marca: filtros.marca,
      soloConfiables: filtros.soloConfiables ? ["1"] : undefined,
    },
    { conOpciones: "1" },
  );

  const cambiar = (f: FiltrosElasticidad) => {
    empezarCarga();
    setFiltros(f);
  };

  const k = data?.kpis;
  const mejor = data?.bandas ? ganadora(data.bandas) : null;
  const sinCambios =
    sinValores(filtros.proveedor) && sinValores(filtros.marca) && !filtros.soloConfiables;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          {/* h2 y no h1: el h1 de la página es el logo, que vive en el layout. */}
          <h2 className="text-lg font-semibold tracking-tight">
            Elasticidad de precios{" "}
            <span className="text-muted text-sm font-normal">· experimento de markup</span>
          </h2>
          <p className="text-muted mt-1 text-xs">
            {data?.desde
              ? `${data.desde}${data.hasta ? ` a ${data.hasta}` : ""}${data.experimento ? ` · ${data.experimento}` : ""}`
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

      <div className="border-line bg-panel flex flex-col gap-3 rounded-xl border p-3">
        <div className="flex flex-wrap items-end gap-3">
          <SelectorMultiple
            etiqueta="Proveedor"
            valores={filtros.proveedor}
            opciones={data?.opciones?.proveedores ?? []}
            onChange={(v) => cambiar({ ...filtros, proveedor: v })}
          />
          <SelectorMultiple
            etiqueta="Marca"
            valores={filtros.marca}
            opciones={data?.opciones?.marcas ?? []}
            onChange={(v) => cambiar({ ...filtros, marca: v })}
          />
          <button
            type="button"
            onClick={() => cambiar({ ...filtros, soloConfiables: !filtros.soloConfiables })}
            aria-pressed={Boolean(filtros.soloConfiables)}
            className={`rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${
              filtros.soloConfiables
                ? "border-c1 bg-c1/15 text-c1"
                : "border-line text-muted hover:bg-panel-2 hover:text-ink"
            }`}
          >
            Solo los que se pueden leer solos
          </button>
          <BotonLimpiar onClick={() => cambiar(inicial)} deshabilitado={sinCambios} />
        </div>

        <span className="text-muted text-[11px] leading-tight">
          Todo se mide <strong>por día realmente a la venta</strong>, no por semana de
          calendario. Un artículo que quebró stock el martes no vendió menos por caro: no
          estuvo a la venta, y dividir por la semana entera le echaría la culpa al precio.
        </span>
      </div>

      {error && (
        <Aviso>
          <p className="font-medium">No se pudieron leer los datos.</p>
          <p className="mt-1 font-mono text-xs break-words opacity-80">{error}</p>
        </Aviso>
      )}

      {!error && cargando && !data && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Esqueleto key={i} className="h-[86px]" />
          ))}
        </div>
      )}

      {!error && data && !data.hayDatos && <TodaviaNo falta={data.falta} />}

      {!error && data?.hayDatos && k && (
        <div className={`space-y-4 transition-opacity ${cargando ? "opacity-50" : ""}`}>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {/* La respuesta, arriba de todo y en una sola tarjeta. */}
            <TarjetaKpi
              titulo="Mejor banda de markup"
              valor={mejor ? labelBanda(mejor.banda) : "—"}
              detalle={
                mejor
                  ? `${fmtMoneda(mejor.margenPorDia)} de margen por día a la venta · markup real ${fmtPct(mejor.markupRealizado)}`
                  : "Hacen falta al menos dos bandas medidas"
              }
              acento={mejor ? COLOR_BANDA[mejor.banda] : undefined}
            />
            {/* Y al lado, cuánto hay que creerle. */}
            <TarjetaKpi
              titulo="Cobertura del pulso"
              valor={fmtPct(k.cobertura)}
              detalle="Horas del experimento que se llegaron a observar. Lo que falta no es ni venta ni quiebre: es no saber."
              acento={
                k.cobertura != null && k.cobertura < 0.9 ? TEMA.negativo : undefined
              }
            />
            <TarjetaKpi
              titulo="Tiempo a la venta"
              valor={fmtPct(k.disponibilidad)}
              detalle={`${fmtPct(k.quiebre)} del tiempo observado se perdió por quiebre de stock`}
              acento={
                k.quiebre != null && k.quiebre > 0.3 ? TEMA.negativo : undefined
              }
            />
            <TarjetaKpi
              titulo="Base de la medición"
              valor={`${fmtNumero(k.skus)} SKU`}
              detalle={`${fmtNumero(k.semanasMedidas)} SKU-semana legibles · ${fmtNumero(k.unidades)} unidades`}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel
              titulo="Margen por día a la venta"
              nota="La respuesta del experimento · su máximo es el markup buscado"
            >
              <BarrasCategoria
                datos={data.bandas
                  .filter((b) => b.margenPorDia != null)
                  .map((b) => ({ label: labelBanda(b.banda), valor: b.margenPorDia! }))}
                formato={fmtMonedaCorta}
                horizontal={false}
                colorUnico={PALETA[1]}
                alturaMinima={240}
                vacio="Todavía no hay bandas medidas."
              />
            </Panel>

            <Panel
              titulo="Unidades por día a la venta"
              nota="Sube al bajar el markup · por eso sola no alcanza"
            >
              <BarrasCategoria
                datos={data.bandas
                  .filter((b) => b.udsPorDia != null)
                  .map((b) => ({ label: labelBanda(b.banda), valor: b.udsPorDia! }))}
                formato={fmtTasa}
                horizontal={false}
                colorUnico={PALETA[0]}
                alturaMinima={240}
                vacio="Todavía no hay bandas medidas."
              />
            </Panel>
          </div>

          <Panel
            titulo="Las tres bandas, en detalle"
            nota="Markup real, no el de la banda · el denominador es el tiempo a la venta"
          >
            <Tabla
              filas={data.bandas}
              columnas={columnasBanda()}
              clave={(b) => b.banda}
              vacio="Sin bandas medidas todavía."
            />
          </Panel>

          <Panel
            titulo="Artículo por artículo"
            nota={
              (data.recortada
                ? `Los ${data.filas.length} de mayor volumen`
                : `${fmtNumero(data.filas.length)} artículos`) +
              " · margen por día a la venta en cada banda"
            }
          >
            <Tabla
              filas={data.filas}
              columnas={columnasSku()}
              clave={(f) => f.sku}
              vacio="Ningún artículo con semanas legibles para el filtro elegido."
            />
          </Panel>

          {/* Lo que este tablero NO puede contestar, dicho en la pantalla y no
              en un README que nadie abre. Es la diferencia entre una política
              de markup y una superstición. */}
          <Aviso tono="info">
            <p className="font-medium">Qué se puede concluir de esto, y qué no.</p>
            <p className="mt-1">
              <strong>Sí:</strong> cuál es la mejor banda a nivel agregado y por segmento
              —proveedor, marca, rango de precio—. Ahí hay miles de unidades y el cuadrado
              latino hace que el efecto de la semana no se confunda con el de la banda.
            </p>
            <p className="mt-1">
              <strong>No:</strong> &ldquo;el markup exacto de cada producto&rdquo;. La
              mediana de los artículos del experimento vende <strong>0,58 unidades por
              semana</strong>, y el 58 % vende menos de una. Para esos, la diferencia entre
              markup 10 % y 35 % es indistinguible del azar: entre vender 0 y vender 1 no
              hay señal. Sólo las filas marcadas <em>&ldquo;se puede leer solo&rdquo;</em>
              —al menos {UDS_MINIMAS_SKU} unidades y dos bandas medidas— tienen evidencia
              propia.
            </p>
            <p className="mt-1">
              La conclusión útil de tres semanas es una <strong>política de markup por
              segmento</strong>, más una lista corta de artículos con volumen propio. Para
              el resto hace falta dejar el experimento corriendo más tiempo.
            </p>
          </Aviso>
        </div>
      )}
    </div>
  );
}
