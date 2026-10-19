"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { firmaDeLasDecisiones, type RenglonOrden } from "@/lib/compras";

/**
 * El borrador de la orden de compra: se guarda solo, se retoma solo y se puede
 * descartar.
 *
 * ---------------------------------------------------------------------------
 * SE GUARDA SOLO, NO CON UN BOTON
 *
 * Un botón de "guardar borrador" lo olvida justo la persona que está por
 * perder el trabajo -- que es el único caso que importa. Se guarda con un
 * retardo después de cada cambio, y la pantalla dice cuándo lo hizo para que
 * no haya que confiar a ciegas.
 *
 * ---------------------------------------------------------------------------
 * SE RETOMA SOLO, Y NO PREGUNTA
 *
 * "¿Querés retomar el borrador?" es una oportunidad más de decir que no sin
 * querer, que es exactamente el accidente que esto viene a evitar. Se retoma y
 * se avisa, con el botón de descartar al lado.
 *
 * ---------------------------------------------------------------------------
 * LO QUE VUELVE SE FUSIONA, NO PISA
 *
 * El borrador llega de la base y puede tardar; la tabla ya se puede estar
 * usando. Si al llegar reemplazara las ediciones, una cantidad cargada en esos
 * segundos desaparecería -- y sería culpa de la función que existe para que
 * nada se pierda. Lo que está en pantalla gana siempre.
 *
 * ---------------------------------------------------------------------------
 * LA FOTO DE SUGERIDOS DEL BORRADOR QUE SE ABRIO NO SE TOCA
 *
 * `fotoAlAbrir` se lee una vez, al retomar, y queda fija hasta que se descarte
 * la orden o se recargue la página. Es contra esa foto que se dice "estas
 * cantidades se recalcularon, revisar".
 *
 * Y HAY UNA RAZON CONCRETA PARA QUE SEA FIJA: el guardado automático escribe
 * una foto nueva cada vez. Si el aviso comparara contra la última guardada, al
 * segundo y medio de retomar un borrador el aviso se borraría solo -- antes de
 * que nadie lo haya leído. Lo que la base guarda y lo que el aviso compara son
 * dos cosas distintas a propósito.
 */

/** Cuánto se espera después del último cambio antes de guardar. */
const ESPERA_MS = 1500;

export type EstadoBorrador =
  | "inactivo"
  | "cargando"
  | "limpio"
  | "guardando"
  | "guardado"
  | "error";

export type ResumenBorrador = {
  estado: EstadoBorrador;
  /**
   * Cuándo se guardó el borrador que se retomó, mientras no se haya guardado
   * encima en esta sesión. `null` si no se retomó ninguno.
   */
  retomadoDe: string | null;
  /**
   * Hay cambios que todavía no llegaron a la base.
   *
   * Lo lee el cartel de salir: avisar con el borrador ya guardado sería pedir
   * confirmación para no perder nada, que es como se enseña a apretar Aceptar
   * sin leer.
   */
  sinGuardar: boolean;
  /**
   * Los sugeridos tal como estaban en el borrador que se abrió.
   *
   * El borrador guarda decisiones, no la orden: todo lo que nadie tocó se
   * recalcula al abrir. Eso es lo correcto --un borrador del viernes tiene que
   * mostrar los números del lunes-- pero significa que la orden puede cambiar
   * sola entre que se guarda y se abre, porque el pipeline corre cada hora y
   * media. Con esta foto, `queSeRecalculo` puede decir CUALES cambiaron.
   */
  sugeridosGuardados: Record<string, number>;
  /** Lo tira. Lo llama el botón de descartar y también el envío de la orden. */
  descartar: () => void;
};

type Args = {
  /** La orden es de UN proveedor. Sin uno elegido no hay borrador que guardar. */
  proveedor: string | null;
  ediciones: Map<string, RenglonOrden>;
  setEdiciones: Dispatch<SetStateAction<Map<string, RenglonOrden>>>;
  nota: string;
  setNota: Dispatch<SetStateAction<string>>;
  mes: string | null;
  ventana: number | null;
  cobertura: number | null;
  /** El sugerido de hoy de cada SKU del proveedor, para la foto que se guarda. */
  sugeridosDeHoy: Map<string, number>;
  /**
   * Si `sugeridosDeHoy` ya es la lista completa del proveedor.
   *
   * GUARDAR ANTES SERIA GUARDAR UNA FOTO A MEDIAS: la comparación de la próxima
   * vez diría que se recalculó todo lo que no estaba a la vista.
   */
  listo: boolean;
};

