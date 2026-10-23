import BarraLateral, { type ItemNav } from "@/components/BarraLateral";
import { enConstruccion, permisoDelUsuario, puedeVer, type Rol } from "@/lib/permisos";
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
      // UNA ENTRADA, NO UNA POR VENDEDOR. Eran cuatro, y para los permisos
      // Objetivos es un módulo solo: cuatro de las siete entradas de este
      // grupo eran el mismo tablero con otro filtro, y con un quinto vendedor
      // volvía a crecer. Los vendedores pasaron a ser pestañas adentro
      // (app/(tablero)/objetivos/layout.tsx), que es lo que ya hacen Stock,
      // Mercado Libre y Tienda Nube con sus vistas.
      //
      // `/objetivos` no tiene contenido: manda a la página del vendedor que
      // corresponde según quién mire. Un `vendedor` cae en la suya.
      { href: "/objetivos", label: "Objetivos", icono: "objetivos" },
    ],
  },
  {
    clave: "minoristas",
    label: "Ventas Minoristas",
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
      // Tienda Nube también tiene pestañas adentro (Tablero, Analytics), por lo
      // mismo que Mercado Libre: son vistas del mismo canal, no secciones
      // distintas del negocio, así que no se abren en la barra.
      { href: "/venta-minorista/tienda-nube", label: "Tienda Nube", icono: "tiendanube" },
    ],
  },
  // Operaciones es la tercera pata, al lado de las dos de venta: lo que pasa
  // con la mercadería, no con la plata. Stock no cuelga de Mayoristas ni de
  // Minoristas porque la mercadería es UNA SOLA, se venda por donde se venda —
  // colgarlo de un canal daría a entender que hay un stock por canal.
  {
    clave: "operaciones",
    label: "Operaciones",
    icono: "operaciones",
    hijos: [
      { href: "/stock", label: "Stock", icono: "stock" },
      // Lo que viene después de la orden: cuando llega la factura, cruzarla
      // contra la OC que salió del tablero y cargarla en Sigma. Es su propio
      // módulo (`facturas_compra` en lib/modulos.ts) y no el de Compras:
      // pedirle al proveedor y asentar lo que llegó son dos trabajos, y los
      // puede hacer gente distinta.
      { href: "/facturas-compra", label: "Carga de Facturas de compra", icono: "factura" },
      // Precios TN va en Operaciones y no en Ventas minoristas -> Tienda Nube,
      // aunque hable de esa tienda: lo de allá es MIRAR lo que se vendió, esto
      // es DECIDIR a cuánto se vende. Son cosas distintas y las mira gente
      // distinta — de hecho es la única entrada del tablero que no ven todos
      // los administradores (ver `admin_tn` en lib/permisos.ts).
      // "Precios TN" a secas: el comparador pasó a ser una pestaña adentro,
      // junto con Rentabilidad por proveedor. Las dos salen de la MISMA
      // corrida y comparten el permiso por prefijo, así que eran dos vistas de
      // un módulo y no dos módulos. Ver app/(tablero)/precios-tn/layout.tsx.
      { href: "/precios-tn", label: "Precios TN", icono: "precios" },
      // Actualizar costos va en Operaciones y no al lado de "Mi cuenta",
      // aunque la vea una sola persona: es una tarea del negocio --la lista de
      // un proveedor que aumentó-- y no una configuración del tablero. El nav
      // la filtra sola con `puedeVer`, así que al resto ni le aparece.
      { href: "/costos", label: "Actualizar costos", icono: "precios" },
    ],
  },
];

/** El nombre con el que se saluda, o `null` si nadie se lo cargó. */
function nombreDelUsuario(usuario: { user_metadata?: Record<string, unknown> } | null) {
  const valor = usuario?.user_metadata?.nombre;
  return typeof valor === "string" && valor.trim() !== "" ? valor.trim() : null;
}

/** Cómo se muestra cada rol abajo del email. */
const NOMBRE_ROL: Record<Rol, string> = {
  superadmin: "Superadministrador",
  admin: "Administrador",
  supervisor: "Supervisor",
  vendedor: "Vendedor",
  responsable_meli: "Responsable Mercado Libre",
  admin_tn: "Administrador Tienda Nube",
  // No dice qué ve porque depende de las casillas de cada uno: eso se mira en
  // el panel de Usuarios, que es donde se puede cambiar.
  personalizado: "Permisos a medida",
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
  // La marca de "en construcción" se DERIVA de la lista de permisos.ts, no se
  // escribe acá. Si se escribiera en los dos lados, publicar una página sería
  // acordarse de dos lugares — y el día que alguien se acuerde de uno solo, o
  // queda un tablero terminado con el puntito puesto, o uno a medio hacer sin
  // aviso. Lo segundo es el que hace daño.
  return nav.flatMap<ItemNav>((item) => {
    if (!item.hijos) {
      if (!item.href || !puedeVer(permiso, item.href)) return [];
      return [{ ...item, enConstruccion: enConstruccion(item.href) }];
    }
    const hijos = item.hijos
      .filter((h) => puedeVer(permiso, h.href))
      .map((h) => ({ ...h, enConstruccion: enConstruccion(h.href) }));
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
        // El nombre vive en `user_metadata` y no en `app_metadata`: es para
        // saludar, no un permiso. Que la persona se lo pueda cambiar no le abre
        // ninguna puerta (ver la nota en /api/usuarios).
        nombre={nombreDelUsuario(usuario)}
        rol={permiso ? NOMBRE_ROL[permiso.rol] : null}
        authConfigurada={authConfigurada}
        // La decide la misma regla que cierra la ruta y la API, no un `rol ===`
        // suelto: si mañana cambia quién reparte permisos, cambia en un lugar.
        puedeVerUsuarios={puedeVer(permiso, "/usuarios")}
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
