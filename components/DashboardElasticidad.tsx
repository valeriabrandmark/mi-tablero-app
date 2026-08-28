"use client";

import { useState } from "react";
import BarrasCategoria from "@/components/charts/BarrasCategoria";
import { BotonLimpiar, SelectorMultiple } from "@/components/SelectorFiltro";
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
  BANDAS,
  BANDAS_EXPERIMENTO,
  EMPATE_TECNICO,
  PASOS_PREVIOS,
  UDS_MINIMAS_SKU,
  labelBanda,
  mejorBanda,
} from "@/lib/elasticidad";
import { alternar as alternarValor, vacio as sinValores } from "@/lib/filtros";
import {
  fmtFechaCorta,
  fmtMoneda,
  fmtMonedaCorta,
  fmtNumero,
  fmtPct,
} from "@/lib/format";
import { PALETA, TEMA } from "@/lib/paleta";
import { hoyArgentina, sumarDias } from "@/lib/rangos";
import { useDatosTablero } from "@/lib/useDatosTablero";
import type {
  DashboardElasticidad,
  FilaElasticidad,
  FiltrosElasticidad,
  ResumenBanda,
} from "@/lib/types";

type Opciones = { proveedores: string[]; marcas: string[] };
type Respuesta = DashboardElasticidad & { opciones: Opciones | null };

/**
 * Un color por banda. Los dos bordes van en gris: no son del experimento, están
 * para que los totales cierren, y pintarlos igual que las tres invitaría a
 * compararlos como si fueran una opción más.
 */
const COLOR_BANDA: Record<string, string> = {
  "<10": TEMA.muted,
  "10-18": PALETA[0],
  "18-25": PALETA[1],
  "25-35": PALETA[3],
  ">35": TEMA.muted,
};

const ATAJOS = [
  { label: "7 días", dias: 7 },
  { label: "30 días", dias: 30 },
  { label: "90 días", dias: 90 },
];

/**
 * La banda que ganó en MÁS ARTÍCULOS, no la que sumó más margen.
 *
 * ES UNA DISTINCIÓN QUE CAMBIA LA RESPUESTA, no un matiz. Sobre 30 días de
 * datos reales, la banda 25-35 % suma más margen Y más unidades que la 10-18 %
 * — que es lo contrario de lo que uno esperaría del precio. No es que subir el
 * precio venda más: es que los artículos que sostienen un margen del 30 % son
 * OTROS PRODUCTOS, con más demanda o menos competencia. El agregado compara
 * artículos distintos entre sí y confunde "qué margen" con "qué producto".
 *
 * Contar en cuántos artículos ganó cada banda compara a cada uno CONSIGO MISMO
 * —el mismo producto vendido a dos márgenes distintos— y eso sí aísla el efecto
 * del precio. Es la única lectura que contesta la pregunta del experimento.
 */
function ganadoraPorArticulo(votos: Record<string, number>): string | null {
  const conVotos = BANDAS_EXPERIMENTO.filter((b) => (votos[b.clave] ?? 0) > 0);
  if (conVotos.length === 0) return null;
  return conVotos.reduce((a, b) =>
    (votos[b.clave] ?? 0) > (votos[a.clave] ?? 0) ? b : a,
  ).clave;
}

/** La banda que más margen sumó. Se muestra al lado, con su advertencia. */
function ganadoraPorMargen(bandas: ResumenBanda[]): ResumenBanda | null {
  const porBanda = Object.fromEntries(
    bandas
      .filter((b) => b.delExperimento && b.unidades > 0)
      .map((b) => [b.banda, b.margen]),
  );
  const clave = mejorBanda(porBanda);
  return clave ? (bandas.find((b) => b.banda === clave) ?? null) : null;
}

