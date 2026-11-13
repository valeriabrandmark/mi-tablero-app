/**
 * MARKETING → CARGA: qué se carga, con qué campos y qué reglas.
 *
 * Reemplaza a la planilla de Google Sheets: todo se carga y se edita desde el
 * tablero y queda en tablas de Supabase (migraciones/marketing_carga.sql).
 *
 * UNA SOLA DEFINICIÓN DE CADA FORMULARIO, usada por los dos lados: la
 * pantalla dibuja los campos a partir de acá, y la API valida con lo mismo.
 * Así no puede pasar que el formulario deje guardar algo que la base
 * rechaza, ni al revés.
 *
 * Sin `pg`: lo importan la pantalla y la API.
 */

export const MARCAS_CARGA = [
  { clave: "diaper_genie", nombre: "Diaper Genie" },
  { clave: "hola_toys", nombre: "Hola Toys" },
  { clave: "unibrandco", nombre: "Unibrandco" },
  { clave: "litter_genie", nombre: "Litter Genie" },
] as const;
export type ClaveMarcaCarga = (typeof MARCAS_CARGA)[number]["clave"];
export const nombreMarcaCarga = (k: string | null | undefined) =>
  MARCAS_CARGA.find((m) => m.clave === k)?.nombre ?? k ?? "—";

export const LISTAS = {
  modalidad: ["Pago", "Canje", "Pago + canje"],
  formato: ["Historia", "Reel", "Reel en colaboración", "Reel + historia", "Pack mensual", "TikTok", "Sorteo", "Evento / visita", "Otro"],
  estadoColaboracion: ["Propuesta", "Negociando", "Acordada", "Producto enviado", "Publicada", "Medida", "Cancelada"],
  estadoPago: ["No aplica", "Pendiente", "Pagado"],
  medioPago: ["Transferencia", "Efectivo", "Factura A", "Factura C", "Mercado Pago"],
  estadoContacto: ["Sin contactar", "Mensaje enviado", "En conversación", "Pidió presupuesto", "Aceptó", "Rechazó", "No responde"],
  tipoEnvio: ["Influencer", "Sorteo", "Producción", "Evento", "Otro"],
  transporte: ["Andreani", "Correo Argentino", "OCA", "Moto / cadete", "Retira en depósito", "Otro"],
  estadoEnvio: ["Preparando", "Enviado", "Recibido", "Devuelto"],
  conceptoGasto: ["Pauta Google", "Pauta Mercado Ads", "Pauta Meta", "Agencia / redes sociales", "Manejo de pauta", "Producción de contenido",
    "Diseño", "Ferias / stand", "Fotografía / video", "Muestras / regalos", "Otro"],
  red: ["Instagram", "TikTok", "YouTube", "Facebook", "Otra"],
  siNo: ["Sí", "No"],
  siNoParcial: ["Sí", "No", "Parcial"],
  estadoContenido: ["Planificado", "En producción", "Aprobado", "Publicado"],
} as const;

export type TipoCampo =
  | "texto"
  | "largo"
  | "numero"
  | "monto"
  | "fecha"
  | "mes"
  | "lista"
  | "marca"
  | "marcas"
  | "influencer"
  | "colaboracion";

export type Campo = {
  /** Columna de la tabla. */
  clave: string;
  etiqueta: string;
  tipo: TipoCampo;
  requerido?: boolean;
  lista?: keyof typeof LISTAS;
  /** Texto de ayuda debajo del campo. */
  ayuda?: string;
  /** Ocupa todo el ancho del formulario. */
  ancho?: boolean;
  /** Se muestra en la tabla del listado. */
  enListado?: boolean;
  /** Sección del formulario. */
  seccion?: string;
};

export type ClaveTabla = "colaboraciones" | "influencers" | "envios" | "gastos" | "presupuesto" | "contenido";

export type DefTabla = {
  clave: ClaveTabla;
  /** Tabla de Supabase. */
  tabla: string;
  titulo: string;
  singular: string;
  campos: Campo[];
};

