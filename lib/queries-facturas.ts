import { query, queryOne } from "@/lib/db";
import type {
  ArticuloMaestro,
  DiferenciaGuardada,
  ResumenDiferencias,
} from "@/lib/factura-cruce";
import type { CuerpoImportCompras, Imputacion } from "@/lib/sigma-compra";

/**
 * El maestro de Sigma que hace falta para reconocer los renglones de una
 * factura de compra.
 *
 * SE TRAE EL PROVEEDOR ENTERO, no sólo los SKU de la OC. Una factura trae a
 * veces artículos que no estaban pedidos --un reemplazo, un bonificado, un
 * error del proveedor-- y para poder decir "esto no estaba en la OC" primero
 * hay que saber QUÉ es. Con sólo los de la OC, esos renglones quedarían como
 * "sin identificar", que es otra cosa.
 *
 * El proveedor sale de los mismos SKU: así sirve igual para una OC armada en
 * el tablero que para una pegada desde Sigma, sin que nadie tenga que elegirlo.
 * Si los SKU son de dos proveedores, vienen los dos.
 */
export async function getMaestroParaFactura(
  skus: string[],
): Promise<ArticuloMaestro[]> {
  if (skus.length === 0) return [];
  const filas = await query<Record<string, unknown>>(
    `with prov as (
       select distinct nullif(trim("proveedorCodigo"), '') as codigo
       from bronze.sigma_articulos
       where trim(id) = any($1::text[])
     )
     ${COLUMNAS_MAESTRO}
     where trim(a.id) = any($1::text[])
        or nullif(trim(a."proveedorCodigo"), '') in (select codigo from prov)`,
    [skus],
  );

  return filas.map(aArticulo);
}

/**
 * Las columnas del maestro que necesita el cruce. Las dos consultas tienen que
 * traer exactamente lo mismo: lo único que cambia es por dónde se entra.
 */
const COLUMNAS_MAESTRO = `
     select trim(a.id)                                   as sku,
            coalesce(a.descripcion, '')                  as descripcion,
            nullif(trim(a."codigoCompra"), '')           as codigo_compra,
            nullif(trim(a."eanUnidad"), '')              as ean_unidad,
            nullif(trim(a."eanDisplay"), '')             as ean_display,
            nullif(trim(a."eanBulto"), '')               as ean_bulto,
            greatest(coalesce(a."unidadesPorBulto", 1), 1)   as u_bulto,
            greatest(coalesce(a."unidadesPorDisplay", 1), 1) as u_display,
            coalesce(a."ivaPorcentual", 21)              as iva
     from bronze.sigma_articulos a`;

function aArticulo(r: Record<string, unknown>): ArticuloMaestro {
  return {
    sku: String(r.sku),
    descripcion: String(r.descripcion),
    codigoCompra: (r.codigo_compra as string | null) ?? null,
    eanUnidad: (r.ean_unidad as string | null) ?? null,
    eanDisplay: (r.ean_display as string | null) ?? null,
    eanBulto: (r.ean_bulto as string | null) ?? null,
    unidadesPorBulto: Number(r.u_bulto ?? 1),
    unidadesPorDisplay: Number(r.u_display ?? 1),
    iva: Number(r.iva ?? 21),
  };
}

/**
 * TODOS LOS PROVEEDORES DEL MAESTRO, para poder cargar una factura de uno que
 * todavía no tiene OC en el tablero.
 *
 * El desplegable se armaba con las órdenes mandadas desde Compras, y eso dejaba
 * 12 proveedores sobre 46: una factura de un proveedor al que la OC se le pasó
 * por teléfono no se podía cargar. La OC sirve para CRUZAR, no para existir.
 *
 * Sale del maestro de artículos porque es donde el código de proveedor vive
 * --el mismo `proveedorCodigo` con el que se arma la OC-- y porque un proveedor
 * sin un solo artículo cargado no sirve para nada acá: no habría con qué
 * reconocer los renglones de su factura.
 */
export async function getProveedoresDeCompra(): Promise<
  { codigo: string; nombre: string }[]
