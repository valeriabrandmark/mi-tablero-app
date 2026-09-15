import { NextResponse, type NextRequest } from "next/server";
import { enConstruccion, permisoDelUsuario, puedeVer, puedeVerBorradores } from "@/lib/permisos";
import {
  aprobarFiltradas,
  aprobarPorIds,
  decidirPropuesta,
  guardarPrecioManual,
} from "@/lib/queries-precios-tn";
import { leerFiltros } from "@/lib/precios-tn";
import { authConfigurada } from "@/lib/supabase/env";
import { getUsuario } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Aprobar o rechazar propuestas. LO ÚNICO QUE ESTA APLICACIÓN ESCRIBE.
 *
 * NO TOCA TIENDA NUBE, y no puede: cambia `estado` en filas de Postgres y nada
 * más. La escritura del precio la hace el workflow del proyecto `precios` con
 * un token que esta aplicación no tiene. Por eso una sesión robada del tablero
 * no puede publicar un precio — lo peor que puede hacer es aprobar algo, que
 * queda firmado con el mail de quien lo hizo.
 *
 * Dos formas de pedirlo:
 *
 *   { id, decision }        una propuesta.
 *   { todas: true, ...f }   todo lo que cumple el filtro `f`.
 *
 * EL BLOQUE VIAJA COMO FILTRO Y NO COMO LISTA DE IDs, a propósito. Si el
 * navegador mandara los IDs, estaría aprobando lo que su pantalla recordaba —
 * que puede ser de hace media hora, de antes de que otra persona decidiera la
 * mitad. Mandando el filtro, el servidor vuelve a resolver "todo lo de esta
 * marca" contra la base de ahora, que es lo que la persona quiso decir.
 */
export async function POST(request: NextRequest) {
  let quien = "desconocido";

  if (authConfigurada) {
    const usuario = await getUsuario();
    const permiso = permisoDelUsuario(usuario);
    if (!puedeVer(permiso, "/api/precios-tn")) {
      return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
    }
    if (enConstruccion("/precios-tn") && !puedeVerBorradores(permiso)) {
      return NextResponse.json({ error: "En construcción" }, { status: 403 });
    }
    quien = usuario?.email ?? "sin email";
  }

  const cuerpo = await request.json().catch(() => null);

  // UNA SELECCIÓN CONCRETA: los ids que la persona tildó.
  //
  // Acá sí viajan ids y no un filtro, y no es una contradicción con el bloque
  // de abajo: son dos gestos distintos. "Todo lo de esta marca" es una
  // descripción que el servidor resuelve contra la base de ahora; "estas seis
  // que tildé" es una lista, y volver a resolverla contra un filtro aprobaría
  // cosas que nadie miró.
  if (Array.isArray(cuerpo?.ids)) {
    const ids = cuerpo.ids.map(Number).filter(Number.isInteger);
    if (!ids.length) {
      return NextResponse.json({ error: "No hay nada seleccionado" }, { status: 400 });
    }
    const total = await aprobarPorIds(ids, quien);
    return NextResponse.json({ ok: true, aprobadas: total, pedidas: ids.length, quien });
  }

  if (cuerpo?.todas === true) {
    const filtros = leerFiltros(new URLSearchParams(cuerpo?.filtros ?? {}));
    const total = await aprobarFiltradas(filtros, quien);
    return NextResponse.json({ ok: true, aprobadas: total, quien });
  }

  const id = Number(cuerpo?.id);
  const decision = cuerpo?.decision;

  // GUARDAR EL PRECIO A MANO SIN DECIDIR: `{ id, precio }` sin `decision`.
  //
  // Es lo que arregla el precio a mano que se perdia. Escribir el numero y
  // autorizar son dos gestos, y antes el numero solo llegaba a la base si se
  // hacian juntos desde el editor. Separandolos, cualquier camino de
  // aprobacion posterior escribe el precio correcto, porque todos leen de
  // `precio_propuesto`.
  if (Number.isInteger(id) && decision === undefined) {
    const precio = Number(cuerpo?.precio);
    if (!Number.isFinite(precio) || precio <= 0) {
      return NextResponse.json(
        { error: "El precio escrito a mano tiene que ser un número mayor que cero." },
        { status: 400 },
      );
    }
    const guardado = await guardarPrecioManual(id, precio, quien);
    if (!guardado) {
      return NextResponse.json(
        {
          error:
            "No se guardó: o esa propuesta ya fue decidida, o el precio que escribiste " +
            "queda por debajo del piso de margen.",
        },
        { status: 409 },
      );
    }
    return NextResponse.json({ ok: true, id, precio, quien });
  }

  if (!Number.isInteger(id) || (decision !== "aprobada" && decision !== "rechazada")) {
    return NextResponse.json({ error: "Pedido inválido" }, { status: 400 });
  }

  // UN PRECIO ESCRITO A MANO, cuando quien aprueba sabe algo que el motor no.
  //
  // Se valida acá antes de llegar al SQL para poder decir POR QUÉ está mal; el
  // piso, en cambio, se verifica dentro del `update` — ver el comentario largo
  // ahí. Un campo de texto libre en una pantalla es por donde se saltea una
  // regla, y el navegador es de quien escribe.
  let precioManual: number | null = null;
  if (cuerpo?.precio !== undefined && cuerpo?.precio !== null && cuerpo?.precio !== "") {
    precioManual = Number(cuerpo.precio);
    if (!Number.isFinite(precioManual) || precioManual <= 0) {
      return NextResponse.json(
        { error: "El precio escrito a mano tiene que ser un número mayor que cero." },
        { status: 400 },
      );
    }
    if (decision !== "aprobada") {
      return NextResponse.json(
        { error: "Un precio a mano sólo tiene sentido al autorizar." },
        { status: 400 },
      );
    }
  }

  const cambio = await decidirPropuesta(id, decision, quien, precioManual);
  if (!cambio) {
    // No se actualizó ninguna fila, y puede ser por dos motivos distintos: que
    // otra persona la haya decidido antes, o que el precio a mano perfore el
    // piso. Se dicen los dos en vez de elegir uno: quien lo lee sabe cuál es.
    return NextResponse.json(
      {
        error: precioManual
          ? "No se autorizó: o esa propuesta ya fue decidida, o el precio que escribiste " +
            "queda por debajo del piso de margen."
          : "Esa propuesta ya fue decidida por otra persona.",
      },
      { status: 409 },
    );
  }
  return NextResponse.json({ ok: true, id, decision, quien, precioManual });
}
