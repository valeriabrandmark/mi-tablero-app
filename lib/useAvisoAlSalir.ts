"use client";

import { useEffect } from "react";

/**
 * Pide confirmación antes de salir de la página si hay trabajo sin guardar.
 *
 * ---------------------------------------------------------------------------
 * POR QUE EXISTE
 *
 * El encargado de compras estaba armando una orden, le dio sin querer a
 * recargar y perdió todo lo que llevaba cargado. La orden se arma en la
 * pantalla y no existe en ningún lado hasta que se baja el archivo, así que un
 * F5 la borra sin preguntar.
 *
 * ---------------------------------------------------------------------------
 * LO QUE ESTO **NO** CUBRE, Y HAY QUE SABERLO
 *
 * `beforeunload` lo dispara el navegador y sólo en algunos casos. Esto avisa
 * cuando se recarga, se cierra la pestaña o se escribe otra dirección. NO
 * avisa cuando:
 *
 *   - se cierra la notebook, se corta la luz o el navegador se cae;
 *   - vence la sesión;
 *   - se navega a otro tablero DESDE EL MENU, porque eso no recarga la
 *     página: Next cambia la vista sin pasar por el navegador.
 *
 * Ese último es el más probable de los tres y es el que esta función no puede
 * tapar: el App Router no tiene una forma estable de frenar una navegación
 * interna. O sea que esto es una red para el accidente concreto que pasó, no
 * una garantía de que el trabajo no se pierda. Lo que da esa garantía es
 * guardar el borrador, que es otra cosa y es más grande.
 *
 * ---------------------------------------------------------------------------
 * EL TEXTO LO PONE EL NAVEGADOR
 *
 * Desde 2016 Chrome, Firefox y Safari ignoran el mensaje que uno escriba y
 * muestran el suyo ("¿Salir del sitio?"). Era un agujero: una página podía
 * poner "Error del sistema, no cierre" y asustar. Por eso acá no se pasa
 * ningún texto -- no serviría de nada.
 */
export function useAvisoAlSalir(hayCambios: boolean): void {
  useEffect(() => {
    if (!hayCambios) return;

    const alSalir = (e: BeforeUnloadEvent) => {
      // Las dos formas: `preventDefault` es la del estándar de hoy y
      // `returnValue` la que todavía piden los navegadores viejos. Poner sólo
      // una deja el aviso sin salir en alguno de los dos.
      e.preventDefault();
      e.returnValue = "";
    };

    window.addEventListener("beforeunload", alSalir);
    return () => window.removeEventListener("beforeunload", alSalir);
  }, [hayCambios]);
}
