import Link from "next/link";
import BotonSalir from "@/components/BotonSalir";
import { slugVendedor, VENDEDORES_OBJETIVOS } from "@/lib/constantes";
import { vendedorDelUsuario } from "@/lib/permisos";
import { authConfigurada } from "@/lib/supabase/env";
import { getUsuario } from "@/lib/supabase/server";

const NAV = [
  { href: "/ventas-mayoristas", label: "Ventas Mayoristas" },
  { href: "/logistica", label: "Logística" },
  { href: "/cuentas-corrientes", label: "Cuentas Corrientes" },
  // Una entrada por vendedor: cada uno entra directo a su tablero.
  ...VENDEDORES_OBJETIVOS.map((v) => ({
    href: `/objetivos/${slugVendedor(v)}`,
    label: `Objetivos ${v.charAt(0)}${v.slice(1).toLowerCase()}`,
  })),
] as const;

export default async function TableroLayout({ children }: LayoutProps<"/">) {
  const usuario = authConfigurada ? await getUsuario() : null;

  // Un vendedor solo ve su propia página, así que el nav no le muestra links
  // que el proxy le va a rebotar igual.
  const vendedor = vendedorDelUsuario(usuario);
  const nav = vendedor
    ? NAV.filter((item) => item.href === `/objetivos/${slugVendedor(vendedor)}`)
    : NAV;

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="border-line bg-panel/80 sticky top-0 z-20 border-b backdrop-blur">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
          <span className="text-sm font-semibold tracking-tight">Brandmark negocio</span>

          <nav className="flex flex-wrap gap-1 text-sm">
            {nav.map((item) => (
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
