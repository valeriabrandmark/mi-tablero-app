import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { SUPABASE_ANON_KEY, SUPABASE_URL, authConfigurada } from "@/lib/supabase/env";
import { paginaInicial, permisoDelUsuario, puedeVer } from "@/lib/permisos";

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

  // Permisos por rol. La regla vive entera en lib/permisos.ts y la comparten
  // esta barrera, la ruta de API y la página, para que no puedan discrepar.
  //
  // Esto corta el acceso a las PÁGINAS, y no alcanza solo con esto: la ruta
  // /api/objetivos vuelve a chequear que el `?vendedor=` pedido sea el suyo,
  // porque desde acá no se ve la query string.
  if (user) {
    const permiso = permisoDelUsuario(user);
    const destino = paginaInicial(permiso);

    if (pathname === "/login") {
      // Ya tiene sesión: a su página, la que sea según su rol.
      const url = request.nextUrl.clone();
      url.pathname = permiso ? destino : "/login";
      url.search = "";
      if (permiso) return NextResponse.redirect(url);
      return sinPermiso(pathname);
    }

    if (!puedeVer(permiso, pathname)) {
      // Sin permiso válido no hay adónde mandarlo: se le dice y listo.
      if (!permiso || pathname.startsWith("/api/")) return sinPermiso(pathname);
      const url = request.nextUrl.clone();
      url.pathname = destino;
      url.search = "";
      return NextResponse.redirect(url);
    }
  }

  return response;
}

export const config = {
  matcher: [
    // Todo menos assets estáticos y archivos con extensión.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
