"use client";

import { useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { BotonEnviar, CLASE_INPUT, Mensaje } from "@/components/CamposContrasena";

export default function FormularioRecuperar() {
  const [email, setEmail] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setEnviando(true);

    // El destino se arma con el origin del navegador para que ande igual en
    // local, en el preview de Vercel y en producción. OJO: cada uno de esos
    // dominios tiene que estar en Supabase → Authentication → URL Configuration
    // → Redirect URLs, si no Supabase ignora el redirect.
    const { error } = await createClient().auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/auth/confirmar?next=/nueva-contrasena`,
    });

    setEnviando(false);

    // A propósito NO se distingue entre "el mail existe" y "no existe": si no,
    // cualquiera puede usar esta pantalla para averiguar quién tiene usuario.
    if (error && !/rate limit|too many/i.test(error.message)) {
      console.error("[recuperar]", error.message);
    }
    if (error && /rate limit|too many/i.test(error.message)) {
      setError("Se pidieron demasiados mails seguidos. Esperá unos minutos y probá de nuevo.");
      return;
    }
    setEnviado(true);
  }

  if (enviado) {
    return (
      <div className="mt-6 space-y-3">
        <Mensaje tono="ok">Listo, revisá tu correo.</Mensaje>
        <p className="text-muted text-sm leading-relaxed">
          Si <span className="text-ink">{email.trim()}</span> tiene una cuenta, le llega un
          link para poner una contraseña nueva. El link vence en una hora y se usa una sola
          vez.
        </p>
        <p className="text-muted text-sm">Si no aparece, fijate en spam.</p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-4">
      <label className="block">
        <span className="text-muted text-xs">Email</span>
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={CLASE_INPUT}
        />
      </label>

      {error && <Mensaje tono="error">{error}</Mensaje>}

      <BotonEnviar enviando={enviando} textoEnviando="Enviando…">
        Enviarme el link
      </BotonEnviar>
    </form>
  );
}
