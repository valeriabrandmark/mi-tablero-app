import Image from "next/image";
import Link from "next/link";
import FormularioLogin from "@/components/FormularioLogin";
import { authConfigurada } from "@/lib/supabase/env";

export const metadata = { title: "Ingresar — Tablero Brandmark" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next } = await searchParams;
  const destino = typeof next === "string" && next.startsWith("/") ? next : "/ventas-mayoristas";

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="border-line bg-panel w-full max-w-sm rounded-xl border p-6">
        <Image
          src="/isotipo.png"
          alt=""
          width={256}
          height={256}
          priority
          className="mb-5 h-16 w-auto"
        />
        <h1 className="text-lg font-semibold tracking-tight">Brandmark Negocio</h1>
        <p className="text-muted mt-1 text-sm">Ingresá con tu email y contraseña.</p>

        {authConfigurada ? (
          <FormularioLogin destino={destino} />
        ) : (
          <p className="text-muted mt-6 text-sm leading-relaxed">
            El login todavía no está configurado.{" "}
            <Link href="/ventas-mayoristas" className="text-c1 underline">
              Ir al tablero
            </Link>{" "}
            (solo posible en desarrollo).
          </p>
        )}
      </div>
    </main>
  );
}
