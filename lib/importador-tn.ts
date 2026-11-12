/**
 * Lee el CSV de "Ventas" que exporta el administrador de Tienda Nube
 * (Ventas → Exportar) y lo convierte en pedidos.
 *
 * Sin `pg` ni nada de servidor: corre en el navegador, para mostrar la vista
 * previa ANTES de subir y para que los datos personales no salgan de la
 * computadora de quien importa (ver `hashEmail`).
 *
 * ---------------------------------------------------------------------------
 * LO QUE HAY QUE SABER DEL ARCHIVO
 *
 * - Separador `;` o `,` según la configuración regional: se detecta.
 * - Codificación UTF-8 o Windows-1252 (los acentos salen rotos si se lee mal):
 *   se prueba UTF-8 y si aparecen caracteres de reemplazo se relee.
 * - UNA FILA POR PRODUCTO. Los datos del pedido se repiten o quedan vacíos en
 *   las filas siguientes del mismo pedido: se toma el primer valor no vacío.
 * - Los nombres de las columnas cambian un poco entre versiones del panel, por
 *   eso se buscan por varios alias y sin acentos ni mayúsculas.
 * - Montos en formato argentino ("1.234,56") o con punto decimal ("1234.56").
 * ---------------------------------------------------------------------------
 */

import type { ClaveMarca } from "@/lib/marketing-demo";

export type PedidoImportado = {
  numero: string;
  /** ISO 8601. */
  fecha: string;
  estado: string | null;
  estadoPago: string | null;
  estadoEnvio: string | null;
  esVenta: boolean;
  subtotal: number | null;
  descuento: number | null;
  envio: number | null;
  total: number;
  cupon: string | null;
  medioPago: string | null;
  provincia: string | null;
  clienteHash: string | null;
  unidades: number;
  productos: { nombre: string; sku: string | null; cantidad: number; precio: number | null }[];
};

export type ResultadoLectura = {
  pedidos: PedidoImportado[];
  filas: number;
  columnasEncontradas: string[];
  columnasFaltantes: string[];
  avisos: string[];
};

/** Columna lógica → nombres posibles en el CSV (ya normalizados). */
const ALIAS: Record<string, string[]> = {
  numero: ["numero de orden", "orden", "n de orden", "numero de pedido", "pedido", "order number"],
  email: ["email", "e-mail", "mail", "email del comprador"],
  fecha: ["fecha", "fecha de la orden", "fecha de creacion", "fecha de compra", "date"],
  estado: ["estado de la orden", "estado del pedido", "estado"],
  estadoPago: ["estado del pago", "pago", "payment status"],
  estadoEnvio: ["estado del envio", "envio estado", "shipping status"],
  subtotal: ["subtotal de productos", "subtotal"],
  descuento: ["descuento", "descuentos", "monto de descuento"],
  envio: ["costo de envio", "envio", "costo del envio"],
  total: ["total", "total de la orden", "monto total"],
  cupon: ["cupon de descuento", "cupon", "codigo de cupon", "coupon"],
  medioPago: ["medio de pago", "forma de pago", "metodo de pago", "gateway"],
  provincia: ["provincia o estado", "provincia", "provincia de envio", "estado/provincia"],
  producto: ["nombre del producto", "producto", "product name"],
  precio: ["precio del producto", "precio", "precio unitario"],
  cantidad: ["cantidad del producto", "cantidad", "quantity"],
  sku: ["sku", "codigo sku"],
};

const OBLIGATORIAS = ["numero", "fecha", "total"];

export function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[°º#]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Decodifica el archivo probando UTF-8 y, si sale roto, Windows-1252. */
export function decodificar(bytes: ArrayBuffer): string {
  const utf8 = new TextDecoder("utf-8").decode(bytes);
  if (!utf8.includes("�")) return utf8.replace(/^﻿/, "");
  return new TextDecoder("windows-1252").decode(bytes);
}

/** CSV con comillas, comillas dobles escapadas y saltos de línea adentro de un campo. */
export function parsearCsv(texto: string): string[][] {
  const fin = texto.indexOf("\n");
  const primera = fin >= 0 ? texto.slice(0, fin) : texto;
  const sep = (primera.match(/;/g)?.length ?? 0) > (primera.match(/,/g)?.length ?? 0) ? ";" : ",";
  const filas: string[][] = [];
  let fila: string[] = [];
  let campo = "";
  let comillas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (comillas) {
      if (c === '"') {
        if (texto[i + 1] === '"') {
          campo += '"';
          i++;
        } else comillas = false;
      } else campo += c;
    } else if (c === '"') comillas = true;
    else if (c === sep) {
      fila.push(campo);
      campo = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && texto[i + 1] === "\n") i++;
      fila.push(campo);
      if (fila.some((x) => x.trim() !== "")) filas.push(fila);
      fila = [];
      campo = "";
    } else campo += c;
  }
  fila.push(campo);
  if (fila.some((x) => x.trim() !== "")) filas.push(fila);
  return filas;
}

