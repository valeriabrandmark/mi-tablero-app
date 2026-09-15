/**
 * Reglas de la pantalla "Precios TN — Comparador".
 *
 * ---------------------------------------------------------------------------
 * QUÉ HACE ESTA PANTALLA Y QUÉ NO
 *
 * Muestra lo que propuso el motor del proyecto `precios` y deja aprobar o
 * rechazar. **Nunca habla con Tienda Nube.** Aprobar cambia el estado de una
 * fila en `precios.propuesta`; la escritura real la hace un workflow, con un
 * token que esta aplicación no tiene y no debe tener. Si alguien roba una
 * sesión del tablero, lo peor que puede hacer es aprobar algo — que después
 * queda registrado en `precios.cambio`, que es inmutable.
 * ---------------------------------------------------------------------------
 */

import type { FiltrosPreciosTn } from "@/lib/types";

/** Vive en `precios`, no acá. Se repite el nombre para poder tipar. */
export const ESTADOS = ["pendiente", "aprobada", "rechazada", "aplicada", "vencida"] as const;
export type EstadoPropuesta = (typeof ESTADOS)[number];

/**
 * Los grupos de alerta, en el orden en que hay que mirarlos.
 *
 * NO SON TRAMOS DE UN MISMO EJE, y por eso no se ordenan por porcentaje: son
 * situaciones distintas que se resuelven de formas distintas. "Perdemos plata"
 * es una decisión de si seguir vendiendo el producto; "estamos caros" es un
 * número a ajustar. Mezclarlos en una sola lista ordenada por diferencia
 * escondería nueve casos graves entre trescientos casos normales.
 */
export const ALERTAS = [
  {
    clave: "no_competible",
    titulo: "No se puede competir sin perder",
    detalle:
      "La competencia vende por debajo de nuestro piso de margen. Igualarlos es " +
      "vender a pérdida; subir al piso nos saca del mercado. Es una decisión de " +
      "si este canal sirve para estos productos, no un precio a corregir.",
    tono: "critico",
  },
  {
    clave: "bajo_piso",
    titulo: "Vendiendo por debajo del piso",
    detalle:
      "El precio de hoy no cubre costo, IVA, pasarela e impuestos con el margen " +
      "mínimo. Acá la competencia SÍ está arriba del piso: se puede subir y " +
      "seguir compitiendo. Es plata que se pierde en cada venta.",
    tono: "critico",
  },
  {
    clave: "caros",
    titulo: "Más caros que la competencia",
    detalle: "Se puede bajar sin perforar el piso de margen.",
    tono: "aviso",
  },
  {
    clave: "baratos",
    titulo: "Más baratos de lo necesario",
    detalle:
      "Estamos por debajo del más barato del mercado sin necesidad. Subir hacia " +
      "el pelotón no cuesta ventas y recupera margen.",
    tono: "aviso",
  },
  {
    clave: "sin_competencia",
    titulo: "Sin competencia detectada",
    detalle:
      "Ninguna fuente tiene estos productos. No se pueden comparar: o no los " +
      "venden, o les falta el código de barras a ellos o a nosotros.",
    tono: "neutro",
  },
  {
    // CORREGIDO Y AUN ASÍ ARRIBA DEL MERCADO. No es una cola de trabajo: es
    // una lista para mirar.
    //
    // Estos productos ya se escribieron, y aun así quedaron por encima del
    // más barato del mercado, porque el piso no deja bajar más. No hay nada
    // que autorizar —el precio ya está puesto— pero tampoco están "en precio",
    // y meterlos en "más caros que la competencia" diría que se puede bajar,
    // que es justo lo que no se puede.
    //
    // Es el mismo diagnóstico que "no se puede competir sin perder", visto
    // después de haber actuado: allá el precio todavía estaba mal, acá ya se
    // corrigió y lo que queda es una decisión de si este canal sirve para
    // estos productos.
    clave: "corregidos_sin_competir",
    titulo: "Corregidos pero sin competir",
    detalle:
      "Ya se les escribió el precio nuevo y quedaron igual por encima del " +
      "mercado: la competencia vende por debajo de nuestro piso. No hay nada " +
      "que autorizar acá; hay que decidir si conviene seguir vendiéndolos.",
    tono: "aviso",
  },
  {
    // LO QUE ESTÁ BIEN TAMBIÉN ES INFORMACIÓN, y faltaba.
    //
    // La pantalla mostraba cinco tarjetas y las cinco eran problemas. Los
    // productos en precio —la mayoría— no aparecían en ningún lado: estaban
    // filtrados como ruido, y "ruido" es la palabra correcta para una cola de
    // trabajo pero no para saber cómo está el negocio. Sin este número, la
    // pantalla contesta "qué está mal" pero no "cuánto está bien", y son dos
    // preguntas distintas.
    clave: "en_precio",
    titulo: "En precio",
    detalle:
      "Estamos a menos del 2 % del más barato del mercado. No hay nada que " +
      "hacer con estos: se listan para poder verlos, no para decidirlos.",
    tono: "ok",
  },
] as const;

export type ClaveAlerta = (typeof ALERTAS)[number]["clave"];