/**
 * Lo que se sabe del borrador de un proveedor, todo junto y etiquetado con el
 * proveedor al que corresponde.
 *
 * VA ETIQUETADO Y NO SE RESETEA al cambiar de proveedor. Además de evitar el
 * `setState` adentro del efecto --que encadena renders-- cierra la ventana en
 * la que el borrador de un proveedor pasaría por el de otro.
 */
type Sesion = {
  proveedor: string;
  /** Si se pudo leer. Con `false` la pantalla sigue andando, sin borrador. */
  ok: boolean;
  /** La firma de las decisiones que la base tiene guardadas ahora. */
  firmaEnLaBase: string | null;
  /** La fecha del borrador que se encontró al abrir. */
  retomadoDe: string | null;
  /** La foto de sugeridos de ese borrador. Fija: ver el encabezado. */
  fotoAlAbrir: Record<string, number>;
  /** Si en esta sesión ya se guardó encima. */
  guardadoAhora: boolean;
};

export function useBorradorOrden({
  proveedor,
  ediciones,
  setEdiciones,
  nota,
  setNota,
  mes,
  ventana,
  cobertura,
  sugeridosDeHoy,
  listo,
}: Args): ResumenBorrador {
  const [sesion, setSesion] = useState<Sesion | null>(null);
  const [guardando, setGuardando] = useState(false);
  /** El proveedor en el que falló el último guardado, o `null`. */
  const [fallo, setFallo] = useState<string | null>(null);

  const firma = useMemo(
    () => firmaDeLasDecisiones(proveedor, nota, ediciones),
    [proveedor, nota, ediciones],
  );

  // --- Retomar -------------------------------------------------------------
  useEffect(() => {
    if (!proveedor) return;
    if (sesion?.proveedor === proveedor) return;

    let cancelado = false;

    fetch(`/api/compras/borrador?proveedor=${encodeURIComponent(proveedor)}`, {
      cache: "no-store",
    })
      .then((r) =>
        r.ok ? r.json() : Promise.reject(new Error(String(r.status))),
      )
      .then((d: { borrador?: BorradorApi | null }) => {
        if (cancelado) return;
        const b = d?.borrador ?? null;

        if (!b) {
          setSesion({
            proveedor,
            ok: true,
            firmaEnLaBase: null,
            retomadoDe: null,
            fotoAlAbrir: {},
            guardadoAhora: false,
          });
          return;
        }

        const vuelta = new Map<string, RenglonOrden>();
        for (const [sku, r] of Object.entries(b.renglones ?? {})) {
          vuelta.set(sku, {
            unidad: r.unidad === "bulto" ? "bulto" : "unidad",
            cantidad: Number(r.cantidad) || 0,
            descuento: Number(r.descuento) || 0,
            descuento2: Number(r.descuento2) || 0,
          });
        }

        setSesion({
          proveedor,
          ok: true,
          // La firma de lo que la base tiene, con la MISMA cuenta que usa la
          // pantalla: si coinciden, no hay nada que guardar y el guardado
          // automático no se dispara al abrir. Si la fusión de abajo cambia
          // algo --porque se cargó una cantidad mientras esto viajaba-- las
          // firmas difieren y se guarda, que es lo correcto.
          firmaEnLaBase: firmaDeLasDecisiones(proveedor, b.nota ?? "", vuelta),
          retomadoDe: b.actualizadoEn,
          fotoAlAbrir: b.sugeridos ?? {},
          guardadoAhora: false,
        });

        // LO DE LA PANTALLA GANA. Ver arriba: el borrador llega tarde y entre
        // medio se pudo haber cargado algo.
        setEdiciones((enPantalla) => {
          const mezcla = new Map(vuelta);
          for (const [sku, r] of enPantalla) mezcla.set(sku, r);
          return mezcla;
        });
        // La nota sólo si no se escribió otra, por lo mismo.
        const guardada = b.nota;
        if (guardada) setNota((actual) => (actual === "" ? guardada : actual));
      })
      .catch(() => {
        if (cancelado) return;
        // Que no se pueda leer el borrador NO puede frenar la pantalla: se
        // sigue trabajando sin él, que es como se trabajaba antes.
        setSesion({
          proveedor,
          ok: false,
          firmaEnLaBase: null,
          retomadoDe: null,
          fotoAlAbrir: {},
          guardadoAhora: false,
        });
      });

    return () => {
      cancelado = true;
    };
  }, [proveedor, sesion, setEdiciones, setNota]);

  // --- Lo que hay, derivado ------------------------------------------------
  //
  // Nada de esto se guarda aparte: se lee de lo que contestó la base y de lo
  // que hay en pantalla.
  const mia = sesion?.proveedor === proveedor ? sesion : null;

  /**
   * Si hay una fila guardada para este proveedor.
   *
   * Es lo que evita crear un borrador vacío por cada proveedor en el que
   * alguien hace click sin tocar nada: sin fila y sin ediciones no hay nada que
   * guardar. Con fila sí, porque vaciar la orden también es una decisión.
   */
  const hayFila = mia?.ok === true && mia.firmaEnLaBase !== null;

  const hayQueGuardar = ediciones.size > 0 || nota !== "" || hayFila;
  const sinGuardar =
    proveedor !== null &&
    mia?.ok === true &&
    hayQueGuardar &&
    mia.firmaEnLaBase !== firma;

  // --- Guardar -------------------------------------------------------------
  useEffect(() => {
    // Sin la lista completa del proveedor la foto de sugeridos saldría a
    // medias. Ver `listo`.
    if (!proveedor || !listo || !sinGuardar) return;

    const t = setTimeout(() => {
      setGuardando(true);
      const foto = Object.fromEntries(sugeridosDeHoy);
      fetch("/api/compras/borrador", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          proveedor,
          mes,
          ventana,
          cobertura,
          nota,
          renglones: Object.fromEntries(ediciones),
          sugeridos: foto,
        }),
      })
        .then((r) => {
          if (!r.ok) throw new Error(String(r.status));
          setFallo(null);
          // Se mueve la firma, NO la foto: la foto que compara el aviso es la
          // del borrador que se abrió. Ver el encabezado.
          setSesion((actual) =>
            actual?.proveedor === proveedor
              ? { ...actual, firmaEnLaBase: firma, guardadoAhora: true }
              : actual,
          );
        })
        .catch(() => setFallo(proveedor))
        .finally(() => setGuardando(false));
    }, ESPERA_MS);

    return () => clearTimeout(t);
    // `sugeridosDeHoy` queda afuera a propósito: cambia de identidad en cada
    // carga de datos y volvería a guardar sin que nadie haya tocado nada.
    // Cuando sí se guarda, el efecto se rearmó con la firma nueva, así que la
    // foto que se manda es la de ese momento.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proveedor, listo, sinGuardar, firma, ediciones, nota, mes, ventana, cobertura]);

  // --- Descartar -----------------------------------------------------------
  const descartar = useCallback(() => {
    if (!proveedor) return;
    setEdiciones(new Map());
    setNota("");
    setFallo(null);
    // Se deja constancia de que para este proveedor ya no hay fila: sin esto,
    // `hayFila` seguiría viendo el borrador que se leyó y el guardado
    // automático volvería a escribirlo vacío.
    setSesion({
      proveedor,
      ok: true,
      firmaEnLaBase: null,
      retomadoDe: null,
      fotoAlAbrir: {},
      guardadoAhora: false,
    });
    fetch(`/api/compras/borrador?proveedor=${encodeURIComponent(proveedor)}`, {
      method: "DELETE",
    }).catch(() => {
      // Si el borrado falla la pantalla ya quedó limpia y no se va a volver a
      // escribir. La fila que quedó vence en tres días.
    });
  }, [proveedor, setEdiciones, setNota]);

  const estado: EstadoBorrador = !proveedor
    ? "inactivo"
    : mia === null
      ? "cargando"
      : !mia.ok || fallo === proveedor
        ? "error"
        : guardando || sinGuardar
          ? "guardando"
          : hayFila
            ? "guardado"
            : "limpio";

  return {
    estado,
    retomadoDe: mia && !mia.guardadoAhora ? mia.retomadoDe : null,
    sinGuardar,
    sugeridosGuardados: mia?.fotoAlAbrir ?? {},
    descartar,
  };
}

type BorradorApi = {
  actualizadoEn: string;
  nota: string | null;
  renglones: Record<
    string,
    { unidad: string; cantidad: number; descuento: number; descuento2: number }
  >;
  sugeridos: Record<string, number>;
};
