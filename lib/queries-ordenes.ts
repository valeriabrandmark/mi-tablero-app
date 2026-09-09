import { query } from "@/lib/db";
import type { OrdenSigma } from "@/lib/sigma-orden";

/**
 * El historial de órdenes que el tablero le mandó a Sigma.
 *
 * ---------------------------------------------------------------------------
 * POR QUÉ EXISTE
 *
 * Una orden mandada no se puede deshacer y, del lado de Sigma, lo único que
 * queda es el resultado. Lo que se PIDIÓ --qué cantidad, en qué unidad, con qué
 * descuentos, contra qué costo de ese día-- no queda en ningún lado.
 *
 * El 09/09/2026 hubo que reconstruir a mano, mirando la ficha de una OC en el
 * ERP y haciendo la división, si se había pedido en bultos o en unidades. Con
 * esta tabla eso es abrir un renglón.
 *
 * SE GUARDA TODO LO QUE SALIÓ, no sólo lo que salió bien. Sigma contesta 500
 * también cuando la orden entra, así que "salió bien" es justo lo que no se
 * puede saber en el momento: el registro sirve para averiguarlo después.
 */

export type OrdenEnviada = {
  id: string;
  enviadaEn: string;
  usuario: string | null;
  proveedorCodigo: string | null;
  proveedorNombre: string | null;
  empresa: string | null;
  mes: string | null;
  nota: string | null;
  renglones: number;
  unidades: number;
  totalBruto: number;
  resultado: "ok" | "incierto";
  respuesta: string | null;
  payload: OrdenSigma;
};

/**
 * Deja constancia de una orden que ya salió.
 *
 * NO TIRA NUNCA. Se llama después de hablarle a Sigma, cuando la orden ya está
 * cargada del otro lado: si esto fallara y dejara propagar el error, la
 * pantalla mostraría "no se pudo" sobre una orden que sí se hizo -- exactamente
 * el problema que este historial viene a resolver. Un fallo acá se registra en
 * el log del servidor y nada más.
 */
export async function guardarOrdenEnviada(datos: {
  usuario: string | null;
  mes: string;
  payload: OrdenSigma;
  resultado: "ok" | "incierto";
  respuesta: string;
  proveedorNombre: string | null;
}): Promise<void> {
  const items = datos.payload.items ?? [];
  const unidades = items.reduce((s, i) => s + (Number(i.cantidad) || 0), 0);
  const total = items.reduce(
    (s, i) => s + (Number(i.cantidad) || 0) * (Number(i.precio) || 0),
    0,
  );

  try {
    await query(
      `insert into app.ordenes_compra_enviadas
         (usuario, proveedor_codigo, proveedor_nombre, empresa, mes, nota,
          renglones, unidades, total_bruto, resultado, respuesta, payload)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)`,
      [
        datos.usuario,
        datos.payload.proveedorId ?? null,
        datos.proveedorNombre,
        datos.payload.empresa ?? null,
        datos.mes || null,
        datos.payload.observaciones || null,
        items.length,
        unidades,
        Math.round(total * 100) / 100,
        datos.resultado,
        // Se recorta: el mensaje de Sigma es corto, pero un 502 de un proxy
        // puede venir con una página de HTML entera.
        datos.respuesta.slice(0, 2000),
        JSON.stringify(datos.payload),
      ],
    );
  } catch (error) {
    console.error("[ordenes] no se pudo guardar la constancia:", error);
  }
}

/** Las últimas órdenes mandadas, de la más nueva a la más vieja. */
export async function getOrdenesEnviadas(limite = 50): Promise<OrdenEnviada[]> {
  const filas = await query<Record<string, unknown>>(
    `select id::text as id,
            to_char(enviada_en at time zone 'America/Argentina/Buenos_Aires',
                    'YYYY-MM-DD HH24:MI')        as enviada_en,
            usuario, proveedor_codigo, proveedor_nombre, empresa, mes, nota,
            renglones, unidades, total_bruto, resultado, respuesta, payload
     from app.ordenes_compra_enviadas
     order by enviada_en desc
     limit $1`,
    [Math.min(Math.max(Math.round(limite), 1), 200)],
  );

  return filas.map((r) => ({
    id: String(r.id),
    enviadaEn: String(r.enviada_en),
    usuario: (r.usuario as string | null) ?? null,
    proveedorCodigo: (r.proveedor_codigo as string | null) ?? null,
    proveedorNombre: (r.proveedor_nombre as string | null) ?? null,
    empresa: (r.empresa as string | null) ?? null,
    mes: (r.mes as string | null) ?? null,
    nota: (r.nota as string | null) ?? null,
    renglones: Number(r.renglones ?? 0),
    unidades: Number(r.unidades ?? 0),
    totalBruto: Number(r.total_bruto ?? 0),
    resultado: r.resultado === "ok" ? "ok" : "incierto",
    respuesta: (r.respuesta as string | null) ?? null,
    payload: r.payload as OrdenSigma,
  }));
}
