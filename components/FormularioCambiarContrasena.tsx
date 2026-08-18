"use client";

import { useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  BotonEnviar,
  CamposContrasena,
  CLASE_INPUT,
  Mensaje,
  validarContrasena,
} from "@/components/CamposContrasena";

/**
 * Cambio de contraseña con la sesión abierta.
 *
 * Pide la contraseña ACTUAL y la verifica con un `signInWithPassword` antes de
 * cambiar nada. Supabase no lo exige, pero sin eso alcanza con encontrar una
 * sesión abierta en una máquina prestada para quedarse con la cuenta: se cambia
 * la contraseña y el dueño queda afuera.
 */
export default function FormularioCambiarContrasena({ email }: { email: string }) {
  const [actual, setActual] = useState("");
  const [nueva, setNueva] = useState("");
  const [repetida, setRepetida] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listo, setListo] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const problema = validarContrasena(nueva, repetida);
    if (problema) return setError(problema);
    if (actual === nueva) return setError("La contraseña nueva es igual a la actual.");

    setError(null);
    setListo(false);
    setEnviando(true);

    const supabase = createClient();

    const { error: errorActual } = await supabase.auth.signInWithPassword({
      email,
      password: actual,
    });
    if (errorActual) {
      setEnviando(false);
      setError("La contraseña actual no es correcta.");
      return;
    }

    const { error: errorCambio } = await supabase.auth.updateUser({ password: nueva });
    setEnviando(false);

    if (errorCambio) {
      setError(
        /same as the old|should be different/i.test(errorCambio.message)
          ? "La contraseña nueva tiene que ser distinta de la anterior."
          : errorCambio.message,
      );
      return;
    }

    setActual("");
    setNueva("");
    setRepetida("");
    setListo(true);
  }

  return (
    <form onSubmit={onSubmit} className="max-w-sm space-y-4">
      <label className="block">
        <span className="text-muted text-xs">Contraseña actual</span>
        <input
          type="password"
          required
          autoComplete="current-password"
          value={actual}
          disabled={enviando}
          onChange={(e) => setActual(e.target.value)}
          className={CLASE_INPUT}
        />
      </label>

      <CamposContrasena
        nueva={nueva}
        repetida={repetida}
        onNueva={setNueva}
        onRepetida={setRepetida}
        deshabilitado={enviando}
      />

      {error && <Mensaje tono="error">{error}</Mensaje>}
      {listo && <Mensaje tono="ok">Contraseña cambiada.</Mensaje>}

      <BotonEnviar enviando={enviando} textoEnviando="Guardando…">
        Cambiar contraseña
      </BotonEnviar>
    </form>
  );
}
