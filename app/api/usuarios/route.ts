import { NextResponse, type NextRequest } from "next/server";
import { esModulo, type ClaveModulo } from "@/lib/modulos";
import {
  exigirSuperadmin,
  rutaParaPonerContrasena,
} from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Alta y permisos de usuarios. LO ÚNICO QUE ESCRIBE ES `auth.users`.
 *
 * ---------------------------------------------------------------------------
 * QUIÉN PUEDE
 *
 * Sólo el `superadmin`, y se chequea en las tres verbos antes de tocar la llave
 * de servicio. No alcanza con `puedeVer`: esta ruta no es una pantalla más, es
 * la que reparte el acceso a todas las demás.
 *
 * ---------------------------------------------------------------------------
 * POR QUÉ NO SE PUEDE EDITAR A UNO MISMO
 *
 * Es la única forma de quedarse afuera para siempre: si el único superadmin se
 * saca el rol, no queda nadie que pueda devolvérselo desde la pantalla y hay
 * que ir a la base a mano. Cuesta una línea evitarlo.
 */

type Cuerpo = {
  email?: unknown;
  id?: unknown;
  nombre?: unknown;
  modulos?: unknown;
  editar?: unknown;
  sigma?: unknown;
  nombreSigma?: unknown;
};

/** Las claves de módulo válidas de lo que haya mandado el navegador. */
function modulos(valor: unknown): ClaveModulo[] {
  return Array.isArray(valor) ? valor.filter(esModulo) : [];
}

function numero(valor: unknown): number | null {
  const n = Number(valor);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function texto(valor: unknown): string | null {
  return typeof valor === "string" && valor.trim() !== "" ? valor.trim() : null;
}

/**
 * El claim que se guarda. `editar` se recorta contra `modulos` acá TAMBIÉN
 * —aunque `permisoDelUsuario` lo vuelve a hacer al leer— para que lo guardado
 * no diga una cosa y lo aplicado otra: mirar el usuario en Supabase tiene que
 * alcanzar para saber qué puede hacer.
 */
function claim(cuerpo: Cuerpo) {
  const ve = modulos(cuerpo.modulos);
  const edita = modulos(cuerpo.editar).filter((m) => ve.includes(m));
  return {
    rol: "personalizado",
    modulos: ve,
    editar: edita,
    sigma: edita.includes("compras") ? numero(cuerpo.sigma) : null,
    nombre_sigma: edita.includes("compras") ? texto(cuerpo.nombreSigma) : null,
  };
}

/** La lista, con lo justo para la pantalla: nunca nada de la sesión. */
export async function GET() {
  const { error, cliente } = await exigirSuperadmin();
  if (error) return error;

  const { data, error: fallo } = await cliente.auth.admin.listUsers({
    perPage: 200,
  });
  if (fallo)
    return NextResponse.json({ error: fallo.message }, { status: 500 });

  const usuarios = data.users.map((u) => {
    const meta = (u.app_metadata ?? {}) as Record<string, unknown>;
    const propia = (u.user_metadata ?? {}) as Record<string, unknown>;
    return {
      id: u.id,
      email: u.email ?? "",
      nombre: texto(propia.nombre),
      rol: typeof meta.rol === "string" ? meta.rol : null,
      vendedor: typeof meta.vendedor === "string" ? meta.vendedor : null,
      modulos: modulos(meta.modulos),
      editar: modulos(meta.editar),
      sigma: numero(meta.sigma),
      ultimoIngreso: u.last_sign_in_at ?? null,
    };
  });

  usuarios.sort((a, b) => a.email.localeCompare(b.email));
  return NextResponse.json({ usuarios });
}

/**
 * Alta. Crea el usuario con una contraseña al azar que nadie ve y devuelve un
 * enlace para que se ponga la suya.
 *
 * POR QUÉ NO SE ELIGE UNA CONTRASEÑA ACÁ. Una contraseña que alguien tipea por
 * el otro viaja por WhatsApp y queda escrita en el teléfono de los dos. El
 * enlace vence solo y sirve una vez: es lo mismo que hace el "¿Olvidaste tu
 * contraseña?" que ya existe, pero sin depender de que el mail llegue.
 *
 * ---------------------------------------------------------------------------
 * POR QUÉ NO SE USA EL `action_link` QUE DEVUELVE SUPABASE
 *
 * Porque no funciona, y falla de la peor manera: parece que anda.
 *
 * Ese enlace apunta a `/auth/v1/verify` de Supabase, que CONSUME EL TOKEN al
 * abrirlo y después redirige a la "Site URL" del proyecto. Si esa Site URL
 * quedó en `http://localhost:3000` --como estaba-- la persona aterriza en una
 * dirección que no existe, y al reintentar el token ya está gastado:
 *
 *     localhost:3000/#error=access_denied&error_code=otp_expired
 *
 * Así que se arma el enlace contra ESTE tablero, apuntando a `/auth/confirmar`,
 * que es la misma ruta que usa "¿Olvidaste tu contraseña?" desde siempre: canjea
 * el `token_hash` con `verifyOtp` y manda a poner la contraseña. No depende de
 * la Site URL, ni de la lista de redirecciones permitidas, ni de que alguien
 * haya configurado bien el proyecto.
 *
 * El `origin` lo pone el navegador (ver PanelUsuarios) y no el servidor: acá
 * habría que adivinarlo entre proxys y encabezados reenviados, y el navegador
 * sabe con certeza desde qué dirección se está usando el tablero.
 */
export async function POST(request: NextRequest) {
  const { error, cliente } = await exigirSuperadmin();
  if (error) return error;

  const cuerpo = ((await request.json().catch(() => null)) ?? {}) as Cuerpo;
  const email = texto(cuerpo.email)?.toLowerCase();
  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "Falta el mail" }, { status: 400 });
  }

  const permisos = claim(cuerpo);
  if (permisos.modulos.length === 0) {
    return NextResponse.json(
      {
        error:
          "Marcá al menos un módulo: un usuario sin módulos no puede entrar a nada",
      },
      { status: 400 },
    );
  }
  if (permisos.editar.includes("compras") && permisos.sigma == null) {
    return NextResponse.json(
      {
        error:
          "Para mandar órdenes al ERP hace falta el número de usuario de Sigma: " +
          "la orden se firma con él y no se puede deducir de nada nuestro.",
      },
      { status: 400 },
    );
  }

  const { data, error: fallo } = await cliente.auth.admin.createUser({
    email,
    // EL NOMBRE VA EN user_metadata Y NO EN app_metadata, y la diferencia
    // importa: app_metadata es donde viven los permisos justamente porque el
    // usuario no la puede tocar. Un nombre para saludar no es un permiso --que
    // alguien se cambie el suyo no le da acceso a nada-- así que va del otro
    // lado, que es el que le pertenece.
    user_metadata: { nombre: texto(cuerpo.nombre) },
    // Al azar y larga: nadie la ve ni la necesita, el acceso se toma por el
    // enlace de abajo.
    password: crypto.randomUUID() + crypto.randomUUID(),
    email_confirm: true,
    app_metadata: permisos,
  });
  if (fallo)
    return NextResponse.json({ error: fallo.message }, { status: 400 });

  // El enlace es lo único que puede fallar sin arruinar el alta: si no sale, el
  // usuario ya existe y puede entrar por "¿Olvidaste tu contraseña?".
  const ruta = await rutaParaPonerContrasena(cliente, email);

  return NextResponse.json({ id: data.user?.id ?? null, email, ruta });
}

