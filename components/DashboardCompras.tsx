"use client";

import { useCallback, useMemo, useState } from "react";
import { BotonLimpiar, SelectorMultiple } from "@/components/SelectorFiltro";
import { contarSkus, sumar, Tabla, type Columna } from "@/components/Tabla";
import { Aviso, Esqueleto, Panel, TarjetaKpi } from "@/components/ui";
import {
  aCsv,
  aTxt,
  aUnidades,
  cantidadSugerida,
  COLUMNAS_SIGMA,
  DESCUENTO_MAXIMO,
  descuentoValido,
  excelParaProveedor,
  factorNeto,
  lineasParaExportar,
  MESES_RENTABILIDAD,
  nombreArchivo,
  porQueSugerido,
  renglonInicial,
  UNIDADES_COMPRA,
  type ClaveUnidadCompra,
  type RenglonOrden,
  COBERTURAS_COMPRA,
  RENTABILIDAD_COMPRA_DISCRETA,
  COBERTURA_COMPRA_MAXIMA,
  coberturaValida,
} from "@/lib/compras";
import { vacio as sinValores } from "@/lib/filtros";
import {
  fmtFechaCorta,
  fmtFechaCortaConAnio,
  fmtMes,
  fmtMoneda,
  fmtNumero,
  fmtPct,
} from "@/lib/format";
import { PALETA, TEMA } from "@/lib/paleta";
import {
  COBERTURA_OBJETIVO_DIAS,
  PLAZO_REPOSICION_DIAS,
  VENTANAS_RITMO,
  VENTANA_POR_DEFECTO,
} from "@/lib/stock";
import { useDatosTablero } from "@/lib/useDatosTablero";
import { RESUMEN_CABECERA, type OrdenSigma } from "@/lib/sigma-orden";
import type { OrdenEnviada } from "@/lib/queries-ordenes";
import { aXlsx } from "@/lib/xlsx";
import type { DashboardCompras, FilaCompra, FiltrosCompras } from "@/lib/types";

type Opciones = {
  proveedores: string[];
  marcas: string[];
  grupos: string[];
  meses: string[];
};
type Respuesta = DashboardCompras & { opciones: Opciones | null };

/**
 * Lo que muestra una celda editable cuando el número es CERO: nada.
 *
 * POR QUÉ NO MUESTRA EL 0. Un `0` en la celda no es un dato, es un obstáculo:
 * para escribir 1 hay que borrarlo primero, y si el cursor queda del lado
 * equivocado sale `10`. Con cantidades y descuentos eso no es un typo
 * cualquiera -- es pedir diez veces de más, o un descuento de 10 puntos que
 * nadie negoció, en un archivo que después alguien importa sin volver a mirar.
 *
 * Vacío y cero son lo mismo acá: un renglón sin cantidad es un artículo que no
 * se pide, y no hay ninguna diferencia entre "no puse nada" y "puse cero". Por
 * eso se puede tratar igual sin perder información -- y `editar` ya convierte
 * el vacío en 0 cuando la persona termina.
 */
function sinCero(n: number | undefined): number | string {
  return n ? n : "";
}

const CLASE_CELDA_EDITABLE =
  "border-line bg-panel-2 text-ink focus:border-c1 w-16 rounded-md border px-1.5 py-1 text-right text-xs tabular-nums outline-none";

