"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import BotonSalir from "@/components/BotonSalir";

export type ItemNav = { href: string; label: string; icono: ClaveIcono };

export type ClaveIcono = "ventas" | "logistica" | "cuentas" | "objetivos";

/**
 * Íconos como SVG inline y no una librería: son cuatro, no cambian, y sumar una
 * dependencia entera para esto haría más pesado el bundle que el tablero.
 */
const ICONOS: Record<ClaveIcono, ReactNode> = {
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

function Icono({ clave }: { clave: ClaveIcono }) {
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
      {ICONOS[clave]}
    </svg>
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
            // `startsWith` no sirve acá: /objetivos marcaría activas las cuatro
            // páginas de vendedor a la vez.
            const activo = pathname === item.href;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={alNavegar}
                  aria-current={activo ? "page" : undefined}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                    activo
                      ? "bg-panel-2 text-ink font-medium"
                      : "text-muted hover:bg-panel-2/60 hover:text-ink"
                  }`}
                >
                  <Icono clave={item.icono} />
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
