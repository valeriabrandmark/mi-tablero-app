import BarraLateral, { type ItemNav } from "@/components/BarraLateral";
import { slugVendedor, VENDEDORES_OBJETIVOS } from "@/lib/constantes";
import { permisoDelUsuario, puedeVer, type Rol } from "@/lib/permisos";
import { authConfigurada } from "@/lib/supabase/env";
import { getUsuario } from "@/lib/supabase/server";

/**
 * El nav, en dos secciones que se despliegan.
 *
 * Las rutas son EXACTAMENTE las de antes. Agrupar es puro acomodo visual: los
 * permisos se resuelven por `href` en `puedeVer()`, así que mover una entrada
 * adentro de un grupo no le cambia el acceso a nadie. Si alguna ruta cambiara,
 * habría que tocar también `permisos.ts` y el proxy — por eso no cambian.
 *
 * Los grupos no tienen `href`: su encabezado despliega, no navega. "Tablero
 * Ventas Brandmark" es el primer hijo justamente porque la sección sí tiene una
 * página principal, y así se llega a ella con un click y no con dos.
 */
const NAV: ItemNav[] = [
  {
    clave: "mayoristas",
    label: "Ventas Mayoristas",
    icono: "ventas",
    logo: { src: "/isotipo.png" },
    hijos: [
      // "Tablero Brandmark" y no "Tablero Ventas Brandmark": el nombre largo no
      // entra en los 240 px de la barra y quedaba cortado en "Tablero Ventas
      // Bran…". El encabezado del grupo ya dice "Ventas Mayoristas".
      { href: "/ventas-mayoristas", label: "Tablero Brandmark", icono: "ventas" },
      { href: "/logistica", label: "Logística", icono: "logistica" },
      { href: "/cuentas-corrientes", label: "Cuentas Corrientes", icono: "cuentas" },
      // Una entrada por vendedor: cada uno entra directo a su tablero.
      ...VENDEDORES_OBJETIVOS.map((v) => ({
        href: `/objetivos/${slugVendedor(v)}`,
        label: `Objetivos ${v.charAt(0)}${v.slice(1).toLowerCase()}`,
        icono: "objetivos" as const,
      })),
    ],
  },
  {
    clave: "minoristas",
    label: "Ventas minoristas",
    icono: "unibrandco",
    hijos: [
      // Mercado Libre sigue teniendo sus pestañas (Tablero, Alertas, Stock
      // Full) adentro de la página: no se abren acá porque son vistas del mismo
      // tablero, no secciones distintas del negocio.
      {
        href: "/venta-minorista/mercado-libre",
        label: "Mercado Libre",
        icono: "mercadolibre",
      },
      { href: "/venta-minorista/tienda-nube", label: "Tienda Nube", icono: "tiendanube" },
    ],
  },
];

/** Cómo se muestra cada rol abajo del email. */
const NOMBRE_ROL: Record<Rol, string> = {
  superadmin: "Superadministrador",
  admin: "Administrador",
  supervisor: "Supervisor",
  vendedor: "Vendedor",
  responsable_meli: "Responsable Mercado Libre",
};

/**
 * Saca del nav lo que el proxy le va a rebotar igual, usando la MISMA regla que
 * las otras barreras para que no se desincronicen.
 *
 * Los hijos se filtran uno por uno y el grupo desaparece si se queda sin
 * ninguno: si solo se mirara el href del grupo, alcanzaría con tener permiso
 * sobre la sección para ver listadas subpáginas que después no se pueden abrir.
 */
function navPermitido(nav: ItemNav[], permiso: Parameters<typeof puedeVer>[0]): ItemNav[] {
  return nav.flatMap((item) => {
    if (!item.hijos) return item.href && puedeVer(permiso, item.href) ? [item] : [];
    const hijos = item.hijos.filter((h) => puedeVer(permiso, h.href));
    return hijos.length > 0 ? [{ ...item, hijos }] : [];
  });
}

export default async function TableroLayout({ children }: LayoutProps<"/">) {
  const usuario = authConfigurada ? await getUsuario() : null;

  const permiso = permisoDelUsuario(usuario);
  const nav = authConfigurada ? navPermitido(NAV, permiso) : NAV;

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
