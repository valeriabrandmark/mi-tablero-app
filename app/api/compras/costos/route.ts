import { NextResponse, type NextRequest } from "next/server";
import { permisoDelUsuario } from "@/lib/permisos";
import { aplicarCostos, prepararCostos } from "@/lib/queries-costos";
import { authConfigurada } from "@/lib/supabase/env";
import { getUsuario } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// EL MAESTRO SE LE PIDE A SIGMA EN EL MOMENTO (ver lib/sigma-articulos), y esa
// llamada se corta a los 30 s. Con el techo por omision de la plataforma, una
// Sigma lenta mataria la funcion antes de que el plan B pudiera actuar: en vez
// de "se uso la copia, mira por que", la pantalla daria un error pelado. Los 60
// dejan 30 s de aire para la consulta a la base y el armado de la foto.
export const maxDuration = 60;

/**
 * Actualizar los costos desde el tablero.
 *
 * ---------------------------------------------------------------------------
 * ESTO REESCRIBE EL MARGEN DE TODO EL TABLERO
 *
 * No es una pantalla más. El costo que sale de acá es el denominador de cada
 * margen que se mira en Compras, en Stock, en Mercado Libre y en Rentabilidad.
 * Un costo mal cargado no se ve donde se carga: se ve semanas después, como un
 * número raro que nadie sabe explicar.
 *
 * Por eso lo mira UN SOLO ROL. No es el permiso de Compras ni el de escribir
 * en el ERP: es más chico que los dos.
 */
async function quienPuede(): Promise<string | null | false> {
  if (!authConfigurada) return "local";
  const quien = await getUsuario();
  // SOLO EL SUPERADMIN, por pedido de ANA (23/10/2026). Tener Compras --o
  // poder mandar una orden al ERP-- no alcanza: son permisos para decidir qué
  // se compra, no para cambiar el costo con el que se mide todo lo demás.
  if (permisoDelUsuario(quien)?.rol !== "superadmin") return false;
  return quien?.email ?? null;
}

/** La foto, sin escribir nada. Es lo que se mira antes de aplicar. */
export async function GET() {
  if ((await quienPuede()) === false) {
    return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  }
  try {
    return NextResponse.json(await prepararCostos());
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : "Error desconocido";
    console.error("[api/compras/costos] GET", error);
    return NextResponse.json({ error: mensaje }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const usuario = await quienPuede();
  if (usuario === false) {
    return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  }

  let cuerpo: { nota?: unknown; fotoId?: unknown };
  try {
    cuerpo = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }

  const nota = typeof cuerpo.nota === "string" ? cuerpo.nota.trim() : "";
  // LA NOTA ES OBLIGATORIA. Es lo único que dos meses después va a decir si
  // ese tramo fue un aumento de un proveedor, una corrección o el cierre del
  // mes. Hoy eso vive en el nombre de un archivo y se pierde.
  if (!nota) {
    return NextResponse.json(
      { error: "Escribí qué cambia: es lo que va a explicar este tramo más adelante." },
      { status: 400 },
    );
  }

  try {
    // LA FOTO SE VUELVE A ARMAR ACA Y NO SE RECIBE DEL NAVEGADOR. Lo que se
    // escribe tiene que salir de la base, no de lo que alguien mande: con el
    // snapshot viajando en el cuerpo, cualquiera podría fijar el costo de
    // cualquier artículo desde la consola.
    const preparado = await prepararCostos();

    // LO QUE SE APLICA TIENE QUE SER LO QUE SE MIRO.
    //
    // La pantalla pide la foto del momento al abrirse, así que entre que se
    // miró y se apretó pudo llegar otra --alguien editó la planilla y la
    // mandó, o entró el envío automático de cada 12 horas. Si eso pasa, los
    // números que se escribirían no son los que estaban en pantalla cuando se
    // decidió aplicar, y nadie lo notaría: los contadores se ven iguales.
    //
    // Se corta y se pide mirar de nuevo. Es el único lugar donde una foto más
    // fresca es un problema y no una mejora.
    const fotoId = typeof cuerpo.fotoId === "number" ? cuerpo.fotoId : null;
    if (fotoId != null && preparado.foto && preparado.foto.id !== fotoId) {
      return NextResponse.json(
        {
          error:
            "Llegó una foto de ofertas nueva mientras mirabas esta. " +
            "Revisá los números otra vez antes de aplicar.",
        },
        { status: 409 },
      );
    }

    if (preparado.snapshot.problemas.length > 0) {
      // 422 y no 400: el pedido está bien formado, lo que no se puede es
      // aplicar ESTA foto. La pantalla los lista uno por uno.
      return NextResponse.json(
        {
          error: "La foto no se puede aplicar.",
          problemas: preparado.snapshot.problemas,
        },
        { status: 422 },
      );
    }

    const { filas } = await aplicarCostos({ preparado, nota, usuario });
    return NextResponse.json({
      ok: true,
      filas,
      mes: preparado.mes,
      vigenteDesde: preparado.vigenteDesde,
    });
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : "Error desconocido";
    console.error("[api/compras/costos] POST", error);
    return NextResponse.json({ error: mensaje }, { status: 500 });
  }
}
