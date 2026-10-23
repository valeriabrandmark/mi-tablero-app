"use client";

import { useState } from "react";
import RutinaMeli from "@/components/RutinaMeli";
import TareasMeli from "@/components/TareasMeli";

/**
 * "Mis tareas" entera: la rutina arriba, porque es por donde arranca el día,
 * y la bandeja de alertas abajo.
 *
 * Las dos se hablan en un solo sentido: la bandeja le pasa a la rutina cuántas
 * alertas de descarte quedan sin contestar, para que la fila "Para evitar
 * descarte" diga cuánto trabajo hay en vez de ser un tilde a ciegas.
 */
export default function MisTareasMeli({ puedeContestar }: { puedeContestar: boolean }) {
  const [pendientes, setPendientes] = useState<number | null>(null);
  return (
    <div className="grid gap-6">
      <RutinaMeli puedeContestar={puedeContestar} pendientesDescarte={pendientes} />
      <TareasMeli puedeContestar={puedeContestar} onPendientes={setPendientes} />
    </div>
  );
}
