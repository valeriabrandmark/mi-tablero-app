"use client";

import { useState } from "react";
import BarrasCategoria from "@/components/charts/BarrasCategoria";
import { BotonLimpiar, SelectorMultiple } from "@/components/SelectorFiltro";
import { sumar, Tabla, type Columna } from "@/components/Tabla";
import { Aviso, Esqueleto, Panel, TarjetaKpi } from "@/components/ui";
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
import { fmtFechaCorta, fmtMoneda, fmtMonedaCorta, fmtNumero, fmtPct } from "@/lib/format";
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
  return conVotos.reduce((a, b) => ((votos[b.clave] ?? 0) > (votos[a.clave] ?? 0) ? b : a))
    .clave;
}

/** La banda que más margen sumó. Se muestra al lado, con su advertencia. */
function ganadoraPorMargen(bandas: ResumenBanda[]): ResumenBanda | null {
  const porBanda = Object.fromEntries(
    bandas.filter((b) => b.delExperimento && b.unidades > 0).map((b) => [b.banda, b.margen]),
  );
  const clave = mejorBanda(porBanda);
  return clave ? (bandas.find((b) => b.banda === clave) ?? null) : null;
}

function columnasBanda(bandas: ResumenBanda[]): Columna<ResumenBanda>[] {
  return [
    {
      titulo: "%margen de la venta",
      celda: (b) => (
        <span style={{ color: COLOR_BANDA[b.banda] }}>
          {labelBanda(b.banda)}
          {!b.delExperimento && <span className="text-muted text-[10px]"> · fuera del rango</span>}
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
      titulo: "Margen $",
      celda: (b) => (
        <strong style={{ color: COLOR_BANDA[b.banda] }}>{fmtMoneda(b.margen)}</strong>
      ),
      numerica: true,
      orden: (b) => b.margen,
      total: fmtMoneda(sumar(bandas, (b) => b.margen)),
    },
    {
      // El desempate: entre dos bandas que dejan lo mismo conviene la que mueve
      // menos mercadería para lograrlo.
      titulo: "Margen por unidad",
      celda: (b) => (b.margenPorUnidad == null ? "—" : fmtMoneda(b.margenPorUnidad)),
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
      titulo: "%margen real",
      // El del conjunto, no el promedio de los porcentajes de cada línea.
      celda: (b) => fmtPct(b.margenPct),
      numerica: true,
      orden: (b) => b.margenPct,
    },
    {
      titulo: "Artículos",
      celda: (b) => fmtNumero(b.skus),
      numerica: true,
      orden: (b) => b.skus,
    },
  ];
}

function columnasArticulo(filas: FilaElasticidad[]): Columna<FilaElasticidad>[] {
  const columnas: Columna<FilaElasticidad>[] = [
    { titulo: "SKU", celda: (f) => f.sku, orden: (f) => f.sku },
    {
      titulo: "Producto",
      celda: (f) => (
        <span className="block max-w-[240px] truncate" title={f.producto ?? undefined}>
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
    // Una columna por banda del experimento, con el margen que dejó cada una.
    // Los dos bordes no van acá: la tabla ya tiene siete columnas y la pregunta
    // de esta tabla es cuál de las TRES conviene.
    ...BANDAS_EXPERIMENTO.map(
      (banda): Columna<FilaElasticidad> => ({
        titulo: banda.label,
        celda: (f) => {
          const margen = f.margenPorBanda[banda.clave];
          if (margen == null) return <span className="text-muted">—</span>;
          const gana = f.mejor === banda.clave;
          return (
            <span
              style={gana ? { color: COLOR_BANDA[banda.clave], fontWeight: 600 } : undefined}
              title={`${fmtNumero(f.unidadesPorBanda[banda.clave] ?? 0)} unidades`}
            >
              {fmtMonedaCorta(margen)}
            </span>
          );
        },
        numerica: true,
        orden: (f) => f.margenPorBanda[banda.clave] ?? null,
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
      // La columna que pediste: cuántos días no se pudo comprar. Es lo que
      // permite descontar un resultado falso — un artículo que "vendió poco" en
      // una banda porque estuvo cuatro días sin stock no vendió poco por caro.
      titulo: "Días sin stock",
      celda: (f) => (
        <span style={f.diasSinStock > 0 ? { color: TEMA.negativo } : { color: TEMA.muted }}>
          {f.diasSinStock === 0 ? "—" : fmtNumero(f.diasSinStock)}
        </span>
      ),
      numerica: true,
      orden: (f) => f.diasSinStock,
    },
    {
      titulo: "Se puede leer solo",
      // Con la mediana del catálogo en 0,58 unidades por semana, para la mayoría
      // de los artículos la "mejor banda" es el resultado de un tiro de dados.
      celda: (f) =>
        f.confiable ? (
          <span style={{ color: PALETA[1] }}>sí</span>
        ) : (
          <span
            className="text-muted"
            title={`Necesita ${UDS_MINIMAS_SKU} unidades y ventas en al menos dos bandas`}
          >
            no
          </span>
        ),
      orden: (f) => (f.confiable ? 1 : 0),
    },
  ];
  return columnas;
}

export default function DashboardElasticidadPage() {
  const hoy = hoyArgentina();
  const inicial: FiltrosElasticidad = { desde: sumarDias(hoy, -30), hasta: hoy };
  const [filtros, setFiltros] = useState<FiltrosElasticidad>(inicial);

  const { data, cargando, error, recargar, empezarCarga } = useDatosTablero<Respuesta>(
    "/api/elasticidad",
    {
      desde: filtros.desde,
      hasta: filtros.hasta,
      proveedor: filtros.proveedor,
      marca: filtros.marca,
      sku: filtros.sku,
      soloConfiables: filtros.soloConfiables ? "1" : undefined,
    },
    { conOpciones: "1" },
  );

  const cambiar = (f: FiltrosElasticidad) => {
    empezarCarga();
    setFiltros(f);
  };
  const alternarSku = (sku: string) =>
    cambiar({ ...filtros, sku: alternarValor(filtros.sku, sku) });

  const k = data?.kpis;
  const mejor = data?.bandas ? ganadoraPorMargen(data.bandas) : null;
  const mejorPorArticulo = k ? ganadoraPorArticulo(k.votosPorBanda) : null;
  const sinCambios =
    filtros.desde === inicial.desde &&
    filtros.hasta === inicial.hasta &&
    sinValores(filtros.proveedor) &&
    sinValores(filtros.marca) &&
    sinValores(filtros.sku) &&
    !filtros.soloConfiables;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          {/* h2 y no h1: el h1 de la página es el logo, que vive en el layout. */}
          <h2 className="text-lg font-semibold tracking-tight">
            Elasticidad de precios{" "}
            <span className="text-muted text-sm font-normal">· margen contra volumen</span>
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
          <div className="flex flex-wrap gap-1">
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
          La banda sale de <strong>cada venta</strong>, no de una lista: con su precio y su
          costo se calcula el %margen con el que se vendió —
          <em>(precio − IVA − costo − comisión − envío) ÷ precio</em>— y con eso cae en su
          banda. El mismo artículo puede aparecer en varias.
        </span>
      </div>

      {!sinValores(filtros.sku) && (
        <div className="flex flex-wrap items-center gap-2">
          {filtros.sku!.map((s) => (
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

      {!error && data && !data.hayDatos && (
        <Aviso tono="info">
          <p className="font-medium">No hay ventas para clasificar en este período.</p>
          <p className="mt-1">
            La banda de cada venta sale de su propio margen, así que sin ventas no hay nada
            que comparar. Probá con un rango más largo o sacando los filtros.
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
        <div className={`space-y-4 transition-opacity ${cargando ? "opacity-50" : ""}`}>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
              acento={mejorPorArticulo ? COLOR_BANDA[mejorPorArticulo] : undefined}
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
                k.dentroDelRango != null && k.dentroDelRango < 0.6 ? PALETA[2] : undefined
              }
            />
            <TarjetaKpi
              titulo="Quebraron stock"
              valor={`${fmtNumero(k.skusQuebrados)} artículos`}
              detalle={`Sobre ${fmtNumero(k.diasMirados)} días medidos · su resultado por banda está falseado`}
              acento={k.skusQuebrados > 0 ? TEMA.negativo : undefined}
            />
          </div>

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
                vacio="Ningún artículo vendió todavía en dos bandas distintas."
              />
            </Panel>
            <Panel titulo="Margen $ por banda" nota="Total del período · ojo, mezcla artículos distintos">
              <BarrasCategoria
                datos={data.bandas.map((b) => ({ label: labelBanda(b.banda), valor: b.margen }))}
                formato={fmtMonedaCorta}
                horizontal={false}
                colorUnico={PALETA[1]}
                alturaMinima={240}
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
              columnas={columnasArticulo(data.articulos)}
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
                Un día cuenta como quebrado cuando <strong>ninguna</strong> de las
                publicaciones del artículo se pudo comprar en todo el día. Los días en que el
                pulso no corrió no se cuentan: no saber no es lo mismo que no tener stock.
              </p>
            </Panel>
          )}

          <Aviso tono="info">
            <p className="font-medium">Cómo leer esto.</p>
            <p className="mt-1">
              <strong>El total por banda mezcla artículos distintos.</strong> En el período
              elegido la banda de {mejor ? labelBanda(mejor.banda) : "mayor margen"} suele
              sumar más margen <em>y</em> más unidades que las de abajo — y eso no significa
              que subir el precio venda más. Los artículos que sostienen un margen alto son
              otros productos, con más demanda o menos competencia. Por eso el titular usa el
              voto artículo por artículo, que compara al mismo producto vendido a dos
              márgenes distintos.
            </p>
            <p className="mt-1">
              <strong>La banda gana por margen $</strong>, pero si otra queda dentro de{" "}
              {fmtPct(EMPATE_TECNICO)} y tiene margen más alto, gana ésa: vender 50 unidades al
              10 % y 20 al 30 % no es lo mismo aunque dejen igual — con la segunda el stock dura
              más y se mueve menos mercadería.
            </p>
            <p className="mt-1">
              <strong>Descontá los quiebres antes de concluir.</strong> Un artículo que vendió
              poco en una banda pero estuvo días sin stock no vendió poco por caro. La columna
              &ldquo;Días sin stock&rdquo; y el panel de arriba están para eso.
            </p>
            <p className="mt-1">
              <strong>Y mirá la columna &ldquo;Se puede leer solo&rdquo;.</strong> La mediana de
              los artículos vende 0,58 unidades por semana; para ésos, la diferencia entre un
              margen y otro es azar. El total de cada banda sí tiene miles de unidades atrás.
            </p>
          </Aviso>
        </div>
      )}
    </div>
  );
}