> {
  return query<{ codigo: string; nombre: string }>(
    `select nullif(trim("proveedorCodigo"), '')            as codigo,
            max("proveedorNombre")                         as nombre
     from bronze.sigma_articulos
     where nullif(trim("proveedorCodigo"), '') is not null
       and nullif(trim("proveedorNombre"), '') is not null
     group by 1
     order by 2`,
  );
}

/**
 * El maestro de UN proveedor, por su código.
 *
 * Es la misma lista que `getMaestroParaFactura` arma a partir de los SKU de la
 * OC, pero entrando por el otro lado: sin OC no hay SKU de los que partir.
 */
export async function getMaestroDelProveedor(
  codigo: string,
): Promise<ArticuloMaestro[]> {
  const filas = await query<Record<string, unknown>>(
    `${COLUMNAS_MAESTRO}
     where nullif(trim(a."proveedorCodigo"), '') = $1`,
    [codigo],
  );
  return filas.map(aArticulo);
}

/* -------------------------------------------------------------------------
   LA IMPUTACION CONTABLE

   Las cuentas con las que se arma `contable[]` de ImportCompras. Viven en la
   base y no en el código porque son el plan de cuentas de la empresa: una
   cuenta inventada manda plata al lugar equivocado en la contabilidad, y eso
   no se nota en ninguna pantalla.
   ------------------------------------------------------------------------- */

export type FilaImputacion = {
  concepto: string;
  cuenta: string;
  subcuenta: string | null;
  centroCosto: string | null;
  tipoImpuesto: string;
};

/** Todas las cuentas cargadas, por concepto. */
export async function getImputacionContable(): Promise<
  Record<string, Imputacion>
> {
  const filas = await query<{
    concepto: string;
    cuenta: string;
    subcuenta: string | null;
    centro_costo: string | null;
    tipo_impuesto: string;
  }>(
    `select concepto, cuenta, subcuenta, centro_costo, tipo_impuesto
       from app.sigma_imputacion_contable
      order by concepto`,
  );

  const m: Record<string, Imputacion> = {};
  for (const f of filas) {
    m[f.concepto] = {
      cuenta: f.cuenta,
      subcuenta: f.subcuenta,
      centroCosto: f.centro_costo,
      tipoImpuesto: f.tipo_impuesto,
    };
  }
  return m;
}

/**
 * Guarda o pisa la cuenta de un concepto.
 *
 * SIN CUENTA O SIN TIPO DE IMPUESTO SE BORRA la fila en vez de guardarla a
 * medias: `armarImportCompras` trata una imputación incompleta como faltante,
 * así que una fila con la cuenta vacía sería una forma silenciosa de decir lo
 * mismo con un registro de más.
 */
export async function guardarImputacion(
  fila: FilaImputacion,
  usuario: string | null,
): Promise<void> {
  const cuenta = fila.cuenta.trim();
  const tipo = fila.tipoImpuesto.trim();

  if (!cuenta || !tipo) {
    await query(
      `delete from app.sigma_imputacion_contable where concepto = $1`,
      [fila.concepto],
    );
    return;
  }

  await query(
    `insert into app.sigma_imputacion_contable
       (concepto, cuenta, subcuenta, centro_costo, tipo_impuesto, actualizado_por)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (concepto) do update
        set cuenta          = excluded.cuenta,
            subcuenta       = excluded.subcuenta,
            centro_costo    = excluded.centro_costo,
            tipo_impuesto   = excluded.tipo_impuesto,
            actualizado_en  = now(),
            actualizado_por = excluded.actualizado_por`,
    [
      fila.concepto,
      cuenta,
      fila.subcuenta?.trim() || null,
      fila.centroCosto?.trim() || null,
      tipo,
      usuario,
    ],
  );
}

/* -------------------------------------------------------------------------
   EL REGISTRO DE LO QUE SE MANDO
   ------------------------------------------------------------------------- */

/**
 * Deja constancia de la factura que se mandó a Sigma.
 *
 * NO TIRA SI FALLA, igual que la de las órdenes: la factura ya está cargada
 * del otro lado, así que un error al guardar la constancia no puede convertir
 * un éxito en un error en la pantalla.
 */
