"use client";

import type { ReactNode } from "react";

/**
 * Los dos campos de "contraseña nueva" y su validación.
 *
 * Los comparten la pantalla de recuperación y la de cambio desde la cuenta:
 * si las reglas vivieran duplicadas, tarde o temprano una de las dos pantallas
 * aceptaría algo que la otra rechaza.
 */

export const LARGO_MINIMO = 8;

export const CLASE_INPUT =
  "border-line bg-panel-2 focus:border-c1 mt-1 w-full rounded-lg border px-3 py-2 text-sm outline-none";

/** Devuelve qué está mal con la contraseña, o `null` si está bien. */
export function validarContrasena(nueva: string, repetida: string): string | null {
  if (nueva.length < LARGO_MINIMO) {
    return `La contraseña tiene que tener al menos ${LARGO_MINIMO} caracteres.`;
  }
  if (nueva !== repetida) return "Las dos contraseñas no coinciden.";
  return null;
}

export function CamposContrasena({
  nueva,
  repetida,
  onNueva,
  onRepetida,
  deshabilitado,
}: {
  nueva: string;
  repetida: string;
  onNueva: (v: string) => void;
  onRepetida: (v: string) => void;
  deshabilitado?: boolean;
}) {
  return (
    <>
      <label className="block">
        <span className="text-muted text-xs">Contraseña nueva</span>
        <input
          type="password"
          required
          minLength={LARGO_MINIMO}
          autoComplete="new-password"
          value={nueva}
          disabled={deshabilitado}
          onChange={(e) => onNueva(e.target.value)}
          className={CLASE_INPUT}
        />
        <span className="text-muted mt-1 block text-[11px]">
          Mínimo {LARGO_MINIMO} caracteres.
        </span>
      </label>

      <label className="block">
        <span className="text-muted text-xs">Repetir contraseña nueva</span>
        <input
          type="password"
          required
          minLength={LARGO_MINIMO}
          autoComplete="new-password"
          value={repetida}
          disabled={deshabilitado}
          onChange={(e) => onRepetida(e.target.value)}
          className={CLASE_INPUT}
        />
      </label>
    </>
  );
}

export function BotonEnviar({
  enviando,
  textoEnviando,
  children,
}: {
  enviando: boolean;
  textoEnviando: string;
  children: ReactNode;
}) {
  return (
    <button
      type="submit"
      disabled={enviando}
      className="bg-c1 w-full rounded-lg px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
    >
      {enviando ? textoEnviando : children}
    </button>
  );
}

/** Mensaje de error o de éxito, con el mismo formato en las tres pantallas. */
export function Mensaje({ tono, children }: { tono: "error" | "ok"; children: ReactNode }) {
  return (
    <p className={`text-sm ${tono === "error" ? "text-rose-400" : "text-c2"}`}>{children}</p>
  );
}
