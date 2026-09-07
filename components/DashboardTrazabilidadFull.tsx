"use client";

import { useState } from "react";
import SaldoFull from "@/components/charts/SaldoFull";
import { BotonLimpiar, SelectorMultiple } from "@/components/SelectorFiltro";
import { contarSkus, sumar, Tabla, type Columna } from "@/components/Tabla";
import { Aviso, Esqueleto, Panel, TarjetaKpi } from "@/components/ui";
import { alternar as alternarValor, vacio as sinValores } from "@/lib/filtros";
import { fmtFechaCorta, fmtFechaCortaConAnio, fmtMoneda, fmtNumero } from "@/lib/format";
import { PALETA, TEMA } from "@/lib/paleta";
import {
  DIAS_PARA_LLEGAR_A_FULL,
  estadoDelSaldo,
  ETIQUETA_ESTADO,
  UMBRAL_RECLAMO_UNIDADES,
} from "@/lib/trazabilidad-full";
import type {
  DashboardTrazabilidad,
  FilaTrazabilidad,
  FiltrosTrazabilidad,
} from "@/lib/types";
import { useDatosTablero } from "@/lib/useDatosTablero";

type Opciones = { proveedores: string[]; grupos: string[] };
type Respuesta = DashboardTrazabilidad & { opciones: Opciones | null };

const TOPE_TEXTO = 300;

/** El saldo que se reclama: el neto una vez descontado lo que todavía viaja. */
function saldoReclamable(f: FilaTrazabilidad): number {
  return f.neto + f.enTransito;
}

function color(f: FilaTrazabilidad): string | undefined {
  const estado = estadoDelSaldo(saldoReclamable(f));
  if (estado === "reclamable") return TEMA.negativo;
  if (estado === "a_mirar") return PALETA[2];
  return undefined;
}

function columnas(filas: FilaTrazabilidad[]): Columna<FilaTrazabilidad>[] {
  return [
    { titulo: "SKU", celda: (f) => f.sku, orden: (f) => f.sku },
    {
      titulo: "Artículo",
      celda: (f) => (
        <span
          className="block max-w-[136px] truncate sm:max-w-[280px]"
          title={f.producto ?? undefined}
        >
          {f.producto ?? "—"}
        </span>
      ),
      orden: (f) => f.producto,
      total: `${fmtNumero(contarSkus(filas, (f) => f.sku))} SKU`,
    },
    {
      titulo: "Proveedor",
      celda: (f) => (
        <span className="block max-w-[110px] truncate sm:max-w-[180px]">
          {f.proveedor ?? "—"}
        </span>
      ),
      orden: (f) => f.proveedor,
    },
    {
      titulo: "Enviado",
      celda: (f) => fmtNumero(f.enviado),
      numerica: true,
      orden: (f) => f.enviado,
      total: fmtNumero(sumar(filas, (f) => f.enviado)),
    },
    {
      titulo: "Vendido",
      celda: (f) => fmtNumero(f.vendido),
      numerica: true,
      orden: (f) => f.vendido,
      total: fmtNumero(sumar(filas, (f) => f.vendido)),
    },
    {
      titulo: "En Full hoy",
      celda: (f) => fmtNumero(f.declaradoHoy),
      numerica: true,
      orden: (f) => f.declaradoHoy,
      total: fmtNumero(sumar(filas, (f) => f.declaradoHoy)),
    },
    {
      titulo: "Viajando",
      // Lo despachado hace poco. Un saldo negativo con este número al lado casi
      // siempre es mercadería en camino, no un faltante.
      celda: (f) =>
        f.enTransito > 0 ? (
          <span className="text-muted">{fmtNumero(f.enTransito)}</span>
        ) : (
          <span className="text-muted">—</span>
        ),
      numerica: true,
      orden: (f) => f.enTransito,
      total: fmtNumero(sumar(filas, (f) => f.enTransito)),
    },
    {
      titulo: "Saldo",
      celda: (f) => {
        const s = saldoReclamable(f);
        return (
          <span
            style={{ color: color(f) }}
            title={
              `Neto de la cuenta: ${f.neto > 0 ? "+" : ""}${fmtNumero(f.neto)} u.\n` +
              (f.enTransito > 0
                ? `Más ${fmtNumero(f.enTransito)} u. despachadas hace menos de ` +
                  `${DIAS_PARA_LLEGAR_A_FULL} días, que pueden estar viajando.\n`
                : "") +
              `Saldo a reclamar: ${s > 0 ? "+" : ""}${fmtNumero(s)} u.\n\n` +
              `Cayó en ${fmtNumero(f.diasConCaida)} día(s), ` +
              `${fmtNumero(-f.brutoCaidas)} u. en total, de las cuales ` +
              `${fmtNumero(-f.brutoCaidas + Math.min(0, s))} volvieron.`
            }
            className="decoration-dotted underline underline-offset-2"
          >
            {s > 0 ? "+" : ""}
            {fmtNumero(s)}
          </span>
        );
      },
      numerica: true,
      orden: (f) => saldoReclamable(f),
      total: fmtNumero(sumar(filas, saldoReclamable)),
    },
    {
      titulo: "Estado",
      celda: (f) => (
        <span style={{ color: color(f) }}>{ETIQUETA_ESTADO[estadoDelSaldo(saldoReclamable(f))]}</span>
      ),
      orden: (f) => saldoReclamable(f),
    },
    {
      titulo: "A costo",
      // Sólo para los que faltan: valorizar un sobrante no significa nada, no
      // es plata que se pueda pedir.
      celda: (f) =>
        saldoReclamable(f) < 0 ? (
          <span style={{ color: color(f) }}>{fmtMoneda(f.plata)}</span>
        ) : (
          <span className="text-muted">—</span>
        ),
      numerica: true,
      orden: (f) => (saldoReclamable(f) < 0 ? f.plata : 0),
      total: fmtMoneda(sumar(filas, (f) => (saldoReclamable(f) < 0 ? f.plata : 0))),
    },
    {
      titulo: "Última caída",
      celda: (f) => (f.ultimaCaida ? fmtFechaCortaConAnio(f.ultimaCaida) : "—"),
      orden: (f) => f.ultimaCaida,
    },
  ];
}