export async function guardarFacturaEnviada(datos: {
  usuario: string | null;
  cuerpo: CuerpoImportCompras;
  proveedorNombre: string | null;
  resultado: "ok" | "rechazada" | "incierto";
  respuesta: string;
  /**
   * LAS DIFERENCIAS CONGELADAS. Ver `resumirDiferencias`: el cruce no se puede
   * recalcular más adelante porque la OC y el maestro cambian, así que lo que
   * se va a reclamar tiene que quedar guardado tal como se vio al mandarla.
   */
  diferencias: ResumenDiferencias;
}): Promise<void> {
  try {
    await query(
      `insert into app.facturas_compra_enviadas
         (usuario, id_sigma, proveedor_id, proveedor_nombre, empresa, sucursal,
          numero_comprobante, tipo_comprobante, fecha_factura, total,
          renglones, resultado, respuesta, payload,
          diferencias, renglones_con_diferencia, dif_costo, dif_cantidad)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9::date, $10, $11, $12, $13,
               $14::jsonb, $15::jsonb, $16, $17, $18)`,
      [
        datos.usuario,
        datos.cuerpo.id,
        datos.cuerpo.proveedorId,
        datos.proveedorNombre,
        datos.cuerpo.empresa,
        datos.cuerpo.sucursal ?? null,
        datos.cuerpo.numeroComprobante,
        datos.cuerpo.tipoComprobante,
        datos.cuerpo.fechaFactura,
        datos.cuerpo.total,
        datos.cuerpo.mercaderias.length,
        datos.resultado,
        datos.respuesta.slice(0, 2000),
        JSON.stringify(datos.cuerpo),
        JSON.stringify(datos.diferencias.lineas),
        datos.diferencias.renglones,
        datos.diferencias.difCosto,
        datos.diferencias.difCantidad,
      ],
    );
  } catch (error) {
    console.error("[facturas] no se pudo guardar la constancia:", error);
  }
}

/** Si una factura ya se mandó: se busca por el mismo id que usa Sigma. */
export async function facturaYaEnviada(
  idSigma: string,
): Promise<{ enviadaEn: string; resultado: string } | null> {
  const fila = await queryOne<{ enviada_en: string; resultado: string }>(
    `select to_char(enviada_en at time zone 'America/Argentina/Buenos_Aires',
                    'DD/MM/YYYY HH24:MI') as enviada_en,
            resultado
       from app.facturas_compra_enviadas
      where id_sigma = $1 and resultado = 'ok'
      order by enviada_en desc
      limit 1`,
    [idSigma],
  );
  return fila ? { enviadaEn: fila.enviada_en, resultado: fila.resultado } : null;
}

/* -------------------------------------------------------------------------
   FACTURAS ENVIADAS A SIGMA, Y QUE FALTA RECLAMAR
   ------------------------------------------------------------------------- */

/** Los tres estados de un reclamo. Ver la migración `facturas_enviadas_reclamo`. */
export const ESTADOS_RECLAMO = ["pendiente", "reclamado", "omitido"] as const;
export type EstadoReclamo = (typeof ESTADOS_RECLAMO)[number];

export function esEstadoReclamo(v: unknown): v is EstadoReclamo {
  return typeof v === "string" && (ESTADOS_RECLAMO as readonly string[]).includes(v);
}

export type FacturaEnviada = {
  id: number;
  enviadaEn: string;
  usuario: string | null;
  proveedor: string | null;
  numero: string | null;
  tipo: string | null;
  fechaFactura: string | null;
  empresa: string | null;
  sucursal: string | null;
  total: number;
  renglones: number;
  resultado: "ok" | "rechazada" | "incierto";
  /** Cuántos renglones no coincidían con la OC. 0 = no hay nada que reclamar. */
  conDiferencia: number;
  difCosto: number;
  difCantidad: number;
  diferencias: DiferenciaGuardada[];
  reclamo: EstadoReclamo;
  reclamoEn: string | null;
  reclamoPor: string | null;
  reclamoNota: string | null;
};

type FilaFactura = {
  id: string;
  enviada_en: string;
  usuario: string | null;
  proveedor_nombre: string | null;
  numero_comprobante: string | null;
  tipo_comprobante: string | null;
  fecha_factura: string | null;
  empresa: string | null;
  sucursal: string | null;
  total: string | null;
  renglones: number;
  resultado: string;
  renglones_con_diferencia: number;
  dif_costo: string | null;
  dif_cantidad: string | null;
  diferencias: DiferenciaGuardada[] | null;
  reclamo: string;
  reclamo_en: string | null;
  reclamo_por: string | null;
  reclamo_nota: string | null;
};

