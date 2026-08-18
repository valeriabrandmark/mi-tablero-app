import Image from "next/image";
import Link from "next/link";
import FormularioLogin from "@/components/FormularioLogin";
import { authConfigurada } from "@/lib/supabase/env";

export const metadata = { title: "Ingresar — Tablero Brandmark" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next, error } = await searchParams;
  const destino = typeof next === "string" && next.startsWith("/") ? next : "/ventas-mayoristas";

  const AVISOS: Record<string, string> = {
    "link-vencido": "Ese link ya no sirve: vence a la hora y se usa una sola vez. Pedí uno nuevo.",
    "link-invalido": "El link del mail no se entendió. Probá pedir uno nuevo.",
    "auth-no-configurada": "El login todavía no está configurado.",
  };
  const aviso = typeof error === "string" ? AVISOS[error] : undefined;

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

        {aviso && (
          <p className="border-c3/30 bg-c3/15 text-c3 mt-4 rounded-lg border p-3 text-xs leading-relaxed">
            {aviso}
          </p>
        )}

        {authConfigurada ? (
          <>
            <FormularioLogin destino={destino} />
            <Link href="/recuperar" className="text-muted hover:text-ink mt-4 inline-block text-xs underline">
              Olvidé mi contraseña
            </Link>
          </>
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
