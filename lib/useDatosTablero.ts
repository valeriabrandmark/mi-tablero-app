"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Trae los datos de una página del tablero y maneja carga / error / recarga.
 * Serializa los filtros a query string y usa ese string como dependencia del
 * efecto, así no importa que el objeto de filtros cambie de identidad.
 */
export function useDatosTablero<T>(
  base: string,
  filtros: Record<string, string | string[] | undefined>,
  extras: Record<string, string> = {},
) {
  const router = useRouter();
  const [data, setData] = useState<T | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [recargas, setRecargas] = useState(0);

  // Se serializan primero para que el efecto dependa del CONTENIDO de los
  // filtros y no de la identidad del objeto, que cambia en cada render.
  const filtrosKey = JSON.stringify(filtros);
  const extrasKey = JSON.stringify(extras);

  const qs = useMemo(() => {
    const sp = new URLSearchParams();
    const todo: Record<string, string | string[] | undefined> = {
      ...JSON.parse(filtrosKey),
      ...JSON.parse(extrasKey),
    };
    // Los filtros múltiples viajan como parámetros repetidos (?sku=A&sku=B):
    // los nombres de cliente y de producto traen comas, así que cualquier
    // separador partiría un valor al medio.
    for (const [k, v] of Object.entries(todo)) {
      if (Array.isArray(v)) {
        for (const uno of v) if (uno) sp.append(k, uno);
      } else if (v) {
        sp.set(k, v);
      }
    }
    return sp.toString();
  }, [filtrosKey, extrasKey]);

  useEffect(() => {
    const ac = new AbortController();

    fetch(`${base}${qs ? `?${qs}` : ""}`, { signal: ac.signal, cache: "no-store" })
      .then(async (res) => {
        if (res.status === 401) {
          router.replace("/login");
          return null;
        }
        const cuerpo = await res.json().catch(() => null);
        if (!res.ok) throw new Error(cuerpo?.error ?? `Error ${res.status}`);
        return cuerpo as T;
      })
      .then((d) => {
        if (d) setData(d);
        setCargando(false);
      })
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setError(e instanceof Error ? e.message : "Error desconocido");
        setCargando(false);
      });

    return () => ac.abort();
  }, [base, qs, recargas, router]);

  /** Marca "cargando" desde el handler: hacerlo dentro del efecto encadena renders. */
  const empezarCarga = useCallback(() => {
    setCargando(true);
    setError(null);
  }, []);

  const recargar = useCallback(() => {
    empezarCarga();
    setRecargas((n) => n + 1);
  }, [empezarCarga]);

  return { data, cargando, error, recargar, empezarCarga };
}
