/**
 * Los isotipos de las marcas, dibujados como SVG y no como PNG.
 *
 * POR QUÉ SVG. Se usan en dos tamaños muy distintos —18 px en el panel de la
 * izquierda y ~40 px en el encabezado de cada tablero—, y un PNG que se ve bien
 * en uno se ve mal en el otro. Además el tablero es de fondo casi negro
 * (#0b0d10) y los originales son azul marino: en SVG el color se ajusta acá, en
 * un PNG habría que exportar una versión aparte de cada archivo.
 *
 * QUÉ SE INVIRTIÓ Y QUÉ NO:
 *
 *   Unibrandco   la U pasa de azul marino a `currentColor`, así acompaña al
 *                texto (gris cuando la entrada está en reposo, blanca cuando
 *                está activa). La tilde queda naranja, que es lo que la
 *                identifica y ya resalta sobre el fondo oscuro.
 *   Tienda Nube  los dos aros pasan de azul marino a `currentColor`, por lo
 *                mismo: en azul marino sobre fondo negro no se veían.
 *   Mercado Libre no se toca. El amarillo sobre fondo oscuro es de lo que más
 *                resalta del tablero, y el azul del apretón va adentro de la
 *                elipse amarilla, donde el contraste no depende del fondo.
 *
 * Son versiones simplificadas hechas a partir de los logos: alcanzan para 18 px
 * y para el encabezado, pero no son los archivos oficiales. Si aparecen los
 * originales conviene reemplazarlos.
 */

type Props = {
  /** Alto/ancho de la caja. El dibujo se centra adentro sin deformarse. */
  className?: string;
  /**
   * Texto para lectores de pantalla. Sin esto la marca es decorativa, que es
   * lo correcto cuando al lado hay un texto que dice lo mismo.
   */
  titulo?: string;
};

/** Atributos comunes: o es una imagen con nombre, o no existe para el lector. */
function accesibilidad(titulo?: string) {
  return titulo ? { role: "img" as const, "aria-label": titulo } : { "aria-hidden": true };
}

/** El naranja de Brandmark, el mismo del isotipo de las flechitas. */
const NARANJA = "#e8801a";

/**
 * Unibrandco: la U con la tilde arriba.
 *
 * La U es un trazo grueso y no una silueta rellena. Con `stroke-linecap="round"`
 * las puntas de arriba quedan redondeadas igual que las de la tilde, y a 18 px
 * se lee mejor que intentando reproducir los remates rectos del original.
 */
export function MarcaUnibrandco({ className, titulo }: Props) {
  return (
    <svg viewBox="0 0 100 140" fill="none" className={className} {...accesibilidad(titulo)}>
      <path
        d="M6 34C12 12 30 4 48 16c16 11 28 14 42-6-2 20-18 34-38 22C34 21 20 16 6 34Z"
        fill={NARANJA}
      />
      <path
        d="M23 56v44a27 27 0 0 0 54 0V56"
        stroke="currentColor"
        strokeWidth="22"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * Tienda Nube: los dos aros que se cruzan.
 *
 * El chico va arriba a la izquierda y el grande abajo a la derecha, cruzados,
 * que es lo que le da la forma de nube. El grosor del trazo es el mismo en los
 * dos: si el aro grande lo llevara proporcional, el chico se vería más liviano.
 */
export function MarcaTiendaNube({ className, titulo }: Props) {
  return (
    <svg viewBox="0 0 100 100" fill="none" className={className} {...accesibilidad(titulo)}>
      <g stroke="currentColor" strokeWidth="12">
        <circle cx="34" cy="36" r="19" />
        <circle cx="60" cy="56" r="26" />
      </g>
    </svg>
  );
}

/**
 * Mercado Libre: la elipse amarilla con el apretón de manos.
 *
 * El apretón está simplificado a la forma que queda: dos brazos que entran de
 * los costados y se cruzan en el medio. A 18 px el detalle de los dedos no se
 * distingue, y a tamaño de encabezado una versión dibujada a mano se notaría
 * más que esta silueta limpia.
 */
export function MarcaMercadoLibre({ className, titulo }: Props) {
  return (
    <svg viewBox="0 0 100 68" fill="none" className={className} {...accesibilidad(titulo)}>
      <ellipse cx="50" cy="34" rx="46" ry="30" fill="#ffe600" stroke="#2d3277" strokeWidth="5" />
      {/* La banda blanca del medio se recorta contra la elipse para que no se
          escape por los costados. */}
      <clipPath id="ml-elipse">
        <ellipse cx="50" cy="34" rx="46" ry="30" />
      </clipPath>
      <g clipPath="url(#ml-elipse)">
        <path d="M0 34Q50 6 100 34Q50 62 0 34Z" fill="#fff" />
        {/* Las dos manos entran EN DIAGONAL y se cruzan en el medio: dibujadas
            horizontales quedaban una al lado de la otra y el conjunto se leía
            como una barra, no como un apretón.

            La de la derecha va dos veces, primero en blanco y más gruesa: ese
            halo es lo que la separa de la de abajo. Sin él las dos se funden en
            una sola mancha azul. */}
        <g strokeLinecap="round" fill="none">
          <path d="M18 38 52 32" stroke="#2d3277" strokeWidth="8" />
          <path d="M82 30 48 36" stroke="#fff" strokeWidth="12" />
          <path d="M82 30 48 36" stroke="#2d3277" strokeWidth="8" />
          {/* Los dedos de la mano de arriba. A 18 px no se distinguen, pero en
              el encabezado son los que terminan de contar qué es. */}
          <path d="M53.3 31 54.7 38.8M60.3 29.8 61.7 37.6M67.3 28.6 68.7 36.4" stroke="#fff" strokeWidth="1.5" />
        </g>
      </g>
    </svg>
  );
}
