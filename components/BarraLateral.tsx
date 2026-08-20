"use client";

import { useState, type ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import BotonSalir from "@/components/BotonSalir";
import {
  MarcaMercadoLibre,
  MarcaTiendaNube,
  MarcaUnibrandco,
} from "@/components/Marcas";

/**
 * Un logo real servido desde /public, para cuando dibujar un ícono no alcanza:
 * "Ventas Mayoristas" es Brandmark y se reconoce por su isotipo, no por un
 * carrito genérico.
 *
 * No lleva `alt` a propósito. La imagen va pegada al texto de la entrada, así
 * que para un lector de pantalla es decorativa: con `alt` el nombre se leería
 * dos veces seguidas.
 */
export type Logo = { src: string };

export type ClaveIcono =
  | "ventas"
  | "logistica"
  | "cuentas"
  | "objetivos"
  | "unibrandco"
  | "mercadolibre"
  | "tiendanube";

/** Subpágina de un grupo. Lleva su propia marca porque es la que se mira. */
export type ItemHijo = {
  href: string;
  label: string;
  icono: ClaveIcono;
  logo?: Logo;
};

export type ItemNav = {
  /** Identificador estable para React. En un link suelto es su propia ruta. */
  clave: string;
  label: string;
  icono: ClaveIcono;
  /** Si está, reemplaza al ícono dibujado. */
  logo?: Logo;
  /** Ruta propia. Un grupo NO tiene: su encabezado despliega, no navega. */
  href?: string;
  /** Subpáginas. Si están, la entrada es un grupo desplegable. */
  hijos?: ItemHijo[];
};

/**
 * Los íconos de las secciones internas, dibujados a trazo. Van como SVG inline
 * y no como librería: son cuatro, no cambian, y sumar una dependencia entera
 * para esto haría más pesado el bundle que el tablero.
 */
type ClaveTrazo = "ventas" | "logistica" | "cuentas" | "objetivos";

const TRAZOS: Record<ClaveTrazo, ReactNode> = {
  ventas: (
    <>
      <circle cx="9" cy="20" r="1.5" />
      <circle cx="18" cy="20" r="1.5" />
      <path d="M2 3h3l2.4 11.2a2 2 0 0 0 2 1.6h7.5a2 2 0 0 0 2-1.6L21 7H6" />
    </>
  ),
  logistica: (
    <>
      <path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5v-9Z" />
      <path d="M3 7.5 12 12l9-4.5M12 12v9" />
    </>
  ),
  cuentas: (
    <>
      <rect x="2.5" y="5" width="19" height="14" rx="2" />
      <path d="M2.5 10h19" />
    </>
  ),
  objetivos: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4.5" />
      <circle cx="12" cy="12" r="1" />
    </>
  ),
};

/**
 * Las marcas reales. No pueden entrar en `TRAZOS` porque no son un trazo suelto
 * dentro de un `<svg>` compartido: cada una trae su propio `viewBox` y sus
 * propios colores (ver components/Marcas.tsx).
 */
const MARCAS = {
  unibrandco: MarcaUnibrandco,
  mercadolibre: MarcaMercadoLibre,
  tiendanube: MarcaTiendaNube,
} as const;

/**
 * La caja de 18 px es la misma para todos. Las marcas no tienen la misma
 * proporción —la U es vertical, la elipse de Mercado Libre es apaisada—, así
 * que el SVG se centra adentro sin deformarse en vez de estirarse al cuadrado.
 */
function Icono({ clave }: { clave: ClaveIcono }) {
  if (clave in MARCAS) {
    const Marca = MARCAS[clave as keyof typeof MARCAS];
    return <Marca className="size-[18px] shrink-0" />;
  }

  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-[18px] shrink-0"
      aria-hidden="true"
    >
      {TRAZOS[clave as ClaveTrazo]}
    </svg>
  );
}

/** El logo si lo hay, el ícono dibujado si no. Siempre ocupa el mismo lugar. */
function Marca({ icono, logo }: { icono: ClaveIcono; logo?: Logo }) {
  if (!logo) return <Icono clave={icono} />;
  return (
    <Image
      src={logo.src}
      alt=""
      width={64}
      height={64}
      className="size-[18px] shrink-0 object-contain"
    />
  );
}

/** Clases del link de nav, para que el item suelto y el hijo de un grupo coincidan. */
function clasesLink(activo: boolean, sangria = false) {
  return `flex items-center gap-3 rounded-lg py-2 text-sm transition-colors ${
    sangria ? "pr-3 pl-7" : "px-3"
  } ${activo ? "bg-panel-2 text-ink font-medium" : "text-muted hover:bg-panel-2/60 hover:text-ink"}`;
}

/**
 * Entrada con subpáginas ("Ventas Mayoristas", "Ventas minoristas").
 *
 * Arranca abierta cuando estás parado en cualquiera de sus hijos: si no, entrar
 * por un link directo dejaría la barra mostrando el grupo cerrado y la página
 * actual sin marcar en ningún lado.
 *
 * El encabezado es un botón y no un link a propósito: la sección no tiene
 * portada, así que un click ahí no tiene adónde llevarte que no sea ya visible.
 */