export const TABLAS: Record<ClaveTabla, DefTabla> = {
  colaboraciones: {
    clave: "colaboraciones",
    tabla: "bronze.mkt_colaboraciones",
    titulo: "Colaboraciones",
    singular: "colaboración",
    campos: [
      { clave: "marca", etiqueta: "Marca", tipo: "marca", requerido: true, enListado: true, seccion: "Acuerdo" },
      { clave: "fecha", etiqueta: "Fecha del acuerdo", tipo: "fecha", requerido: true, enListado: true, seccion: "Acuerdo" },
      { clave: "influencer_id", etiqueta: "Influencer", tipo: "influencer", requerido: true, enListado: true, seccion: "Acuerdo" },
      { clave: "modalidad", etiqueta: "Modalidad", tipo: "lista", lista: "modalidad", requerido: true, enListado: true, seccion: "Acuerdo" },
      { clave: "formato", etiqueta: "Formato", tipo: "lista", lista: "formato", requerido: true, seccion: "Acuerdo" },
      { clave: "piezas", etiqueta: "Piezas", tipo: "numero", seccion: "Acuerdo" },
      { clave: "estado", etiqueta: "Estado", tipo: "lista", lista: "estadoColaboracion", requerido: true, enListado: true, seccion: "Acuerdo" },
      { clave: "campana", etiqueta: "Campaña / fecha comercial", tipo: "texto", seccion: "Acuerdo" },
      { clave: "producto_promocionado", etiqueta: "Producto / marca promocionada", tipo: "texto", seccion: "Acuerdo" },
      { clave: "objetivo", etiqueta: "Objetivo", tipo: "largo", ancho: true, seccion: "Acuerdo" },
      { clave: "honorarios", etiqueta: "Honorarios ($)", tipo: "monto", enListado: true, seccion: "Pago" },
      { clave: "iva_honorarios", etiqueta: "IVA honorarios ($)", tipo: "monto", seccion: "Pago" },
      { clave: "otros_costos", etiqueta: "Otros costos ($)", tipo: "monto", seccion: "Pago" },
      { clave: "estado_pago", etiqueta: "Estado de pago", tipo: "lista", lista: "estadoPago", enListado: true, seccion: "Pago" },
      { clave: "fecha_pago", etiqueta: "Fecha de pago", tipo: "fecha", seccion: "Pago" },
      { clave: "medio_pago", etiqueta: "Medio de pago", tipo: "lista", lista: "medioPago", seccion: "Pago" },
      { clave: "factura", etiqueta: "Factura", tipo: "texto", seccion: "Pago" },
      { clave: "publicacion_prevista", etiqueta: "Publicación prevista", tipo: "fecha", seccion: "Resultado" },
      { clave: "publicacion_real", etiqueta: "Publicación real", tipo: "fecha", seccion: "Resultado" },
      { clave: "link", etiqueta: "Link", tipo: "texto", ancho: true, seccion: "Resultado" },
      { clave: "cupon", etiqueta: "Cupón", tipo: "texto", enListado: true, ayuda: "Sin cupón no se puede medir la venta que trae.", seccion: "Resultado" },
      { clave: "alcance", etiqueta: "Alcance", tipo: "numero", seccion: "Resultado" },
      { clave: "interacciones", etiqueta: "Interacciones", tipo: "numero", seccion: "Resultado" },
      { clave: "observaciones", etiqueta: "Observaciones", tipo: "largo", ancho: true, seccion: "Resultado" },
    ],
  },
  influencers: {
    clave: "influencers",
    tabla: "bronze.mkt_influencers",
    titulo: "Influencers",
    singular: "influencer",
    campos: [
      { clave: "nombre", etiqueta: "Nombre", tipo: "texto", requerido: true, enListado: true },
      { clave: "instagram", etiqueta: "@ Instagram", tipo: "texto", requerido: true, enListado: true },
      { clave: "seguidores", etiqueta: "Seguidores", tipo: "numero", requerido: true, enListado: true },
      { clave: "red", etiqueta: "Red", tipo: "lista", lista: "red" },
      { clave: "provincia", etiqueta: "Provincia / ciudad", tipo: "texto", enListado: true },
      { clave: "nicho", etiqueta: "Nicho", tipo: "texto" },
      { clave: "marcas", etiqueta: "Marcas", tipo: "marcas", enListado: true, ancho: true },
      { clave: "tarifa_historia", etiqueta: "Tarifa historia ($)", tipo: "monto", seccion: "Tarifas" },
      { clave: "tarifa_reel", etiqueta: "Tarifa reel ($)", tipo: "monto", enListado: true, seccion: "Tarifas" },
      { clave: "tarifa_pack", etiqueta: "Tarifa pack ($)", tipo: "monto", seccion: "Tarifas" },
      { clave: "acepta_canje", etiqueta: "Acepta canje", tipo: "lista", lista: "siNo", seccion: "Tarifas" },
      { clave: "email", etiqueta: "Email", tipo: "texto", seccion: "Contacto" },
      { clave: "whatsapp", etiqueta: "WhatsApp", tipo: "texto", seccion: "Contacto" },
      { clave: "estado_contacto", etiqueta: "Estado del contacto", tipo: "lista", lista: "estadoContacto", requerido: true, enListado: true, seccion: "Contacto" },
      { clave: "ultimo_contacto", etiqueta: "Último contacto", tipo: "fecha", enListado: true, seccion: "Contacto" },
      { clave: "observaciones", etiqueta: "Observaciones", tipo: "largo", ancho: true, seccion: "Contacto" },
    ],
  },
  envios: {
    clave: "envios",
    tabla: "bronze.mkt_envios",
    titulo: "Envíos",
    singular: "envío",
    campos: [
      { clave: "tipo", etiqueta: "Tipo", tipo: "lista", lista: "tipoEnvio", requerido: true, enListado: true },
      { clave: "marca", etiqueta: "Marca", tipo: "marca", requerido: true, enListado: true },
      { clave: "colaboracion_id", etiqueta: "Colaboración", tipo: "colaboracion", ayuda: "Obligatoria si el envío es a un influencer.", ancho: true },
      { clave: "destinatario", etiqueta: "Destinatario", tipo: "texto", requerido: true, enListado: true },
      { clave: "fecha", etiqueta: "Fecha", tipo: "fecha", requerido: true, enListado: true },
      { clave: "transporte", etiqueta: "Transporte", tipo: "lista", lista: "transporte", requerido: true },
      { clave: "costo", etiqueta: "Costo del envío ($)", tipo: "monto", requerido: true, enListado: true },
      { clave: "estado", etiqueta: "Estado", tipo: "lista", lista: "estadoEnvio", requerido: true, enListado: true },
      { clave: "seguimiento", etiqueta: "Seguimiento", tipo: "texto" },
      { clave: "recibido", etiqueta: "Recibido el", tipo: "fecha" },
      { clave: "publico", etiqueta: "Publicó contenido", tipo: "lista", lista: "siNoParcial" },
      { clave: "observaciones", etiqueta: "Observaciones", tipo: "largo", ancho: true },
    ],
  },
  gastos: {
    clave: "gastos",
    tabla: "bronze.mkt_gastos",
    titulo: "Otros gastos",
    singular: "gasto",
    campos: [
      { clave: "fecha", etiqueta: "Fecha", tipo: "fecha", requerido: true, enListado: true },
      { clave: "marca", etiqueta: "Marca", tipo: "marca", requerido: true, enListado: true },
      { clave: "concepto", etiqueta: "Concepto", tipo: "lista", lista: "conceptoGasto", requerido: true, enListado: true },
      { clave: "proveedor", etiqueta: "Proveedor", tipo: "texto", enListado: true },
      { clave: "detalle", etiqueta: "Detalle", tipo: "texto", requerido: true, enListado: true, ancho: true },
      { clave: "monto", etiqueta: "Monto ($)", tipo: "monto", requerido: true, enListado: true },
      { clave: "iva", etiqueta: "IVA ($)", tipo: "monto" },
      { clave: "estado_pago", etiqueta: "Estado de pago", tipo: "lista", lista: "estadoPago", requerido: true, enListado: true },
      { clave: "fecha_pago", etiqueta: "Fecha de pago", tipo: "fecha" },
      { clave: "factura", etiqueta: "Factura", tipo: "texto" },
      { clave: "observaciones", etiqueta: "Observaciones", tipo: "largo", ancho: true, ayuda: "La pauta de Meta no hace falta cargarla: el tablero la lee de Meta Ads." },
    ],
  },
  presupuesto: {
    clave: "presupuesto",
    tabla: "bronze.mkt_presupuesto",
    titulo: "Presupuesto",
    singular: "presupuesto",
    campos: [
      { clave: "mes", etiqueta: "Mes", tipo: "mes", requerido: true, enListado: true },
      { clave: "marca", etiqueta: "Marca", tipo: "marca", requerido: true, enListado: true },
      { clave: "monto", etiqueta: "Presupuesto ($)", tipo: "monto", requerido: true, enListado: true },
      { clave: "nota", etiqueta: "Nota", tipo: "texto", enListado: true, ancho: true },
    ],
  },
  contenido: {
    clave: "contenido",
    tabla: "bronze.mkt_contenido",
    titulo: "Contenido",
    singular: "pieza",
    campos: [
      { clave: "colaboracion_id", etiqueta: "Colaboración", tipo: "colaboracion", requerido: true, enListado: true, ancho: true },
      { clave: "formato", etiqueta: "Formato", tipo: "lista", lista: "formato", requerido: true, enListado: true },
      { clave: "estado", etiqueta: "Estado", tipo: "lista", lista: "estadoContenido", requerido: true, enListado: true },
      { clave: "titulo", etiqueta: "Título", tipo: "texto", requerido: true, enListado: true, ancho: true },
      { clave: "concepto", etiqueta: "Concepto", tipo: "largo", ancho: true },
      { clave: "guion", etiqueta: "Guion", tipo: "largo", ancho: true },
      { clave: "copy", etiqueta: "Copy", tipo: "largo", ancho: true },
      { clave: "fecha", etiqueta: "Fecha", tipo: "fecha", enListado: true },
      { clave: "link", etiqueta: "Link", tipo: "texto", ancho: true },
      { clave: "observaciones", etiqueta: "Observaciones", tipo: "largo", ancho: true },
    ],
  },
};

