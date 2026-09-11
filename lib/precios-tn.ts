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
] as const;

export type ClaveAlerta = (typeof ALERTAS)[number]["clave"];

/**
 * Debajo de esta diferencia no se muestra nada.
 *
 * Con la política actual el motor ya no propone cambios menores al 2 %, pero el
 * umbral se repite acá porque la pantalla también lista cosas que el motor
 * MANTUVO, y una lista de trescientos productos con 1 % de diferencia no es
 * una cola de trabajo: es ruido que hace abandonar la pantalla.
 */
export const DIFERENCIA_MINIMA_VISIBLE = 0.02;

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
