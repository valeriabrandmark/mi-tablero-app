import Image from "next/image";
import Link from "next/link";
import FormularioRecuperar from "@/components/FormularioRecuperar";
import { authConfigurada } from "@/lib/supabase/env";

export const metadata = { title: "Recuperar contraseña — Tablero Brandmark" };

export default function RecuperarPage() {
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="border-line bg-panel w-full max-w-sm rounded-xl border p-6">
        <Image src="/isotipo.png" alt="" width={256} height={256} priority className="mb-5 h-16 w-auto" />
        <h1 className="text-lg font-semibold tracking-tight">Recuperar contraseña</h1>
        <p className="text-muted mt-1 text-sm">
          Te mandamos un link por mail para poner una nueva.
        </p>

        {authConfigurada ? (
          <FormularioRecuperar />
        ) : (
          <p className="text-muted mt-6 text-sm">El login todavía no está configurado.</p>
        )}

        <Link href="/login" className="text-c1 mt-6 inline-block text-sm underline">
          Volver
        </Link>
      </div>
    </main>
  );
}
