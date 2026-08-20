import { MarcaMercadoLibre, MarcaTiendaNube, MarcaUnibrandco } from "@/components/Marcas";

/**
 * El encabezado de los tableros minoristas: Unibrandco junto a la marca del
 * canal, como en los logos que se usan afuera del tablero.
 *
 * Es el equivalente de `EncabezadoPagina` para estas páginas, pero armado con
 * SVG y texto en vez de un PNG. Los lockups originales llevan el nombre escrito
 * con la tipografía de cada marca, y eso no se puede reproducir con una fuente
 * cualquiera sin que se note: el isotipo va dibujado y el nombre lo pone el
 * texto, con la tipografía del tablero. Sin ese texto el encabezado quedaba en
 * dos dibujos chicos flotando en el borde, sin el peso que tienen las páginas
 * mayoristas.
 */
const CANALES = {
  "mercado-libre": { Marca: MarcaMercadoLibre, nombre: "Mercado Libre" },
  "tienda-nube": { Marca: MarcaTiendaNube, nombre: "Tienda Nube" },
} as const;

export default function EncabezadoCanal({
  canal,
  className,
}: {
  canal: keyof typeof CANALES;
  className?: string;
}) {
  const { Marca, nombre } = CANALES[canal];

  // Todo el conjunto es UNA imagen para el lector de pantalla: leído pieza por
  // pieza daría "Unibrandco, Mercado Libre" como si fueran dos cosas sueltas.
  return (
    <span
      role="img"
      aria-label={`Unibrandco · ${nombre}`}
      className={`inline-flex flex-wrap items-center gap-x-3 gap-y-1 ${className ?? ""}`}
    >
      <MarcaUnibrandco className="h-9 w-auto" />
      {/* "co" en naranja, como en el logo. */}
      <span className="text-xl font-semibold tracking-tight">
        Unibrand<span className="text-[#e8801a]">co</span>
      </span>

      <span className="bg-line mx-1 h-8 w-px" />

      <Marca className="h-8 w-auto" />
      <span className="text-xl font-semibold tracking-tight">{nombre}</span>
    </span>
  );
}
