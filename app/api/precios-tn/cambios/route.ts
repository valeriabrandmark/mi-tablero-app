import { NextResponse, type NextRequest } from "next/server";
import { enConstruccion, permisoDelUsuario, puedeVer, puedeVerBorradores } from "@/lib/permisos";
import {
  contarCambiosPreciosTn,
  deshacerCambio,
  deshacerCambios,
  getCambiosPreciosTn,
  getCatalogosCambiosTn,
  idsDeCambiosFiltrados,
} from "@/lib/queries-precios-tn";
import { leerFiltrosDeCambios, TOPE_HISTORIAL } from "@/lib/precios-tn";
import { authConfigurada } from "@/lib/supabase/env";
import { getUsuario } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function autorizar(): Promise<{ error: NextResponse } | { quien: string }> {
  if (!authConfigurada) return { quien: "desarrollo" };

  const usuario = await getUsuario();
  const permiso = permisoDelUsuario(usuario);
  if (!puedeVer(permiso, "/api/precios-tn")) {
    return { error: NextResponse.json({ error: "Sin permiso" }, { status: 403 }) };
  }
  if (enConstruccion("/precios-tn") && !puedeVerBorradores(permiso)) {
    return { error: NextResponse.json({ error: "En construcción" }, { status: 403 }) };
  }
  return { quien: usuario?.email ?? "sin email" };
}

/**
 * El historial de precios escritos en la tienda.
 *
 * ARRANCA CON LOS ULTIMOS 100 Y NO CON TODO. Es lo que se mira al abrir, y
 * bajar miles de filas para mostrar las primeras veinte es tiempo de espera
 * regalado. `?todo=1` trae el resto, hasta TOPE_HISTORIAL.
 *
 * El total se devuelve SIEMPRE, con filtro o sin el, para poder decir "100 de
 * 3.412" en vez de dejar creer que eso es todo lo que hay.
 */
export async function GET(request: NextRequest) {
  const auth = await autorizar();
  if ("error" in auth) return auth.error;

  const params = request.nextUrl.searchParams;
  const filtros = leerFiltrosDeCambios(params);
  const limite = params.get("todo") === "1" ? TOPE_HISTORIAL : 100;

  const [cambios, total, catalogos] = await Promise.all([
    getCambiosPreciosTn(filtros, limite),
    contarCambiosPreciosTn(filtros),
    getCatalogosCambiosTn(),
  ]);

  return NextResponse.json({ cambios, total, catalogos, tope: TOPE_HISTORIAL });
}

/**
 * Deshacer un cambio.
 *
 * ESTA RUTA NO HABLA CON TIENDA NUBE, igual que el resto de la aplicación.
 * Crea una propuesta en sentido contrario, ya aprobada, y la escritura la hace
 * `precios aplicar` con el token que este tablero no tiene. La vuelta larga es
 * el punto: hace que deshacer pase por los mismos controles que cualquier otro
 * precio, incluido el que impide pisar una corrección que alguien haya hecho a
 * mano en el medio.
 */
export async function POST(request: NextRequest) {
  const auth = await autorizar();
  if ("error" in auth) return auth.error;

  const cuerpo = await request.json().catch(() => null);

  // UNA SELECCION CONCRETA: los cambios que la persona tildo.
  if (Array.isArray(cuerpo?.ids)) {
    const ids = cuerpo.ids.map(Number).filter(Number.isInteger);
    if (!ids.length) {
      return NextResponse.json({ error: "No hay nada seleccionado" }, { status: 400 });
    }
    const pedidas = await deshacerCambios(ids, auth.quien);
    return NextResponse.json({ ok: true, pedidas, seleccionados: ids.length });
  }

  // TODO LO FILTRADO. Viaja el filtro y no los ids, por lo mismo que en la
  // cola: "todo lo de esta marca" lo resuelve el servidor contra la base de
  // ahora, no contra lo que el navegador tenia en pantalla hace un rato.
  if (cuerpo?.todas === true) {
    const filtros = leerFiltrosDeCambios(new URLSearchParams(cuerpo?.filtros ?? {}));
    const ids = await idsDeCambiosFiltrados(filtros);
    if (!ids.length) {
      return NextResponse.json({ error: "No hay cambios que deshacer con ese filtro" }, { status: 400 });
    }
    const pedidas = await deshacerCambios(ids, auth.quien);
    return NextResponse.json({ ok: true, pedidas, seleccionados: ids.length });
  }

  const id = Number(cuerpo?.id);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: "Pedido inválido" }, { status: 400 });
  }

  const propuesta = await deshacerCambio(id, auth.quien);
  if (propuesta === null) {
    // No es un error del servidor: ese cambio ya tenía una vuelta atrás en
    // cola, o no existe. Fingir que funcionó sería peor.
    return NextResponse.json(
      { error: "Ese cambio ya tiene una vuelta atrás pedida, o no existe." },
      { status: 409 },
    );
  }
  return NextResponse.json({ ok: true, propuesta });
}
