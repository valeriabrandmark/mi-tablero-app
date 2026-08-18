"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  BotonEnviar,
  CamposContrasena,
  Mensaje,
  validarContrasena,
} from "@/components/CamposContrasena";

/**
 * Contraseña nueva después de entrar por el link del mail.
 *
 * Acá NO se pide la contraseña anterior: el punto de todo el flujo es que la
 * persona no la recuerda. Lo que autoriza el cambio es la sesión de
 * recuperación que dejó `/auth/confirmar` al canjear el link.
 */
export default function FormularioNuevaContrasena() {
  const router = useRouter();
  const [nueva, setNueva] = useState("");
  const [repetida, setRepetida] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const problema = validarContrasena(nueva, repetida);
    if (problema) return setError(problema);

    setError(null);
    setEnviando(true);

    const { error } = await createClient().auth.updateUser({ password: nueva });

    if (error) {
      setEnviando(false);
      setError(
        /same as the old|should be different/i.test(error.message)
          ? "La contraseña nueva tiene que ser distinta de la anterior."
          : error.message,
      );
      return;
    }

    // A la raíz: el proxy manda a cada uno a la página que le toca por su rol.
    router.replace("/");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-4">
      <CamposContrasena
        nueva={nueva}
        repetida={repetida}
        onNueva={setNueva}
        onRepetida={setRepetida}
        deshabilitado={enviando}
      />

      {error && <Mensaje tono="error">{error}</Mensaje>}

      <BotonEnviar enviando={enviando} textoEnviando="Guardando…">
        Guardar y entrar
      </BotonEnviar>
    </form>
  );
}
