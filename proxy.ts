import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { SUPABASE_ANON_KEY, SUPABASE_URL, authConfigurada } from "@/lib/supabase/env";
import { slugVendedor } from "@/lib/constantes";
import { tieneClaimInvalido, vendedorDelUsuario } from "@/lib/permisos";

/** Rutas accesibles sin sesión. */
const RUTAS_PUBLICAS = ["/login", "/auth-no-configurada"];

function esPublica(pathname: string) {
  return RUTAS_PUBLICAS.some((r) => pathname === r || pathname.startsWith(`${r}/`));
}

/** A las llamadas de datos les conviene un 403 JSON, no el HTML de una página. */
function sinPermiso(pathname: string) {
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  }
  return new NextResponse("No tenés permiso para ver esta página.", {
    status: 403,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (!authConfigurada) {
    // En desarrollo dejamos pasar para poder trabajar en el tablero sin auth,
    // pero en producción nunca se sirve el tablero sin login.
    if (process.env.NODE_ENV !== "production") return NextResponse.next();
    if (pathname === "/auth-no-configurada") return NextResponse.next();
    const url = request.nextUrl.clone();
    url.pathname = "/auth-no-configurada";
    url.search = "";
    return NextResponse.redirect(url);
  }

  // `response` se va mutando con las cookies que refresca Supabase.
  let response = NextResponse.next({ request });

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && !esPublica(pathname)) {
    // A las llamadas de datos les conviene un 401 JSON, no el HTML del login.
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(url);
  }

  // Permisos por vendedor. Un usuario sin claim es administrador y ve todo; uno
  // con vendedor asignado ve ÚNICAMENTE su página de objetivos.
  //
  // Esto corta el acceso a las páginas, pero no alcanza solo con esto: la ruta
  // /api/objetivos vuelve a chequear que el vendedor pedido sea el suyo, porque
  // si no un vendedor con sesión pediría los datos de otro por query string.
  if (user) {
    if (tieneClaimInvalido(user)) {
      // Un claim que no reconocemos no abre nada: es más seguro que abrir de más.
      return sinPermiso(pathname);
    }

    const vendedor = vendedorDelUsuario(user);
    if (vendedor) {
      const suya = `/objetivos/${slugVendedor(vendedor)}`;

      if (pathname.startsWith("/api/")) {
        if (pathname !== "/api/objetivos") return sinPermiso(pathname);
      } else if (pathname !== suya) {
        const url = request.nextUrl.clone();
        url.pathname = suya;
        url.search = "";
        return NextResponse.redirect(url);
      }
    }
  }

  if (user && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/ventas-mayoristas";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    // Todo menos assets estáticos y archivos con extensión.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