/**
 * Las facturas que se mandaron a Sigma.
 *
 * SOLO LAS QUE ENTRARON (`resultado = 'ok'`). Una rechazada no está cargada
 * del otro lado, así que no hay nada que reclamar sobre ella: listarla junto
 * a las que sí entraron haría que la lista de "lo que falta reclamar" tuviera
 * adentro cosas que ni siquiera existen en el ERP.
 *
 * `count(*)` de Postgres vuelve como TEXTO (int8), igual que los numeric: por
 * eso todo pasa por `Number()` antes de salir de acá.
 */
export async function getFacturasEnviadas(opciones?: {
  soloPendientes?: boolean;
  limite?: number;
}): Promise<FacturaEnviada[]> {
  const filtro = opciones?.soloPendientes
    ? "and renglones_con_diferencia > 0 and reclamo = 'pendiente'"
    : "";

  const filas = await query<FilaFactura>(
    `select id::text,
            to_char(enviada_en at time zone 'America/Argentina/Buenos_Aires',
                    'DD/MM/YYYY HH24:MI')                        as enviada_en,
            usuario, proveedor_nombre, numero_comprobante,
            tipo_comprobante,
            to_char(fecha_factura, 'DD/MM/YYYY')                 as fecha_factura,
            empresa, sucursal, total, renglones, resultado,
            renglones_con_diferencia, dif_costo, dif_cantidad, diferencias,
            reclamo,
            to_char(reclamo_en at time zone 'America/Argentina/Buenos_Aires',
                    'DD/MM/YYYY HH24:MI')                        as reclamo_en,
            reclamo_por, reclamo_nota
       from app.facturas_compra_enviadas
      where resultado = 'ok' ${filtro}
      order by enviada_en desc
      limit $1`,
    [Math.min(Math.max(opciones?.limite ?? 200, 1), 500)],
  );

  return filas.map((f) => ({
    id: Number(f.id),
    enviadaEn: f.enviada_en,
    usuario: f.usuario,
    proveedor: f.proveedor_nombre,
    numero: f.numero_comprobante,
    tipo: f.tipo_comprobante,
    fechaFactura: f.fecha_factura,
    empresa: f.empresa,
    sucursal: f.sucursal,
    total: Number(f.total ?? 0),
    renglones: Number(f.renglones ?? 0),
    resultado: f.resultado as FacturaEnviada["resultado"],
    conDiferencia: Number(f.renglones_con_diferencia ?? 0),
    difCosto: Number(f.dif_costo ?? 0),
    difCantidad: Number(f.dif_cantidad ?? 0),
    diferencias: f.diferencias ?? [],
    reclamo: esEstadoReclamo(f.reclamo) ? f.reclamo : "pendiente",
    reclamoEn: f.reclamo_en,
    reclamoPor: f.reclamo_por,
    reclamoNota: f.reclamo_nota,
  }));
}

/**
 * Marcar una factura como reclamada u omitida, o volverla a pendiente.
 *
 * SE PUEDE VOLVER ATRAS a propósito: marcar "omitido" por error no puede
 * dejar un reclamo enterrado para siempre. Lo único que no se puede es
 * inventar un estado.
 *
 * Queda quién y cuándo, que es lo que convierte "está cerrado" en "lo cerró
 * fulana el martes": sin eso, dentro de dos meses nadie sabe si se reclamó de
 * verdad o si alguien tildó para sacarlo de la lista.
 */
export async function marcarReclamo(
  id: number,
  estado: EstadoReclamo,
  usuario: string | null,
  nota: string | null,
): Promise<void> {
  await query(
    `update app.facturas_compra_enviadas
        set reclamo = $2,
            -- Volver a pendiente borra la firma: si no, quedaría diciendo que
            -- alguien lo cerró cuando ya no está cerrado.
            reclamo_en  = case when $2 = 'pendiente' then null else now() end,
            reclamo_por = case when $2 = 'pendiente' then null else $3 end,
            reclamo_nota = $4
      where id = $1`,
    [id, estado, usuario, nota?.slice(0, 500) ?? null],
  );
}
