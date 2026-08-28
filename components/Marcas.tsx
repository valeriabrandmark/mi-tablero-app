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

/**
 * El naranja de Brandmark: el de las flechitas del isotipo y el de la tilde de
 * la U de Unibrandco. Se exporta porque la barra lateral lo usa para el
 * engranaje de Operaciones, y un segundo #e8801a escrito a mano en otro
 * archivo es el que después queda distinto cuando se retoca la marca.
 */
export const NARANJA = "#e8801a";

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
    <svg viewBox="0 0 98 94" fill="none" className={className} {...accesibilidad(titulo)}>
      <g stroke="currentColor" strokeWidth="13">
        <circle cx="32" cy="32" r="20" />
        <circle cx="62" cy="58" r="24" />
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
      <clipPath id="ml-elipse">
        <ellipse cx="50" cy="34" rx="46" ry="30" />
      </clipPath>

      {/* NO hay una franja blanca de fondo. El blanco del logo SON los brazos y
          las manos: su contorno es el que separa el blanco del amarillo. Puesto
          como franja aparte quedaban cuatro líneas horizontales cruzando la
          elipse —el borde de la franja más el de cada brazo— y el conjunto se
          leía como una venda a rayas.

          Cada parte se dibuja dos veces: primero todos los contornos en azul y
          más gruesos, después todos los rellenos en blanco y más finos. En ese
          orden los contornos internos quedan tapados y sobrevive solo la
          silueta de afuera, que es lo que hace un dibujo de línea. */}
      <g clipPath="url(#ml-elipse)" fill="none" strokeLinecap="round">
        <g stroke="#2d3277">
          <path d="M0 42 40 36" strokeWidth="22" />
          <path d="M100 25 62 30" strokeWidth="22" />
          <path d="M40 38 62 29" strokeWidth="31" />
        </g>
        <g stroke="#fff">
          <path d="M0 42 40 36" strokeWidth="17" />
          <path d="M100 25 62 30" strokeWidth="17" />
          <path d="M40 38 62 29" strokeWidth="26" />
        </g>

        {/* Las cuatro yemas de la mano de abajo, en diagonal hacia arriba. Ese
            gesto es el que hace que se lea un apretón: puestas en fila
            horizontal quedaban dos palos cruzados. */}
        <g fill="#fff" stroke="#2d3277" strokeWidth="2.2">
          <circle cx="40" cy="44" r="4.3" />
          <circle cx="46" cy="42" r="4.5" />
          <circle cx="52" cy="39.5" r="4.5" />
          <circle cx="58" cy="36.5" r="4.2" />
        </g>
        {/* La separación entre dedo y dedo. Sin estas líneas las yemas son
            cuatro bolitas sueltas y no una mano. */}
        <path
          d="M41 40 45 35M47 38 51 33M53 35 57 30"
          stroke="#2d3277"
          strokeWidth="2.2"
        />

        {/* El pulgar de la mano de arriba, apoyado sobre la otra. Va último
            porque en el logo queda por encima de todo. */}
        <path d="M40 34 64 26" stroke="#2d3277" strokeWidth="12.5" />
        <path d="M40 34 64 26" stroke="#fff" strokeWidth="8.5" />
      </g>
    </svg>
  );
}
