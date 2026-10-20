"use client";

import { useEffect, useState } from "react";

/**
 * LAS ORDENES A MEDIO ARMAR DE QUIEN ESTA MIRANDO.
 *
 * ---------------------------------------------------------------------------
 * POR QUE EXISTE
 *
 * El borrador se guarda solo y se retoma solo, pero sólo se retoma cuando ya
 * elegiste el proveedor -- o sea, cuando ya te acordabas de que lo tenías. Si
 * no te acordás, no hay forma de enterarte: la pantalla arranca igual que
 * siempre y el trabajo guardado no aparece en ningún lado.
 *
 * Eso convertía a los borradores en una función invisible, que es casi lo mismo
 * que no tenerla. Esto es la lista: "tenés dos órdenes a medio armar, son
 * éstas".
 *
 * ---------------------------------------------------------------------------
 * EL USUARIO NO VIAJA EN EL PEDIDO
 *
 * Sale de la sesión del lado del servidor. Acá no hay nada que mandar: la
 * respuesta ya es "los tuyos". Ver app/api/compras/borrador/route.ts.
 */

export type BorradorVigente = {
  proveedor: string;
  /** "19/10/2026 14:32", ya en hora de Buenos Aires. */
  actualizadoEn: string;
  /** Renglones CON CANTIDAD. Un borrador donde sólo se vació no cuenta nada. */
  renglones: number;
};

export function useBorradoresVigentes(): {
  borradores: BorradorVigente[];
  cargando: boolean;
} {
  const [borradores, setBorradores] = useState<BorradorVigente[]>([]);
  const [listo, setListo] = useState(false);

  useEffect(() => {
    const ac = new AbortController();

    fetch("/api/compras/borrador", { signal: ac.signal, cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { borradores?: BorradorVigente[] }) => {
        setBorradores(Array.isArray(d.borradores) ? d.borradores : []);
        setListo(true);
      })
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === "AbortError") return;
        // Que no se pueda leer la lista NO puede frenar la pantalla: se arma la
        // orden igual, que es como se armaba antes de que esto existiera.
        setBorradores([]);
        setListo(true);
      });

    return () => ac.abort();
    // UNA SOLA VEZ, al entrar. El borrador del proveedor que se está mirando
    // cambia con cada tecla, y volver a pedir la lista para seguirlo serían dos
    // consultas por guardado -- la pantalla lo deriva de lo que ya tiene (ver
    // `borradores` en DashboardCompras). Esta lista es para los OTROS, que no
    // cambian mientras se arma una orden.
  }, []);

  return { borradores, cargando: !listo };
}
