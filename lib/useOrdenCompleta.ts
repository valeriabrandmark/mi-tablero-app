"use client";

import { useEffect, useState } from "react";
import type { FilaCompra } from "@/lib/types";

/**
 * TODO LO QUE EL PROVEEDOR TIENE, sin los filtros de la vista.
 *
 * ---------------------------------------------------------------------------
 * POR QUE HACE FALTA UNA SEGUNDA CONSULTA
 *
 * La orden se arma mirando de a poco --una marca, lo que tiene oferta, lo
 * discontinuado-- pero la orden que sale es una sola y es del proveedor
 * entero. Mientras lo que se bajaba eran las filas visibles, bajar con un
 * filtro puesto no daba ningún error: daba una orden incompleta que parecía
 * correcta y que alguien le mandaba a un proveedor.
 *
 * Esto trae la lista completa: mismo proveedor, misma ventana, misma cobertura
 * y mismo mes, pero SIN marca, SIN buscador y SIN recortes. Con eso la orden,
 * los totales y el archivo dejan de depender de lo que había filtrado en ese
 * momento.
 *
 * ---------------------------------------------------------------------------
 * NO ES CARA, Y EL MOTIVO IMPORTA
 *
 * `getDashboardCompras` está cacheada con la versión del pipeline en la clave
 * (ver lib/cache.ts), y estos parámetros NO llevan los filtros de la vista: es
 * la MISMA clave para todos los que armen una orden de ese proveedor en esa
 * corrida. Se paga una vez por proveedor por corrida, no una vez por click.
 *
 * El proveedor más grande (GLAM) tiene 973 artículos con stock, así que el
 * tope real de esta respuesta son unas mil filas.
 *
 * ---------------------------------------------------------------------------
 * SOLO CON UN PROVEEDOR ELEGIDO
 *
 * Sin proveedor esto pediría los ~8.200 artículos de todos, para armar una
 * orden que no existe: una orden es de un proveedor. Devuelve vacío y no
 * consulta nada.
 *
 * ---------------------------------------------------------------------------
 * LO QUE LLEGO VIENE ETIQUETADO CON LO QUE SE PIDIO
 *
 * El estado no se resetea al cambiar de proveedor: se guarda la respuesta con
 * la clave de la consulta que la trajo, y `cargando` es "lo que tengo no es de
 * lo que estoy pidiendo". Además de evitar el `setState` adentro del efecto
 * --que encadena renders-- cierra la ventana en la que las filas del proveedor
 * anterior pasarían por actuales: sin esto, cambiar de proveedor y apretar
 * "bajar" en ese instante bajaba la orden del proveedor de antes.
 */
export function useOrdenCompleta(parametros: {
  proveedor: string | null;
  ventana: number;
  cobertura: number;
  mes: string | undefined;
}): { filas: FilaCompra[]; cargando: boolean; error: string | null } {
  const { proveedor, ventana, cobertura, mes } = parametros;

  type Traido =
    | { clave: string; ok: true; filas: FilaCompra[] }
    | { clave: string; ok: false; error: string };

  const [traido, setTraido] = useState<Traido | null>(null);

  // Todo lo que cambia la respuesta entra en la clave. Si faltara algo --el
  // mes, por ejemplo-- la pantalla mostraría los sugeridos de otro mes como si
  // fueran los del elegido.
  const clave = proveedor
    ? `${proveedor}|${ventana}|${cobertura}|${mes ?? ""}`
    : "";

  useEffect(() => {
    if (!proveedor) return;

    const ac = new AbortController();
    const sp = new URLSearchParams();
    sp.set("proveedor", proveedor);
    sp.set("ventana", String(ventana));
    sp.set("cobertura", String(cobertura));
    if (mes) sp.set("mes", mes);
    // Sin `recortes`: la ruta trata la ausencia como "sin recortes", que es la
    // lista completa. Es a propósito -- ver el comentario en app/api/compras.

    fetch(`/api/compras?${sp.toString()}`, {
      signal: ac.signal,
      cache: "no-store",
    })
      .then(async (res) => {
        const cuerpo = await res.json().catch(() => null);
        if (!res.ok) throw new Error(cuerpo?.error ?? `Error ${res.status}`);
        return cuerpo as { filas?: FilaCompra[] };
      })
      .then((d) => {
        setTraido({
          clave,
          ok: true,
          filas: Array.isArray(d.filas) ? d.filas : [],
        });
      })
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setTraido({
          clave,
          ok: false,
          error: e instanceof Error ? e.message : "Error desconocido",
        });
      });

    return () => ac.abort();
  }, [clave, proveedor, ventana, cobertura, mes]);

  // Sólo sirve lo que corresponde a lo que se está pidiendo ahora.
  const mio = traido?.clave === clave ? traido : null;

  return {
    // Con la lista a medias se devuelve vacío a propósito: la pantalla bloquea
    // la descarga en vez de bajar un archivo incompleto.
    filas: mio?.ok ? mio.filas : [],
    cargando: proveedor !== null && mio === null,
    error: mio && !mio.ok ? mio.error : null,
  };
}
