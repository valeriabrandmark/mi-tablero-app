import { NextResponse, type NextRequest } from "next/server";
import { enTransaccion, query } from "@/lib/db";
import type { CuerpoImportacion, PedidoImportado } from "@/lib/importador-tn";
import { MARCAS } from "@/lib/marketing-demo";
import { permisoDelUsuario } from "@/lib/permisos";
import { authConfigurada } from "@/lib/supabase/env";
import { getUsuario } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Un mes de una tienda chica son cientos de pedidos; esto es un techo de sobra. */
const MAX_PEDIDOS = 20_000;

/**
 * Importador de pedidos de Tienda Nube para el Tablero de Marca.
 *
 * El CSV se lee EN EL NAVEGADOR (lib/importador-tn.ts) y acá llega ya
 * convertido en pedidos, sin emails ni nombres. Esta ruta sólo valida y hace
 * upsert: reimportar el mismo archivo no duplica, actualiza.
 *
 * Mismo permiso que la página: sólo el superadmin. Lo vuelve a chequear el
 * proxy por prefijo (/api/marketing), y acá de nuevo porque escribe.
 */
async function quienPuede(): Promise<string | null | false> {
  if (!authConfigurada) return "local";
  const quien = await getUsuario();
  if (permisoDelUsuario(quien)?.rol !== "superadmin") return false;
  return quien?.email ?? null;
}

const texto = (v: unknown, max = 200) =>
  typeof v === "string" && v.trim() !== "" ? v.trim().slice(0, max) : null;
const numero = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

function validar(p: PedidoImportado): PedidoImportado | null {
  const num = texto(p?.numero, 40);
  const total = numero(p?.total);
  if (!num || total == null || typeof p.fecha !== "string" || Number.isNaN(Date.parse(p.fecha))) {
    return null;
  }
  const hash = texto(p.clienteHash, 64);
  return {
    numero: num,
    fecha: new Date(p.fecha).toISOString(),
    estado: texto(p.estado, 60),
    estadoPago: texto(p.estadoPago, 60),
    estadoEnvio: texto(p.estadoEnvio, 60),
    esVenta: p.esVenta === true,
    subtotal: numero(p.subtotal),
    descuento: numero(p.descuento),
    envio: numero(p.envio),
    total,
    cupon: texto(p.cupon, 60)?.toUpperCase() ?? null,
    medioPago: texto(p.medioPago, 80),
    provincia: texto(p.provincia, 80),
    // Sólo un hash hexadecimal: si llegara un email en claro, se descarta.
    clienteHash: hash && /^[0-9a-f]{64}$/.test(hash) ? hash : null,
    unidades: Math.max(0, Math.round(numero(p.unidades) ?? 0)),
    productos: Array.isArray(p.productos)
      ? p.productos.slice(0, 200).map((x) => ({
          nombre: texto(x?.nombre, 200) ?? "",
          sku: texto(x?.sku, 60),
          cantidad: numero(x?.cantidad) ?? 1,
          precio: numero(x?.precio),
        }))
      : [],
  };
}

