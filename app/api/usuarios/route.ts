import { NextResponse, type NextRequest } from "next/server";
import { necesitaUsuarioSigma } from "@/lib/modulos";
import {
  claimDeUsuario,
  modulosValidos,
  numeroPositivo,
  textoNoVacio,
  type CuerpoUsuario,
} from "@/lib/claim-usuario";
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

// Lo que se guarda se arma en lib/claim-usuario.ts: ahí tiene pruebas, que es
// justo lo que le faltó cuando la condición del número de Sigma quedó escrita
// a mano en tres lugares y uno se desincronizó.
type Cuerpo = CuerpoUsuario;

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
      nombre: textoNoVacio(propia.nombre),
      rol: typeof meta.rol === "string" ? meta.rol : null,
      vendedor: typeof meta.vendedor === "string" ? meta.vendedor : null,
      modulos: modulosValidos(meta.modulos),
      editar: modulosValidos(meta.editar),
      sigma: numeroPositivo(meta.sigma),
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
  const email = textoNoVacio(cuerpo.email)?.toLowerCase();
  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "Falta el mail" }, { status: 400 });
  }

  const permisos = claimDeUsuario(cuerpo);
  if (permisos.modulos.length === 0) {
    return NextResponse.json(
      {
        error:
          "Marcá al menos un módulo: un usuario sin módulos no puede entrar a nada",
      },
      { status: 400 },
    );
  }
  // Lo mismo que en el PATCH: cualquier módulo que firme en Sigma.
  if (necesitaUsuarioSigma(permisos.editar) && permisos.sigma == null) {
    return NextResponse.json(
      {
        error:
          "Para escribir en el ERP hace falta el número de usuario de Sigma: " +
          "lo que se manda se firma con él y no se puede deducir de nada nuestro.",
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
    user_metadata: { nombre: textoNoVacio(cuerpo.nombre) },
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
  const id = textoNoVacio(cuerpo.id);
  if (!id)
    return NextResponse.json({ error: "Falta el usuario" }, { status: 400 });

  const nombre = textoNoVacio(cuerpo.nombre);

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

  const permisos = claimDeUsuario(cuerpo);
  // CUALQUIER MODULO QUE FIRME EN SIGMA, no sólo Compras. Miraba `compras` a
  // secas, así que al separar la carga de facturas se podía guardar a alguien
  // con permiso de cargar facturas y sin número: entraba y el botón no andaba.
  if (necesitaUsuarioSigma(permisos.editar) && permisos.sigma == null) {
    return NextResponse.json(
      {
        error:
          "Para escribir en el ERP hace falta el número de usuario de Sigma.",
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

  // Sin módulos = sin acceso, y sigue existiendo. Es la forma REVERSIBLE de
  // sacar a alguien: si mañana vuelve, se le marcan las casillas otra vez. El
  // DELETE de abajo es la otra, la que no tiene vuelta.
  return NextResponse.json({
    ok: true,
    sinAcceso: permisos.modulos.length === 0,
  });
}

/**
 * Borrar un usuario. NO TIENE DESHACER.
 *
 * ---------------------------------------------------------------------------
 * ESTO NO ES "SACARLE EL ACCESO"
 *
 * Para eso están las casillas: un usuario sin módulos no entra a ninguna
 * pantalla y sigue existiendo, así que el día que vuelve se le marcan otra vez
 * y listo. Borrarlo saca la fila de `auth.users` y con ella la cuenta: el mail
 * queda libre, la persona pierde su contraseña, y lo que haya quedado firmado
 * con su nombre en otras tablas pasa a apuntar a un usuario que ya no está.
 *
 * Por eso existen las dos, y por eso la pantalla ofrece primero la otra.
 *
 * ---------------------------------------------------------------------------
 * LOS DOS SEGUROS
 *
 * 1. NO A UNO MISMO. Es la única forma de quedarse afuera para siempre, y acá
 *    es peor que en el PATCH: ahí te sacabas el rol, acá te borrás la cuenta.
 *
 * 2. EL MAIL TIENE QUE COINCIDIR. El navegador manda el id y además el mail
 *    que mostró al confirmar. Si no son el mismo usuario, la lista que vio la
 *    persona ya no es la que hay, y lo que iba a borrar no es lo que creía.
 *    Cuesta una consulta y evita el error que no se puede deshacer.
 */
export async function DELETE(request: NextRequest) {
  const { error, cliente, yo } = await exigirSuperadmin();
  if (error) return error;

  const cuerpo = ((await request.json().catch(() => null)) ?? {}) as Cuerpo;
  const id = textoNoVacio(cuerpo.id);
  const email = textoNoVacio(cuerpo.email)?.toLowerCase() ?? null;
  if (!id || !email)
    return NextResponse.json(
      { error: "Falta el usuario o su mail" },
      { status: 400 },
    );

  if (id === yo) {
    return NextResponse.json(
      { error: "No podés borrar tu propia cuenta." },
      { status: 400 },
    );
  }

  const { data, error: fallaLeer } = await cliente.auth.admin.getUserById(id);
  if (fallaLeer || !data?.user) {
    return NextResponse.json(
      { error: "Ese usuario ya no existe." },
      { status: 404 },
    );
  }
  if ((data.user.email ?? "").toLowerCase() !== email) {
    return NextResponse.json(
      {
        error:
          "El usuario no coincide con el que estabas viendo. Actualizá la " +
          "lista y fijate de nuevo: no se borró nada.",
      },
      { status: 409 },
    );
  }

  const { error: fallo } = await cliente.auth.admin.deleteUser(id);
  if (fallo)
    return NextResponse.json({ error: fallo.message }, { status: 400 });

  return NextResponse.json({ ok: true, borrado: data.user.email ?? "" });
}