export default function DashboardTrazabilidadFull() {
  const [filtros, setFiltros] = useState<FiltrosTrazabilidad>({});
  const [buscado, setBuscado] = useState("");

  const { data, cargando, error, recargar, empezarCarga } = useDatosTablero<Respuesta>(
    "/api/trazabilidad-full",
    {
      proveedor: filtros.proveedor,
      grupo: filtros.grupo,
      sku: filtros.sku,
      desde: filtros.desde,
      buscar: filtros.buscar,
      todos: filtros.todos ? "1" : undefined,
      soloReclamables: filtros.soloReclamables ? "1" : undefined,
    },
  );

  const cambiar = (f: FiltrosTrazabilidad) => {
    empezarCarga();
    setFiltros(f);
  };
  const alternarEn = (clave: "sku") => (valor: string) =>
    cambiar({ ...filtros, [clave]: alternarValor(filtros[clave], valor) });

  const k = data?.kpis;
  const sinCambios =
    sinValores(filtros.proveedor) &&
    sinValores(filtros.grupo) &&
    sinValores(filtros.sku) &&
    !filtros.buscar &&
    !filtros.todos &&
    !filtros.soloReclamables;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-lg font-medium">Trazabilidad de Full</h1>
          <p className="text-muted mt-0.5 text-xs">
            Lo que mandamos, lo que se vendió y lo que Mercado Libre declara tener.
          </p>
        </div>
        {data?.desde && (
          <span className="text-muted text-xs">
            Contando desde el {fmtFechaCorta(data.desde)}
            {data.hasta ? ` al ${fmtFechaCorta(data.hasta)}` : ""} ·{" "}
            {fmtNumero(data.diasDeFoto)} días de foto
          </span>
        )}
      </div>

      {error && <Aviso>{error}</Aviso>}

      {/* SIN DOS DÍAS NO HAY NADA QUE MIRAR, y se dice en vez de mostrar ceros:
          un tablero en cero se lee como "está todo bien", que es exactamente lo
          contrario de "todavía no sabemos". */}
      {data && data.diasDeFoto < 2 && (
        <Aviso tono="info">
          La foto diaria del stock de Full recién se está juntando. Con un solo día no
          hay movimiento que comparar: mañana ya se puede leer el primer saldo.
        </Aviso>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <SelectorMultiple
          etiqueta="Empresa"
          valores={filtros.grupo}
          opciones={data?.opciones?.grupos ?? []}
          onChange={(v) => cambiar({ ...filtros, grupo: v })}
        />
        <SelectorMultiple
          etiqueta="Proveedor"
          valores={filtros.proveedor}
          opciones={data?.opciones?.proveedores ?? []}
          onChange={(v) => cambiar({ ...filtros, proveedor: v })}
        />

        <form
          onSubmit={(e) => {
            e.preventDefault();
            cambiar({ ...filtros, buscar: buscado.trim() || undefined });
          }}
          className="flex flex-col gap-1"
        >
          <label className="text-muted text-[11px]" htmlFor="buscar-traza">
            Buscar
          </label>
          <input
            id="buscar-traza"
            value={buscado}
            onChange={(e) => setBuscado(e.target.value)}
            placeholder="SKU o artículo"
            className="border-line bg-panel-2 text-ink focus:border-c1 w-44 rounded-md border px-2 py-1.5 text-xs outline-none"
          />
        </form>

        <button
          type="button"
          onClick={() =>
            cambiar({ ...filtros, soloReclamables: filtros.soloReclamables ? undefined : true })
          }
          aria-pressed={filtros.soloReclamables ?? false}
          className={`rounded-md border px-3 py-1.5 text-xs transition-colors ${
            filtros.soloReclamables
              ? "border-c1 bg-c1/15 text-c1 font-medium"
              : "border-line text-muted hover:text-ink"
          }`}
        >
          Sólo para reclamar
        </button>

        <button
          type="button"
          onClick={() => cambiar({ ...filtros, todos: filtros.todos ? undefined : true })}
          aria-pressed={filtros.todos ?? false}
          className={`rounded-md border px-3 py-1.5 text-xs transition-colors ${
            filtros.todos
              ? "border-c1 bg-c1/15 text-c1 font-medium"
              : "border-line text-muted hover:text-ink"
          }`}
        >
          Ver también los que cierran
        </button>

        <BotonLimpiar onClick={() => cambiar({})} deshabilitado={sinCambios} />
        <button
          type="button"
          onClick={recargar}
          className="border-line text-muted hover:text-ink rounded-md border px-3 py-1.5 text-xs"
        >
          Actualizar
        </button>
      </div>

      {!data && cargando && <Esqueleto className="h-64" />}

      {data && k && (
        <div className={`space-y-4 transition-opacity ${cargando ? "opacity-50" : ""}`}>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <TarjetaKpi
              titulo="Para reclamar"
              valor={fmtNumero(k.unidadesReclamables)}
              detalle={`${fmtNumero(k.skusReclamables)} SKU con ${UMBRAL_RECLAMO_UNIDADES} u. o más de faltante`}
              acento={k.skusReclamables > 0 ? TEMA.negativo : undefined}
            />
            <TarjetaKpi
              titulo="Lo que vale"
              valor={fmtMoneda(k.plataReclamable)}
              detalle="A costo, sólo lo faltante"
              acento={k.plataReclamable > 0 ? TEMA.negativo : undefined}
            />
            <TarjetaKpi
              titulo="La cuenta cierra en"
              valor={fmtNumero(k.skusEnOrden)}
              detalle={`de ${fmtNumero(k.skus)} artículos con movimiento`}
            />
            <TarjetaKpi
              titulo="Saldo del conjunto"
              valor={`${k.neto > 0 ? "+" : ""}${fmtNumero(k.neto)}`}
              detalle="Positivo: Meli declara de más"
            />
          </div>

          <Panel
            titulo="La cuenta corriente del stock en Full"
            nota="Unidades · el cero es que cierra"
          >
            <SaldoFull datos={data.serie} />

            {/* LA NOTA MÁS IMPORTANTE DE LA PANTALLA. Sin esto, el primer día
                que alguien vea una caída diaria va a salir a reclamar algo que
                se corrige solo, y a la tercera vez deja de creerle al tablero. */}
            <p className="text-muted mt-3 text-[11px] leading-relaxed">
              Lo que se mira es la <strong className="text-ink">forma</strong>, no el
              día suelto. En el período medido hubo{" "}
              {fmtNumero(-k.brutoCaidas)} unidades de caídas diarias, pero{" "}
              {fmtNumero(-k.brutoCaidas + Math.min(0, k.neto))} volvieron al día
              siguiente: la foto de Mercado Libre se toma a una hora fija y las ventas
              se cuentan por día calendario, así que una venta del límite cae de un lado
              y su descuento de stock del otro. Eso se corrige solo. Una unidad que
              Mercado Libre sacó, no.
            </p>
          </Panel>

          <Panel
            titulo="Artículos cuya cuenta no cierra"
            nota={
              data.recortada
                ? `Los ${TOPE_TEXTO} con más diferencia · click para filtrar`
                : "Click para filtrar"
            }
          >
            <Tabla
              filas={data.filas}
              columnas={columnas(data.filas)}
              etiquetaTotal={data.recortada ? `Total (los ${TOPE_TEXTO} mostrados)` : "Total"}
              clave={(f) => f.sku}
              onClickFila={(f) => alternarEn("sku")(f.sku)}
              activa={(f) => (filtros.sku?.length ? filtros.sku.includes(f.sku) : false)}
              vacio="No hay artículos con diferencias para el filtro elegido."
            />

            <p className="text-muted mt-3 text-[11px] leading-relaxed">
              El saldo ya tiene descontado lo despachado en los últimos{" "}
              {DIAS_PARA_LLEGAR_A_FULL} días —la columna “Viajando”—, que es mercadería
              que todavía puede estar en camino. Sin ese descuento la lista tendría{" "}
              seis veces más artículos, casi todos envíos viajando.
            </p>
          </Panel>
        </div>
      )}
    </div>
  );
}
