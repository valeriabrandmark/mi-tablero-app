import { NextResponse, type NextRequest } from "next/server";
import { esModulo, type ClaveModulo } from "@/lib/modulos";
import { permisoDelUsuario } from "@/lib/permisos";
import { adminConfigurado, createAdminClient } from "@/lib/supabase/admin";
import { authConfigurada } from "@/lib/supabase/env";
import { getUsuario } from "@/lib/supabase/server";

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
  modulos?: unknown;
  editar?: unknown;
  sigma?: unknown;
  nombreSigma?: unknown;
};

/** Devuelve el cliente admin, o la respuesta de error si no corresponde. */
async function admin() {
  if (!authConfigurada) {
    return {
      error: NextResponse.json(
        { error: "Login no configurado" },
        { status: 503 },
      ),
    };
  }
  const usuario = await getUsuario();
  const permiso = permisoDelUsuario(usuario);
  if (permiso?.rol !== "superadmin") {
    return {
      error: NextResponse.json({ error: "Sin permiso" }, { status: 403 }),
    };
  }
  if (!adminConfigurado) {
    return {
      error: NextResponse.json(
        {
          error:
            "Falta la llave de servicio de Supabase. Cargá SUPABASE_SERVICE_ROLE_KEY " +
            "en Vercel → Settings → Environment Variables y volvé a desplegar.",
        },
        { status: 503 },
      ),
    };
  }
  return { cliente: createAdminClient(), yo: usuario?.id ?? null };
}

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
  const { error, cliente } = await admin();
  if (error) return error;

  const { data, error: fallo } = await cliente.auth.admin.listUsers({
    perPage: 200,
  });
  if (fallo)
    return NextResponse.json({ error: fallo.message }, { status: 500 });

  const usuarios = data.users.map((u) => {
    const meta = (u.app_metadata ?? {}) as Record<string, unknown>;
    return {
      id: u.id,
      email: u.email ?? "",
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
 */
export async function POST(request: NextRequest) {
  const { error, cliente } = await admin();
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
  const { data: enlace } = await cliente.auth.admin.generateLink({
    type: "recovery",
    email,
  });

  return NextResponse.json({
    id: data.user?.id ?? null,
    email,
    enlace: enlace?.properties?.action_link ?? null,
  });
}

/** Cambio de permisos de alguien que ya existe. */
export async function PATCH(request: NextRequest) {
  const { error, cliente, yo } = await admin();
  if (error) return error;

  const cuerpo = ((await request.json().catch(() => null)) ?? {}) as Cuerpo;
  const id = texto(cuerpo.id);
  if (!id)
    return NextResponse.json({ error: "Falta el usuario" }, { status: 400 });
  if (id === yo) {
    return NextResponse.json(
      {
        error:
          "No podés cambiar tus propios permisos: sería la forma de quedarte afuera.",
      },
      { status: 400 },
    );
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