export type Fila = Record<string, unknown> & { id?: number };

/** Producto de canje cargado a mano (lo que no pasó por SIGMA). */
export type ProductoManual = {
  sku: string | null;
  producto: string;
  cantidad: number;
  costo_unitario: number | null;
  pvp_unitario: number | null;
  fecha_entrega: string | null;
};

/** Una línea de SIGMA vendida a un cliente de canje. */
export type LineaCanje = {
  comprobante: string;
  fecha: string;
  marca: ClaveMarcaCarga;
  sku: string;
  producto: string;
  cantidad: number;
  costo: number;
  colaboracion_id: number | null;
};

// ---------------------------------------------------------------------------
// Validación (la misma en la pantalla y en la API)
// ---------------------------------------------------------------------------

const vacio = (v: unknown) => v === null || v === undefined || (typeof v === "string" && v.trim() === "") || (Array.isArray(v) && v.length === 0);

/**
 * Devuelve la lista de problemas (vacía si está todo bien). Además de los
 * obligatorios, las reglas de negocio de cada tabla.
 */
export function validar(
  tabla: ClaveTabla,
  d: Fila,
  extra?: { productos?: ProductoManual[]; comprobantes?: string[] },
  /** false al editar: algunas reglas sólo valen para lo que se carga nuevo. */
  nuevo = true,
): string[] {
  const def = TABLAS[tabla];
  const errores: string[] = [];
  for (const c of def.campos) {
    const v = d[c.clave];
    if (c.requerido && vacio(v)) errores.push(`Falta ${c.etiqueta.toLowerCase()}`);
    if (!vacio(v) && c.tipo === "lista" && c.lista && !(LISTAS[c.lista] as readonly string[]).includes(String(v))) {
      errores.push(`${c.etiqueta}: "${String(v)}" no está en la lista`);
    }
    if (!vacio(v) && c.tipo === "marca" && !MARCAS_CARGA.some((m) => m.clave === v)) errores.push(`Marca inválida`);
    if (!vacio(v) && (c.tipo === "monto" || c.tipo === "numero")) {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0) errores.push(`${c.etiqueta}: tiene que ser un número positivo`);
    }
    if (!vacio(v) && c.tipo === "fecha" && !/^\d{4}-\d{2}-\d{2}$/.test(String(v))) errores.push(`${c.etiqueta}: fecha inválida`);
    if (!vacio(v) && c.tipo === "mes" && !/^\d{4}-\d{2}$/.test(String(v))) errores.push(`${c.etiqueta}: va como aaaa-mm`);
  }
  if (tabla === "colaboraciones") {
    const conPago = d.modalidad === "Pago" || d.modalidad === "Pago + canje";
    const conCanje = d.modalidad === "Canje" || d.modalidad === "Pago + canje";
    if (conPago && !(Number(d.honorarios) > 0)) errores.push("Una colaboración paga necesita los honorarios");
    if (conPago && vacio(d.estado_pago)) errores.push("Falta el estado de pago");
    if (conCanje && extra && !(extra.productos?.length || extra.comprobantes?.length)) {
      errores.push("Un canje necesita un comprobante de SIGMA o al menos un producto");
    }
    // Sólo al cargar: lo migrado de las planillas viejas no siempre tiene esas
    // fechas, y exigirlas impediría corregir cualquier otro dato de esas filas.
    if (nuevo && d.estado_pago === "Pagado" && vacio(d.fecha_pago)) errores.push("Si está pagado, falta la fecha de pago");
    if (nuevo && d.estado === "Publicada" && vacio(d.publicacion_real)) errores.push("Si está publicada, falta la fecha de publicación");
    for (const [i, p] of (extra?.productos ?? []).entries()) {
      if (vacio(p.producto)) errores.push(`Producto ${i + 1}: falta el nombre`);
      if (!(Number(p.cantidad) > 0)) errores.push(`Producto ${i + 1}: falta la cantidad`);
    }
  }
  if (tabla === "envios" && d.tipo === "Influencer" && vacio(d.colaboracion_id)) {
    errores.push("Un envío a un influencer va con su colaboración");
  }
  if (tabla === "gastos" && nuevo && d.estado_pago === "Pagado" && vacio(d.fecha_pago)) errores.push("Si está pagado, falta la fecha de pago");
  return errores;
}