/** Cambio de permisos de alguien que ya existe. */
export async function PATCH(request: NextRequest) {
  const { error, cliente, yo } = await exigirSuperadmin();
  if (error) return error;

  const cuerpo = ((await request.json().catch(() => null)) ?? {}) as Cuerpo;
  const id = texto(cuerpo.id);
  if (!id)
    return NextResponse.json({ error: "Falta el usuario" }, { status: 400 });

  const nombre = texto(cuerpo.nombre);

  // SOBRE UNO MISMO SE CAMBIA EL NOMBRE, NO LOS PERMISOS.
  //
  // Sacarse el propio rol es la única forma de quedarse afuera para siempre: no
  // queda nadie que pueda devolverlo desde la pantalla. El nombre no tiene ese
  // problema y hace falta poder ponérselo, así que se guarda y se avisa que lo
  // demás no se tocó — en vez de rechazar todo y dejar sin explicación por qué.
  if (id === yo) {
    const { error: fallo } = await cliente.auth.admin.updateUserById(id, {
      user_metadata: { nombre },
    });
    if (fallo)
      return NextResponse.json({ error: fallo.message }, { status: 400 });
    return NextResponse.json({
      ok: true,
      aviso:
        "Se guardó tu nombre. Tus propios permisos no se pueden cambiar desde acá.",
    });
  }

  const permisos = claim(cuerpo);
  if (permisos.editar.includes("compras") && permisos.sigma == null) {
    return NextResponse.json(
      {
        error:
          "Para mandar órdenes al ERP hace falta el número de usuario de Sigma.",
      },
      { status: 400 },
    );
  }

  const { error: fallo } = await cliente.auth.admin.updateUserById(id, {
    app_metadata: permisos,
    user_metadata: { nombre },
  });
  if (fallo)
    return NextResponse.json({ error: fallo.message }, { status: 400 });

  // Sin módulos = sin acceso. No se borra al usuario: si mañana vuelve, se le
  // marcan las casillas otra vez y no hay que crearlo de nuevo ni perder de
  // vista que existió.
  return NextResponse.json({
    ok: true,
    sinAcceso: permisos.modulos.length === 0,
  });
}
