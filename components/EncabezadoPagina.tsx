import Image from "next/image";

/**
 * Encabezado con el logo de cada página, tomado del template de Power BI.
 * Los PNG originales tienen el texto en azul oscuro; están recoloreados a
 * blanco para que se lean sobre el fondo del tablero (ver public/encabezados).
 */
const ENCABEZADOS = {
  ventas: { src: "/encabezados/ventas.png", ancho: 850, alto: 220, alt: "Brandmark Ventas" },
  logistica: {
    src: "/encabezados/logistica.png",
    ancho: 850,
    alto: 220,
    alt: "Brandmark Logística",
  },
  "cuentas-corrientes": {
    src: "/encabezados/cuentas-corrientes.png",
    ancho: 1232,
    alto: 220,
    alt: "Brandmark Cuentas Corrientes",
  },
} as const;

export default function EncabezadoPagina({
  pagina,
  children,
}: {
  pagina: keyof typeof ENCABEZADOS;
  /** Línea de estado debajo del logo (por ejemplo la hora de actualización). */
  children?: React.ReactNode;
}) {
  const e = ENCABEZADOS[pagina];
  return (
    <div>
      <h1>
        <Image
          src={e.src}
          alt={e.alt}
          width={e.ancho}
          height={e.alto}
          priority
          className="h-11 w-auto sm:h-14"
        />
      </h1>
      {children}
    </div>
  );
}