/** "1.234,56" · "1234.56" · "$ 1.234" → número. */
export function numeroAr(v: string | undefined): number | null {
  if (v == null) return null;
  let s = v.replace(/[^\d,.-]/g, "");
  if (!s) return null;
  const coma = s.lastIndexOf(",");
  const punto = s.lastIndexOf(".");
  if (coma > punto) s = s.replace(/\./g, "").replace(",", ".");
  else if (punto > coma && coma >= 0) s = s.replace(/,/g, "");
  // Sólo puntos, en grupos de tres: "1.234" o "12.345.678" son miles.
  else if (coma < 0 && /^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** "dd/mm/aaaa hh:mm[:ss]" o ISO → ISO, en hora argentina. */
export function fechaIso(v: string | undefined): string | null {
  if (!v) return null;
  const t = v.trim();
  const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    const [, d, mes, a, h = "12", mi = "00", s = "00"] = m;
    const anio = a.length === 2 ? `20${a}` : a;
    const iso = `${anio}-${mes.padStart(2, "0")}-${d.padStart(2, "0")}T${h.padStart(2, "0")}:${mi}:${s}-03:00`;
    return Number.isNaN(Date.parse(iso)) ? null : new Date(iso).toISOString();
  }
  const ms = Date.parse(t);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

/**
 * Pagado y no cancelado. Tienda Nube escribe los estados en castellano en el
 * CSV ("Pagado", "Recibido", "Cancelada"), pero se aceptan los de la API por
 * si el archivo viene de otro lado.
 */
export function esVenta(estado: string | null, pago: string | null): boolean {
  const e = normalizar(estado ?? "");
  const p = normalizar(pago ?? "");
  if (/cancel/.test(e) || /cancel/.test(p)) return false;
  return /pagad|recibid|paid|autorizad|authorized|aprobad/.test(p);
}

/** SHA-256 del email en minúsculas. El email nunca sale del navegador. */
export async function hashEmail(email: string): Promise<string | null> {
  const limpio = email.trim().toLowerCase();
  if (!limpio || !limpio.includes("@")) return null;
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(limpio));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function leerCsvTiendaNube(bytes: ArrayBuffer): Promise<ResultadoLectura> {
  const filas = parsearCsv(decodificar(bytes));
  const avisos: string[] = [];
  if (filas.length < 2) {
    return { pedidos: [], filas: 0, columnasEncontradas: [], columnasFaltantes: OBLIGATORIAS, avisos: ["El archivo está vacío."] };
  }

  const cabecera = filas[0].map(normalizar);
  const indice: Record<string, number> = {};
  for (const [logica, alias] of Object.entries(ALIAS)) {
    // Primero coincidencia exacta; "estado" a secas no tiene que comerse
    // "estado del pago".
    const i = alias.map((a) => cabecera.indexOf(a)).find((x) => x >= 0);
    if (i !== undefined) indice[logica] = i;
  }
  const columnasEncontradas = Object.keys(indice);
  const columnasFaltantes = OBLIGATORIAS.filter((c) => !(c in indice));
  if (columnasFaltantes.length) {
    return { pedidos: [], filas: filas.length - 1, columnasEncontradas, columnasFaltantes, avisos: [
      "No es el CSV de Ventas de Tienda Nube, o cambiaron los nombres de las columnas.",
    ] };
  }

  const valor = (fila: string[], c: string) => {
    const i = indice[c];
    const v = i === undefined ? "" : (fila[i] ?? "").trim();
    return v === "" ? undefined : v;
  };

  type Acum = { campos: Record<string, string>; productos: PedidoImportado["productos"] };
  const porNumero = new Map<string, Acum>();
  for (const fila of filas.slice(1)) {
    const numero = valor(fila, "numero")?.replace(/^#/, "");
    if (!numero) continue;
    let p = porNumero.get(numero);
    if (!p) porNumero.set(numero, (p = { campos: {}, productos: [] }));
    for (const c of Object.keys(indice)) {
      const v = valor(fila, c);
      if (v !== undefined && p.campos[c] === undefined) p.campos[c] = v;
    }
    const nombre = valor(fila, "producto");
    if (nombre) {
      p.productos.push({
        nombre,
        sku: valor(fila, "sku") ?? null,
        cantidad: numeroAr(valor(fila, "cantidad")) ?? 1,
        precio: numeroAr(valor(fila, "precio")),
      });
    }
  }

  const pedidos: PedidoImportado[] = [];
  let sinFecha = 0;
  for (const [numero, { campos, productos }] of porNumero) {
    const fecha = fechaIso(campos.fecha);
    const total = numeroAr(campos.total);
    if (!fecha || total == null) {
      sinFecha++;
      continue;
    }
    const estado = campos.estado ?? null;
    const estadoPago = campos.estadoPago ?? null;
    pedidos.push({
      numero,
      fecha,
      estado,
      estadoPago,
      estadoEnvio: campos.estadoEnvio ?? null,
      esVenta: esVenta(estado, estadoPago),
      subtotal: numeroAr(campos.subtotal),
      descuento: numeroAr(campos.descuento),
      envio: numeroAr(campos.envio),
      total,
      cupon: campos.cupon ? campos.cupon.toUpperCase() : null,
      medioPago: campos.medioPago ?? null,
      provincia: campos.provincia ?? null,
      clienteHash: campos.email ? await hashEmail(campos.email) : null,
      unidades: productos.reduce((s, x) => s + x.cantidad, 0),
      productos,
    });
  }
  if (sinFecha) avisos.push(`${sinFecha} pedido(s) sin fecha o sin total: no se importan.`);
  if (!("estadoPago" in indice)) avisos.push("No se encontró la columna de estado del pago: ningún pedido va a contar como venta.");
  if (!("email" in indice)) avisos.push("Sin columna de email: no se va a poder separar clientes nuevos de recurrentes.");
  if (!("cupon" in indice)) avisos.push("Sin columna de cupón: las ventas por influencer no se van a poder medir.");

  return { pedidos, filas: filas.length - 1, columnasEncontradas, columnasFaltantes, avisos };
}

export type CuerpoImportacion = { marca: ClaveMarca; archivo: string; pedidos: PedidoImportado[] };
