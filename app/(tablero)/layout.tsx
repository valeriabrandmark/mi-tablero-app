import Link from "next/link";
import BotonSalir from "@/components/BotonSalir";
import { authConfigurada } from "@/lib/supabase/env";
import { getUsuario } from "@/lib/supabase/server";

const NAV = [{ href: "/ventas-mayoristas", label: "Ventas Mayoristas" }] as const;

export default async function TableroLayout({ children }: LayoutProps<"/">) {
  const usuario = authConfigurada ? await getUsuario() : null;

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="border-line bg-panel/80 sticky top-0 z-20 border-b backdrop-blur">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
          <span className="text-sm font-semibold tracking-tight">Tablero Brandmark</span>

          <nav className="flex gap-1 text-sm">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="hover:bg-panel-2 text-muted hover:text-ink rounded-lg px-3 py-1.5"
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-3">
            {usuario?.email && (
              <span className="text-muted hidden text-xs sm:inline">{usuario.email}</span>
            )}
            {authConfigurada && <BotonSalir />}
          </div>
        </div>

        {!authConfigurada && (
          <p className="bg-c3/15 text-c3 border-c3/30 border-t px-4 py-1.5 text-xs sm:px-6">
            Login deshabilitado: faltan <code>NEXT_PUBLIC_SUPABASE_URL</code> y{" "}
            <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code>. En producción el tablero no se sirve
            sin ellas.
          </p>
        )}
      </header>

      <main className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}