/** Descarga un contenido como archivo. Texto o bytes: al Blob le da igual. */
function bajar(contenido: BlobPart, nombre: string, tipo: string) {
  const url = URL.createObjectURL(new Blob([contenido], { type: tipo }));
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function DashboardComprasPage({
  puedeEnviar,
  usuarioSigma,
}: {
  puedeEnviar: boolean;
  /** Nombre en Sigma de quien va a firmar la orden. `null` fuera de la lista. */
  usuarioSigma: string | null;
}) {
  const inicial: FiltrosCompras = {
    ventana: VENTANA_POR_DEFECTO,
    cobertura: COBERTURA_OBJETIVO_DIAS,
  };
  const [filtros, setFiltros] = useState<FiltrosCompras>(inicial);
  const [buscado, setBuscado] = useState("");

  /**
   * LO QUE EL USUARIO CAMBIÓ A MANO, por SKU. Sólo eso.
   *
   * SE GUARDAN LAS EDICIONES Y NO LA ORDEN ENTERA, que es la diferencia que
   * importa: la orden se deriva de las filas que llegaron más lo que la persona
   * tocó encima. Guardando la orden completa habría que copiarla cada vez que
   * el servidor manda filas nuevas —y eso es un `setState` adentro de un
   * efecto, que además de estar prohibido por el lint es una copia que se puede
   * desincronizar del cálculo. Así, un artículo que nadie tocó siempre muestra
   * el sugerido de HOY.
   *
   * Es un borrador y vive en la pantalla: hasta que no se baja el archivo no
   * existe en ningún lado. Va por SKU —y no por posición— para que sobreviva a
   * cambiar un filtro o a reordenar la tabla.
   */
  const [ediciones, setEdiciones] = useState<Map<string, RenglonOrden>>(
    new Map(),
  );

  /**
   * La nota que va en la carátula del Excel del proveedor ("Ofertas agosto").
   *
   * ES OPCIONAL A PROPÓSITO. Bloquear la descarga hasta que alguien escriba
   * algo convierte el campo en un trámite: se termina poniendo "." para poder
   * bajar el archivo, y una nota que dice "." es peor que ninguna. Si está
   * vacío, esa línea simplemente no aparece.
   *
   * No va al archivo de Sigma: la grilla de importación no tiene dónde ponerla.
   */
  const [comentario, setComentario] = useState("");

  /**
   * El envío de la orden al ERP, en tres estados: nada, confirmando, mandando.
   *
   * HAY UN PASO DE CONFIRMACIÓN Y NO ES UN `confirm()` DEL NAVEGADOR. Lo que
   * hay que revisar antes de mandar son diez números y seis códigos de
   * cabecera; un cartel que diga «¿estás seguro?» no deja revisar nada, y lo
   * único que enseña es a apretar Aceptar sin leer.
   */
  const [confirmando, setConfirmando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<
    | { ok: true; enviado: OrdenSigma }
    // `mandado` parte el fracaso en dos casos que NO se tratan igual: uno se
    // reintenta, el otro se revisa en Sigma antes de tocar nada.
    | {
        ok: false;
        mandado: boolean;
        error: string;
        problemas?: string[];
        enviado?: OrdenSigma;
      }
    | null
  >(null);

  // EL HISTORIAL SE PIDE APARTE Y A DEMANDA. Es la constancia de lo que ya se
  // mandó: no cambia con los filtros, no hace falta para armar la orden, y
  // pedirlo con cada cambio de proveedor sería una consulta de más en cada
  // click. Se trae al abrir el panel y se refresca al mandar una orden.
  const [historial, setHistorial] = useState<OrdenEnviada[] | null>(null);
  const [cargandoHistorial, setCargandoHistorial] = useState(false);

  const traerHistorial = useCallback(async () => {
    setCargandoHistorial(true);
    try {
      const r = await fetch("/api/compras/ordenes");
      const json = await r.json();
      setHistorial(Array.isArray(json.ordenes) ? json.ordenes : []);
    } catch {
      setHistorial([]);
    } finally {
      setCargandoHistorial(false);
    }
  }, []);

  const coberturaElegida = filtros.cobertura ?? COBERTURA_OBJETIVO_DIAS;
  // Sólo dice si el campo manual está ABIERTO. El valor vive en los filtros,
  // como todo lo demás: si esto guardara el número, elegir 60 desde un chip y
  // volver a "Otro" mostraría el valor viejo.
  const [otroDias, setOtroDias] = useState(
    !COBERTURAS_COMPRA.some((d) => d === coberturaElegida),
  );

  const { data, cargando, error, recargar, empezarCarga } =
    useDatosTablero<Respuesta>(
      "/api/compras",
      {
        proveedor: filtros.proveedor,
        grupo: filtros.grupo,
        marca: filtros.marca,
        buscar: filtros.buscar ? [filtros.buscar] : undefined,
        ventana: [String(filtros.ventana ?? VENTANA_POR_DEFECTO)],
        cobertura: [String(filtros.cobertura ?? COBERTURA_OBJETIVO_DIAS)],
        mes: filtros.mes ? [filtros.mes] : undefined,
        todos: filtros.todos ? ["1"] : undefined,
        soloOferta: filtros.soloOferta ? ["1"] : undefined,
        // RED DE SEGURIDAD. `satisfies` obliga a que estén TODAS las claves
        // de FiltrosCompras: si mañana se agrega un filtro y se olvida acá, esto
        // rompe el build.
        //
        // Existe porque ya pasó. El filtro de Empresa se cableó en el tipo, en
        // la ruta de API, en el SQL y en el selector -- y faltó esta línea, que
        // es la que lo mete en la query string. Sin ella el filtro cambiaba pero
        // la URL no, el efecto no se volvía a disparar y la pantalla quedaba
        // sombreada para siempre. Ni tsc, ni eslint, ni el build lo veían: para
        // todos ellos era un objeto válido al que le faltaba una clave.
      } satisfies Record<keyof FiltrosCompras, string | string[] | undefined>,
      { conOpciones: "1" },
    );

  const filas = useMemo(() => data?.filas ?? [], [data]);

  /**
   * La orden como está ahora: el sugerido de cada artículo, con lo editado
   * encima. Un artículo que nadie tocó arranca con la cantidad sugerida y con
   * la oferta del proveedor del mes elegido.
   */
  const orden = useMemo(
    () =>
      new Map(
        filas.map((f) => [f.sku, ediciones.get(f.sku) ?? renglonInicial(f)]),
      ),
    [filas, ediciones],
  );

  const cambiar = (f: FiltrosCompras) => {
    empezarCarga();
    setFiltros(f);
  };

  /**
   * Vuelve al punto de partida sin recargar la página.
   *
   * Es lo que hace falta después de mandar una orden: sin esto la pantalla se
   * queda con el cartel del resultado y con la orden anterior armada, y la
   * única salida era F5 --que además vuelve a pedir todos los datos.
   *
   * Borrar las ediciones NO deja la pantalla vacía: la orden se DERIVA del
   * sugerido, así que sin ediciones encima cada artículo vuelve a su cantidad
   * sugerida. Es exactamente el estado en el que estaba al abrir la sección.
   */
  const empezarDeNuevo = () => {
    setResultado(null);
    setConfirmando(false);
    setEdiciones(new Map());
    setComentario("");
  };

  /** Saca un renglón de la orden. Cantidad 0 es "no lo pidas", no "pedí cero". */
  const sacarDeLaOrden = (sku: string) => editar(sku, { cantidad: 0 });

  const editar = (sku: string, parche: Partial<RenglonOrden>) => {
    const actual = orden.get(sku);
    if (!actual) return;
    setEdiciones((previo) => {
      const siguiente = new Map(previo);
      siguiente.set(sku, { ...actual, ...parche });
      return siguiente;
    });
  };

  /** Cambia la unidad de TODAS las filas visibles, recalculando la cantidad. */
  const todasEnUnidad = (unidad: ClaveUnidadCompra) =>
    setEdiciones((previo) => {
      const siguiente = new Map(previo);
      for (const f of filas) {
        const actual = orden.get(f.sku);
        if (!actual) continue;
        // La cantidad se recalcula desde las UNIDADES que ya había pedido, no
        // desde el sugerido: si pidió 5 bultos y pasa a unidades, tiene que ver
        // esas mismas unidades, no volver al cálculo original.
        const unidades = aUnidades(
          actual.cantidad,
          actual.unidad,
          f.unidadesPorBulto,
        );
        siguiente.set(f.sku, {
          ...actual,
          unidad,
          cantidad: cantidadSugerida(unidades, unidad, f.unidadesPorBulto),
        });
      }
      return siguiente;
    });

  // Borrar las ediciones ES volver al sugerido: como la orden se deriva, sin
  // nada encima cada artículo vuelve a mostrar lo que el cálculo pide hoy.
  const volverAlSugerido = () =>
    setEdiciones((previo) => {
      const siguiente = new Map(previo);
      for (const f of filas) siguiente.delete(f.sku);
      return siguiente;
    });

  const vaciar = () =>
    setEdiciones((previo) => {
      const siguiente = new Map(previo);
      for (const f of filas) {
        const actual = orden.get(f.sku);
        if (actual) siguiente.set(f.sku, { ...actual, cantidad: 0 });
      }
      return siguiente;
    });

  // --- Los totales de la orden, que es lo que se está por comprar ----------
  const resumen = useMemo(() => {
    let renglones = 0;
    let unidades = 0;
    let bultos = 0;
    let bruto = 0;
    let neto = 0;
    let recortados = 0;
    // Renglones a los que el maestro no les tiene cargado el código con el que
    // el proveedor los vende. No rompen nada —van al Excel con la celda
    // vacía— pero el que recibe el mail no los va a poder identificar.
    let sinCodigo = 0;
    for (const f of filas) {
      const r = orden.get(f.sku);
      if (!r || !(r.cantidad > 0)) continue;
      renglones += 1;
      if (!f.codigoCompra) sinCodigo += 1;
      const u = aUnidades(r.cantidad, r.unidad, f.unidadesPorBulto);
      unidades += u;
      if (r.unidad === "bulto") bultos += r.cantidad;
      const lista = f.costoLista > 0 ? f.costoLista : f.costo;
      if (r.descuento > DESCUENTO_MAXIMO || r.descuento2 > DESCUENTO_MAXIMO)
        recortados += 1;
      bruto += u * lista;
      neto += u * lista * factorNeto(r.descuento, r.descuento2);
    }
    return { renglones, unidades, bultos, bruto, neto, recortados, sinCodigo };
  }, [filas, orden]);

  /**
   * Los renglones que hoy tienen cantidad, con su nombre. Es lo que se manda, y
   * también lo que se muestra para poder sacar uno cuando Sigma rechaza la
   * orden por culpa de un artículo concreto.
   */
  const renglonesDeLaOrden = useMemo(
    () =>
      filas
        .map((f) => ({ fila: f, renglon: orden.get(f.sku) }))
        .filter((r) => (r.renglon?.cantidad ?? 0) > 0),
    [filas, orden],
  );

  // LAS ÓRDENES SON POR PROVEEDOR. Con dos elegidos el archivo mezclaría
  // proveedores en una sola orden, que es algo que no existe.
  const proveedorUnico =
    filtros.proveedor?.length === 1 ? filtros.proveedor[0] : null;

  const descargar = (formato: "txt" | "csv" | "xlsx") => {
    if (!proveedorUnico) return;
    if (formato === "xlsx") {
      // El Excel se arma de las FILAS y no de las líneas de Sigma: necesita el
      // costo, el EAN y el nombre del artículo, que a ese archivo no van.
      const libro = excelParaProveedor(
        filas,
        orden,
        proveedorUnico,
        comentario,
      );
      if (libro.filas.length === 0) return;
      bajar(
        aXlsx(libro),
        nombreArchivo(proveedorUnico, "xlsx"),
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
      return;
    }
    const lineas = lineasParaExportar(filas, orden);
    if (lineas.length === 0) return;
    if (formato === "txt") {
      bajar(
        aTxt(lineas),
        nombreArchivo(proveedorUnico, "txt"),
        "text/plain;charset=utf-8",
      );
    } else {
      bajar(
        aCsv(lineas),
        nombreArchivo(proveedorUnico, "csv"),
        "text/csv;charset=utf-8",
      );
    }
  };

  /**
   * Manda la orden al ERP.
   *
   * VIAJA LO QUE LA PERSONA DECIDIÓ Y NADA MÁS: SKU, unidad, cantidad y los dos
   * descuentos. El precio lo vuelve a leer el servidor de la base -- si se
   * mandara desde acá, cualquiera con la consola abierta podría cargar una
   * orden al precio que quiera.
   */
  const enviarASigma = async () => {
    if (!proveedorUnico || resumen.renglones === 0) return;
    setEnviando(true);
    setResultado(null);
    try {
      const renglones = filas
        .map((f) => ({ sku: f.sku, ...orden.get(f.sku) }))
        .filter((r) => (r.cantidad ?? 0) > 0);

      const r = await fetch("/api/compras/sigma", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ renglones, mes: data?.mes, nota: comentario }),
      });
      const json = await r.json();
      // Salió o no salió, quedó registrada: si el panel está abierto, que se
      // vea sin tener que recargar la página.
      if (historial !== null) void traerHistorial();

      if (r.ok) {
        setResultado({ ok: true, enviado: json.enviado as OrdenSigma });
        setConfirmando(false);
      } else {
        setResultado({
          ok: false,
          // Ante la duda, "puede haber entrado". Un falso "revisá en Sigma"
          // cuesta treinta segundos; un falso "no se mandó" cuesta una orden
          // de compra duplicada en el ERP de un proveedor.
          mandado: json.mandado !== false,
          error: json.error ?? `Error ${r.status}`,
          problemas: json.problemas,
          // El cuerpo exacto que salió, para poder mirarlo cuando el ERP
          // contesta algo que no está en su tabla de errores.
          enviado: json.enviado as OrdenSigma | undefined,
        });
      }
    } catch (e) {
      // Si el fetch se cortó, no sabemos si el pedido llegó a salir del
      // navegador. Se asume que sí, por lo mismo de arriba.
      setResultado({
        ok: false,
        mandado: true,
        error: e instanceof Error ? e.message : "Error de red",
      });
    } finally {
      setEnviando(false);
    }
  };

  // Hay sell in del proveedor cargado para ese mes, o todavía no.
  const sellInHayDatos = (data?.sellInCargado ?? 0) > 0;

  const sinCambios =
    sinValores(filtros.grupo) &&
    sinValores(filtros.proveedor) &&
    sinValores(filtros.marca) &&
    !filtros.buscar &&
    !filtros.todos &&
    !filtros.mes &&
    (filtros.ventana ?? VENTANA_POR_DEFECTO) === VENTANA_POR_DEFECTO;

  const columnas: Columna<FilaCompra>[] = [
    { titulo: "SKU", celda: (f) => f.sku, orden: (f) => f.sku },
    {
      titulo: "Artículo",
      celda: (f) => (
        <span
          className="block max-w-[136px] truncate sm:max-w-[240px]"
          title={f.producto ?? undefined}
        >
          {f.producto ?? "—"}
        </span>
      ),
      orden: (f) => f.producto,
      // El recuento va en esta columna y no en la del SKU para no pisar
      // la etiqueta "Total", que es la que dice si la tabla está recortada.
      total: `${fmtNumero(contarSkus(filas, (f) => f.sku))} SKU`,
    },
    {
      titulo: "U. x bulto",
      ayuda:
        "Cuántas unidades trae un bulto, según el maestro de Sigma. Es lo que convierte la cantidad cuando se pide por bulto; los artículos que no se compran así figuran en 1.",
      celda: (f) =>
        f.unidadesPorBulto > 1 ? fmtNumero(f.unidadesPorBulto) : "—",
      numerica: true,
      orden: (f) => f.unidadesPorBulto,
    },
    {
      titulo: "Stock",
      ayuda:
        "Las unidades que hay hoy: depósito de Tucumán más Mercado Libre Full. Es stock físico, NO descuenta lo ya pedido y todavía no recibido -- Digip informa tránsito y recepción en cero.",
      celda: (f) => fmtNumero(f.total),
      numerica: true,
      orden: (f) => f.total,
      total: fmtNumero(sumar(filas, (f) => f.total)),
    },
    {
      titulo: "Cobertura",
      ayuda:
        "Para cuántos días alcanza el stock actual al ritmo al que se vende. Vacío cuando no hubo ventas en la ventana: sin ritmo no hay días que estimar, que no es lo mismo que cero.",
      celda: (f) =>
        f.cobertura == null ? (
          <span className="text-muted">sin venta</span>
        ) : (
          <span
            style={
              f.cobertura < PLAZO_REPOSICION_DIAS
                ? { color: TEMA.negativo }
                : undefined
            }
          >
            {fmtNumero(Math.round(f.cobertura))} d
          </span>
        ),
      numerica: true,
      orden: (f) => f.cobertura ?? 999_999,
    },
    {
      titulo: "Sugerido u.",
      ayuda:
        "Las unidades que el cálculo propone comprar: lo que falta para cubrir los días elegidos más el plazo de reposición, movido por la oferta y recortado por el techo. Pasá el mouse por el número para ver de dónde sale.",
      // El número solo no alcanza para firmar una compra: el que decide tiene
      // que poder ver de dónde salió sin preguntarle a nadie. Por eso el
      // tooltip trae la cuenta entera, paso por paso.
      celda: (f) => {
        // La cobertura sale de `data` y no de `filtros`: es la que el servidor
        // usó para ESTAS filas. Mientras una consulta viaja las dos difieren.
        const texto = porQueSugerido(
          f,
          data?.cobertura ?? coberturaElegida,
        ).join("\n");
        if (f.sugerido <= 0) {
          return (
            <span className="text-muted" title={texto}>
              —
            </span>
          );
        }
        return (
          <span
            title={texto}
            // Subrayado punteado: la señal de que hay algo para leer al pasar
            // por encima. Sin eso el tooltip existe y nadie se entera.
            className={
              f.factorOferta > 1
                ? "decoration-dotted underline underline-offset-2"
                : "decoration-dotted underline underline-offset-2 opacity-90"
            }
            style={f.factorOferta > 1 ? { color: PALETA[1] } : undefined}
          >
            {fmtNumero(f.sugerido)}
            {f.factorOferta > 1 ? ` ×${f.factorOferta.toFixed(1)}` : ""}
          </span>
        );
      },
      numerica: true,
      orden: (f) => f.sugerido,
      total: fmtNumero(sumar(filas, (f) => f.sugerido)),
    },
    {
      // La decisión que el usuario pidió poder tomar fila por fila: la mayoría
      // se compra por bulto, pero hay excepciones.
      titulo: "Unidad",
      ayuda:
        "Si el renglón se pide por bulto o por unidad. Cambia cómo se lee la cantidad de al lado, no lo que se compra.",
      celda: (f) => {
        const r = orden.get(f.sku);
        return (
          <select
            value={r?.unidad ?? "unidad"}
            onChange={(e) => {
              const unidad = e.target.value as ClaveUnidadCompra;
              const actual = orden.get(f.sku);
              if (!actual) return;
              const unidades = aUnidades(
                actual.cantidad,
                actual.unidad,
                f.unidadesPorBulto,
              );
              editar(f.sku, {
                unidad,
                cantidad: cantidadSugerida(
                  unidades,
                  unidad,
                  f.unidadesPorBulto,
                ),
              });
            }}
            className="border-line bg-panel-2 text-ink focus:border-c1 rounded-md border px-1.5 py-1 text-xs outline-none"
          >
            {UNIDADES_COMPRA.map((u) => (
              <option key={u.clave} value={u.clave}>
                {u.label}
              </option>
            ))}
          </select>
        );
      },
      orden: (f) => orden.get(f.sku)?.unidad ?? "",
    },
    {
      titulo: "Cantidad",
      ayuda:
        "Lo que se va a pedir, en la unidad de la columna anterior. Arranca en el sugerido y se puede escribir encima; vaciar la celda vuelve al sugerido.",
      celda: (f) => {
        const r = orden.get(f.sku);
        return (
          <input
            type="number"
            min={0}
            step={1}
            value={sinCero(r?.cantidad)}
            onChange={(e) =>
              editar(f.sku, {
                cantidad: Math.max(0, Math.floor(Number(e.target.value) || 0)),
              })
            }
            className={CLASE_CELDA_EDITABLE}
            aria-label={`Cantidad a comprar de ${f.sku}`}
          />
        );
      },
      numerica: true,
      orden: (f) => orden.get(f.sku)?.cantidad ?? 0,
    },
    {
      titulo: "Unidades",
      ayuda:
        "La cantidad convertida a unidades sueltas, que es lo que realmente se compra. En un renglón por bulto es la cantidad por las unidades por bulto.",
      // Cuántas unidades físicas son, que es lo único comparable entre una fila
      // en bultos y otra en unidades.
      celda: (f) => {
        const r = orden.get(f.sku);
        if (!r || r.cantidad <= 0) return <span className="text-muted">—</span>;
        return fmtNumero(aUnidades(r.cantidad, r.unidad, f.unidadesPorBulto));
      },
      numerica: true,
      orden: (f) => {
        const r = orden.get(f.sku);
        return r ? aUnidades(r.cantidad, r.unidad, f.unidadesPorBulto) : 0;
      },
      total: fmtNumero(resumen.unidades),
    },
    {
      titulo: "Desc 1 (Sell in) %",
      ayuda:
        "El descuento VIGENTE del proveedor para el mes elegido, cargado desde la planilla de sell in. Es el único que viaja al ERP como descuento 1. Vacío es que todavía no se cargó, que no es lo mismo que cero.",
      celda: (f) => {
        const r = orden.get(f.sku);
        const excedido = (r?.descuento ?? 0) > DESCUENTO_MAXIMO;
        return (
          <input
            type="number"
            min={0}
            max={DESCUENTO_MAXIMO}
            step={0.5}
            value={sinCero(r?.descuento)}
            onChange={(e) =>
              editar(f.sku, { descuento: Number(e.target.value) || 0 })
            }
            className={`${CLASE_CELDA_EDITABLE} ${excedido ? "border-rose-500/60" : ""}`}
            title={
              f.sellInPct == null
                ? "El sell in del proveedor no está cargado para este mes: arranca en 0 y hay que ponerlo a mano"
                : `Sell in del proveedor en el mes elegido: ${f.sellInPct.toFixed(2)} %`
            }
            aria-label={`Desc 1 de ${f.sku}`}
          />
        );
      },
      numerica: true,
      orden: (f) => orden.get(f.sku)?.descuento ?? 0,
    },
    {
      // EL SEGUNDO DESCUENTO ARRANCA VACÍO Y NO SALE DE NINGÚN DATO: es el que
      // se negocia por fuera del sell in de lista. Se aplica EN CASCADA sobre
      // lo que quedó del primero, no sumado -- ver factorNeto en lib/compras.
      titulo: "Desc 2 %",
      ayuda:
        "Un segundo descuento, a mano y vacío por defecto. Se aplica EN CASCADA sobre el primero: 15 % y 10 % no son 25 % sino 23,5 %.",
      celda: (f) => {
        const r = orden.get(f.sku);
        const excedido = (r?.descuento2 ?? 0) > DESCUENTO_MAXIMO;
        const d1 = descuentoValido(r?.descuento ?? 0);
        const d2 = descuentoValido(r?.descuento2 ?? 0);
        return (
          <input
            type="number"
            min={0}
            max={DESCUENTO_MAXIMO}
            step={0.5}
            value={sinCero(r?.descuento2)}
            onChange={(e) =>
              editar(f.sku, { descuento2: Number(e.target.value) || 0 })
            }
            className={`${CLASE_CELDA_EDITABLE} ${excedido ? "border-rose-500/60" : ""}`}
            title={
              d2 > 0
                ? `${d1} % y ${d2} % en cascada = ${((1 - factorNeto(d1, d2)) * 100).toFixed(2)} % de descuento total (no ${(d1 + d2).toFixed(2)} %)`
                : "Segundo descuento, a mano. Se aplica sobre lo que queda después del Desc 1, no se suma."
            }
            aria-label={`Desc 2 de ${f.sku}`}
          />
        );
      },
      numerica: true,
      orden: (f) => orden.get(f.sku)?.descuento2 ?? 0,
    },
    {
      // REFERENCIA, NO VIAJA AL ARCHIVO. Es el sell in calculado con nuestras
      // compras (costos_historicos.oferta_pct), con el que se viene costeando.
      // Se muestra para poder comparar contra el del proveedor, y el título dice
      // qué es: puesto como "oferta" a secas se copiaría a la orden pensando
      // que es el descuento con el que se pide.
      titulo: "s/ n. compras %",
      ayuda:
        "El descuento que se deduce de lo que efectivamente pagamos en nuestras compras. Se muestra como referencia y NO viaja a la orden: mandarlo sería pedirle al proveedor un descuento que él no ofreció.",
      celda: (f) => (
        <span
          className="text-muted"
          title="Sell in calculado con nuestras compras. No va al archivo."
        >
          {f.ofertaCalculadaPct == null ? "—" : f.ofertaCalculadaPct.toFixed(2)}
        </span>
      ),
      numerica: true,
      orden: (f) => f.ofertaCalculadaPct,
    },
    {
      // De dónde sale depende de qué haya: el sell in del proveedor cuando esté
      // cargado, el calculado mientras tanto. EL TÍTULO DICE CUÁL, que es lo que
      // evita leer un número como si fuera el otro.
      titulo: sellInHayDatos ? "Sell in últ. 6 m" : "s/ n. compras 6 m",
      ayuda: sellInHayDatos
        ? "Los últimos 6 meses del sell in del proveedor, para ver si la oferta de este mes es buena o es la de siempre."
        : "Los últimos 6 meses del descuento deducido de nuestras compras. Se muestra este porque el sell in del proveedor todavía no está cargado.",
      celda: (f) => {
        const h = sellInHayDatos ? f.histSellIn : f.histCalculado;
        if (h.length === 0) return <span className="text-muted">—</span>;
        return (
          <span
            className="tabular-nums whitespace-nowrap"
            title={h
              .map((x) => `${fmtMes(x.mes)}: ${x.pct.toFixed(2)} %`)
              .join("\n")}
          >
            {h.map((x) => Math.round(x.pct)).join(" · ")}
          </span>
        );
      },
      // Ordena por el más viejo de la serie contra el actual: lo que interesa
      // es si HOY estamos mejor o peor que el promedio de los últimos meses.
      orden: (f) => {
        const h = sellInHayDatos ? f.histSellIn : f.histCalculado;
        if (h.length === 0) return null;
        return h.reduce((a, x) => a + x.pct, 0) / h.length;
      },
    },
    {
      titulo: "A pagar",
      ayuda:
        "Lo que cuesta este renglón con los dos descuentos ya aplicados en cascada, SIN IVA.",
      celda: (f) => {
        const r = orden.get(f.sku);
        if (!r || r.cantidad <= 0) return <span className="text-muted">—</span>;
        const lista = f.costoLista > 0 ? f.costoLista : f.costo;
        const u = aUnidades(r.cantidad, r.unidad, f.unidadesPorBulto);
        return fmtMoneda(u * lista * factorNeto(r.descuento, r.descuento2));
      },
      numerica: true,
      orden: (f) => {
        const r = orden.get(f.sku);
        if (!r) return 0;
        const lista = f.costoLista > 0 ? f.costoLista : f.costo;
        return (
          aUnidades(r.cantidad, r.unidad, f.unidadesPorBulto) *
          lista *
          factorNeto(r.descuento, r.descuento2)
        );
      },
      total: fmtMoneda(resumen.neto),
    },
    {
      // Para saber si se vende bien o si se estaba liquidando. Son dos motivos
      // distintos para el mismo ritmo de venta, y llevan a comprar distinto.
      titulo: `Rent. ${MESES_RENTABILIDAD} meses`,
      ayuda: `La rentabilidad del artículo en los últimos ${MESES_RENTABILIDAD} meses. Dice si el artículo deja plata, no si hace falta comprarlo.`,
      celda: (f) =>
        f.rentabilidad == null ? (
          <span className="text-muted">sin venta</span>
        ) : (
          <span
            style={{
              color:
                f.rentabilidad < 0
                  ? TEMA.negativo
                  : f.rentabilidad < 0.1
                    ? PALETA[3]
                    : undefined,
            }}
            title={`${fmtNumero(f.udsRentabilidad)} unidades vendidas`}
          >
            {fmtPct(f.rentabilidad)}
          </span>
        ),
      numerica: true,
      orden: (f) => f.rentabilidad,
    },
    {
      // La del mes que acaba de cerrar, aparte de la ventana móvil: es contra
      // ésta que se mira si la oferta que el proveedor ofrece ahora conviene.
      titulo: `Rent. ${data ? fmtMes(data.mesPasado) : "mes pasado"}`,
      ayuda:
        "La rentabilidad del mes que acaba de cerrar, aparte de la ventana móvil. Es contra lo que se mira si la oferta que el proveedor ofrece ahora conviene.",
      celda: (f) =>
        f.rentMesPasado == null ? (
          <span className="text-muted">sin venta</span>
        ) : (
          <span
            style={{
              color:
                f.rentMesPasado < 0
                  ? TEMA.negativo
                  : f.rentMesPasado < 0.1
                    ? PALETA[3]
                    : undefined,
            }}
            title={`${fmtNumero(f.udsMesPasado)} unidades vendidas`}
          >
            {fmtPct(f.rentMesPasado)}
          </span>
        ),
      numerica: true,
      orden: (f) => f.rentMesPasado,
    },
    {
      // TRES ESTADOS Y NO DOS, porque el detalle de renglones casi no viene: de
      // los 173 comprobantes de agosto, 14 traen items. Un "no" a secas sería
      // mentira la mayoría de las veces.
      //
      // Y CUANDO SE SABE, SE DICE CUÁNTO. Un "sí" no distingue una compra de 12
      // unidades de una de 1.200, y esa es justo la comparación que se quiere
      // hacer contra el sugerido de al lado.
      titulo: "Comprado el mes pasado",
      ayuda:
        "Cuántas unidades de este artículo entraron en una factura de compra del mes calendario pasado. " +
        "«No consta» es que se le compró al proveedor pero ese comprobante llegó sin el detalle de renglones. " +
        "«No» es que no hubo ninguna compra a ese proveedor, y eso sí es seguro.",
      celda: (f) => {
        if (f.unidadesMesPasado > 0) {
          const bultos =
            f.unidadesPorBulto > 1
              ? f.unidadesMesPasado / f.unidadesPorBulto
              : null;
          return (
            <span style={{ color: PALETA[1] }}>
              {fmtNumero(f.unidadesMesPasado)} u
              {/* Los bultos sólo si el artículo se compra así Y la cuenta da
                  redonda: "25 bultos" es un dato, "24,7 bultos" es ruido de una
                  compra que no vino en bultos enteros. */}
              {bultos != null && Number.isInteger(bultos) && (
                <span className="text-muted"> · {fmtNumero(bultos)} b</span>
              )}
            </span>
          );
        }
        // Puede haber renglón sin cantidad: sigue siendo un "sí" sin número.
        if (f.compradoMesPasado)
          return <span style={{ color: PALETA[1] }}>sí, sin cantidad</span>;
        if (f.proveedorComproMesPasado)
          return (
            <span
              className="text-muted"
              title="Se le compró al proveedor, pero ese comprobante no trae el detalle de renglones: no se puede saber si incluía este artículo."
            >
              no consta
            </span>
          );
        return (
          <span title="No hubo ninguna compra a este proveedor el mes pasado.">
            no
          </span>
        );
      },
      numerica: true,
      // Ordena por cantidad, y lo que no tiene cantidad va abajo pero en orden:
      // "sí sin número" (-1) sabe más que "no consta" (-2), que sabe más que
      // "no" (-3). Sin esto los tres casos empatarían en 0 con los que no se
      // compraron.
      orden: (f) =>
        f.unidadesMesPasado > 0
          ? f.unidadesMesPasado
          : f.compradoMesPasado
            ? -1
            : f.proveedorComproMesPasado
              ? -2
              : -3,
    },
    {
      titulo: "Última compra",
      ayuda:
        "La fecha de la última factura de compra en la que aparece este artículo. Sale del detalle de renglones, así que un artículo comprado en un comprobante sin detalle no la va a tener.",
      celda: (f) =>
        f.ultimaCompra ? fmtFechaCortaConAnio(f.ultimaCompra) : "—",
      orden: (f) => f.ultimaCompra,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">
            Compras{" "}
            <span className="text-muted text-sm font-normal">
              · armar la orden y bajarla para Sigma
            </span>
          </h1>
          <p className="text-muted mt-1 text-xs">
            {data
              ? `Actualizado ${new Date(data.generadoEn).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}`
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
          {/* Antes que Proveedor: es el corte más grueso. Y en esta pantalla
              importa más todavía, porque la orden de compra se arma por
              proveedor y conviene llegar al de la empresa correcta. */}
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
          <SelectorMultiple
            etiqueta="Marca"
            valores={filtros.marca}
            opciones={data?.opciones?.marcas ?? []}
            onChange={(v) => cambiar({ ...filtros, marca: v })}
          />

          {/* El mes de la oferta: de acá sale el descuento que va al archivo. */}
          <div className="flex flex-col gap-1">
            <label className="text-muted text-[11px]" htmlFor="mes-oferta">
              Sell in del mes
            </label>
            <select
              id="mes-oferta"
              value={data?.mes ?? ""}
              onChange={(e) => cambiar({ ...filtros, mes: e.target.value })}
              className="border-line bg-panel-2 text-ink focus:border-c1 rounded-lg border px-2.5 py-1.5 text-xs outline-none"
            >
              {(data?.meses ?? []).map((m) => (
                <option key={m} value={m}>
                  {fmtMes(m)}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-muted text-[11px]">Ritmo medido sobre</span>
            <div className="flex flex-wrap gap-1">
              {VENTANAS_RITMO.map((v) => {
                const activo = (filtros.ventana ?? VENTANA_POR_DEFECTO) === v;
                return (
                  <button
                    key={v}
                    type="button"
                    onClick={() => cambiar({ ...filtros, ventana: v })}
                    aria-pressed={activo}
                    className={`rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${
                      activo
                        ? "border-c1 bg-c1/15 text-c1"
                        : "border-line text-muted hover:bg-panel-2 hover:text-ink"
                    }`}
                  >
                    {v} días
                  </button>
                );
              })}
            </div>
          </div>

          {/* PARA CUÁNTOS DÍAS SE COMPRA.
              Está al lado de "Ritmo medido sobre" y son lo contrario: aquél
              mira para atrás --sobre cuántos días se midió lo que se vende--,
              éste para adelante. Por eso las dos leyendas dicen la dirección. */}
          <div className="flex flex-col gap-1">
            <span className="text-muted text-[11px]">Comprar para</span>
            <div className="flex flex-wrap items-center gap-1">
              {COBERTURAS_COMPRA.map((d) => {
                const activo = !otroDias && coberturaElegida === d;
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => {
                      setOtroDias(false);
                      cambiar({ ...filtros, cobertura: d });
                    }}
                    aria-pressed={activo}
                    className={`rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${
                      activo
                        ? "border-c1 bg-c1/15 text-c1"
                        : "border-line text-muted hover:bg-panel-2 hover:text-ink"
                    }`}
                  >
                    {d} días
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => setOtroDias(true)}
                aria-pressed={otroDias}
                className={`rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${
                  otroDias
                    ? "border-c1 bg-c1/15 text-c1"
                    : "border-line text-muted hover:bg-panel-2 hover:text-ink"
                }`}
              >
                Otro
              </button>
              {otroDias && (
                <input
                  type="number"
                  min={1}
                  max={COBERTURA_COMPRA_MAXIMA}
                  step={1}
                  value={coberturaElegida}
                  aria-label={`Días de compra, hasta ${COBERTURA_COMPRA_MAXIMA}`}
                  // Se recorta al salir del campo y no en cada tecla: recortando
                  // mientras se escribe, tipear "120" pasa por "1" y "12" y el
                  // campo pelea con los dedos.
                  onChange={(e) =>
                    cambiar({ ...filtros, cobertura: Number(e.target.value) })
                  }
                  onBlur={(e) =>
                    cambiar({
                      ...filtros,
                      cobertura: coberturaValida(Number(e.target.value)),
                    })
                  }
                  className="border-line bg-panel-2 text-ink focus:border-c1 w-20 rounded-lg border px-2.5 py-1.5 text-xs outline-none"
                />
              )}
            </div>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              cambiar({ ...filtros, buscar: buscado.trim() || undefined });
            }}
            className="flex flex-col gap-1"
          >
            <label className="text-muted text-[11px]" htmlFor="buscar-compras">
              Buscar
            </label>
            <input
              id="buscar-compras"
              value={buscado}
              onChange={(e) => setBuscado(e.target.value)}
              onBlur={() =>
                cambiar({ ...filtros, buscar: buscado.trim() || undefined })
              }
              placeholder="SKU o artículo"
              className="border-line bg-panel-2 text-ink placeholder:text-muted focus:border-c1 w-40 rounded-lg border px-2.5 py-1.5 text-xs outline-none"
            />
          </form>

          <button
            type="button"
            onClick={() => cambiar({ ...filtros, todos: !filtros.todos })}
            aria-pressed={filtros.todos ?? false}
            className={`self-end rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${
              filtros.todos
                ? "border-c1 bg-c1/15 text-c1"
                : "border-line text-muted hover:bg-panel-2 hover:text-ink"
            }`}
          >
            {filtros.todos
              ? "Todos los artículos"
              : "Sólo los que hay que comprar"}
          </button>

          <BotonLimpiar
            onClick={() => {
              setBuscado("");
              cambiar(inicial);
            }}
            deshabilitado={sinCambios}
          />
        </div>

        <span className="text-muted text-[11px] leading-tight">
          El <strong>sugerido</strong> es lo que falta para cubrir{" "}
          {(data?.cobertura ?? coberturaElegida) + PLAZO_REPOSICION_DIAS} días
          de venta ({data?.cobertura ?? coberturaElegida} que elegiste comprar
          más {PLAZO_REPOSICION_DIAS} que tarda la reposición) al ritmo de los
          últimos {filtros.ventana ?? VENTANA_POR_DEFECTO} días, contando el
          stock de <strong>los dos depósitos</strong>. El{" "}
          <strong>descuento</strong> es el{" "}
          <strong>sell in vigente del proveedor</strong> del mes elegido y se
          puede corregir fila por fila.
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

      {error ? null : !data ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Esqueleto key={i} className="h-[86px]" />
          ))}
        </div>
      ) : (
        <div
          className={`grid grid-cols-2 gap-3 transition-opacity sm:grid-cols-2 lg:grid-cols-4 ${cargando ? "opacity-50" : ""}`}
        >
          <TarjetaKpi
            titulo="Renglones en la orden"
            valor={fmtNumero(resumen.renglones)}
            detalle={`de ${fmtNumero(filas.length)} artículos a la vista`}
          />
          <TarjetaKpi
            titulo="Unidades a pedir"
            valor={fmtNumero(resumen.unidades)}
            detalle={
              resumen.bultos > 0
                ? `${fmtNumero(resumen.bultos)} bultos`
                : "todo por unidad"
            }
          />
          <TarjetaKpi
            titulo="A pagar con descuento, sin IVA"
            valor={fmtMoneda(resumen.neto)}
            detalle={`Sin descuento serían ${fmtMoneda(resumen.bruto)}`}
            acento={resumen.neto > 0 ? PALETA[1] : undefined}
          />
          <TarjetaKpi
            titulo="Ahorro por el descuento"
            valor={fmtMoneda(resumen.bruto - resumen.neto)}
            detalle={
              data.sellInCargado > 0
                ? `Sell in de ${fmtMes(data.mes)} · ${fmtNumero(data.sellInCargado)} artículos`
                : "Sell in sin cargar: los descuentos van a mano"
            }
            acento={data.sellInCargado === 0 ? PALETA[3] : undefined}
          />
        </div>
      )}

      {data && (
        <div
          className={`space-y-4 transition-opacity ${cargando ? "opacity-50" : ""}`}
        >
          {/* La barra de la orden: acciones sobre todo lo que se ve, y la
              descarga. Va arriba de la tabla porque es lo que se hace al final
              y tiene que estar a mano sin scrollear 500 filas. */}
          <div className="border-line bg-panel flex flex-wrap items-center gap-2 rounded-xl border p-3">
            <span className="text-muted mr-1 text-[11px]">Toda la lista:</span>
            {UNIDADES_COMPRA.map((u) => (
              <button
                key={u.clave}
                type="button"
                onClick={() => todasEnUnidad(u.clave)}
                className="border-line hover:bg-panel-2 text-muted hover:text-ink rounded-lg border px-2.5 py-1.5 text-xs"
              >
                Pasar a {u.label.toLowerCase()}
              </button>
            ))}
            <button
              type="button"
              onClick={volverAlSugerido}
              className="border-line hover:bg-panel-2 text-muted hover:text-ink rounded-lg border px-2.5 py-1.5 text-xs"
            >
              Volver al sugerido
            </button>
            <button
              type="button"
              onClick={vaciar}
              className="border-line hover:bg-panel-2 text-muted hover:text-ink rounded-lg border px-2.5 py-1.5 text-xs"
            >
              Vaciar cantidades
            </button>
            {/* NO ES UN BOTÓN MÁS DE LA FILA: los de al lado tocan la orden
                --la unidad, las cantidades--, éste toca QUÉ SE VE. Se queda
                acá igual porque es el mismo gesto ("preparame la tabla para
                esto") y separarlo en otra fila lo escondería. Por eso se
                enciende como los chips de filtro y no como los de acción. */}
            <button
              type="button"
              onClick={() =>
                cambiar({ ...filtros, soloOferta: !filtros.soloOferta })
              }
              aria-pressed={filtros.soloOferta ?? false}
              title="Deja sólo los artículos con sell in del proveedor cargado para el mes elegido."
              className={`rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${
                filtros.soloOferta
                  ? "border-c1 bg-c1/15 text-c1"
                  : "border-line text-muted hover:bg-panel-2 hover:text-ink"
              }`}
            >
              Dejar sólo con oferta
            </button>

            <div className="ml-auto flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={comentario}
                onChange={(e) => setComentario(e.target.value)}
                maxLength={120}
                placeholder="Nota para el proveedor (ej. Ofertas agosto)"
                title="Sale en la carátula del Excel, debajo del título. Opcional; no va al archivo de Sigma."
                aria-label="Nota para la carátula del Excel"
                className="border-line bg-panel-2 text-ink placeholder:text-muted focus:border-c1 w-60 rounded-lg border px-2.5 py-1.5 text-xs outline-none"
              />
              {!proveedorUnico && (
                <span className="text-muted text-[11px]">
                  Elegí <strong>un</strong> proveedor para bajar la orden
                </span>
              )}
              <button
                type="button"
                onClick={() => descargar("txt")}
                disabled={!proveedorUnico || resumen.renglones === 0}
                className="border-c1 bg-c1/15 text-c1 hover:bg-c1/25 rounded-lg border px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-40"
              >
                Bajar TXT para Sigma
              </button>
              {/* El botón que escribe en el ERP sólo lo ve quien puede usarlo.
                  Esconderlo no es el permiso --de eso se encarga la ruta de
                  API-- pero ofrecer un botón que va a contestar 403 es peor
                  que no ofrecerlo. */}
              {puedeEnviar && (
                <button
                  type="button"
                  onClick={() => {
                    setResultado(null);
                    setConfirmando((v) => !v);
                  }}
                  disabled={!proveedorUnico || resumen.renglones === 0}
                  title="Carga la orden directamente en Sigma. Pide confirmar antes."
                  className="border-c1 bg-c1 text-panel hover:bg-c1/85 rounded-lg border px-3 py-1.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Enviar a Sigma
                </button>
              )}
              <button
                type="button"
                onClick={() => descargar("xlsx")}
                disabled={!proveedorUnico || resumen.renglones === 0}
                title="Excel valorizado, con el código y el EAN del proveedor, para mandarle por mail"
                className="border-c1 bg-c1/15 text-c1 hover:bg-c1/25 rounded-lg border px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-40"
              >
                Bajar Excel para el proveedor
              </button>
              <button
                type="button"
                onClick={() => descargar("csv")}
                disabled={!proveedorUnico || resumen.renglones === 0}
                className="border-line hover:bg-panel-2 text-muted hover:text-ink rounded-lg border px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-40"
              >
                Bajar CSV
              </button>
            </div>
          </div>

          {/* LA CONFIRMACIÓN DEL ENVÍO.
              Muestra lo que la persona decidió y, sobre todo, los seis códigos
              de cabecera que NO eligió y que igual van a quedar cargados. Un
              cartel de «¿estás seguro?» no dejaría revisar nada. */}
          {puedeEnviar && confirmando && (
            <div className="border-c1 bg-panel space-y-3 rounded-xl border p-4">
              <p className="text-ink text-sm font-medium">
                Se va a cargar una orden de compra en Sigma. No se puede
                deshacer desde acá: si sale mal, hay que anularla en Sigma.
              </p>
              <div className="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
                <div className="flex justify-between gap-3">
                  <span className="text-muted">Proveedor</span>
                  <strong className="text-right">{proveedorUnico}</strong>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-muted">Renglones</span>
                  <strong>{fmtNumero(resumen.renglones)}</strong>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-muted">Unidades</span>
                  <strong>{fmtNumero(resumen.unidades)}</strong>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-muted">
                    A pagar con descuento, sin IVA
                  </span>
                  <strong>{fmtMoneda(resumen.neto)}</strong>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-muted">Queda a nombre de</span>
                  <strong>{usuarioSigma ?? "—"}</strong>
                </div>
                {RESUMEN_CABECERA.map((c) => (
                  <div key={c.campo} className="flex justify-between gap-3">
                    <span className="text-muted">{c.campo}</span>
                    <span className="font-mono">{c.valor}</span>
                  </div>
                ))}
                <div className="flex justify-between gap-3 sm:col-span-2">
                  <span className="text-muted">Obs. para el proveedor</span>
                  <span className="text-right">
                    {comentario.trim() || (
                      <em className="text-muted">sin nota</em>
                    )}
                  </span>
                </div>
              </div>
              <p className="text-muted text-[11px]">
                La orden entra en estado <strong>Pendiente</strong>: queda
                cargada pero no aprobada. El precio de cada renglón lo vuelve a
                leer el servidor de la base, no se manda desde esta pantalla.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={enviarASigma}
                  disabled={enviando}
                  className="border-c1 bg-c1 text-panel hover:bg-c1/85 rounded-lg border px-3 py-1.5 text-xs font-medium disabled:opacity-40"
                >
                  {enviando ? "Mandando…" : "Confirmo, mandar la orden"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmando(false)}
                  disabled={enviando}
                  className="border-line hover:bg-panel-2 text-muted hover:text-ink rounded-lg border px-3 py-1.5 text-xs disabled:opacity-40"
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}

          {resultado && (
            <Aviso
              tono={
                resultado.ok ? "info" : resultado.mandado ? "alerta" : "error"
              }
            >
              {resultado.ok ? (
                <>
                  <p className="font-medium">La orden se cargó en Sigma.</p>
                  <p className="mt-1">
                    Proveedor <strong>{resultado.enviado.proveedorId}</strong> ·
                    empresa <strong>{resultado.enviado.empresa}</strong> ·{" "}
                    {fmtNumero(resultado.enviado.items.length)} renglones ·
                    estado <strong>Pendiente</strong>. Buscala en Sigma para
                    aprobarla.
                  </p>
                  {/* Se muestra lo que se mandó, y no un "listo" a secas: en una
                      operación sin deshacer, la constancia de qué se cargó vale
                      más que el mensaje de éxito. */}
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs">
                      Ver lo que se mandó
                    </summary>
                    <pre className="bg-panel-2 mt-1 max-h-64 overflow-auto rounded-md p-2 text-[11px]">
                      {JSON.stringify(resultado.enviado, null, 2)}
                    </pre>
                  </details>
                  {/* Sin esto, después de una orden buena la única forma de
                      armar la siguiente era recargar la página -- y eso vuelve
                      a pedir todos los datos para nada. */}
                  <button
                    type="button"
                    onClick={empezarDeNuevo}
                    className="border-line hover:bg-panel-2 text-muted hover:text-ink mt-3 rounded-lg border px-3 py-1.5 text-xs"
                  >
                    Formular otra orden
                  </button>
                </>
              ) : (
                <>
                  {/* DOS FRACASOS DISTINTOS, Y LA DIFERENCIA NO ES DE TONO.
                      Si nada salió de acá, se corrige y se vuelve a apretar.
                      Si ya se le habló a Sigma, apretar de nuevo puede cargar
                      la orden por segunda vez -- y Sigma contesta 500 hasta
                      cuando la cargó bien, así que este cartel aparece también
                      en los envíos que salieron perfectos. */}
                  {resultado.mandado ? (
                    <>
                      <p className="font-medium">
                        Sigma contestó con un error, pero la orden puede haber
                        quedado cargada igual.
                      </p>
                      <p className="mt-1">
                        <strong>
                          No vuelvas a mandarla sin revisar primero en Sigma.
                        </strong>{" "}
                        Su API contesta un error también cuando la orden entra
                        bien, así que este mensaje no distingue una cosa de la
                        otra. Buscá la orden en «Órdenes de compra» del
                        proveedor
                        {resultado.enviado ? (
                          <>
                            {" "}
                            <strong>{resultado.enviado.proveedorId}</strong>
                          </>
                        ) : null}
                        : si está, listo; si no está, recién ahí volvé a
                        mandarla.
                      </p>
                    </>
                  ) : (
                    <p className="font-medium">
                      No se mandó la orden. Nada salió del tablero, así que
                      podés corregir y volver a intentar.
                    </p>
                  )}
                  <p className="mt-1 font-mono text-xs break-words opacity-80">
                    {resultado.error}
                  </p>
                  {resultado.problemas && resultado.problemas.length > 0 && (
                    <ul className="mt-1 list-disc space-y-0.5 pl-5">
                      {resultado.problemas.map((p) => (
                        <li key={p}>{p}</li>
                      ))}
                    </ul>
                  )}
                  {/* CUANDO EL ERP CONTESTA ALGO QUE NO ESTÁ EN SU TABLA DE
                      ERRORES, el mensaje solo no alcanza para arreglar nada:
                      hay que ver qué se le mandó. Va acá y no en la consola
                      porque quien lo necesita es la persona que va a
                      copiárselo a soporte. */}
                  {resultado.enviado && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs">
                        Ver lo que se intentó mandar
                      </summary>
                      <pre className="bg-panel-2 mt-1 max-h-64 overflow-auto rounded-md p-2 text-[11px]">
                        {JSON.stringify(resultado.enviado, null, 2)}
                      </pre>
                    </details>
                  )}

                  {/* SACAR EL RENGLÓN QUE MOLESTA, SIN VOLVER A LA TABLA.
                      Sigma rechaza la orden entera por UN artículo --"costo
                      cero", "no existe"-- y decía cuál, pero había que ir a
                      buscarlo entre cientos de filas para vaciarle la cantidad.
                      Acá está la orden como quedó, y cada X lo saca.

                      SÓLO CUANDO NADA SALIÓ. Si ya se le habló a Sigma, editar
                      y reintentar es cargar una segunda orden; ahí abajo va
                      "formular otra" en vez de "reintentar". */}
                  {!resultado.mandado && renglonesDeLaOrden.length > 0 && (
                    <div className="mt-3">
                      <p className="text-xs font-medium">
                        La orden como quedó (
                        {fmtNumero(renglonesDeLaOrden.length)} renglones). Sacá
                        el que sobra y volvé a mandarla:
                      </p>
                      <ul className="border-line mt-1 max-h-48 divide-y divide-white/5 overflow-auto rounded-md border">
                        {renglonesDeLaOrden.map(({ fila, renglon }) => (
                          <li
                            key={fila.sku}
                            className="flex items-center gap-2 px-2 py-1 text-xs"
                          >
                            <button
                              type="button"
                              onClick={() => sacarDeLaOrden(fila.sku)}
                              aria-label={`Sacar ${fila.sku} de la orden`}
                              title="Sacar este renglón de la orden"
                              className="border-line text-muted hover:border-rose-500/40 hover:bg-rose-500/10 hover:text-rose-300 shrink-0 rounded border px-1.5 leading-5"
                            >
                              ✕
                            </button>
                            <span className="font-mono shrink-0">
                              {fila.sku}
                            </span>
                            <span className="text-muted truncate">
                              {fila.producto ?? "—"}
                            </span>
                            <span className="ml-auto shrink-0 tabular-nums">
                              {fmtNumero(renglon!.cantidad)}{" "}
                              {UNIDADES_COMPRA.find(
                                (u) => u.clave === renglon!.unidad,
                              )?.label ?? renglon!.unidad}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {!resultado.mandado && (
                      <button
                        type="button"
                        onClick={enviarASigma}
                        disabled={enviando || renglonesDeLaOrden.length === 0}
                        className="border-c1 bg-c1 text-panel hover:bg-c1/85 rounded-lg border px-3 py-1.5 text-xs font-medium disabled:opacity-40"
                      >
                        {enviando ? "Mandando…" : "Reintentar"}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={empezarDeNuevo}
                      disabled={enviando}
                      className="border-line hover:bg-panel-2 text-muted hover:text-ink rounded-lg border px-3 py-1.5 text-xs disabled:opacity-40"
                    >
                      Formular otra orden
                    </button>
                  </div>
                </>
              )}
            </Aviso>
          )}

          <Panel
            titulo="Artículos"
            nota={
              (data.recortada
                ? `Los ${filas.length} de mayor peso`
                : `${fmtNumero(filas.length)} artículos`) +
              ` · ritmo de ${data.ventana} días` +
              (data.mes ? ` · sell in de ${fmtMes(data.mes)}` : "")
            }
          >
            <Tabla
              filas={filas}
              columnas={columnas}
              etiquetaTotal="Total de la orden"
              clave={(f) => f.sku}
              vacio={
                filtros.todos
                  ? "Ningún artículo para el filtro elegido."
                  : "Nada que comprar con este filtro: ningún artículo está por debajo de la cobertura objetivo."
              }
            />
          </Panel>

          {/* LO QUE YA SE MANDÓ.
              Del lado de Sigma queda el resultado; lo que se PIDIÓ --cantidad,
              unidad, precio y descuentos de cada renglón-- no queda en ningún
              lado. Acá sí, tal como viajó. */}
          <Panel
            titulo="Órdenes ya mandadas"
            nota={
              historial === null
                ? "Constancia de lo que se le mandó a Sigma"
                : `${fmtNumero(historial.length)} órdenes · la más nueva primero`
            }
          >
            {historial === null ? (
              <button
                type="button"
                onClick={() => void traerHistorial()}
                disabled={cargandoHistorial}
                className="border-line text-muted hover:bg-panel-2 hover:text-ink rounded-lg border px-3 py-1.5 text-xs transition-colors disabled:opacity-50"
              >
                {cargandoHistorial ? "Buscando…" : "Ver el historial"}
              </button>
            ) : historial.length === 0 ? (
              <p className="text-muted text-sm">
                Todavía no se mandó ninguna orden desde el tablero.
              </p>
            ) : (
              <div className="space-y-2">
                {historial.map((o) => (
                  <details
                    key={o.id}
                    className="border-line rounded-lg border px-3 py-2"
                  >
                    <summary className="cursor-pointer text-xs">
                      <span className="tabular-nums">{o.enviadaEn}</span>
                      {" · "}
                      <strong>
                        {o.proveedorNombre ?? o.proveedorCodigo ?? "—"}
                      </strong>
                      {" · "}
                      {fmtNumero(o.renglones)} renglones ·{" "}
                      {fmtNumero(o.unidades)} unidades
                      {" · "}
                      {fmtMoneda(o.totalBruto)}
                      {o.resultado === "incierto" && (
                        <span className="ml-2 text-amber-400">
                          · sin confirmar
                        </span>
                      )}
                      {o.usuario ? (
                        <span className="text-muted"> · {o.usuario}</span>
                      ) : null}
                    </summary>
                    {o.nota && (
                      <p className="text-muted mt-1 text-xs">{o.nota}</p>
                    )}
                    {o.resultado === "incierto" && (
                      <p className="mt-1 text-xs text-amber-300">
                        Sigma contestó «{o.respuesta ?? "sin mensaje"}». Eso NO
                        quiere decir que no haya entrado: su API contesta error
                        también cuando la orden se carga bien.
                      </p>
                    )}
                    {/* El cuerpo exacto, que es el punto de todo esto: acá se
                        ve si un renglón se pidió en bultos o en unidades, y a
                        qué precio se lo pidió ese día. */}
                    <pre className="bg-panel-2 mt-2 max-h-64 overflow-auto rounded-md p-2 text-[11px]">
                      {JSON.stringify(o.payload, null, 2)}
                    </pre>
                  </details>
                ))}
              </div>
            )}
          </Panel>

          <Aviso tono="info">
            <p className="font-medium">
              Qué lleva el archivo, y qué mirar antes de mandarlo.
            </p>
            <p className="mt-1">
              El archivo tiene las {COLUMNAS_SIGMA.length} columnas de la grilla
              de Sigma —
              <span className="font-mono text-xs">
                {COLUMNAS_SIGMA.join(" · ")}
              </span>
              — y sólo los renglones con cantidad: un cero no es «comprar cero»,
              es un artículo que decidiste no pedir. El{" "}
              <strong>TXT va separado por tabulaciones</strong> y el CSV por
              punto y coma, porque el descuento lleva coma decimal («15,00») y
              con coma separadora Excel lo parte al medio.
            </p>
            <p className="mt-1">
              <strong>
                Los dos descuentos se aplican en cascada, no se suman.
              </strong>{" "}
              <span className="font-mono text-xs">FDESCU1</span> es el sell in y{" "}
              <span className="font-mono text-xs">FDESCU2</span> el segundo, que
              arranca vacío y se pone a mano. Un 15 % y un 10 %{" "}
              <strong>no son 25 %</strong>: el segundo se calcula sobre lo que
              quedó después del primero, así que el neto es 0,85 × 0,90 = 76,5 %
              del costo, o sea <strong>23,5 %</strong>. Así los liquida el
              proveedor y así los aplica Sigma; en una orden grande la
              diferencia es plata. El{" "}
              <span className="font-mono text-xs">FDESCU2</span> viaja siempre,
              aunque esté en cero: una grilla con la última columna vacía se
              importa, una a la que le falta una columna no.
            </p>
            <p className="mt-1">
              En <span className="font-mono text-xs">UNICOM</span> va
              exactamente{" "}
              {UNIDADES_COMPRA.map((u, i) => (
                <span key={u.clave}>
                  {i > 0 ? " o " : ""}
                  <span className="font-mono text-xs">{u.unicom}</span>
                </span>
              ))}
              . Está escrito acá para poder compararlo con lo que espera Sigma
              sin abrir el archivo: si alguna vez rechaza la importación, es lo
              primero para mirar.
            </p>
            <p className="mt-1">
              <strong>Una orden, un proveedor.</strong> Por eso la descarga pide
              que haya exactamente uno elegido: no existe la orden que mezcla
              dos.
            </p>
            <p className="mt-1">
              <strong>
                El Excel para el proveedor es otro archivo, no otro formato.
              </strong>{" "}
              Sale de los mismos renglones —si acá está en cero, no está en
              ninguno de los dos— pero habla el idioma del que lo recibe: lleva
              su <strong>código de compra</strong> y el <strong>EAN</strong> en
              vez de nuestro SKU, el nombre del artículo, y el costo{" "}
              <em>de la unidad que se le pide</em>: si el renglón va por bulto,
              el costo que se muestra es el del bulto. Arriba de todo lleva la
              carátula —<strong>quién compra, la fecha y a quién</strong>, más
              la nota que escribas al lado del botón— y cierra con el total. La
              empresa que emite sale del <strong>grupo del proveedor</strong>:
              una orden de un proveedor de NOA no la firma Quo. Es para adjuntar
              a un mail, no para importar en ningún lado.
              {resumen.sinCodigo > 0 && (
                <>
                  {" "}
                  <strong>
                    {fmtNumero(resumen.sinCodigo)} de los{" "}
                    {fmtNumero(resumen.renglones)} renglones no tienen cargado
                    el código de compra del proveedor
                  </strong>{" "}
                  en el maestro de Sigma, así que en el Excel esa celda va
                  vacía. El artículo se pide igual —el proveedor lo va a
                  reconocer por el EAN y por el nombre— pero es algo para cargar
                  en Sigma, no acá.
                </>
              )}
            </p>
            <p className="mt-1">
              <strong>
                El Desc 1 es el sell in VIGENTE DEL PROVEEDOR, y hoy no está
                cargado.
              </strong>{" "}
              Vive en la planilla de Google y todavía no se sincroniza sola, así
              que la columna arranca en{" "}
              <strong>0 y hay que ponerla a mano</strong>. Cero acá quiere decir
              «no lo sabemos», no «sin descuento».
            </p>
            <p className="mt-1">
              La columna <strong>«s/ n. compras %»</strong> es otra cosa y{" "}
              <strong>no va al archivo</strong>: es el sell in{" "}
              <em>calculado con nuestras compras</em> (
              <span className="font-mono text-xs">
                costos_historicos.oferta_pct
              </span>
              ), el que se usa para valorizar el costo real y trasladarlo a las
              ofertas del mes. Sirve para comparar, no para pedir: mandarlo en
              una orden sería pedirle al proveedor con un descuento inventado.
              {resumen.recortados > 0 && (
                <>
                  {" "}
                  <strong>
                    Hay {fmtNumero(resumen.recortados)} con descuento mayor a{" "}
                    {DESCUENTO_MAXIMO} %
                  </strong>
                  : se recortan a {DESCUENTO_MAXIMO} antes de exportar. Un
                  descuento así es un error de carga, y en una orden de compra
                  deja de ser un número raro en una pantalla.
                </>
              )}
            </p>
            <p className="mt-1">
              <strong>
                El sugerido no descuenta la mercadería en tránsito.
              </strong>{" "}
              Digip informa las columnas de tránsito y recepción en cero, así
              que un pedido ya hecho y todavía no recibido no se ve por ningún
              lado y el sugerido lo vuelve a pedir. Es lo primero para revisar
              antes de mandar la orden.
            </p>
            <p className="mt-1">
              <strong>
                «Comprado el mes pasado» tiene tres respuestas y no dos.
              </strong>{" "}
              Cuando el artículo aparece en un renglón de compra, muestra{" "}
              <em>cuántas unidades</em> —y los bultos al lado, si la cuenta da
              redonda—, para poder compararlo con el sugerido. <em>No</em> es
              que no hubo ninguna compra a ese proveedor, y eso sí es seguro.{" "}
              <em>No consta</em> es que al proveedor se le compró pero ese
              comprobante llegó sin el detalle de renglones — de los 173
              comprobantes de agosto, 14 traen items—, así que no se puede
              saber. Un «no» ahí sería mentira la mayoría de las veces.
            </p>
            <p className="mt-1">
              <strong>
                Un artículo que no rinde no se compra de más por una oferta.
              </strong>{" "}
              Por debajo del {RENTABILIDAD_COMPRA_DISCRETA} % de rentabilidad
              —el cuartil de abajo del catálogo— el sugerido es sólo lo
              necesario, por buena que esté la oferta: comprar más es plata
              quieta en algo que ya no la devuelve. La excepción es un descuento
              que <em>antes no teníamos</em>, y se mide contra la mediana de su
              propia historia: los cuatro Almond Breeze tienen 50 % de sell in,
              pero el proveedor les da 42,5 % todos los meses y el artículo
              igual pierde plata; el Scotch-Brite tiene 40 % contra una mediana
              de 0, y ese sí es nuevo. Pasá el mouse por el sugerido y lo dice
              renglón por renglón.
            </p>
            <p className="mt-1">
              <strong>El nombre de cada columna se puede consultar.</strong> Los
              encabezados con subrayado punteado explican, al pasar el mouse, de
              dónde sale el número y qué quiere decir que esté vacío. No están
              en todas: donde el título ya lo dice, un cartel que lo repita
              estorba.
            </p>
            <p className="mt-1">
              La columna de los <strong>últimos 6 meses de descuento</strong> es
              para ver si la oferta de este mes es buena o es la de siempre.
              Muestra el{" "}
              {sellInHayDatos
                ? "sell in del proveedor"
                : "sell in calculado con nuestras compras, porque el del proveedor todavía no está cargado"}
              , y el título de la columna dice cuál de los dos se está viendo.
            </p>
            <p className="mt-1">
              <strong>
                La rentabilidad es de los últimos {MESES_RENTABILIDAD} meses
              </strong>
              , de todos los canales, sobre la facturación neta y sin descontar
              flete. Sirve para separar «se vende porque gusta» de «se vendía
              porque estaba liquidado»: son el mismo ritmo y llevan a comprar
              distinto.
            </p>
            <p className="mt-1">
              La columna «Última compra» es un piso: sólo hay comprobantes
              cargados
              {data.comprasHasta
                ? ` hasta el ${fmtFechaCorta(data.comprasHasta)}`
                : ""}
              , y dos de cada tres llegan sin el detalle de renglones.
            </p>
          </Aviso>
        </div>
      )}
    </div>
  );
}
