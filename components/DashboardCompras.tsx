"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import BotonActualizar from "@/components/BotonActualizar";
import { BotonLimpiar, SelectorMultiple } from "@/components/SelectorFiltro";
import { contarSkus, sumar, Tabla, type Columna } from "@/components/Tabla";
import { Aviso, Esqueleto, Panel, TarjetaKpi } from "@/components/ui";
import {
  aCsv,
  aTxt,
  aUnidades,
  cantidadSugerida,
  type Combinacion,
  COLUMNAS_SIGMA,
  DESCUENTO_MAXIMO,
  descuentoValido,
  excelParaProveedor,
  factorNeto,
  lineasParaExportar,
  MESES_RENTABILIDAD,
  nombreArchivo,
  porQueSugerido,
  desc2DelProveedor,
  renglonInicial,
  UNIDADES_COMPRA,
  type ClaveUnidadCompra,
  type RenglonOrden,
  COBERTURAS_COMPRA,
  RENTABILIDAD_COMPRA_DISCRETA,
  COBERTURA_COMPRA_MAXIMA,
  CAIDA_SELL_IN_PARA_AVISAR,
  alcanceDisponible,
  type AlcanceOrden,
  coberturaValida,
  DIAS_DE_VIDA_BORRADOR,
  entraEnLaOrden,
  nombreDelAlcanceMarca,
  renglonesConCantidad,
  RECORTES_COMPRAS,
  queRecortaLaOrden,
  queSeRecalculo,
  totalesDeLaOrden,
  RECORTES_POR_DEFECTO,
  recortesValidos,
  opcionesCruzadas,
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
import { useAvisoAlSalir } from "@/lib/useAvisoAlSalir";
import { useBorradorOrden } from "@/lib/useBorradorOrden";
import { useBorradoresVigentes } from "@/lib/useBorradoresVigentes";
import { useOrdenCompleta } from "@/lib/useOrdenCompleta";
import { useDatosTablero } from "@/lib/useDatosTablero";
import { RESUMEN_CABECERA, type OrdenSigma } from "@/lib/sigma-orden";
import type { OrdenEnviada } from "@/lib/queries-ordenes";
import { aXlsx } from "@/lib/xlsx";
import type {
  DashboardCompras,
  FilaCompra,
  FiltrosCompras,
  OpcionSellIn,
} from "@/lib/types";

type Opciones = {
  proveedores: string[];
  marcas: string[];
  grupos: string[];
  combinaciones: Combinacion[];
  meses: string[];
};
/**
 * Cómo se nombra la columna del sell in que se está mirando.
 *
 * BUSCA POR `valorSellIn`, que viene del servidor, y NO lo rearma con
 * (mes, evento). Para una promo sin mes esos dos no alcanzan: la opción vale
 * "|HOT SALE" pero su `mes` es el último con costos, así que rearmarlo daba
 * "2026-10|HOT SALE" --que no existe-- y el título caía en "oct 2026" cuando
 * la pantalla estaba mostrando el HOT SALE.
 *
 * Si por lo que sea no está en la lista, cae en el mes.
 */
function etiquetaDe(data: {
  mes: string;
  valorSellIn: string;
  opcionesSellIn: OpcionSellIn[];
}): string {
  return (
    data.opcionesSellIn.find((o) => o.valor === data.valorSellIn)?.etiqueta ??
    fmtMes(data.mes)
  );
}

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

/**
 * Cuántos artículos recalculados se listan antes de resumir en "y N más".
 *
 * Doce entran en dos renglones y se leen de un vistazo. La lista viene ordenada
 * por cuánto se movió cada uno, así que los doce primeros son los que pueden
 * cambiar la orden; una lista de cuarenta no se lee y empuja los botones fuera
 * de la pantalla.
 */
const RECALCULADOS_A_LA_VISTA = 12;

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

/**
 * "Descuentos del proveedor: planilla del 22/09 06:49".
 *
 * En ámbar si hace más de un día y medio, que es cuando conviene mirar el
 * disparador del Apps Script: manda una foto por día, así que pasadas ~36 h sin
 * novedades algo dejó de andar. No es rojo porque un fin de semana largo sin
 * cambios es normal.
 */
function FotoSellIn({ iso }: { iso: string }) {
  // La hora actual va en estado y no se lee en el render: además de ser lo que
  // pide React, es lo que hace que el aviso aparezca solo si la pestaña queda
  // abierta. Mismo patrón que `UltimaCarga` en el tablero de Meli.
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setAhora(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const horas = (ahora - new Date(iso).getTime()) / 3_600_000;
  const vieja = horas > 36;
  const cuando = new Date(iso).toLocaleString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  return (
    <p className={`mt-0.5 text-[11px] ${vieja ? "text-negativo" : "text-muted"}`}>
      Descuentos del proveedor: planilla del {cuando}
      {vieja && " — hace más de un día, revisar el disparador de la planilla"}
    </p>
  );
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
    recortes: RECORTES_POR_DEFECTO,
  };
  const [filtros, setFiltros] = useState<FiltrosCompras>(inicial);

  // Se sanea acá y no se lee `filtros.recortes` a pelo: así la pantalla y el
  // servidor miran exactamente la misma lista.
  const recortes = recortesValidos(filtros.recortes);
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
    | { ok: true; enviado: OrdenSigma; numeroSigma: string | null }
    // `mandado` parte el fracaso en dos casos que NO se tratan igual: uno se
    // reintenta, el otro se revisa en Sigma antes de tocar nada.
    | {
        ok: false;
        mandado: boolean;
        error: string;
        problemas?: string[];
        enviado?: OrdenSigma;
        url?: string;
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
        // Cada recorte va como un parámetro repetido (?recorte=a&recorte=b),
        // igual que los demás filtros de lista.
        recortes: recortes.length > 0 ? recortes : undefined,
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

  // LAS ÓRDENES SON POR PROVEEDOR. Con dos elegidos el archivo mezclaría
  // proveedores en una sola orden, que es algo que no existe.
  const proveedorUnico =
    filtros.proveedor?.length === 1 ? filtros.proveedor[0] : null;

  /**
   * LA ORDEN ENTERA DEL PROVEEDOR, no la vista.
   *
   * La orden se arma mirando de a poco --una marca, lo que tiene oferta, lo
   * discontinuado-- pero la que sale es una sola y lleva todo lo del proveedor.
   * Esta segunda consulta es la que hace que eso sea cierto: trae la lista
   * completa, sin marca, sin buscador y sin recortes. Ver lib/useOrdenCompleta.
   */
  const completa = useOrdenCompleta({
    proveedor: proveedorUnico,
    ventana: filtros.ventana ?? VENTANA_POR_DEFECTO,
    cobertura: coberturaElegida,
    mes: filtros.mes,
  });

  // Los tres selectores se recortan entre sí. Se recalcula en el navegador
  // --son 380 combinaciones-- así que elegir un proveedor achica la lista de
  // marcas al instante, sin ir al servidor.
  const combinaciones = useMemo(
    () => data?.opciones?.combinaciones ?? [],
    [data],
  );
  const opcionesGrupo = useMemo(
    () => opcionesCruzadas("grupo", combinaciones, filtros),
    [combinaciones, filtros],
  );
  const opcionesProveedor = useMemo(
    () => opcionesCruzadas("proveedor", combinaciones, filtros),
    [combinaciones, filtros],
  );
  const opcionesMarca = useMemo(
    () => opcionesCruzadas("marca", combinaciones, filtros),
    [combinaciones, filtros],
  );



  /**
   * HASTA DONDE LLEGA LA ORDEN: todo el proveedor, o sólo la marca elegida.
   *
   * ES UNA ELECCION Y NO UNA REGLA, y hubo que aprenderlo dos veces.
   *
   * Primero la orden era lo que se veía, y bajar con un filtro puesto daba una
   * orden incompleta que parecía correcta. Después pasó a ser SIEMPRE el
   * proveedor entero, y apareció el error opuesto: con la marca AVENT
   * filtrada, los totales metían un CHICCO del mismo proveedor que no se veía
   * por ningún lado.
   *
   * LOS DOS CASOS SON REALES Y CONVIVEN. Hay proveedores donde la OC va
   * siempre por marca, y hay veces que se filtra una marca sólo para vaciarle
   * cantidades y la OC igual va por todo el proveedor. Ninguna regla fija sirve
   * para los dos, así que se elige, se ve cuál está elegida, y los números de
   * arriba dicen a cuál de las dos se refieren.
   *
   * LA MARCA ES LO UNICO QUE PUEDE RECORTAR. El buscador y el selector Mostrar
   * no: son la lupa con la que se mira, no un conjunto que alguien pueda
   * nombrar. Ver `alcanceDisponible` en lib/compras.ts.
   *
   * Arranca en "proveedor" porque es el error más barato de los dos: comprar
   * un bulto de más se ve en el archivo antes de mandarlo; olvidarse media
   * orden no se ve hasta que no llega la mercadería.
   */
  const [alcance, setAlcance] = useState<AlcanceOrden>("proveedor");

  /** Si hay algo que elegir: una orden, y una marca que pueda recortarla. */
  const sePuedeElegirAlcance =
    proveedorUnico !== null && alcanceDisponible(filtros.marca);
  const alcanceReal: AlcanceOrden = sePuedeElegirAlcance
    ? alcance
    : "proveedor";

  /**
   * QUE ESTA MOSTRANDO MENOS QUE LA ORDEN, sin recortarla.
   *
   * Se calcula con la MISMA función de siempre, sacándole la marca cuando la
   * marca SÍ es el alcance: ahí deja de ser una lupa y pasa a ser la orden. Lo
   * que queda --el buscador, el selector Mostrar, y la marca cuando la orden es
   * del proveedor entero-- recorta lo que se ve y nada más.
   */
  const otroRecorte = useMemo(
    () =>
      queRecortaLaOrden(
        alcanceReal === "marca" ? { ...filtros, marca: undefined } : filtros,
        recortes,
      ),
    [filtros, recortes, alcanceReal],
  );

  /**
   * LOS ARTICULOS DE LOS QUE SALE LA ORDEN.
   *
   * Con alcance "proveedor" es la unión de las dos consultas y no sólo la
   * completa, por el rato en que la completa todavía no llegó: con la lista
   * vacía, `orden` quedaría vacía y la tabla no tendría ni una cantidad que
   * mostrar. Las filas visibles van primero por eso.
   *
   * No hay riesgo de que una fila entre dos veces con datos distintos: las dos
   * consultas piden el mismo proveedor, la misma ventana, la misma cobertura y
   * el mismo mes, así que para un SKU las dos devuelven lo mismo. Lo único que
   * cambia entre ellas es CUALES filas vienen.
   */
  const filasOrden = useMemo(() => {
    if (!proveedorUnico) return filas;
    const porSku = new Map(filas.map((f) => [f.sku, f]));
    for (const f of completa.filas) {
      // Con alcance de marca se mira la MARCA del artículo y no si está a la
      // vista: uno de la marca que el buscador dejó afuera entra igual, porque
      // es parte de esa orden.
      if (!entraEnLaOrden(f, alcanceReal, filtros.marca)) continue;
      if (!porSku.has(f.sku)) porSku.set(f.sku, f);
    }
    return [...porSku.values()];
  }, [filas, completa.filas, proveedorUnico, alcanceReal, filtros.marca]);

  /**
   * La orden como está ahora: el sugerido de cada artículo, con lo editado
   * encima. Un artículo que nadie tocó arranca con la cantidad sugerida y con
   * la oferta del proveedor del mes elegido.
   */
  const orden = useMemo(
    () =>
      new Map(
        filasOrden.map((f) => [f.sku, ediciones.get(f.sku) ?? renglonInicial(f)]),
      ),
    [filasOrden, ediciones],
  );

  /**
   * Si la orden entera ya está en el navegador.
   *
   * Es la condición para bajar el archivo y para guardar el borrador: con la
   * lista a medias, lo primero sería una orden incompleta y lo segundo una foto
   * de sugeridos incompleta.
   */
  const ordenCompletaLista =
    proveedorUnico !== null && !completa.cargando && completa.error === null;

  /** El sugerido de hoy de cada artículo del proveedor. Va al borrador. */
  const sugeridosDeHoy = useMemo(
    () => new Map(completa.filas.map((f) => [f.sku, f.sugerido])),
    [completa.filas],
  );

  /**
   * EL BORRADOR. Se guarda solo, se retoma solo y se puede descartar.
   *
   * Lo que originó todo esto: el encargado de compras le dio sin querer a
   * recargar y perdió una orden a medio armar. Ver lib/useBorradorOrden.
   */
  const borrador = useBorradorOrden({
    proveedor: proveedorUnico,
    ediciones,
    setEdiciones,
    nota: comentario,
    setNota: setComentario,
    mes: data?.mes ?? null,
    ventana: filtros.ventana ?? VENTANA_POR_DEFECTO,
    cobertura: coberturaElegida,
    sugeridosDeHoy,
    listo: ordenCompletaLista,
  });

  /**
   * LA LISTA DE ORDENES A MEDIO ARMAR, para poder volver a una.
   *
   * El borrador se retoma solo, pero sólo cuando ya elegiste el proveedor --
   * o sea, cuando ya te acordabas de que lo tenías. Sin esta lista no hay
   * forma de enterarse de que hay trabajo guardado, y una función invisible es
   * casi lo mismo que no tenerla.
   */
  const { borradores: guardados } = useBorradoresVigentes();

  /**
   * La lista que se muestra: los OTROS proveedores salen del servidor y el que
   * se está mirando sale de la pantalla.
   *
   * SE DERIVA EN VEZ DE VOLVER A PEDIRLA, y no es una optimización: el
   * borrador del proveedor actual cambia con cada tecla, así que mantenerlo al
   * día desde el servidor sería pedir la lista entera dos veces por guardado.
   * Y además quedaría siempre un instante atrasada justo donde se la está
   * mirando.
   */
  const borradores = useMemo(() => {
    const otros = guardados.filter((b) => b.proveedor !== proveedorUnico);
    const cuantos = renglonesConCantidad(ediciones);
    if (!proveedorUnico || cuantos === 0) return otros;
    return [
      {
        proveedor: proveedorUnico,
        renglones: cuantos,
        actualizadoEn: "ahora",
      },
      ...otros,
    ];
  }, [guardados, proveedorUnico, ediciones]);

  /**
   * LAS CANTIDADES QUE SE MOVIERON SOLAS desde que se guardó el borrador.
   *
   * Sólo tiene sentido con la lista completa: con la lista a medias, todo lo
   * que no llegó todavía parecería haberse recalculado a cero.
   */
  const recalculados = useMemo(() => {
    if (!ordenCompletaLista) return [];
    const todos = queSeRecalculo(
      borrador.sugeridosGuardados,
      sugeridosDeHoy,
      ediciones,
    );
    // SOLO LOS QUE ESTAN EN LA ORDEN. La foto que se guarda cubre al proveedor
    // entero --tiene que servir sea cual sea el alcance la próxima vez-- pero
    // avisar de un artículo que no va a salir en este archivo es ruido justo en
    // el aviso que no puede ser ruido.
    const enLaOrden = new Set(filasOrden.map((f) => f.sku));
    return todos.filter((r) => enLaOrden.has(r.sku));
  }, [
    ordenCompletaLista,
    borrador.sugeridosGuardados,
    sugeridosDeHoy,
    ediciones,
    filasOrden,
  ]);

  /**
   * DESCARTAR PIDE CONFIRMAR, y no por trámite: tira la orden a medio armar,
   * que es exactamente lo que todo esto existe para no perder. Un click de más
   * acá cuesta un segundo; un click de menos cuesta la tarde del encargado de
   * compras.
   */
  const [confirmandoDescarte, setConfirmandoDescarte] = useState(false);

  const descartarBorrador = () => {
    borrador.descartar();
    setConfirmandoDescarte(false);
  };

  /**
   * "¿Se está guardando?", contestado en una línea.
   *
   * Vacío cuando no hay nada que decir --ningún borrador y nada tocado-- para
   * que la barra no lleve una línea de texto permanente que nadie lee.
   */
  const estadoBorrador = ((): string => {
    // SIN UN PROVEEDOR ELEGIDO NO HAY BORRADOR, y hay que decirlo en vez de no
    // mostrar nada: una orden es de un proveedor, así que no hay dónde guardar
    // lo que se cargue. Callarse deja a alguien cargando cantidades que no se
    // están guardando, convencido de que sí -- o buscando una función que
    // parece no existir.
    if (!proveedorUnico)
      return ediciones.size > 0
        ? "El borrador se guarda por proveedor: elegí uno y lo que cargues queda guardado solo."
        : "";
    // "error" es tanto no haber podido LEER el borrador como no haber podido
    // GUARDARLO, y el texto sirve para los dos: en los dos casos lo que hay en
    // pantalla no está en ningún otro lado. Decir "no se pudo guardar" cuando
    // lo que falló fue la lectura sería mandar a buscar el problema al lugar
    // equivocado.
    if (borrador.estado === "error")
      return "El borrador no está disponible. Lo que cargues queda sólo en esta pantalla: no cierres la pestaña sin bajar el archivo.";
    // Incluye lo que todavía no salió: ver `estado` en useBorradorOrden.
    if (borrador.estado === "guardando") return "Guardando el borrador…";
    if (borrador.retomadoDe)
      return `Se retomó el borrador que dejaste el ${borrador.retomadoDe}.`;
    if (borrador.estado === "guardado") return "Borrador guardado.";
    return "";
  })();

  /**
   * AVISO ANTES DE PERDER LA ORDEN A MEDIO ARMAR.
   *
   * SALTA SOLO SI HAY ALGO QUE PERDER DE VERDAD, y eso es nuevo: ahora que el
   * borrador se guarda solo, lo normal es que recargar no pierda nada. Un
   * cartel que pregunta "¿seguro?" cuando no hay nada en juego es el que
   * ensaña a apretar Aceptar sin leer, y después no frena el que sí importa.
   *
   * Los tres casos en los que sí hay algo en juego:
   *
   *   - el guardado está pendiente (se tocó algo hace menos de un segundo y
   *     medio, que es justo la ventana del F5 sin querer);
   *   - el guardado falló y el borrador no tiene lo último;
   *   - no hay un solo proveedor elegido, así que no hay borrador posible
   *     --una orden es de un proveedor-- y las ediciones viven sólo acá.
   *
   * Tiene agujeros grandes --no cubre cerrar la notebook ni navegar por el
   * menú-- y están listados en `useAvisoAlSalir`. Esos agujeros son los que
   * tapa el borrador, que es la garantía de verdad.
   */
  useAvisoAlSalir(
    ediciones.size > 0 &&
      (proveedorUnico === null ||
        borrador.sinGuardar ||
        borrador.estado === "error"),
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
    // `descartar` limpia las ediciones y la nota, y además borra el borrador de
    // la base: la orden ya salió, guardarla a medio armar no tiene sentido.
    borrador.descartar();
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
  //
  // SON DOS Y LA DIFERENCIA IMPORTA. `resumen` es la orden: el proveedor
  // entero, que es lo que va a salir en el archivo. `resumenVista` es lo que
  // se está mirando ahora, que mientras se revisa marca por marca es la cuenta
  // que hace falta --el subtotal de esa marca-- y que de otro modo no habría
  // forma de ver. La pantalla muestra los dos justamente para que nadie tenga
  // que adivinar cuál de los dos está leyendo.
  const resumen = useMemo(
    () => totalesDeLaOrden(filasOrden, orden),
    [filasOrden, orden],
  );

  const resumenVista = useMemo(
    () => totalesDeLaOrden(filas, orden),
    [filas, orden],
  );

  /** Si lo que se ve es menos que la orden, en renglones. */
  const vistaEsRecorte = resumenVista.renglones !== resumen.renglones;

  /**
   * Si se puede bajar o mandar la orden.
   *
   * PIDE LA LISTA COMPLETA DEL PROVEEDOR, que es la condición nueva. Con la
   * consulta a medio llegar el archivo saldría con los renglones que alcanzaron
   * a venir -- justo el problema que la lista completa viene a resolver. Son un
   * par de segundos y sólo la primera vez de cada proveedor en cada corrida:
   * después la consulta está cacheada.
   */
  // LOS DOS ALCANCES SALEN DE LA LISTA COMPLETA, así que los dos la esperan.
  // También el de marca: sus artículos son los de esa marca en TODO el
  // proveedor, no los que el buscador dejó a la vista.
  const puedeBajar =
    proveedorUnico !== null && ordenCompletaLista && resumen.renglones > 0;

  /**
   * Los renglones que hoy tienen cantidad, con su nombre. Es lo que se manda, y
   * también lo que se muestra para poder sacar uno cuando Sigma rechaza la
   * orden por culpa de un artículo concreto.
   */
  const renglonesDeLaOrden = useMemo(
    () =>
      filasOrden
        .map((f) => ({ fila: f, renglon: orden.get(f.sku) }))
        .filter((r) => (r.renglon?.cantidad ?? 0) > 0),
    [filasOrden, orden],
  );

  /**
   * Baja la orden.
   *
   * SALE DE LA LISTA COMPLETA DEL PROVEEDOR, no de lo que se ve. Antes salía de
   * las filas visibles, y bajar con un filtro puesto no daba ningún error: daba
   * una orden incompleta que parecía correcta y que alguien le mandaba a un
   * proveedor. Ahora el archivo lleva todo lo que el proveedor tiene con
   * sugerido, más lo que se cargó a mano, menos lo que se sacó -- se haya
   * hecho con los filtros que sea.
   *
   * `ordenCompletaLista` es la guarda: sin la lista entera no se baja nada. Es
   * a propósito que no haya un camino de respaldo con las filas visibles --ese
   * camino es exactamente el error que esto viene a sacar.
   */
  const descargar = (formato: "txt" | "csv" | "xlsx") => {
    if (!proveedorUnico || !ordenCompletaLista) return;
    if (formato === "xlsx") {
      // El Excel se arma de las FILAS y no de las líneas de Sigma: necesita el
      // costo, el EAN y el nombre del artículo, que a ese archivo no van.
      const libro = excelParaProveedor(
        filasOrden,
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
    const lineas = lineasParaExportar(filasOrden, orden);
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
    if (!proveedorUnico || !ordenCompletaLista || resumen.renglones === 0)
      return;
    setEnviando(true);
    setResultado(null);
    try {
      // La orden entera del proveedor, igual que el archivo. Ver `descargar`.
      const renglones = filasOrden
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
        setResultado({
          ok: true,
          enviado: json.enviado as OrdenSigma,
          // El número con el que la orden existe en Sigma. Puede venir null:
          // ver `numeroDeOrdenSigma`.
          numeroSigma: (json.numeroSigma as string | null) ?? null,
        });
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
          url: json.url as string | undefined,
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

  /** Saca lo que recorta la vista, dejando proveedor y grupo. */
  /**
   * Saca la lupa: deja de recortar la VISTA, sin tocar lo que es la orden.
   *
   * LA MARCA SE RESPETA CUANDO ES EL ALCANCE. Si la orden es "sólo AVENT",
   * borrar la marca la convertiría en la del proveedor entero -- un botón que
   * dice "ver" no puede cambiar lo que se va a mandar.
   */
  const verOrdenCompleta = () =>
    cambiar({
      ...filtros,
      marca: alcanceReal === "marca" ? filtros.marca : undefined,
      buscar: undefined,
      recortes: RECORTES_POR_DEFECTO,
    });

  const sinCambios =
    sinValores(filtros.grupo) &&
    sinValores(filtros.proveedor) &&
    sinValores(filtros.marca) &&
    !filtros.buscar &&
    recortes.join() === RECORTES_POR_DEFECTO.join() &&
    !filtros.mes &&
    (filtros.ventana ?? VENTANA_POR_DEFECTO) === VENTANA_POR_DEFECTO;

  const columnas: Columna<FilaCompra>[] = [
    { titulo: "SKU", celda: (f) => f.sku, orden: (f) => f.sku },
    {
      // EL CODIGO CON EL QUE EL PROVEEDOR LO VENDE, no el nuestro. Ya viajaba
      // en el Excel que se le manda --él no conoce nuestro SKU-- pero no se
      // veía en pantalla, así que para cotejar una lista de precios contra
      // esta tabla había que abrir el Excel o buscar el artículo en Sigma.
      titulo: "Cód. proveedor",
      ayuda:
        "El código con el que el proveedor identifica el artículo (codigoCompra en Sigma). Es el que va en el Excel que se le manda; sirve para cotejar contra su lista de precios. Vacío es que no está cargado en Sigma.",
      celda: (f) =>
        f.codigoCompra ? (
          <span className="tabular-nums">{f.codigoCompra}</span>
        ) : (
          <span className="text-muted">—</span>
        ),
      orden: (f) => f.codigoCompra,
    },
    {
      titulo: "Artículo",
      // LA FECHA DE ALTA VIVE ACA Y NO EN SU PROPIA COLUMNA. Es un dato que se
      // consulta de a uno --"¿este es nuevo o hace años que está?"-- y no se
      // compara entre filas, así que una columna entera para él era ancho
      // gastado en una tabla que ya no entraba en la pantalla.
      //
      // LO QUE SI TIENE QUE VERSE SIN PASAR EL MOUSE es que el artículo es
      // nuevo, porque eso cambia cómo se lee todo lo demás de la fila: un
      // ritmo flojo en un artículo de tres semanas no quiere decir lo mismo
      // que en uno de tres años. Por eso el nombre va en ámbar.
      celda: (f) => {
        const alta = f.alta ? fmtFechaCortaConAnio(f.alta) : null;
        return (
          <span
            className={`block max-w-[136px] truncate sm:max-w-[240px] ${
              f.esNuevo ? "text-amber-400" : ""
            }`}
            title={
              (f.producto ?? "—") +
              (alta ? `\n\nAlta en Sigma: ${alta}` : "") +
              (f.esNuevo
                ? " — ARTÍCULO NUEVO. Su ritmo se mide sobre los días que" +
                  " lleva vendiendo, no sobre la ventana entera."
                : "")
            }
          >
            {f.producto ?? "—"}
          </span>
        );
      },
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
        // EL FRENO SE VE, no sólo se lee en el tooltip. Un "—" a secas en un
        // artículo que se venía comprando se lee como "no hace falta", y acá
        // la verdad es la contraria: hace falta, pero no a este precio.
        if (f.esDiscontinuo) {
          return (
            <span
              title={texto}
              className="cursor-help whitespace-nowrap text-amber-400 decoration-dotted underline underline-offset-2"
            >
              discontinuo
            </span>
          );
        }
        if (f.costo === 0) {
          return (
            <span
              title={texto}
              className="text-negativo cursor-help whitespace-nowrap decoration-dotted underline underline-offset-2"
            >
              sin costo
            </span>
          );
        }
        if (f.sinOfertaPorAhora) {
          return (
            <span
              title={texto}
              className="cursor-help whitespace-nowrap text-amber-400 decoration-dotted underline underline-offset-2"
            >
              sin oferta
            </span>
          );
        }
        if (f.sugerido <= 0) {
          return (
            <span className="text-muted" title={texto}>
              —
            </span>
          );
        }
        // EL MINIMO NO ES UNA CUENTA, y no puede parecerlo. Se muestra apagado
        // y con la palabra al lado: quien está armando una orden tiene que
        // poder separar de un vistazo los renglones que el cálculo midió de los
        // que son un punto de partida para decidir.
        if (f.sugeridoMinimo) {
          return (
            <span
              title={texto}
              className="text-muted cursor-help whitespace-nowrap decoration-dotted underline underline-offset-2"
            >
              {fmtNumero(f.sugerido)}{" "}
              <span className="text-[10px]">mín.</span>
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
            {/* Se sugiere, pero a precio de lista: el proveedor le sacó la
                oferta hace varios meses y no parece que vuelva. */}
            {f.dejoDeTenerSellIn && (
              <span
                className="ml-1 text-amber-400"
                title="Hace varios meses que no tiene sell in y antes sí tenía: esta compra va a precio de lista."
              >
                !
              </span>
            )}
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
        // LA ALERTA VA EN ESTA CELDA Y NO EN OTRA. Es la cantidad que va a
        // viajar a la orden, y es donde está el ojo mientras se carga: un
        // aviso en otra columna se lee después de haber decidido, que es
        // tarde. El borde ámbar dice "esto lo puso un mínimo, no una cuenta".
        const aviso = f.sugeridoMinimo
          ? f.esNuevo
            ? `Artículo NUEVO (alta ${f.alta ? fmtFechaCortaConAnio(f.alta) : "—"}) y todavía sin ninguna venta. ` +
              `Esta cantidad es el mínimo de 1 bulto (${fmtNumero(f.unidadesPorBulto)} u.), no una necesidad medida: revisala antes de mandar.`
            : `SIN VENTAS en los últimos ${f.diasRitmo} días. ` +
              `Esta cantidad es el mínimo de 1 bulto (${fmtNumero(f.unidadesPorBulto)} u.), no una necesidad medida: revisala antes de mandar.`
          : undefined;
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
            className={`${CLASE_CELDA_EDITABLE} ${
              aviso ? "border-amber-500/70 bg-amber-500/5" : ""
            }`}
            title={aviso}
            aria-label={
              `Cantidad a comprar de ${f.sku}` +
              (aviso ? " (mínimo sin ventas que lo respalden)" : "")
            }
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
      // EL SEGUNDO DESCUENTO LO PONE LA PERSONA: es el que se negocia por
      // fuera del sell in de lista, así que arranca vacío salvo que el
      // proveedor tenga un acuerdo fijo (ver DESC2_FIJO_POR_PROVEEDOR). Se
      // aplica EN CASCADA sobre lo que quedó del primero, no sumado -- ver
      // factorNeto en lib/compras.
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
            // DE DONDE SALIO EL NUMERO, cuando no lo escribió la persona. Un
            // 4,94 que aparece solo en 156 renglones necesita decir por qué
            // está ahí; si no, parece un error de otro.
            title={
              d2 > 0
                ? `${d1} % y ${d2} % en cascada = ${((1 - factorNeto(d1, d2)) * 100).toFixed(2)} % de descuento total (no ${(d1 + d2).toFixed(2)} %)` +
                  (desc2DelProveedor(f.proveedor) > 0
                    ? `. Los ${desc2DelProveedor(f.proveedor)} % son el acuerdo fijo con ${f.proveedor}: vienen cargados y se pueden cambiar.`
                    : "")
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
      // EL NUMERO QUE FALTABA PARA PODER LEER EL SUGERIDO.
      //
      // El sugerido proyecta hacia adelante las unidades de atrás, y las
      // unidades solas no dicen en qué condiciones salieron. Un artículo que
      // voló con 40 % de sell in no tiene por qué volar al 10 %: el ritmo, que
      // sólo mira unidades, pide lo mismo igual.
      //
      // Va DESPUES de los dos descuentos editables y no entre ellos: los dos
      // primeros son lo que se está por pedir --se escriben-- y éste es
      // historia, que no se toca. Metido en el medio cortaba el par de campos
      // que se cargan juntos. Igual queda a un golpe de vista del Desc 1, que
      // es contra el que se compara.
      // "Sell in AL VENDER" y no "vendido": lo que se vendió es el artículo,
      // no el sell in. El título viejo se leía como si el descuento fuera la
      // mercadería.
      titulo: "Sell in al vender %",
      ayuda:
        "Con qué descuento de compra se había comprado lo que se vendió en la ventana del ritmo, ponderado por unidades. Es contra lo que se compara el Desc 1 de este mes: si el ritmo se hizo con una oferta que ya no está, puede no repetirse. La tilde ~ adelante quiere decir que no todas esas ventas tienen el dato, y cuánto exactamente lo dice el tooltip. Vacío es que ninguna lo tiene.",
      celda: (f) => {
        if (f.sellInVendidoPct == null) return <span className="text-muted">—</span>;
        const cob = f.sellInVendidoCobertura ?? 0;
        const parcial = cob < 0.9;
        const cayo =
          f.sellInVendidoPct - (f.sellInPct ?? 0) >= CAIDA_SELL_IN_PARA_AVISAR;
        return (
          <span
            className={`cursor-help decoration-dotted underline underline-offset-2 ${
              cayo ? "text-amber-400" : "text-muted"
            }`}
            title={
              // LOS DIAS SON LOS DE LA VENTANA ELEGIDA, no los de `diasRitmo`.
              // Este promedio se calcula sobre la ventana entera; `diasRitmo`
              // es por artículo --se acorta en los que empezaron a venderse
              // hace poco-- y ponerlo acá hacía que el cartel dijera "en estos
              // 100 días" en una fila y "120" en la de al lado, por un motivo
              // que no viene al caso.
              `Lo que se vendió en los últimos ${data?.ventana ?? filtros.ventana ?? VENTANA_POR_DEFECTO} días ` +
              `se había comprado con ${f.sellInVendidoPct.toFixed(2)} % de descuento.` +
              (parcial
                ? ` Ojo: sólo el ${Math.round(cob * 100)} % de esas unidades tiene el dato cargado, así que es aproximado.`
                : "") +
              (cayo
                ? ` Este mes hay ${(f.sellInPct ?? 0).toFixed(2)} %: ese ritmo se hizo con una oferta que ahora no está.`
                : "")
            }
          >
            {/* UN SOLO NUMERO. Antes iban dos porcentajes pegados --"21.67
                35%"-- y no había forma de saber cuál era cuál: los dos
                terminaban en % y ninguno decía qué era. La cobertura pasa a
                ser una TILDE, que se lee "aproximado" sin explicación y no se
                puede confundir con otro porcentaje. El número exacto sigue
                estando, en el tooltip. */}
            {parcial ? "~" : ""}
            {f.sellInVendidoPct.toFixed(2)}
          </span>
        );
      },
      numerica: true,
      orden: (f) => f.sellInVendidoPct,
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
      <div className="flex flex-wrap items-start justify-between gap-3">
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
          {/* DE CUANDO ES EL DESCUENTO, que es lo que viaja a la orden.
              No sale del tablero: sale de un Google Sheet que un Apps Script
              fotografía una vez por día. Sin esta fecha no hay forma de saber
              si lo que se está mirando incluye el cambio de hace un rato — y
              una orden de compra con el descuento viejo se manda igual. */}
          {data?.sellInFoto && <FotoSellIn iso={data.sellInFoto} />}
        </div>
        {/* DOS BOTONES Y NO UNO. "Recargar" vuelve a leer la base y es
            instantáneo; "Actualizar ahora" le pide al pipeline que vaya a
            buscar datos nuevos — y acá eso incluye **el descuento del sell in**,
            que es lo que viaja a la orden de compra. Antes el paso del sell in
            corría una vez por día a las 00:20 y la planilla manda su foto a las
            06:00, así que un descuento editado el lunes entraba el miércoles.
            Ahora corre en cada corrida, y este botón la fuerza. */}
        <div className="flex items-start gap-2">
          <button
            onClick={recargar}
            disabled={cargando}
            title="Vuelve a leer los datos que ya están en la base. Es instantáneo."
            className="border-line hover:bg-panel-2 text-muted hover:text-ink rounded-lg border px-3 py-1.5 text-xs disabled:opacity-40"
          >
            {cargando ? "Recargando…" : "Recargar"}
          </button>
          <BotonActualizar onDatosNuevos={recargar} conSellIn />
        </div>
      </div>

      {/* LAS ORDENES A MEDIO ARMAR, arriba de todo.
          Va antes que los filtros porque es lo primero que hay que saber al
          entrar: que hay trabajo empezado y dónde está. Abajo de la tabla no
          lo vería nadie, que es exactamente lo que pasaba hasta ahora. */}
      {borradores.length > 0 && (
        <div className="border-c1/40 bg-c1/5 flex flex-wrap items-center gap-2 rounded-xl border p-3">
          <span className="text-ink text-xs font-medium">
            {borradores.length === 1
              ? "Tenés una orden a medio armar:"
              : `Tenés ${fmtNumero(borradores.length)} órdenes a medio armar:`}
          </span>
          {borradores.map((b) => {
            const actual = b.proveedor === proveedorUnico;
            return (
              <button
                key={b.proveedor}
                type="button"
                // Elegir el proveedor es todo lo que hace falta: el borrador se
                // retoma solo cuando la pantalla queda en ese proveedor.
                onClick={() => cambiar({ ...filtros, proveedor: [b.proveedor] })}
                disabled={actual}
                title={`Último cambio: ${b.actualizadoEn}`}
                className={`rounded-lg border px-2.5 py-1 text-[11px] ${
                  actual
                    ? "border-c1 text-c1 cursor-default"
                    : "border-line text-muted hover:bg-panel-2 hover:text-ink"
                }`}
              >
                <span className="font-medium">{b.proveedor}</span>
                <span className="opacity-70">
                  {" · "}
                  {b.renglones === 1
                    ? "1 renglón"
                    : `${fmtNumero(b.renglones)} renglones`}
                  {" · "}
                  {b.actualizadoEn}
                </span>
                {actual && <span className="opacity-70">{" · estás acá"}</span>}
              </button>
            );
          })}
          <span className="text-muted ml-auto text-[11px]">
            Se guardan {DIAS_DE_VIDA_BORRADOR} días y después se borran solos.
          </span>
        </div>
      )}

      <div className="border-line bg-panel flex flex-col gap-3 rounded-xl border p-3">
        <div className="flex flex-wrap items-end gap-3">
          {/* Antes que Proveedor: es el corte más grueso. Y en esta pantalla
              importa más todavía, porque la orden de compra se arma por
              proveedor y conviene llegar al de la empresa correcta. */}
          <SelectorMultiple
            etiqueta="Empresa"
            valores={filtros.grupo}
            opciones={opcionesGrupo}
            onChange={(v) => cambiar({ ...filtros, grupo: v })}
          />
          <SelectorMultiple
            etiqueta="Proveedor"
            valores={filtros.proveedor}
            opciones={opcionesProveedor}
            onChange={(v) => cambiar({ ...filtros, proveedor: v })}
          />
          <SelectorMultiple
            etiqueta="Marca"
            valores={filtros.marca}
            opciones={opcionesMarca}
            onChange={(v) => cambiar({ ...filtros, marca: v })}
          />

          {/* QUE COLUMNA DE LA PLANILLA. De acá sale el descuento que va al
              archivo, así que no es un filtro de vista: cambia el número que
              se le pide al proveedor.

              UNA OPCION POR COLUMNA Y NO POR MES. La planilla tiene columnas
              que son un corte dentro de un mes ("1/7/2026 (Glam)") y otras que
              son una promo sin mes ("HOT SALE"). Listando sólo los meses, las
              dos quedaban inalcanzables: la de Glam se veía igual que la común
              de julio y traía la común igual. */}
          <div className="flex flex-col gap-1">
            <label className="text-muted text-[11px]" htmlFor="mes-oferta">
              Sell in del mes
            </label>
            <select
              id="mes-oferta"
              // EL VALOR VIENE DEL SERVIDOR, no se rearma acá. Ver `etiquetaDe`:
              // con (mes, evento) una promo daba un value que no es ninguna
              // opción, y entonces el <select> no seleccionaba nada --el
              // navegador mostraba la primera-- aunque la pantalla de abajo sí
              // estuviera mostrando la promo.
              value={data?.valorSellIn ?? filtros.mes ?? ""}
              onChange={(e) => cambiar({ ...filtros, mes: e.target.value })}
              className="border-line bg-panel-2 text-ink focus:border-c1 rounded-lg border px-2.5 py-1.5 text-xs outline-none"
            >
              {(data?.opcionesSellIn ?? []).map((o) => (
                <option key={o.valor} value={o.valor}>
                  {o.etiqueta}
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

          {/* LOS GRUPOS QUE SE MUESTRAN, EN UNA LISTA COMO CUALQUIER OTRO
              FILTRO. Se SUMAN entre ellos: marcar dos muestra los de los dos.

              Eran dos botones sueltos en dos lugares distintos de la pantalla
              --"sólo los que hay que comprar" acá y "dejar sólo con oferta"
              abajo, en la fila de acciones de la orden-- así que para saber
              qué se estaba viendo había que mirar dos cosas que no entran en
              la misma pantalla.

              Va con el MISMO selector que marca y proveedor a propósito: se
              abren igual, se destildan igual y "ninguno elegido" quiere decir
              lo mismo en los tres, que es "todos". Uno menos que aprender. */}
          <SelectorMultiple
            etiqueta="Mostrar"
            valores={filtros.recortes}
            opciones={RECORTES_COMPRAS.map((r) => [r.valor, r.etiqueta])}
            onChange={(v) => cambiar({ ...filtros, recortes: recortesValidos(v) })}
            todos="Todos los artículos"
          />

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
            // EL TITULO CAMBIA CON EL NUMERO, y eso es el arreglo. Antes
            // decía siempre "en la orden" y el número era a veces la orden
            // del proveedor y a veces lo que se veía: dos cosas distintas con
            // la misma etiqueta, y sin forma de saber cuál se estaba leyendo.
            titulo={
              proveedorUnico ? "Renglones en la orden" : "Renglones a la vista"
            }
            valor={fmtNumero(resumen.renglones)}
            detalle={
              // LOS TRES KPI DE LA ORDEN CUENTAN LA ORDEN ENTERA, no la vista,
              // porque son el archivo que se va a bajar. Y como la vista casi
              // siempre es un recorte --se revisa marca por marca-- el detalle
              // dice cuánto de eso es lo que se está mirando: sin eso, el
              // número grande no coincidiría con la tabla de abajo y no habría
              // forma de saber por qué.
              [
                completa.cargando ? "trayendo la orden completa…" : null,
                // DE QUIEN ES LA ORDEN. Sin el nombre, el número grande no
                // dice de qué conjunto habla -- que es justo lo que confundía
                // con una marca filtrada.
                // DE QUE ORDEN HABLA EL NUMERO GRANDE. Sin esto, con una
                // marca filtrada no hay forma de saber si cuenta la marca o el
                // proveedor entero -- que es lo que confundía.
                proveedorUnico && vistaEsRecorte
                  ? alcanceReal === "marca"
                    ? `la orden de ${nombreDelAlcanceMarca(filtros.marca)}`
                    : `toda la orden de ${proveedorUnico}`
                  : null,
                // Cuántos de esos renglones son mínimos sin respaldo de ventas.
                // Va acá y no en un aviso aparte porque es una propiedad DE LA
                // ORDEN: el número de al lado se lee distinto si un tercio de
                // él son artículos que nadie midió.
                resumen.minimos > 0
                  ? `${fmtNumero(resumen.minimos)} sin ventas que lo respalden`
                  : null,
                vistaEsRecorte
                  ? `${fmtNumero(resumenVista.renglones)} en esta vista`
                  : `de ${fmtNumero(filas.length)} artículos a la vista`,
              ]
                .filter(Boolean)
                .join(" · ")
            }
          />
          <TarjetaKpi
            titulo={proveedorUnico ? "Unidades a pedir" : "Unidades a la vista"}
            valor={fmtNumero(resumen.unidades)}
            detalle={
              [
                resumen.bultos > 0
                  ? `${fmtNumero(resumen.bultos)} bultos`
                  : "todo por unidad",
                vistaEsRecorte
                  ? `${fmtNumero(resumenVista.unidades)} en esta vista`
                  : null,
              ]
                .filter(Boolean)
                .join(" · ")
            }
          />
          <TarjetaKpi
            titulo={
              proveedorUnico
                ? "A pagar con descuento, sin IVA"
                : "A pagar por lo que se ve, sin IVA"
            }
            valor={fmtMoneda(resumen.neto)}
            detalle={
              // EL SUBTOTAL DE LA VISTA ES LO QUE SE MIRA AL REVISAR MARCA POR
              // MARCA: "¿cuánto estoy pidiendo de esta marca?". Es la única
              // forma de verlo, porque el número de arriba es la orden entera.
              vistaEsRecorte
                ? `${fmtMoneda(resumenVista.neto)} en esta vista · sin descuento la orden sería ${fmtMoneda(resumen.bruto)}`
                : `Sin descuento serían ${fmtMoneda(resumen.bruto)}`
            }
            acento={resumen.neto > 0 ? PALETA[1] : undefined}
          />
          <TarjetaKpi
            titulo="Ahorro por el descuento"
            valor={fmtMoneda(resumen.bruto - resumen.neto)}
            detalle={
              data.sellInCargado > 0
                ? `Sell in de ${etiquetaDe(data)} · ${fmtNumero(data.sellInCargado)} artículos` +
                  // De qué mes es el COSTO sobre el que se aplica el descuento.
                  // Sólo cuando la columna no es un mes --una promo-- porque en
                  // cualquier otro caso es el mismo que ya dice la etiqueta, y
                  // repetirlo seria ruido.
                  (data.evento && !data.valorSellIn.startsWith(data.mes)
                    ? ` · costos de ${fmtMes(data.mes)}`
                    : "")
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
            {/* LOS AVISOS VAN PRIMERO Y ARRIBA DE LOS BOTONES, no al lado
                de la descarga: lo que tiene que pasar es leerlos ANTES de
                bajar el archivo, y abajo del botón se leen después. */}

            {/* 1. LAS CANTIDADES SE MOVIERON SOLAS. Es el aviso más importante
                   de los tres: cambia números, no sólo lo que se ve. */}
            {recalculados.length > 0 && (
              <div className="border-c3/40 bg-c3/10 w-full rounded-lg border px-3 py-2 text-[11px]">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-c3 font-semibold">
                    Tener en cuenta que se recalcularon cantidades. Revisar.
                  </span>
                  <span className="text-muted">
                    El borrador guarda lo que decidiste, no los números: el
                    resto se volvió a calcular con las ventas de hoy.{" "}
                    <strong className="text-ink">
                      {fmtNumero(recalculados.length)}{" "}
                      {recalculados.length === 1
                        ? "artículo cambió"
                        : "artículos cambiaron"}
                    </strong>{" "}
                    desde que lo guardaste.
                  </span>
                </div>
                {/* CUALES, y no sólo cuántos: "revisar" sin la lista es una
                    sensación, con la lista es una instrucción. Vienen ordenados
                    por cuánto se movieron, así que los primeros son los que
                    pueden cambiar la orden de verdad. */}
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {recalculados.slice(0, RECALCULADOS_A_LA_VISTA).map((r) => (
                    <span
                      key={r.sku}
                      className="border-line bg-panel text-muted rounded-md border px-1.5 py-0.5 tabular-nums"
                      title={`${r.sku}: el cálculo pedía ${r.antes} y ahora pide ${r.ahora}`}
                    >
                      <span className="text-ink font-medium">{r.sku}</span>{" "}
                      {fmtNumero(r.antes)} → {fmtNumero(r.ahora)}
                    </span>
                  ))}
                  {recalculados.length > RECALCULADOS_A_LA_VISTA && (
                    <span className="text-muted px-1 py-0.5">
                      y{" "}
                      {fmtNumero(
                        recalculados.length - RECALCULADOS_A_LA_VISTA,
                      )}{" "}
                      más
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* 2. HASTA DONDE LLEGA LA ORDEN, elegido a mano.
                   Los dos casos son reales: hay proveedores donde la OC va
                   siempre por marca, y hay veces que se filtra una marca sólo
                   para vaciarle cantidades y la OC igual va por todo el
                   proveedor. Acá se elige cuál de los dos es ésta. */}
            {sePuedeElegirAlcance && (
              <div className="border-line bg-panel-2 flex w-full flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border px-3 py-2 text-[11px]">
                <span className="text-ink font-semibold">La orden es:</span>
                <div className="flex flex-wrap gap-1">
                  <button
                    type="button"
                    onClick={() => setAlcance("proveedor")}
                    className={`rounded-lg border px-2.5 py-1 text-[11px] ${
                      alcanceReal === "proveedor"
                        ? "border-c1 text-c1 font-medium"
                        : "border-line text-muted hover:text-ink"
                    }`}
                  >
                    Todo {proveedorUnico}
                  </button>
                  <button
                    type="button"
                    onClick={() => setAlcance("marca")}
                    className={`rounded-lg border px-2.5 py-1 text-[11px] ${
                      alcanceReal === "marca"
                        ? "border-c1 text-c1 font-medium"
                        : "border-line text-muted hover:text-ink"
                    }`}
                  >
                    Sólo {nombreDelAlcanceMarca(filtros.marca)}
                  </button>
                </div>
                <span className="text-muted">
                  {alcanceReal === "proveedor" ? (
                    <>
                      El archivo lleva{" "}
                      <strong className="text-ink">
                        los {fmtNumero(resumen.renglones)} renglones
                      </strong>{" "}
                      del proveedor, con las cantidades que hayas cargado
                      filtrando marca por marca.
                    </>
                  ) : (
                    <>
                      El archivo lleva sólo{" "}
                      <strong className="text-ink">
                        los {fmtNumero(resumen.renglones)} renglones
                      </strong>{" "}
                      de {nombreDelAlcanceMarca(filtros.marca)}. Lo que cargaste
                      en otras marcas de este proveedor{" "}
                      <strong className="text-ink">no va a salir</strong>.
                    </>
                  )}
                </span>
              </div>
            )}

            {/* 2b. EL BUSCADOR Y EL SELECTOR MOSTRAR NO RECORTAN LA ORDEN, y
                    conviene decirlo donde se están usando. Son la lupa con la
                    que se mira, no un conjunto que alguien pueda nombrar: si
                    recortaran, olvidarse una palabra tipeada mandaría media
                    orden sin que nada avisara. */}
            {proveedorUnico && (otroRecorte.length > 0) && (
              <div className="border-line bg-panel-2 text-muted flex w-full flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border px-3 py-2 text-[11px]">
                <span>
                  Tenés puesto {otroRecorte.join(" y ")}, pero eso{" "}
                  <strong className="text-ink">no recorta la orden</strong>:
                  sirve para mirar y para cargar cantidades. Acá ves{" "}
                  {fmtNumero(resumenVista.renglones)} de los{" "}
                  {fmtNumero(resumen.renglones)} renglones que van al archivo.
                </span>
                <button
                  type="button"
                  onClick={verOrdenCompleta}
                  className="border-line text-muted hover:bg-panel hover:text-ink ml-auto rounded-lg border px-2.5 py-1 text-[11px] font-medium"
                >
                  Ver la orden completa
                </button>
              </div>
            )}

            {/* 3. LA ORDEN COMPLETA TODAVIA NO LLEGO, o no se pudo traer. Los
                   botones de bajar y mandar están apagados mientras tanto: ver
                   `puedeBajar`. */}
            {proveedorUnico && completa.cargando && (
              <div className="border-line bg-panel-2 text-muted w-full rounded-lg border px-3 py-2 text-[11px]">
                Trayendo la orden completa de {proveedorUnico}…
              </div>
            )}
            {proveedorUnico && completa.error && (
              <div className="border-negativo/40 bg-negativo/10 w-full rounded-lg border px-3 py-2 text-[11px]">
                <span className="text-negativo font-semibold">
                  No se pudo traer la orden completa del proveedor.
                </span>{" "}
                <span className="text-muted">
                  Hasta que se pueda, bajar o mandar la orden queda bloqueado:
                  saldría incompleta. Probá el botón de actualizar.
                </span>
              </div>
            )}

            {/* ESTOS TRES BOTONES ACTUAN SOBRE LO QUE SE VE, no sobre la
                orden entera, y por eso el rótulo lo dice. Es lo correcto para
                trabajar marca por marca --vaciar la marca que no va-- pero
                decírselo "toda la lista" ahora sería mentira: la lista de la
                orden es el proveedor completo. */}
            <span className="text-muted mr-1 text-[11px]">
              Lo que estás viendo:
            </span>
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
                disabled={!puedeBajar}
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
                  disabled={!puedeBajar}
                  title="Carga la orden directamente en Sigma. Pide confirmar antes."
                  className="border-c1 bg-c1 text-panel hover:bg-c1/85 rounded-lg border px-3 py-1.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Enviar a Sigma
                </button>
              )}
              <button
                type="button"
                onClick={() => descargar("xlsx")}
                disabled={!puedeBajar}
                title="Excel valorizado, con el código y el EAN del proveedor, para mandarle por mail"
                className="border-c1 bg-c1/15 text-c1 hover:bg-c1/25 rounded-lg border px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-40"
              >
                Bajar Excel para el proveedor
              </button>
              <button
                type="button"
                onClick={() => descargar("csv")}
                disabled={!puedeBajar}
                className="border-line hover:bg-panel-2 text-muted hover:text-ink rounded-lg border px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-40"
              >
                Bajar CSV
              </button>
            </div>

            {/* EL ESTADO DEL BORRADOR, abajo y en voz baja.
                No es una acción ni un aviso: es la respuesta a "¿se está
                guardando?", que es la pregunta que alguien se hace una vez y
                después no vuelve a hacerse. Por eso va al pie, chico y sin
                color -- salvo cuando falla, que ahí sí hay que mirarlo. */}
            {estadoBorrador && (
              <div className="border-line mt-1 flex w-full flex-wrap items-center gap-x-2 gap-y-1 border-t pt-2 text-[11px]">
                <span
                  className={
                    borrador.estado === "error" ? "text-negativo" : "text-muted"
                  }
                >
                  {estadoBorrador}
                </span>
                {/* DESCARTAR ESTA AL LADO DE "SE RETOMO" a propósito: retomar
                    solo, sin preguntar, sólo es aceptable si deshacerlo está
                    a un click de distancia. */}
                {proveedorUnico &&
                  (borrador.retomadoDe !== null || ediciones.size > 0) &&
                  (confirmandoDescarte ? (
                    <>
                      <span className="text-ink">
                        Se pierden las {fmtNumero(ediciones.size)} cantidades
                        que cargaste a mano. ¿Descartar?
                      </span>
                      <button
                        type="button"
                        onClick={descartarBorrador}
                        className="border-negativo/50 text-negativo hover:bg-negativo/15 rounded-lg border px-2 py-0.5 text-[11px] font-medium"
                      >
                        Sí, descartar
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmandoDescarte(false)}
                        className="border-line text-muted hover:bg-panel-2 hover:text-ink rounded-lg border px-2 py-0.5 text-[11px]"
                      >
                        No
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmandoDescarte(true)}
                      className="border-line text-muted hover:bg-panel-2 hover:text-ink rounded-lg border px-2 py-0.5 text-[11px]"
                      title="Borra las cantidades que cargaste y el borrador guardado. La orden vuelve al sugerido de hoy."
                    >
                      Descartar el borrador
                    </button>
                  ))}
                {proveedorUnico && (
                  <span className="text-muted ml-auto">
                    Los borradores se guardan {DIAS_DE_VIDA_BORRADOR} días.
                  </span>
                )}
              </div>
            )}
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
              {/* EL MOMENTO DE NO VOLVER ATRAS merece decir QUE se manda con
                  todas las letras, sea cual sea el alcance elegido. */}
              {vistaEsRecorte && (
                <p className="text-muted text-xs">
                  {alcanceReal === "proveedor" ? (
                    <>
                      Se manda la orden <strong>entera</strong> de{" "}
                      {proveedorUnico} —los{" "}
                      <strong className="text-ink">
                        {fmtNumero(resumen.renglones)} renglones
                      </strong>{" "}
                      de acá abajo—, no sólo los{" "}
                      {fmtNumero(resumenVista.renglones)} que se ven en la tabla
                      con los filtros puestos.
                    </>
                  ) : (
                    <>
                      Se manda <strong>sólo {nombreDelAlcanceMarca(filtros.marca)}</strong>:
                      los{" "}
                      <strong className="text-ink">
                        {fmtNumero(resumen.renglones)} renglones
                      </strong>{" "}
                      de acá abajo. Lo que hayas cargado en otras marcas de{" "}
                      {proveedorUnico} <strong>no va a salir</strong>.
                    </>
                  )}
                </p>
              )}
              {/* LA ULTIMA CHANCE DE VER LOS MINIMOS. Ahora se cargan solos,
                  así que pueden llegar hasta acá sin que nadie los haya
                  mirado: son cantidades que ninguna venta respalda, en una
                  orden que después no se puede deshacer desde el tablero. */}
              {resumen.minimos > 0 && (
                <p className="text-xs text-amber-400">
                  <strong>
                    {fmtNumero(resumen.minimos)} de los{" "}
                    {fmtNumero(resumen.renglones)} renglones
                  </strong>{" "}
                  son el mínimo de un bulto de artículos que no vendieron nada
                  en la ventana —nuevos, o que dejaron de moverse—. Están
                  marcados en ámbar en la columna Cantidad.
                </p>
              )}
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
                  <p className="font-medium">
                    La orden se cargó en Sigma
                    {resultado.numeroSigma ? (
                      <>
                        {" "}
                        con el número{" "}
                        <strong className="font-mono">
                          {resultado.numeroSigma}
                        </strong>
                      </>
                    ) : (
                      ""
                    )}
                    .
                  </p>
                  <p className="mt-1">
                    Proveedor <strong>{resultado.enviado.proveedorId}</strong> ·
                    empresa <strong>{resultado.enviado.empresa}</strong> ·{" "}
                    {fmtNumero(resultado.enviado.items.length)} renglones ·
                    estado <strong>Pendiente</strong>.{" "}
                    {resultado.numeroSigma
                      ? "Buscá ese número en Sigma para aprobarla."
                      : "Buscála en Sigma para aprobarla."}
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
                  {resultado.url && (
                    <p className="mt-1 text-xs">
                      A esta URL: <span className="font-mono break-all">{resultado.url}</span>
                    </p>
                  )}
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
              `${fmtNumero(filas.length)} artículos` +
              ` · ritmo de ${data.ventana} días` +
              (data.mes ? ` · sell in de ${etiquetaDe(data)}` : "")
            }
          >
            <Tabla
              filas={filas}
              columnas={columnas}
              etiquetaTotal="Total de la orden"
              clave={(f) => f.sku}
              /* SKU, código del proveedor y artículo se quedan quietos. Son
                 las tres que contestan "¿de qué fila es este número?", y sin
                 ellas a la vista los veinte campos de la derecha no se pueden
                 leer: hay que arrastrar hasta el borde para saber de qué
                 artículo se estaba hablando, y volver. */
              fijas={3}
              vacio={<VacioCompras data={data} filtros={filtros} cambiar={cambiar} />}
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
                      {/* EL NUMERO DE SIGMA, que es con el que la orden se
                          busca del otro lado. Las viejas no lo tienen: su API
                          no lo devolvía cuando se mandaron. */}
                      {o.numeroSigma && (
                        <>
                          {" · "}
                          <span className="font-mono">OC {o.numeroSigma}</span>
                        </>
                      )}
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
            {resumen.recortados > 0 && (
              <p className="mt-1">
                <strong>
                  Hay {fmtNumero(resumen.recortados)} renglones con descuento
                  mayor a {DESCUENTO_MAXIMO} %
                </strong>
                : se recortan a {DESCUENTO_MAXIMO} antes de exportar. Un
                descuento así es un error de carga, y en una orden de compra
                deja de ser un número raro en una pantalla.
              </p>
            )}
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
              <strong>La rentabilidad</strong> que se muestra es la del mes que
              acaba de cerrar, de todos los canales, sobre la facturación neta y
              sin descontar flete. Sirve para separar «se vende porque gusta» de
              «se vendía porque estaba liquidado»: son el mismo ritmo y llevan a
              comprar distinto. La de los últimos {MESES_RENTABILIDAD} meses
              sigue entrando en el cálculo del sugerido —es la que frena las
              compras grandes de lo que no rinde— pero ya no ocupa una columna.
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

/**
 * Qué decir cuando la tabla no tiene ninguna fila.
 *
 * ---------------------------------------------------------------------------
 * UN CARTEL QUE NO DA LA SALIDA ES UN CARTEL QUE NO SIRVE
 *
 * Filtrando por una marca chica la pantalla quedaba en blanco y parecía decir
 * "esa marca no existe", cuando lo que pasaba era que la vista elegida la
 * dejaba afuera: sus artículos están, pero no hay nada que reponer o no tienen
 * oferta este mes.
 *
 * Que no haya sugerencia NO es lo mismo que que no haya nada que pedir: una
 * marca nueva, un artículo que se repone puntualmente o algo que se acordó con
 * el proveedor se cargan a mano, y para eso el artículo tiene que estar a la
 * vista. Así que acá va cuántos encontró el filtro y el botón que los muestra.
 */
function VacioCompras({
  data,
  filtros,
  cambiar,
}: {
  data: DashboardCompras;
  filtros: FiltrosCompras;
  cambiar: (f: FiltrosCompras) => void;
}) {
  const hay = data.articulosDelFiltro;
  const sinFicha = data.sinFichaDeStock ?? [];

  /**
   * EXISTE EN SIGMA PERO NO TIENE FICHA DE STOCK.
   *
   * Va primero porque contesta la pregunta que la persona se está haciendo
   * --"¿por qué no aparece si yo lo veo en Sigma?"-- y porque la salida no es
   * tocar un filtro de esta pantalla sino cargarlo en Digip. Un cartel que
   * ofrece sacar recortes cuando el problema es otro manda a buscar donde no
   * está.
   */
  if (sinFicha.length > 0) {
    return (
      <div className="mx-auto flex max-w-xl flex-col items-center gap-2">
        <p>
          {sinFicha.length === 1 ? (
            <>
              <strong className="text-ink">{sinFicha[0]!.sku}</strong> existe en
              Sigma, pero todavía no tiene ficha de stock en Digip.
            </>
          ) : (
            <>
              Hay{" "}
              <strong className="text-ink">
                {fmtNumero(sinFicha.length)} artículos
              </strong>{" "}
              que existen en Sigma pero todavía no tienen ficha de stock en
              Digip.
            </>
          )}
        </p>
        <ul className="text-muted space-y-0.5 text-xs">
          {sinFicha.map((a) => (
            <li key={a.sku}>
              <span className="font-mono">{a.sku}</span>
              {a.producto ? ` · ${a.producto}` : ""}
              {a.proveedor ? ` · ${a.proveedor}` : ""}
              {a.alta ? ` · alta ${fmtFechaCortaConAnio(a.alta)}` : ""}
            </li>
          ))}
        </ul>
        {/* QUE HACER, que es lo único que falta. Esta pantalla arma la lista
            desde el stock de los dos depósitos: sin ficha no hay fila, y no
            hay filtro acá que lo destrabe. */}
        <p className="text-muted text-xs">
          Compras arma la lista desde el stock de los dos depósitos, así que
          hasta que no esté cargado en Digip —aunque sea en cero— no puede
          aparecer. En cuanto lo esté, entra solo en la próxima corrida.
        </p>
      </div>
    );
  }

  // Sin recortes no hay a quién culpar: cero filas es cero artículos.
  if (hay === 0) {
    return <p>Ningún artículo para el filtro elegido.</p>;
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <p className="mx-auto max-w-lg">
        Ninguno de los grupos elegidos tiene artículos con este filtro, pero
        hay{" "}
        <strong className="text-ink">
          {hay === 1 ? "1 artículo" : `${fmtNumero(hay)} artículos`}
        </strong>{" "}
        {hay === 1
          ? "al que podés cargarle cantidades a mano."
          : "a los que podés cargarles cantidades a mano."}
      </p>

      <button
        type="button"
        onClick={() => cambiar({ ...filtros, recortes: [] })}
        className="border-c1 bg-c1/15 text-c1 hover:bg-c1/25 rounded-lg border px-3 py-1.5 text-xs transition-colors"
      >
        {hay === 1 ? "Ver el artículo" : `Ver los ${fmtNumero(hay)} artículos`}
      </button>
    </div>
  );
}
