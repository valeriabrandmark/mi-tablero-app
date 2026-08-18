"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type Pestana = {
  href: string;
  label: string;
  /** Página todavía sin datos: se muestra apagada y no navega. */
  pendiente?: boolean;
};

/**
 * Pestañas de la sección Mercado Libre, arriba del contenido.
 *
 * Van acá y no en la barra lateral porque son vistas de un mismo tablero —los
 * mismos datos mirados distinto—, mientras que la barra lateral separa
 * secciones que no tienen nada que ver entre sí.
 *
 * Una pestaña "pendiente" se dibuja igual pero no navega: prometer un link que
 * lleva a una página vacía se lee como que el tablero está roto, y esconderla
 * hace que nadie sepa que falta.
 */
export default function PestanasMeli({ pestanas }: { pestanas: Pestana[] }) {
  const pathname = usePathname();

  return (
    <nav className="border-line -mx-1 mb-4 flex gap-1 overflow-x-auto border-b px-1">
      {pestanas.map((p) => {
        const activa = pathname === p.href;

        if (p.pendiente) {
          return (
            <span
              key={p.href}
              title="Todavía no está armada: falta que el orquestador cargue el stock."
              className="text-muted/50 cursor-not-allowed border-b-2 border-transparent px-3 py-2 text-sm whitespace-nowrap"
            >
              {p.label}
              <span className="ml-1.5 text-[10px]">próximamente</span>
            </span>
          );
        }

        return (
          <Link
            key={p.href}
            href={p.href}
            aria-current={activa ? "page" : undefined}
            className={`border-b-2 px-3 py-2 text-sm whitespace-nowrap transition-colors ${
              activa
                ? "border-c1 text-ink font-medium"
                : "text-muted hover:text-ink border-transparent"
            }`}
          >
            {p.label}
          </Link>
        );
      })}
    </nav>
  );
}
