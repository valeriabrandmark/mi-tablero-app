import { createHash, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

/**
 * La llave de los scripts de Google que le mandan datos al Tablero de Marca
 * (Google Ads y Google Analytics). No hay sesión: el script manda un token
 * compartido en el header. Sirve MKT_GOOGLE_ADS_TOKEN y, si no está, el de la
 * planilla de Marketing (MKT_PLANILLA_TOKEN), que ya está cargado en Vercel.
 * Hash y comparación en tiempo constante: no filtra ni el largo ni el prefijo.
 */
export function llaveScriptGoogle(request: NextRequest): "ok" | "sin_configurar" | "invalido" {
  const esperado = process.env.MKT_GOOGLE_ADS_TOKEN || process.env.MKT_PLANILLA_TOKEN;
  if (!esperado) return "sin_configurar";
  const cabecera = request.headers.get("authorization") ?? "";
  const recibido = cabecera.startsWith("Bearer ") ? cabecera.slice(7) : "";
  if (!recibido) return "invalido";
  const a = createHash("sha256").update(recibido).digest();
  const b = createHash("sha256").update(esperado).digest();
  return timingSafeEqual(a, b) ? "ok" : "invalido";
}

export const MENSAJE_LLAVE = {
  sin_configurar: "El tablero no tiene MKT_GOOGLE_ADS_TOKEN ni MKT_PLANILLA_TOKEN.",
  invalido: "El TOKEN del script no coincide con el del tablero (MKT_GOOGLE_ADS_TOKEN o MKT_PLANILLA_TOKEN en Vercel).",
} as const;
