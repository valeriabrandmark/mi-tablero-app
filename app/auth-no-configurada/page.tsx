export const metadata = { title: "Configuración pendiente — Tablero Brandmark" };

export default function AuthNoConfigurada() {
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="border-line bg-panel max-w-lg rounded-xl border p-6">
        <h1 className="text-lg font-semibold">Falta configurar el login</h1>
        <p className="text-muted mt-3 text-sm leading-relaxed">
          El tablero no se sirve sin autenticación. Para habilitarlo, cargá estas dos
          variables en Vercel (Settings → Environment Variables) y volvé a desplegar:
        </p>
        <ul className="mt-4 space-y-1 font-mono text-sm">
          <li>NEXT_PUBLIC_SUPABASE_URL</li>
          <li>NEXT_PUBLIC_SUPABASE_ANON_KEY</li>
        </ul>
        <p className="text-muted mt-4 text-xs">
          Las encontrás en Supabase → Project Settings → API.
        </p>
      </div>
    </main>
  );
}