function columnasBanda(bandas: ResumenBanda[]): Columna<ResumenBanda>[] {
  return [
    {
      titulo: "%margen bruto de la venta",
      celda: (b) => (
        <span style={{ color: COLOR_BANDA[b.banda] }}>
          {labelBanda(b.banda)}
          {!b.delExperimento && (
            <span className="text-muted text-[10px]"> · fuera del rango</span>
          )}
        </span>
      ),
      orden: (b) => BANDAS.findIndex((x) => x.clave === b.banda),
    },
    {
      titulo: "Unidades",
      celda: (b) => fmtNumero(b.unidades),
      numerica: true,
      orden: (b) => b.unidades,
      total: fmtNumero(sumar(bandas, (b) => b.unidades)),
    },
    {
      titulo: "Margen bruto $",
      celda: (b) => (
        <strong style={{ color: COLOR_BANDA[b.banda] }}>
          {fmtMoneda(b.margen)}
        </strong>
      ),
      numerica: true,
      orden: (b) => b.margen,
      total: fmtMoneda(sumar(bandas, (b) => b.margen)),
    },
    {
      // El desempate: entre dos bandas que dejan lo mismo conviene la que mueve
      // menos mercadería para lograrlo.
      titulo: "Margen bruto por unidad",
      celda: (b) =>
        b.margenPorUnidad == null ? "—" : fmtMoneda(b.margenPorUnidad),
      numerica: true,
      orden: (b) => b.margenPorUnidad,
    },
    {
      titulo: "Facturación",
      celda: (b) => fmtMoneda(b.facturacion),
      numerica: true,
      orden: (b) => b.facturacion,
      total: fmtMoneda(sumar(bandas, (b) => b.facturacion)),
    },
    {
      titulo: "%margen bruto real",
      // El del conjunto, no el promedio de los porcentajes de cada línea.
      celda: (b) => fmtPct(b.margenPct),
      numerica: true,
      orden: (b) => b.margenPct,
      // PONDERADO, que es la única forma correcta de totalizar un porcentaje:
      // margen total sobre facturación total. El promedio simple dejaría que
      // una banda de tres ventas pese lo mismo que una de tres mil.
      total: fmtPct(
        promedioPonderado(
          bandas,
          (b) => b.margen,
          (b) => b.facturacion,
        ),
      ),
    },
    {
      titulo: "Artículos",
      celda: (b) => fmtNumero(b.skus),
      numerica: true,
      orden: (b) => b.skus,
      // Los artículos NO se suman: el mismo SKU aparece en varias bandas, así
      // que la suma contaría a varios dos y tres veces. El total real es el
      // distinct del período, que ya viene resuelto del servidor.
      total: <span className="text-muted">sin sumar</span>,
    },
  ];
}