/**
 * Debajo de esta diferencia un producto está EN PRECIO.
 *
 * Con la política actual el motor ya no propone cambios menores al 2 %, pero el
 * umbral se repite acá porque la pantalla también lista cosas que el motor
 * MANTUVO, y una lista de trescientos productos con 1 % de diferencia no es
 * una cola de trabajo: es ruido que hace abandonar la pantalla.
 *
 * ESO SIGUE SIENDO CIERTO PARA LA COLA, Y NO PARA EL RESUMEN. Antes estos
 * productos no existían en ningún lado de la pantalla; ahora cuentan en su
 * propia tarjeta y se pueden ver haciendo clic. Lo que no hacen es mezclarse
 * con lo que hay que decidir, que es de lo que había que protegerse.
 */
export const DIFERENCIA_MINIMA_VISIBLE = 0.02;

/**
 * Los grupos que NO son cola de trabajo.
 *
 * Se nombran una sola vez para que la consulta y la pantalla no puedan opinar
 * distinto sobre cuáles son: el día que se agregue otro, se agrega acá y las
 * dos se enteran.
 *
 * QUÉ TIENEN EN COMÚN Y POR QUÉ NO SE LISTAN POR DEFECTO: en ninguno hay algo
 * que autorizar. "En precio" no necesita cambio y "corregidos pero sin
 * competir" ya lo tuvo. Mezclarlos con lo pendiente es lo que hacía que la
 * cola mostrara cientos de renglones sin casilla —ni acción posible— y que
 * encontrar los que sí esperan una decisión fuera un trabajo.
 *
 * Se cuentan siempre en su tarjeta y se listan al hacerle clic.
 */
export const GRUPOS_INFORMATIVOS: readonly ClaveAlerta[] = [
  "en_precio",
  "corregidos_sin_competir",
];

/**
 * Los mismos, listos para un `not in (...)` de SQL.
 *
 * Se interpolan sin parametrizar y está bien: son claves nuestras, declaradas
 * arriba en este archivo, no texto que venga de una query string. Lo que sí se
 * parametriza siempre es lo que escribe quien usa la pantalla.
 */
export const GRUPOS_INFORMATIVOS_SQL = GRUPOS_INFORMATIVOS.map((g) => `'${g}'`).join(", ");

/**
 * Cuántos precios escribe COMO MÁXIMO cada corrida de escritura.
 *
 * POR QUÉ HAY UN TOPE. Escribir un precio es lo único irreversible de todo
 * esto: un precio publicado ya lo vio un cliente. Si una corrida sale con un
 * dato roto —un costo mal cargado, una fuente que devolvió precios de otro
 * producto— 50 productos mal es un problema de una tarde y 3.788 es un problema
 * de una semana. El tope es el freno de mano.
 *
 * SE DECLARA ACÁ Y NO SÓLO EN LA RUTA porque la pantalla lo necesita para no
 * mentir: con 200 autorizadas, un botón que dice "Escribir (200)" promete algo
 * que no va a pasar. Los dos leen de esta constante, así que no pueden decir
 * números distintos.
 */
export const TANDA_ESCRITURA = 50;

/** Cómo se llama cada fuente en pantalla. El código es feo; el nombre no. */
export const NOMBRE_FUENTE: Record<string, string> = {
  farmaonline: "Farmaonline",
  farmacias_del_pueblo: "Farmacias del Pueblo",
  juleriaque: "Juleriaque",
  gloss: "Gloss",
  parfumerie: "Parfumerie",
  fravega: "Frávega",
  sunino: "Su Niño",
  bauma: "Bauma Shop",
  bebelli: "Bebelli",
  philips: "Philips",
  chicco: "Chicco",
  fiorani: "Fiorani",
};

export function nombreFuente(codigo: string): string {
  return NOMBRE_FUENTE[codigo] ?? codigo;
}

/**
 * Lee los filtros de la query string.
 *
 * VIVE ACÁ Y NO EN CADA RUTA porque la ruta que LISTA y la que APRUEBA EN
 * BLOQUE tienen que entender exactamente los mismos parámetros. Si cada una
 * los leyera a su manera, el día que difieran el botón de "autorizar todo"
 * aprobaría un conjunto distinto del que la persona tiene delante — y eso no
 * daría ningún error, sólo precios aprobados que nadie miró.
 */
export function leerFiltros(params: URLSearchParams): FiltrosPreciosTn {
  // El grupo se valida contra la lista y no se pasa crudo: un valor inventado
  // no encontraría clasificación y el filtro caería silencioso en "todo", que
  // es justo lo que no se pidió.
  const crudo = params.get("grupo");
  const grupo = (ALERTAS.find((a) => a.clave === crudo)?.clave ?? null) as ClaveAlerta | null;

  const texto = (nombre: string, largoMaximo: number) => {
    const v = params.get(nombre)?.trim() ?? "";
    return v ? v.slice(0, largoMaximo) : null;
  };

  return {
    grupo,
    // Van parametrizados en el SQL, así que el recorte no es contra inyección
    // sino contra una query string absurda de 8 kB que no puede coincidir con
    // ningún proveedor real.
    proveedor: texto("proveedor", 120),
    marca: texto("marca", 120),
    busqueda: texto("q", 60),
  };
}
