import { NextResponse, type NextRequest } from "next/server";
import {
  armarImportCompras,
  idDeLaFactura,
  type DatosFactura,
} from "@/lib/sigma-compra";
import {
  resumirDiferencias,
  type ResultadoCruce,
  type TotalesComprobante,
} from "@/lib/factura-cruce";
import { permisoDelUsuario, puedeCargarFacturas } from "@/lib/permisos";
import {
  facturaYaEnviada,
  getImputacionContable,
  guardarFacturaEnviada,
} from "@/lib/queries-facturas";
import { authConfigurada } from "@/lib/supabase/env";
import { getUsuario } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Carga una factura de compra en Sigma (`ImportCompras`).
 *
 * ---------------------------------------------------------------------------
 * ESTO ESCRIBE EN LA CONTABILIDAD
 *
 * Es la segunda ruta de todo el tablero que deja algo cargado en un sistema
 * ajeno, y la más delicada de las dos: una orden de compra mal cargada se
 * anula; una factura toca cuenta corriente, stock e IVA.
 *
 * Por eso lo mismo que la de órdenes: la mira UN SOLO ROL (`superadmin`), se
 * valida todo antes de salir, y queda constancia de qué se mandó.
 *
 * ---------------------------------------------------------------------------
 * PERO ESTE ENDPOINT SE PORTA MEJOR, Y CAMBIA LAS REGLAS
 *
 * `ImportOrdenDeCompra` contesta 500 también cuando la orden entró, así que
 * ahí "no sabemos" es la respuesta honesta. `ImportCompras` no:
 *
 *   200  registro insertado correctamente
 *   400  la causa exacta, y NO entró
 *
 * Y es IDEMPOTENTE por el campo `id`. Mandar dos veces la misma factura
 * devuelve "registro procesado anteriormente" en vez de cargarla de nuevo.
 * Sumado a que `numeroComprobante` no puede repetirse para el mismo
 * proveedor, duplicar una factura por apretar el botón dos veces no es
 * posible -- que es justo lo que sí pasó con las órdenes.
 *
 * ---------------------------------------------------------------------------
 * EL CUERPO SE ARMA ACA, NO EN EL NAVEGADOR
 *
 * Del pedido se aceptan el cruce y las decisiones de la persona. Las CUENTAS
 * salen de la base: mandarlas desde el navegador dejaría imputar una factura a
 * la cuenta que a alguien se le ocurra desde la consola.
 */

/** Sin esto, un servidor que acepta la conexión y no contesta cuelga la función. */
const TIMEOUT_MS = 30_000;

function urlDeSigma(): string {
  const cliente = process.env.SIGMA_URL_CLIENTE;
  const alias = process.env.SIGMA_BASEALIAS;
  const id = process.env.SIGMA_ID_CLIENTE;
  const token = process.env.SIGMA_TOKEN;

  const faltan = [
    ["SIGMA_URL_CLIENTE", cliente],
    ["SIGMA_BASEALIAS", alias],
    ["SIGMA_ID_CLIENTE", id],
    ["SIGMA_TOKEN", token],
  ]
    .filter(([, v]) => !v)
    .map(([k]) => k);

  if (faltan.length > 0) {
    throw new Error(
      `Faltan variables de entorno de Sigma: ${faltan.join(", ")}.`,
    );
  }
  return `https://${cliente}/${alias}/${id}/sigma/api/v10/ImportCompras`;
}

