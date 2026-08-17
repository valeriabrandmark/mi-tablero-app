import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { SUPABASE_ANON_KEY, SUPABASE_URL, authConfigurada } from "@/lib/supabase/env";

/** Rutas accesibles sin sesión. */
const RUTAS_PUBLICAS = ["/login", "/auth-no-configurada"];

function esPublica(pathname: string) {
  return RUTAS_PUBLICAS.some((r) => pathname === r || pathname.startsWith(`${r}/`));
}

export async function middleware(request: NextRequest) {
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
