import Image from "next/image";
import Link from "next/link";
import FormularioNuevaContrasena from "@/components/FormularioNuevaContrasena";
import { authConfigurada } from "@/lib/supabase/env";
import { getUsuario } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Contraseña nueva — Tablero Brandmark" };

export default async function NuevaContrasenaPage() {
  // Se llega acá con la sesión que dejó /auth/confirmar. Sin sesión el link
  // venció, ya se usó, o alguien entró de prendido: no hay nada que hacer.
  const usuario = authConfigurada ? await getUsuario() : null;

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="border-line bg-panel w-full max-w-sm rounded-xl border p-6">
        <Image src="/isotipo.png" alt="" width={256} height={256} priority className="mb-5 h-16 w-auto" />
        <h1 className="text-lg font-semibold tracking-tight">Contraseña nueva</h1>

        {!authConfigurada ? (
          <p className="text-muted mt-1 text-sm">El login todavía no está configurado.</p>
        ) : usuario ? (
          <>
            <p className="text-muted mt-1 text-sm">
              Para <span className="text-ink">{usuario.email}</span>.
            </p>
            <FormularioNuevaContrasena />
          </>
        ) : (
          <>
            <p className="text-muted mt-1 text-sm leading-relaxed">
              Este link ya no sirve: vence a la hora y se usa una sola vez.
            </p>
            <Link href="/recuperar" className="text-c1 mt-4 inline-block text-sm underline">
              Pedir uno nuevo
            </Link>
          </>
        )}
      </div>
    </main>
  );
}
