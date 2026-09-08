import { NextResponse, type NextRequest } from "next/server";
import { descuentoValido, UNIDADES_COMPRA, type RenglonOrden } from "@/lib/compras";
import { permisoDelUsuario, puedeVerBorradores } from "@/lib/permisos";
import { getArticulosParaOrden } from "@/lib/queries-compras";
import {
  armarOrdenSigma,
  problemasDeLaOrden,
  type ArticuloParaOrden,
} from "@/lib/sigma-orden";
import { authConfigurada } from "@/lib/supabase/env";
import { getUsuario } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Manda una orden de compra al ERP.
 *
 * ---------------------------------------------------------------------------
 * ES LA PRIMERA RUTA DEL TABLERO QUE ESCRIBE AFUERA
 *
 * Todo lo demás lee: consulta Supabase y devuelve números. Esto llama a un
 * sistema ajeno y deja algo cargado del otro lado, y no hay `undo`: una orden
 * mandada se anula a mano en Sigma. Eso justifica tres cosas que en una ruta
 * de lectura serían exageradas.
 *
 * PRIMERA: LA MIRA UN SOLO ROL. `superadmin`, el mismo que ve los borradores.
 * `admin` "ve todo sin editar" y esto es editar el ERP. Es la segunda vez que
 * los dos roles se comportan distinto, y por el mismo motivo que la primera.
 *
 * SEGUNDA: EL PRECIO NO VIENE DEL NAVEGADOR. Del cuerpo se aceptan las
 * decisiones de la persona --qué SKU, cuánto, con qué descuentos y en qué
 * unidad-- y nada más. El costo se vuelve a leer de la base con
 * `getArticulosParaOrden`. Aceptarlo de afuera sería dejar cargar una orden al
 * ERP al precio que a alguien se le ocurra desde la consola del navegador.
 *
 * TERCERA: SE VALIDA ANTES DE SALIR. Sigma corta en el primer error, así que
 * sin esto cada arreglo cuesta un viaje. Y hay un caso que Sigma NO avisa: si
 * `items` viene vacío, la orden se crea igual, vacía y sin error.
 *
 * ---------------------------------------------------------------------------
 * SOBRE LOS CÓDIGOS DE ERROR
 *
 * `ImportOrdenDeCompra` contesta 500 tanto para "te falta un campo" como para
 * "se rompió", y 200 para el éxito. Así que un 500 con cuerpo se devuelve tal
 * cual a la pantalla: el mensaje de Sigma está en castellano y dice qué pasó
 * mejor de lo que podríamos resumirlo.
 */

/** El sobre de Sigma, sacado del entorno. Falla claro si falta algo. */
function urlDeSigma(): string {
  const cliente = process.env.SIGMA_URL_CLIENTE;
  const alias = process.env.SIGMA_BASEALIAS;
  const id = process.env.SIGMA_ID_CLIENTE;
  const faltantes = [
    ["SIGMA_URL_CLIENTE", cliente],
    ["SIGMA_BASEALIAS", alias],
    ["SIGMA_ID_CLIENTE", id],
    ["SIGMA_TOKEN", process.env.SIGMA_TOKEN],
  ]
    .filter(([, v]) => !v)
    .map(([k]) => k);

  if (faltantes.length > 0) {
    throw new Error(
      `Faltan variables de entorno de Sigma: ${faltantes.join(", ")}. ` +
        `Cargalas en Vercel → Settings → Environment Variables.`,
    );
  }
  return `https://${cliente}/${alias}/${id}/sigma/api/v10/ImportOrdenDeCompra`;
}

/** Sin esto, un servidor que acepta la conexión y no contesta cuelga la función. */
const TIMEOUT_MS = 60_000;

type CuerpoRenglon = {
  sku?: unknown;
  unidad?: unknown;
  cantidad?: unknown;
  descuento?: unknown;
  descuento2?: unknown;
};

