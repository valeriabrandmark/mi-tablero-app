import BarraLateral, { type ClaveIcono, type ItemNav } from "@/components/BarraLateral";
import { slugVendedor, VENDEDORES_OBJETIVOS } from "@/lib/constantes";
import { permisoDelUsuario, puedeVer, type Rol } from "@/lib/permisos";
import { authConfigurada } from "@/lib/supabase/env";
import { getUsuario } from "@/lib/supabase/server";

const NAV: ItemNav[] = [
  { href: "/ventas-mayoristas", label: "Ventas Mayoristas", icono: "ventas" as ClaveIcono },
  { href: "/logistica", label: "Logística", icono: "logistica" as ClaveIcono },
  { href: "/cuentas-corrientes", label: "Cuentas Corrientes", icono: "cuentas" as ClaveIcono },
  // Una entrada por vendedor: cada uno entra directo a su tablero.
  ...VENDEDORES_OBJETIVOS.map((v) => ({
    href: `/objetivos/${slugVendedor(v)}`,
    label: `Objetivos ${v.charAt(0)}${v.slice(1).toLowerCase()}`,
    icono: "objetivos" as ClaveIcono,
  })),
];

/** Cómo se muestra cada rol abajo del email. */
const NOMBRE_ROL: Record<Rol, string> = {
  superadmin: "Superadministrador",
  admin: "Administrador",
  supervisor: "Supervisor",
  vendedor: "Vendedor",
};

export default async function TableroLayout({ children }: LayoutProps<"/">) {
  const usuario = authConfigurada ? await getUsuario() : null;

  // El nav no muestra links que el proxy le va a rebotar igual. Usa la misma
  // regla que las otras barreras, así no se desincronizan.
  const permiso = permisoDelUsuario(usuario);
  const nav = authConfigurada ? NAV.filter((item) => puedeVer(permiso, item.href)) : NAV;

  return (
    <div className="flex min-h-full flex-1">
      <BarraLateral
        nav={nav}
        email={usuario?.email ?? null}
        rol={permiso ? NOMBRE_ROL[permiso.rol] : null}
        authConfigurada={authConfigurada}
      />

      {/* `min-w-0` para que las tablas anchas scrolleen dentro de su panel en
          vez de estirar la página entera. `pt-16` deja lugar a la barra de
          móvil, que es fija; en escritorio no hace falta. */}
      <div className="flex min-w-0 flex-1 flex-col pt-16 lg:pt-0">
        {!authConfigurada && (
          <p className="bg-c3/15 text-c3 border-c3/30 border-b px-4 py-1.5 text-xs sm:px-6">
            Login deshabilitado: faltan <code>NEXT_PUBLIC_SUPABASE_URL</code> y{" "}
            <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code>. En producción el tablero no se sirve
            sin ellas.
          </p>
        )}

        <main className="w-full max-w-[1600px] flex-1 px-4 py-6 sm:px-6">{children}</main>
      </div>
    </div>
  );
}