function Grupo({
  item,
  pathname,
  alNavegar,
}: {
  item: ItemNav;
  pathname: string;
  alNavegar?: () => void;
}) {
  const hijos = item.hijos ?? [];
  const dentro = hijos.some((h) => pathname === h.href || pathname.startsWith(`${h.href}/`));
  const [abierto, setAbierto] = useState(dentro);

  return (
    <li>
      <button
        type="button"
        onClick={() => setAbierto((a) => !a)}
        aria-expanded={abierto}
        className={`${clasesLink(dentro && !abierto)} w-full text-left`}
      >
        <Marca icono={item.icono} logo={item.logo} />
        <span className="flex-1 truncate">{item.label}</span>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          className={`size-4 shrink-0 transition-transform ${abierto ? "rotate-180" : ""}`}
          aria-hidden="true"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {abierto && (
        <ul className="mt-0.5 space-y-0.5">
          {hijos.map((h) => {
            // `startsWith` acá sí: las pestañas de Mercado Libre cuelgan de su
            // propia URL, y estando en Alertas el grupo tiene que seguir
            // marcando Mercado Libre.
            //
            // La excepción son las páginas de objetivos: comparten el prefijo
            // /objetivos pero no cuelgan una de otra, así que se comparan
            // enteras. Por eso el `===` va primero y el `startsWith` exige la
            // barra: /objetivos/silvio nunca es prefijo de /objetivos/ramon.
            const activo = pathname === h.href || pathname.startsWith(`${h.href}/`);
            return (
              <li key={h.href}>
                <Link
                  href={h.href}
                  onClick={alNavegar}
                  aria-current={activo ? "page" : undefined}
                  className={clasesLink(activo, true)}
                >
                  <Marca icono={h.icono} logo={h.logo} />
                  <span className="truncate">{h.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}

function Contenido({
  nav,
  email,
  rol,
  authConfigurada,
  alNavegar,
}: {
  nav: ItemNav[];
  email: string | null;
  rol: string | null;
  authConfigurada: boolean;
  alNavegar?: () => void;
}) {
  const pathname = usePathname();

  return (
    <div className="flex h-full flex-col">
      <div className="px-5 py-5">
        <span className="text-base font-semibold tracking-tight">Brandmark</span>
        <span className="text-muted ml-1.5 text-base">negocio</span>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 pb-4">
        <ul className="space-y-0.5">
          {nav.map((item) => {
            if (item.hijos?.length) {
              return (
                <Grupo
                  key={item.clave}
                  item={item}
                  pathname={pathname}
                  alNavegar={alNavegar}
                />
              );
            }

            // Sin hijos y sin href no hay nada que mostrar: un grupo al que los
            // permisos le sacaron todas las subpáginas ya viene filtrado, pero
            // el tipo permite la combinación y acá se descarta.
            if (!item.href) return null;

            // `startsWith` no sirve acá: /objetivos marcaría activas las cuatro
            // páginas de vendedor a la vez.
            const activo = pathname === item.href;
            return (
              <li key={item.clave}>
                <Link
                  href={item.href}
                  onClick={alNavegar}
                  aria-current={activo ? "page" : undefined}
                  className={clasesLink(activo)}
                >
                  <Marca icono={item.icono} logo={item.logo} />
                  <span className="truncate">{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="border-line border-t px-5 py-4">
        {email && (
          <div className="mb-3 min-w-0">
            <p className="truncate text-sm font-medium">{email}</p>
            {rol && <p className="text-muted text-xs">{rol}</p>}
          </div>
        )}

        {/* La cuenta va acá abajo y no en el nav de arriba: no es una página del
            negocio, y la ve cualquiera sin importar el rol. */}
        {authConfigurada && (
          <Link
            href="/cuenta"
            onClick={alNavegar}
            aria-current={pathname === "/cuenta" ? "page" : undefined}
            className={`mb-2 flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs transition-colors ${
              pathname === "/cuenta"
                ? "bg-panel-2 text-ink"
                : "text-muted hover:bg-panel-2/60 hover:text-ink"
            }`}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="size-4 shrink-0"
              aria-hidden="true"
            >
              <circle cx="12" cy="8" r="3.5" />
              <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
            </svg>
            Mi cuenta
          </Link>
        )}

        {authConfigurada && <BotonSalir className="w-full justify-start" />}
      </div>
    </div>
  );
}

export default function BarraLateral(props: {
  nav: ItemNav[];
  email: string | null;
  rol: string | null;
  authConfigurada: boolean;
}) {
  const [abierta, setAbierta] = useState(false);

  return (
    <>
      {/* Escritorio: columna fija */}
      <aside className="border-line bg-panel hidden w-60 shrink-0 border-r lg:block">
        <div className="sticky top-0 h-dvh">
          <Contenido {...props} />
        </div>
      </aside>

      {/* Móvil: barra con botón y panel deslizante */}
      <div className="border-line bg-panel/80 fixed inset-x-0 top-0 z-30 flex items-center gap-3 border-b px-4 py-3 backdrop-blur lg:hidden">
        <button
          onClick={() => setAbierta(true)}
          aria-label="Abrir menú"
          className="border-line hover:bg-panel-2 text-muted hover:text-ink rounded-lg border p-1.5"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="size-5">
            <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
          </svg>
        </button>
        <span className="text-sm font-semibold tracking-tight">Brandmark negocio</span>
      </div>

      {abierta && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            aria-label="Cerrar menú"
            onClick={() => setAbierta(false)}
            className="absolute inset-0 bg-black/60"
          />
          <aside className="border-line bg-panel absolute inset-y-0 left-0 w-64 border-r">
            <Contenido {...props} alNavegar={() => setAbierta(false)} />
          </aside>
        </div>
      )}
    </>
  );
}