/**
 * Lo que llega del navegador, limpiado.
 *
 * NO SE CONFÍA EN NADA. Cada campo se valida por separado y lo que no encaja
 * se descarta: un `unidad` que no sea una de las dos conocidas, una cantidad
 * que no sea un entero positivo, un descuento fuera de rango.
 */
function leerRenglones(crudo: unknown): Map<string, RenglonOrden> {
  const orden = new Map<string, RenglonOrden>();
  if (!Array.isArray(crudo)) return orden;

  for (const fila of crudo.slice(0, 500) as CuerpoRenglon[]) {
    const sku = typeof fila?.sku === "string" ? fila.sku.trim().slice(0, 40) : "";
    if (!sku) continue;

    const unidad = UNIDADES_COMPRA.find((u) => u.clave === fila?.unidad)?.clave;
    if (!unidad) continue;

    const cantidad = Number(fila?.cantidad);
    if (!Number.isFinite(cantidad) || cantidad <= 0) continue;

    orden.set(sku, {
      unidad,
      cantidad: Math.round(cantidad),
      descuento: descuentoValido(Number(fila?.descuento)),
      descuento2: descuentoValido(Number(fila?.descuento2)),
    });
  }
  return orden;
}

export async function POST(request: NextRequest) {
  if (authConfigurada) {
    const permiso = permisoDelUsuario(await getUsuario());
    if (!puedeVerBorradores(permiso)) {
      return NextResponse.json(
        { error: "Mandar órdenes al ERP requiere el rol superadmin." },
        { status: 403 },
      );
    }
  }

  let cuerpo: { renglones?: unknown; mes?: unknown; nota?: unknown };
  try {
    cuerpo = await request.json();
  } catch {
    return NextResponse.json({ error: "El cuerpo no es JSON válido." }, { status: 400 });
  }

  const orden = leerRenglones(cuerpo.renglones);
  const mes = typeof cuerpo.mes === "string" ? cuerpo.mes.slice(0, 7) : "";
  const nota = typeof cuerpo.nota === "string" ? cuerpo.nota : "";

  if (orden.size === 0) {
    return NextResponse.json(
      { error: "No llegó ningún renglón con cantidad." },
      { status: 400 },
    );
  }

  try {
    const articulos = new Map<string, ArticuloParaOrden>(
      (await getArticulosParaOrden([...orden.keys()], mes)).map((a) => [a.sku, a]),
    );

    const problemas = problemasDeLaOrden(articulos, orden);
    if (problemas.length > 0) {
      // 422 y no 400: el JSON está bien formado, lo que no se puede es mandar
      // ESTA orden. La pantalla las lista todas juntas.
      return NextResponse.json({ error: "La orden no se puede mandar", problemas }, { status: 422 });
    }

    const payload = armarOrdenSigma(articulos, orden, nota);

    const respuesta = await fetch(urlDeSigma(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Auth-Token": process.env.SIGMA_TOKEN!,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    const texto = (await respuesta.text()).trim();

    if (!respuesta.ok) {
      // El mensaje de Sigma va tal cual a la pantalla: está en castellano y
      // dice qué campo falta mejor de lo que podríamos resumirlo.
      console.error("[api/compras/sigma]", respuesta.status, texto);
      return NextResponse.json(
        {
          error: texto || `Sigma contestó ${respuesta.status} sin explicar por qué.`,
          enviado: payload,
        },
        { status: 502 },
      );
    }

    return NextResponse.json({
      ok: true,
      respuesta: texto,
      // Se devuelve lo que se mandó para que la pantalla pueda mostrarlo: es la
      // única constancia de qué se cargó, y en una operación sin `undo` eso
      // vale más que el mensaje de éxito.
      enviado: payload,
    });
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : "Error desconocido";
    console.error("[api/compras/sigma]", error);
    return NextResponse.json({ error: mensaje }, { status: 500 });
  }
}
