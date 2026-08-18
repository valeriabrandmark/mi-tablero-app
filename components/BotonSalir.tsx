"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function BotonSalir({ className = "" }: { className?: string }) {
  const router = useRouter();
  const [saliendo, setSaliendo] = useState(false);

  async function salir() {
    setSaliendo(true);
    await createClient().auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  return (
    <button
      onClick={salir}
      disabled={saliendo}
      className={`border-line hover:bg-panel-2 text-muted hover:text-ink flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs disabled:opacity-60 ${className}`}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="size-4 shrink-0" aria-hidden="true">
        <path d="M15 17l5-5-5-5M20 12H9M12 21H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h6" />
      </svg>
      {saliendo ? "Saliendo…" : "Cerrar sesión"}
    </button>
  );
}