export async function POST(request: NextRequest) {
  // MISMO PERMISO QUE MANDAR UNA ORDEN: `puedeCargarFacturas`, que además de
  // ver Compras pide estar habilitado en USUARIOS_ERP. Cargar una factura deja
  // un asiento en la contabilidad; ver el tablero no.
  let usuario: string | null = "local";
  if (authConfigurada) {
    const quien = await getUsuario();
    usuario = quien?.email ?? null;
    if (!puedeCargarFacturas(permisoDelUsuario(quien), usuario)) {
      return NextResponse.json(
        {
          error:
            "Tu usuario no está habilitado para cargar en el ERP. Se habilita " +
            "en USUARIOS_ERP (lib/permisos.ts).",
          mandado: false,
        },
        { status: 403 },
      );
    }
  }

  let cuerpoPedido: {
    cruce?: ResultadoCruce;
    totales?: TotalesComprobante;
    datos?: DatosFactura;
    proveedorNombre?: string;
    confirmado?: boolean;
  };
  try {
    cuerpoPedido = await request.json();
  } catch {
    return NextResponse.json(
      { error: "El cuerpo no es JSON válido." },
      { status: 400 },
    );
  }

  const { cruce, totales, datos } = cuerpoPedido;
  if (!cruce || !totales || !datos) {
    return NextResponse.json(
      { error: "Faltan el cruce, los totales o los datos de la factura." },
      { status: 400 },
    );
  }

  // LAS CUENTAS SALEN DE LA BASE. Ver arriba.
  const imputacion = await getImputacionContable();
  const { cuerpo, problemas, advertencias } = armarImportCompras(
    cruce,
    totales,
    datos,
    imputacion,
  );

  if (problemas.length > 0) {
    // 422 y no 400: el pedido está bien formado, lo que falta son datos de la
    // factura o cuentas sin configurar. La pantalla los lista uno por uno.
    //
    // LAS ADVERTENCIAS NO ENTRAN ACA. Un total que no cuadra se avisa en la
    // pantalla y se manda igual: la factura entra pendiente y se corrige en
    // Sigma, así que frenarla de este lado no protegía nada.
    return NextResponse.json(
      { error: "La factura todavía no se puede mandar.", problemas, cuerpo },
      { status: 422 },
    );
  }

  // YA MANDADA: se avisa antes de volver a hablarle a Sigma. Su endpoint la
  // rechazaría igual por el `id`, pero preguntar de este lado explica mejor lo
  // que pasó que un "registro procesado anteriormente" suelto.
  const previa = await facturaYaEnviada(idDeLaFactura(datos));
  if (previa && !cuerpoPedido.confirmado) {
    return NextResponse.json(
      {
        error: `Esta factura ya se cargó en Sigma el ${previa.enviadaEn}.`,
        yaEnviada: previa,
        cuerpo,
      },
      { status: 409 },
    );
  }

  // LAS DIFERENCIAS SE CONGELAN ACA, antes de hablarle a Sigma. Ver
  // `resumirDiferencias`: el cruce no se puede recalcular después porque la OC
  // y el maestro cambian, así que lo que se va a reclamar tiene que quedar
  // guardado tal como se vio al mandarla.
  const diferencias = resumirDiferencias(cruce);

  try {
    const respuesta = await fetch(urlDeSigma(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Auth-Token": process.env.SIGMA_TOKEN!,
      },
      body: JSON.stringify(cuerpo),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    const texto = (await respuesta.text()).trim();

    if (!respuesta.ok) {
      // 400 ES UNA RESPUESTA DE VERDAD: la factura NO entró y el mensaje dice
      // por qué. Es la diferencia con el endpoint de órdenes, donde un error
      // puede significar que sí entró.
      const rechazada = respuesta.status === 400;
      console.error("[api/compras/facturas/sigma]", respuesta.status, texto);
      await guardarFacturaEnviada({
        usuario,
        cuerpo,
        proveedorNombre: cuerpoPedido.proveedorNombre ?? null,
        resultado: rechazada ? "rechazada" : "incierto",
        respuesta: texto,
        diferencias,
      });
      return NextResponse.json(
        {
          error: texto || `Sigma contestó ${respuesta.status} sin explicar por qué.`,
          // Con 400 se puede corregir y reintentar tranquilo. Con cualquier
          // otra cosa no sabemos si entró, y reintentar es volver a hablarle.
          mandado: !rechazada,
          cuerpo,
        },
        { status: 502 },
      );
    }

    await guardarFacturaEnviada({
      usuario,
      cuerpo,
      proveedorNombre: cuerpoPedido.proveedorNombre ?? null,
      resultado: "ok",
      diferencias,
      // QUEDA ESCRITO QUE SE MANDO DESCUADRADA. Si después hay que revisar
      // por qué una factura entró con un total que no cerraba, el registro lo
      // dice en vez de haber que reconstruirlo.
      respuesta: [texto, ...advertencias].filter(Boolean).join(" · "),
    });

    return NextResponse.json({ ok: true, respuesta: texto, advertencias, cuerpo });
  } catch (error) {
    const mensaje =
      error instanceof Error ? error.message : "Error desconocido";
    console.error("[api/compras/facturas/sigma]", error);
    // Armar la URL puede fallar ANTES de hablarle a Sigma: ahí no se mandó
    // nada. Si ya salió el pedido no lo sabemos, y el `id` protege de la
    // duplicación igual.
    const salio = !mensaje.startsWith("Faltan variables");
    return NextResponse.json(
      { error: mensaje, mandado: salio, cuerpo },
      { status: 500 },
    );
  }
}
