"use client";

import type { ReactNode } from "react";

export function CajaTooltip({ titulo, children }: { titulo?: ReactNode; children: ReactNode }) {
  return (
    <div className="border-line bg-panel/95 rounded-lg border px-3 py-2 text-xs shadow-lg backdrop-blur">
      {titulo && <p className="text-muted mb-1.5">{titulo}</p>}
      <div className="space-y-1">{children}</div>
    </div>
  );
}

export function FilaTooltip({
  color,
  label,
  valor,
}: {
  color: string;
  label: string;
  valor: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="size-2 shrink-0 rounded-full" style={{ background: color }} />
      <span className="text-muted max-w-[180px] truncate">{label}</span>
      <span className="ml-auto tabular-nums">{valor}</span>
    </div>
  );
}