export async function POST(request: NextRequest) {
  const usuario = await quienPuede();
  if (usuario === false) return NextResponse.json({ error: "Sin permiso" }, { status: 403 });

  let cuerpo: CuerpoImportacion;
  try {
    cuerpo = (await request.json()) as CuerpoImportacion;
  } catch {
    return NextResponse.json({ error: "El cuerpo no es JSON" }, { status: 400 });
  }
  if (!MARCAS.some((m) => m.clave === cuerpo?.marca)) {
    return NextResponse.json({ error: "Marca desconocida" }, { status: 400 });
  }
  if (!Array.isArray(cuerpo.pedidos) || cuerpo.pedidos.length === 0) {
    return NextResponse.json({ error: "No hay pedidos para importar" }, { status: 400 });
  }
  if (cuerpo.pedidos.length > MAX_PEDIDOS) {
    return NextResponse.json({ error: `Más de ${MAX_PEDIDOS} pedidos: partí el archivo` }, { status: 400 });
  }

  const pedidos = cuerpo.pedidos.map(validar).filter((p): p is PedidoImportado => p !== null);
  const descartados = cuerpo.pedidos.length - pedidos.length;
  if (pedidos.length === 0) {
    return NextResponse.json({ error: "Ningún pedido válido" }, { status: 400 });
  }
  const archivo = texto(cuerpo.archivo, 200);
  const fechas = pedidos.map((p) => p.fecha).sort();

  try {
    const resultado = await enTransaccion(async (ejecutar) => {
      // Un solo insert con jsonb_to_recordset: cientos de pedidos en un viaje,
      // y `xmax = 0` distingue los que entraron nuevos de los que se pisaron.
      const filas = await ejecutar<{ nuevo: boolean }>(
        `insert into bronze.mkt_tn_pedidos
           (marca, numero, fecha, estado, estado_pago, estado_envio, es_venta, subtotal,
            descuento, envio, total, cupon, medio_pago, provincia, cliente_hash, unidades,
            productos, archivo, importado_por, importado_en)
         select $1, x."numero", x."fecha", x."estado", x."estadoPago", x."estadoEnvio",
                x."esVenta", x."subtotal", x."descuento", x."envio", x."total", x."cupon",
                x."medioPago", x."provincia", x."clienteHash", x."unidades", x."productos",
                $3, $4, now()
           from jsonb_to_recordset($2::jsonb) as x(
                "numero" text, "fecha" timestamptz, "estado" text, "estadoPago" text,
                "estadoEnvio" text, "esVenta" boolean, "subtotal" numeric, "descuento" numeric,
                "envio" numeric, "total" numeric, "cupon" text, "medioPago" text,
                "provincia" text, "clienteHash" text, "unidades" integer, "productos" jsonb)
         on conflict (marca, numero) do update set
           fecha = excluded.fecha, estado = excluded.estado, estado_pago = excluded.estado_pago,
           estado_envio = excluded.estado_envio, es_venta = excluded.es_venta,
           subtotal = excluded.subtotal, descuento = excluded.descuento, envio = excluded.envio,
           total = excluded.total, cupon = excluded.cupon, medio_pago = excluded.medio_pago,
           provincia = excluded.provincia,
           cliente_hash = coalesce(excluded.cliente_hash, bronze.mkt_tn_pedidos.cliente_hash),
           unidades = excluded.unidades, productos = excluded.productos,
           archivo = excluded.archivo, importado_por = excluded.importado_por,
           importado_en = now()
         returning (xmax = 0) as nuevo`,
        [cuerpo.marca, JSON.stringify(pedidos), archivo, usuario],
      );
      const nuevos = filas.filter((f) => f.nuevo).length;
      await ejecutar(
        `insert into bronze.mkt_tn_importaciones
           (marca, archivo, pedidos, nuevos, actualizados, desde, hasta, importado_por)
         values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [cuerpo.marca, archivo, filas.length, nuevos, filas.length - nuevos, fechas[0], fechas.at(-1), usuario],
      );
      return { pedidos: filas.length, nuevos, actualizados: filas.length - nuevos };
    });
    return NextResponse.json({ ...resultado, descartados });
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : "Error desconocido";
    console.error("[api/marketing/tienda-nube] POST", error);
    const sinTabla = /mkt_tn_pedidos|mkt_tn_importaciones/.test(mensaje) && /does not exist|no existe/.test(mensaje);
    return NextResponse.json(
      {
        error: sinTabla
          ? "Falta crear las tablas: correr migraciones/marketing_tienda_nube.sql en Supabase."
          : mensaje,
      },
      { status: 500 },
    );
  }
}

/** Las últimas importaciones, para el historial de la pantalla. */
export async function GET() {
  if ((await quienPuede()) === false) {
    return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  }
  try {
    const filas = await query(
      `select marca, archivo, pedidos, nuevos, actualizados, desde, hasta, importado_por, importado_en
         from bronze.mkt_tn_importaciones order by importado_en desc limit 30`,
    );
    return NextResponse.json({ importaciones: filas });
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : "Error desconocido";
    return NextResponse.json({ importaciones: [], error: mensaje });
  }
}
