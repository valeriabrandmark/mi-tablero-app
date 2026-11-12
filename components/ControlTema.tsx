"use client";

import { useEffect, useSyncExternalStore } from "react";
import {
  ATRIBUTO_TEMA,
  CLAVE_TEMA,
  ETIQUETA,
  TEMA_POR_DEFECTO,
  atributosDeTema,
  temaGuardado,
  type Tema,
} from "@/lib/tema";

const OPCIONES: Tema[] = ["oscuro", "claro"];

/** El aviso de que lo cambiamos NOSOTROS. `storage` sólo avisa a las OTRAS pestañas. */
const EVENTO = "tablero-tema-cambio";

function leerDelNavegador(): Tema {
  try {
    return temaGuardado(localStorage.getItem(CLAVE_TEMA));
  } catch {
    // Modo incógnito o cookies bloqueadas: el default, que es lo que ya está
    // pintado.
    return TEMA_POR_DEFECTO;
  }
}

/** En el servidor no hay navegador: el default, el mismo que dibuja el CSS. */
function leerEnElServidor(): Tema {
  return TEMA_POR_DEFECTO;
}

function suscribir(avisar: () => void): () => void {
  window.addEventListener(EVENTO, avisar);
  // Y si lo cambian en OTRA pestaña, este botón se entera. Son dos pestañas del
  // mismo tablero y el tema es uno solo: dejarlas discrepando haría dudar de
  // cuál es el bueno.
  window.addEventListener("storage", avisar);
  return () => {
    window.removeEventListener(EVENTO, avisar);
    window.removeEventListener("storage", avisar);
  };
}

/**
 * El interruptor del tema, para "Mi cuenta".
 *
 * ---------------------------------------------------------------------------
 * EL TEMA VIVE EN `localStorage`, NO EN ESTADO DE REACT
 *
 * Por eso `useSyncExternalStore` y no un `useState` sembrado desde un efecto.
 * El servidor no puede saber qué tema tiene esta persona --está en el
 * navegador-- así que el primer dibujo tiene que ser el default en los dos
 * lados o React avisa que no coinciden. `useSyncExternalStore` es exactamente
 * eso: un valor para el servidor, otro para el cliente, y React acomoda la
 * diferencia sin pelear.
 *
 * De paso sale gratis que dos pestañas abiertas se mantengan iguales.
 *
 * ESO NO PRODUCE UN FOGONAZO. La página ya viene pintada del color correcto
 * desde antes del primer pintado, porque el script del layout escribió el
 * atributo en `<html>`. Lo único que se acomoda acá es cuál de los dos botones
 * se ve elegido.
 *
 * ---------------------------------------------------------------------------
 * EL `<html>` SE TOCA EN UN EFECTO, Y A MANO
 *
 * A mano porque el `<html>` lo dibuja el layout del servidor: pasarlo por React
 * obligaría a hacer cliente toda la raíz del tablero para una preferencia de
 * color. Y en un efecto porque es justo para lo que están --llevar el estado de
 * React a un sistema externo, que acá es el documento--, no para calcular nada.
 */
export default function ControlTema() {
  const tema = useSyncExternalStore(suscribir, leerDelNavegador, leerEnElServidor);

  useEffect(() => {
    const { atributo, colorScheme } = atributosDeTema(tema);
    const html = document.documentElement;
    if (atributo) html.dataset[ATRIBUTO_TEMA] = atributo;
    else delete html.dataset[ATRIBUTO_TEMA];
    html.style.colorScheme = colorScheme;
  }, [tema]);

  const elegir = (nuevo: Tema) => {
    try {
      localStorage.setItem(CLAVE_TEMA, nuevo);
    } catch {
      // Si no se puede guardar, igual cambia en esta pestaña: el evento se
      // dispara lo mismo. Vuelve al default al recargar, y es mejor que no
      // dejarlo cambiar.
    }
    window.dispatchEvent(new Event(EVENTO));
  };

  return (
    <div>
      <div
        className="border-line inline-flex rounded-lg border p-0.5"
        role="group"
        aria-label="Tema del tablero"
      >
        {OPCIONES.map((op) => (
          <button
            key={op}
            type="button"
            aria-pressed={tema === op}
            onClick={() => elegir(op)}
            className={`rounded-md px-3 py-1.5 text-xs transition-colors ${
              tema === op ? "bg-panel-2 text-ink" : "text-muted hover:text-ink"
            }`}
          >
            {ETIQUETA[op]}
          </button>
        ))}
      </div>
      <p className="text-muted mt-2 text-[11px] leading-relaxed">
        Queda guardado en este navegador, no en tu usuario: si entrás desde otra
        computadora, arranca en oscuro.
      </p>
    </div>
  );
}