function columnasArticulo(
  filas: FilaElasticidad[],
  diasMirados: number,
): Columna<FilaElasticidad>[] {
  const columnas: Columna<FilaElasticidad>[] = [
    { titulo: "SKU", celda: (f) => f.sku, orden: (f) => f.sku },
    {
      titulo: "Producto",
      celda: (f) => (
        <span
          className="block max-w-[240px] truncate"
          title={f.producto ?? undefined}
        >
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
      total: fmtNumero(sumar(filas, (f) => f.unidades)),
    },
    {
      titulo: "Margen bruto",
      celda: (f) => fmtMoneda(f.margen),
      numerica: true,
      orden: (f) => f.margen,
      total: fmtMoneda(sumar(filas, (f) => f.margen)),
    },
    {
      titulo: "%margen bruto",
      celda: (f) => fmtPct(f.facturacion > 0 ? f.margen / f.facturacion : null),
      numerica: true,
      orden: (f) => (f.facturacion > 0 ? f.margen / f.facturacion : null),
      total: fmtPct(
        promedioPonderado(
          filas,
          (f) => f.margen,
          (f) => f.facturacion,
        ),
      ),
    },
    // TRES COLUMNAS POR BANDA: unidades, margen y %margen. Es ancho a
    // propósito — la tabla scrollea sola — porque la decisión no se puede tomar
    // con una sola de las tres: el margen dice cuánto entró, las unidades a
    // costa de cuánto stock, y el porcentaje si el precio fue el que se quería.
    ...BANDAS_EXPERIMENTO.flatMap((banda): Columna<FilaElasticidad>[] => {
      const gana = (f: FilaElasticidad) => f.mejor === banda.clave;
      const resalte = (f: FilaElasticidad) =>
        gana(f)
          ? { color: COLOR_BANDA[banda.clave], fontWeight: 600 }
          : undefined;
      return [
        {
          titulo: `${banda.label} · uds`,
          celda: (f) =>
            f.unidadesPorBanda[banda.clave] == null ? (
              <span className="text-muted">—</span>
            ) : (
              <span style={resalte(f)}>
                {fmtNumero(f.unidadesPorBanda[banda.clave])}
              </span>
            ),
          numerica: true,
          orden: (f) => f.unidadesPorBanda[banda.clave] ?? null,
          total: fmtNumero(
            sumar(filas, (f) => f.unidadesPorBanda[banda.clave]),
          ),
        },
        {
          titulo: `${banda.label} · margen`,
          celda: (f) =>
            f.margenPorBanda[banda.clave] == null ? (
              <span className="text-muted">—</span>
            ) : (
              <span style={resalte(f)}>
                {fmtMonedaCorta(f.margenPorBanda[banda.clave])}
              </span>
            ),
          numerica: true,
          orden: (f) => f.margenPorBanda[banda.clave] ?? null,
          total: fmtMoneda(sumar(filas, (f) => f.margenPorBanda[banda.clave])),
        },
        {
          titulo: `${banda.label} · %`,
          celda: (f) => (
            <span style={resalte(f)}>
              {fmtPct(f.margenPctPorBanda[banda.clave])}
            </span>
          ),
          numerica: true,
          orden: (f) => f.margenPctPorBanda[banda.clave] ?? null,
          total: fmtPct(
            promedioPonderado(
              filas,
              (f) => f.margenPorBanda[banda.clave],
              (f) => f.facturacionPorBanda[banda.clave],
            ),
          ),
        },
      ];
    }),
    {
      titulo: "Mejor",
      celda: (f) =>
        f.mejor == null ? (
          <span className="text-muted">sin comparar</span>
        ) : (
          <span style={{ color: COLOR_BANDA[f.mejor] }}>
            {labelBanda(f.mejor)}
          </span>
        ),
      orden: (f) => f.mejor,
      total: (
        <span className="text-muted">
          {fmtNumero(filas.filter((f) => f.mejor != null).length)} comparables
        </span>
      ),
    },
    {
      // La columna que pediste: cuántos días no se pudo comprar. Es lo que
      // permite descontar un resultado falso — un artículo que "vendió poco" en
      // una banda porque estuvo cuatro días sin stock no vendió poco por caro.
      titulo: `Días sin stock (de ${fmtNumero(diasMirados)})`,
      // EL DENOMINADOR VA EN EL TÍTULO, y no es decorativo. La historia de
      // disponibilidad arrancó el 21/08: si el período elegido son 30 días pero
      // sólo se midieron 3, un "0 días sin stock" no significa "nunca quebró",
      // significa "no lo miramos". Con el denominador a la vista, la diferencia
      // se ve sin tener que acordarse.
      celda: (f) => (
        <span
          style={
            f.diasSinStock > 0
              ? { color: TEMA.negativo }
              : { color: TEMA.muted }
          }
        >
          {f.diasSinStock === 0 ? "—" : fmtNumero(f.diasSinStock)}
        </span>
      ),
      numerica: true,
      orden: (f) => f.diasSinStock,
      // Cuántos artículos quebraron, no la suma de días: sumar días de
      // artículos distintos no da ninguna magnitud con sentido.
      total: (
        <span className="text-muted">
          {fmtNumero(filas.filter((f) => f.diasSinStock > 0).length)} quebraron
        </span>
      ),
    },
    {
      // SE LLAMABA "se puede leer solo" y hubo que preguntar qué quería decir,
      // así que el nombre estaba mal. Dice si ESTE artículo tiene suficientes
      // ventas como para que su columna "Mejor" signifique algo, o si es ruido.
      titulo: "¿Alcanza el volumen?",
      celda: (f) =>
        f.confiable ? (
          <span
            style={{ color: PALETA[1] }}
            title={`Vendió ${fmtNumero(f.unidades)} unidades en dos o más bandas: su "Mejor" tiene evidencia atrás.`}
          >
            sí
          </span>
        ) : (
          <span
            className="text-muted"
            title={
              f.mejor == null
                ? "Vendió en una sola banda, así que no hay con qué comparar."
                : `Sólo ${fmtNumero(f.unidades)} unidades. Hacen falta ${UDS_MINIMAS_SKU} para que la diferencia entre bandas no sea azar.`
            }
          >
            {f.mejor == null ? "sin comparar" : "poco volumen"}
          </span>
        ),
      orden: (f) => (f.confiable ? 1 : 0),
      total: (
        <span className="text-muted">
          {fmtNumero(filas.filter((f) => f.confiable).length)} sí
        </span>
      ),
    },
  ];
  return columnas;
}

export default function DashboardElasticidadPage() {
  const hoy = hoyArgentina();
  const inicial: FiltrosElasticidad = {
    desde: sumarDias(hoy, -30),
    hasta: hoy,
  };
  const [filtros, setFiltros] = useState<FiltrosElasticidad>(inicial);

  const { data, cargando, error, recargar, empezarCarga } =
    useDatosTablero<Respuesta>(
      "/api/elasticidad",
      {
        desde: filtros.desde,
        hasta: filtros.hasta,
        proveedor: filtros.proveedor,
        marca: filtros.marca,
        sku: filtros.sku,
        banda: filtros.banda,
        soloConfiables: filtros.soloConfiables ? "1" : undefined,
      },
      { conOpciones: "1" },
    );

  const [buscado, setBuscado] = useState("");

  const cambiar = (f: FiltrosElasticidad) => {
    empezarCarga();
    setFiltros(f);
  };
  const alternarSku = (sku: string) =>
    cambiar({ ...filtros, sku: alternarValor(filtros.sku, sku) });

  /**
   * El click en una barra alterna esa banda en el filtro, igual que en
   * Logística y Cuentas Corrientes. Los gráficos reciben `label` y no `clave`,
   * así que hay que volver de uno al otro: si el label no matchea ninguna banda
   * no se hace nada, en vez de meter un valor inventado en el filtro.
   */
  const alternarBanda = (label: string) => {
    const banda = BANDAS.find((b) => b.label === label);
    if (banda)
      cambiar({ ...filtros, banda: alternarValor(filtros.banda, banda.clave) });
  };

  /** Los labels de las bandas elegidas, que es lo que el gráfico resalta. */
  const bandasResaltadas = (filtros.banda ?? []).map(labelBanda);

  // Mover una punta más allá de la otra deja un rango vacío y la página se ve
  // rota sin motivo. Se arrastra la otra punta en vez de permitirlo.
  const cambiarDesde = (v: string) =>
    cambiar({
      ...filtros,
      desde: v,
      hasta: filtros.hasta < v ? v : filtros.hasta,
    });
  const cambiarHasta = (v: string) =>
    cambiar({
      ...filtros,
      hasta: v,
      desde: filtros.desde > v ? v : filtros.desde,
    });

  const buscar = () => {
    const sku = buscado.trim().toUpperCase();
    if (!sku) return;
    setBuscado("");
    if (!filtros.sku?.includes(sku)) alternarSku(sku);
  };

  const k = data?.kpis;
  const mejor = data?.bandas ? ganadoraPorMargen(data.bandas) : null;
  const mejorPorArticulo = k ? ganadoraPorArticulo(k.votosPorBanda) : null;
  const sinCambios =
    filtros.desde === inicial.desde &&
    filtros.hasta === inicial.hasta &&
    sinValores(filtros.proveedor) &&
    sinValores(filtros.marca) &&
    sinValores(filtros.sku) &&
    sinValores(filtros.banda) &&
    !filtros.soloConfiables;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          {/* h2 y no h1: el h1 de la página es el logo, que vive en el layout. */}
          <h2 className="text-lg font-semibold tracking-tight">
            Elasticidad de precios{" "}
            <span className="text-muted text-sm font-normal">
              · margen contra volumen
            </span>
          </h2>
          <p className="text-muted mt-1 text-xs">
            {data ? `${data.desde} a ${data.hasta}` : "Cargando datos en vivo…"}
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
          <label className="flex flex-col gap-1">
            <span className="text-muted text-[11px]">Desde</span>
            <input
              type="date"
              value={filtros.desde}
              max={filtros.hasta}
              onChange={(e) => e.target.value && cambiarDesde(e.target.value)}
              className="border-line bg-panel-2 text-ink rounded-lg border px-2.5 py-1.5 text-xs [color-scheme:dark]"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-muted text-[11px]">Hasta</span>
            <input
              type="date"
              value={filtros.hasta}
              min={filtros.desde}
              onChange={(e) => e.target.value && cambiarHasta(e.target.value)}
              className="border-line bg-panel-2 text-ink rounded-lg border px-2.5 py-1.5 text-xs [color-scheme:dark]"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-muted text-[11px]">Buscar SKU</span>
            <input
              type="search"
              value={buscado}
              placeholder="AL27003"
              onChange={(e) => setBuscado(e.target.value)}
              // Enter y no búsqueda al tipear: cada tecla dispararía una
              // consulta al servidor, y acá lo que se busca es un SKU exacto.
              onKeyDown={(e) => e.key === "Enter" && buscar()}
              onBlur={buscar}
              className="border-line bg-panel-2 text-ink placeholder:text-muted w-32 rounded-lg border px-2.5 py-1.5 text-xs uppercase"
            />
          </label>

          <div className="flex flex-wrap gap-1 self-end pb-0.5">
            {ATAJOS.map((a) => {
              const desde = sumarDias(hoy, -a.dias);
              const activo = filtros.desde === desde && filtros.hasta === hoy;
              return (
                <button
                  key={a.dias}
                  type="button"
                  onClick={() => cambiar({ ...filtros, desde, hasta: hoy })}
                  aria-pressed={activo}
                  className={`rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${
                    activo
                      ? "border-c1 bg-c1/15 text-c1"
                      : "border-line text-muted hover:bg-panel-2 hover:text-ink"
                  }`}
                >
                  {a.label}
                </button>
              );
            })}
          </div>

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
            onClick={() =>
              cambiar({ ...filtros, soloConfiables: !filtros.soloConfiables })
            }
            aria-pressed={Boolean(filtros.soloConfiables)}
            className={`rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${
              filtros.soloConfiables
                ? "border-c1 bg-c1/15 text-c1"
                : "border-line text-muted hover:bg-panel-2 hover:text-ink"
            }`}
          >
            Solo los que se pueden leer solos
          </button>
          <BotonLimpiar
            onClick={() => cambiar(inicial)}
            deshabilitado={sinCambios}
          />
        </div>

        <span className="text-muted text-[11px] leading-tight">
          La banda sale de <strong>cada venta</strong>, no de una lista: con su
          precio y su costo se calcula el %margen con el que se vendió —
          <em>(precio − IVA − costo − comisión − envío) ÷ precio</em>— y con eso
          cae en su banda. El mismo artículo puede aparecer en varias.
        </span>
      </div>

      {(!sinValores(filtros.sku) || !sinValores(filtros.banda)) && (
        <div className="flex flex-wrap items-center gap-2">
          {(filtros.banda ?? []).map((b) => (
            <button
              key={b}
              onClick={() => alternarBanda(labelBanda(b))}
              className="rounded-full border px-3 py-1 text-xs"
              style={{
                color: COLOR_BANDA[b],
                borderColor: `${COLOR_BANDA[b]}66`,
                backgroundColor: `${COLOR_BANDA[b]}1a`,
              }}
            >
              {labelBanda(b)} ✕
            </button>
          ))}
          {(filtros.sku ?? []).map((s) => (
            <button
              key={s}
              onClick={() => alternarSku(s)}
              className="border-c1/40 bg-c1/10 text-c1 hover:bg-c1/20 rounded-full border px-3 py-1 text-xs"
            >
              SKU {s} ✕
            </button>
          ))}
        </div>
      )}

      {error && (
        <Aviso>
          <p className="font-medium">No se pudieron leer los datos.</p>
          <p className="mt-1 font-mono text-xs break-words opacity-80">
            {error}
          </p>
        </Aviso>
      )}

      {!error && cargando && !data && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Esqueleto key={i} className="h-[86px]" />
          ))}
        </div>
      )}

      {!error && data && !data.hayDatos && (
        <Aviso tono="info">
          <p className="font-medium">
            No hay ventas para clasificar en este período.
          </p>
          <p className="mt-1">
            La banda de cada venta sale de su propio margen, así que sin ventas
            no hay nada que comparar. Probá con un rango más largo o sacando los
            filtros.
          </p>
          <ul className="mt-2 space-y-1">
            {PASOS_PREVIOS.map((p) => (
              <li key={p.clave} className="text-xs opacity-80">
                <strong>{p.titulo}.</strong> {p.detalle}
              </li>
            ))}
          </ul>
        </Aviso>
      )}

      {!error && data?.hayDatos && k && (
        <div
          className={`space-y-4 transition-opacity ${cargando ? "opacity-50" : ""}`}
        >
          <ConAlarmaMargen activa={k.margen < 0}>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {/* EL TITULAR ES EL VOTO POR ARTÍCULO, no el margen agregado. Ver
                `ganadoraPorArticulo` para por qué el agregado engaña. */}
              <TarjetaKpi
                titulo="Mejor banda, artículo por artículo"
                valor={mejorPorArticulo ? labelBanda(mejorPorArticulo) : "—"}
                detalle={
                  mejorPorArticulo
                    ? `Ganó en ${fmtNumero(k.votosPorBanda[mejorPorArticulo] ?? 0)} de ${fmtNumero(k.comparables)} artículos comparables · ${fmtNumero(k.comparablesConVolumen)} con volumen propio`
                    : "Hacen falta artículos que hayan vendido en dos bandas distintas"
                }
                acento={
                  mejorPorArticulo ? COLOR_BANDA[mejorPorArticulo] : undefined
                }
              />
              <TarjetaKpi
                titulo="Margen del período"
                valor={fmtMoneda(k.margen)}
                detalle={`${fmtPct(k.margenPct)} sobre ${fmtMoneda(k.facturacion)} · ${fmtNumero(k.unidades)} unidades`}
              />
              <TarjetaKpi
                titulo="Dentro del rango 10-35 %"
                valor={fmtPct(k.dentroDelRango)}
                detalle="Las unidades que caen fuera se venden con márgenes que el experimento no está probando"
                acento={
                  k.dentroDelRango != null && k.dentroDelRango < 0.6
                    ? PALETA[2]
                    : undefined
                }
              />
              <TarjetaKpi
                titulo="Quebraron stock"
                valor={`${fmtNumero(k.skusQuebrados)} artículos`}
                detalle={`Sobre ${fmtNumero(k.diasMirados)} días medidos · su resultado por banda está falseado`}
                acento={k.skusQuebrados > 0 ? TEMA.negativo : undefined}
              />
            </div>
          </ConAlarmaMargen>

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel
              titulo="En cuántos artículos ganó cada banda"
              nota={`Comparando cada artículo consigo mismo · ${fmtNumero(k.comparables)} comparables`}
            >
              <BarrasCategoria
                datos={BANDAS_EXPERIMENTO.map((b) => ({
                  label: b.label,
                  valor: k.votosPorBanda[b.clave] ?? 0,
                }))}
                formato={fmtNumero}
                horizontal={false}
                colorUnico={PALETA[3]}
                alturaMinima={240}
                seleccionados={bandasResaltadas}
                onSeleccionar={alternarBanda}
                vacio="Ningún artículo vendió todavía en dos bandas distintas."
              />
            </Panel>
            <Panel
              titulo="Margen $ por banda"
              nota="Total del período · ojo, mezcla artículos distintos"
            >
              <BarrasCategoria
                datos={data.bandas.map((b) => ({
                  label: labelBanda(b.banda),
                  valor: b.margen,
                }))}
                formato={fmtMonedaCorta}
                horizontal={false}
                colorUnico={PALETA[1]}
                alturaMinima={240}
                seleccionados={bandasResaltadas}
                onSeleccionar={alternarBanda}
                vacio="Sin ventas en el período."
              />
            </Panel>

            <Panel
              titulo="Unidades por banda"
              nota="Sube al bajar el margen · por eso sola no alcanza"
            >
              <BarrasCategoria
                datos={data.bandas.map((b) => ({
                  label: labelBanda(b.banda),
                  valor: b.unidades,
                }))}
                formato={fmtNumero}
                horizontal={false}
                colorUnico={PALETA[0]}
                alturaMinima={240}
                seleccionados={bandasResaltadas}
                onSeleccionar={alternarBanda}
                vacio="Sin ventas en el período."
              />
            </Panel>
          </div>

          <Panel
            titulo="Las bandas, en detalle"
            nota="Las dos de los extremos no son del experimento; están para que los totales cierren"
          >
            <Tabla
              filas={data.bandas}
              columnas={columnasBanda(data.bandas)}
              clave={(b) => b.banda}
              vacio="Sin ventas en el período."
            />
          </Panel>

          <Panel
            titulo="Artículo por artículo"
            nota={
              (data.recortada
                ? `Los ${data.articulos.length} de mayor margen`
                : `${fmtNumero(data.articulos.length)} artículos`) +
              " · click en una fila para filtrar por ese SKU"
            }
          >
            <Tabla
              filas={data.articulos}
              columnas={columnasArticulo(data.articulos, k.diasMirados)}
              clave={(f) => f.sku}
              onClickFila={(f) => alternarSku(f.sku)}
              activa={(f) => Boolean(filtros.sku?.includes(f.sku))}
              etiquetaTotal={data.recortada ? "Total (los mostrados)" : "Total"}
              vacio="Ningún artículo con ventas para el filtro elegido."
            />
          </Panel>

          {/* El detalle día por día se pide al filtrar un artículo: sin filtro
              serían decenas de miles de filas (el 54 % del catálogo está
              quebrado en cualquier momento dado). El conteo por artículo está
              siempre, en la columna "Días sin stock" de la tabla de arriba. */}
          {!sinValores(filtros.sku) && (
            <Panel
              titulo="Días sin stock, día por día"
              nota={
                data.diasSinStock.length > 0
                  ? `${fmtNumero(data.diasSinStock.length)} días quebrados · sobre ${fmtNumero(k.diasMirados)} días medidos`
                  : `Sin quiebres en los ${fmtNumero(k.diasMirados)} días medidos`
              }
            >
              <div className="max-h-[320px] overflow-y-auto">
                <div className="flex flex-wrap gap-1.5">
                  {data.diasSinStock.map((d) => (
                    <button
                      key={`${d.sku}-${d.dia}`}
                      onClick={() => alternarSku(d.sku)}
                      className="border-line hover:bg-panel-2 rounded-md border px-2 py-1 text-[11px] tabular-nums"
                      title="Click para filtrar por este artículo"
                    >
                      <span className="text-ink">{d.sku}</span>{" "}
                      <span className="text-muted">{fmtFechaCorta(d.dia)}</span>
                    </button>
                  ))}
                </div>
              </div>
              <p className="text-muted mt-3 text-[11px] leading-tight">
                Un día cuenta como quebrado cuando <strong>ninguna</strong> de
                las publicaciones del artículo se pudo comprar en todo el día.
                Los días en que el pulso no corrió no se cuentan: no saber no es
                lo mismo que no tener stock.
              </p>
            </Panel>
          )}

          <Aviso tono="info">
            <p className="font-medium">Cómo leer esto.</p>
            <p className="mt-1">
              <strong>El total por banda mezcla artículos distintos.</strong> En
              el período elegido la banda de{" "}
              {mejor ? labelBanda(mejor.banda) : "mayor margen"} suele sumar más
              margen <em>y</em> más unidades que las de abajo — y eso no
              significa que subir el precio venda más. Los artículos que
              sostienen un margen alto son otros productos, con más demanda o
              menos competencia. Por eso el titular usa el voto artículo por
              artículo, que compara al mismo producto vendido a dos márgenes
              distintos.
            </p>
            <p className="mt-1">
              <strong>La banda gana por margen $</strong>, pero si otra queda
              dentro de {fmtPct(EMPATE_TECNICO)} y tiene margen más alto, gana
              ésa: vender 50 unidades al 10 % y 20 al 30 % no es lo mismo aunque
              dejen igual — con la segunda el stock dura más y se mueve menos
              mercadería.
            </p>
            <p className="mt-1">
              <strong>Descontá los quiebres antes de concluir.</strong> Un
              artículo que vendió poco en una banda pero estuvo días sin stock
              no vendió poco por caro. La columna &ldquo;Días sin stock&rdquo; y
              el panel de arriba están para eso.
            </p>
            <p className="mt-1">
              <strong>
                Y mirá la columna &ldquo;Se puede leer solo&rdquo;.
              </strong>{" "}
              La mediana de los artículos vende 0,58 unidades por semana; para
              ésos, la diferencia entre un margen y otro es azar. El total de
              cada banda sí tiene miles de unidades atrás.
            </p>
          </Aviso>
        </div>
      )}
    </div>
  );
}
