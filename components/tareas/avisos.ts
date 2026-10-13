"use client";

/**
 * El aviso de "arrancá con esto": un sonido y una notificación del sistema.
 *
 * FUNCIONA CON EL TABLERO ABIERTO, aunque sea en otra pestaña o con la ventana
 * minimizada. Con el navegador cerrado no hay nada que avise: para eso harían
 * falta notificaciones push, que quedaron para una segunda etapa.
 *
 * EL SONIDO SE SINTETIZA, no es un archivo: tres notas cortas con Web Audio.
 * No hay nada que descargar ni que se pueda romper por una ruta mal puesta.
 *
 * Los navegadores no dejan sonar nada hasta que la persona tocó la página al
 * menos una vez (la política de autoplay). Por eso el contexto de audio se
 * crea y se "despierta" en el primer click, con `prepararAudio`.
 */

let contexto: AudioContext | null = null;

export function prepararAudio() {
  if (typeof window === "undefined") return;
  if (!contexto) {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    contexto = new Ctor();
  }
  if (contexto.state === "suspended") void contexto.resume();
}

/** Tres notas ascendentes (do–mi–sol), suaves: llama la atención sin asustar. */
export function sonarAviso() {
  prepararAudio();
  const ctx = contexto;
  if (!ctx) return;

  const notas = [523.25, 659.25, 783.99];
  const t0 = ctx.currentTime + 0.02;
  // Dos veces la secuencia, por si la primera se la pierde quien está en otra cosa.
  for (const repeticion of [0, 1]) {
    notas.forEach((frecuencia, i) => {
      const inicio = t0 + repeticion * 0.9 + i * 0.16;
      const osc = ctx.createOscillator();
      const vol = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = frecuencia;
      vol.gain.setValueAtTime(0.0001, inicio);
      vol.gain.exponentialRampToValueAtTime(0.25, inicio + 0.02);
      vol.gain.exponentialRampToValueAtTime(0.0001, inicio + 0.45);
      osc.connect(vol).connect(ctx.destination);
      osc.start(inicio);
      osc.stop(inicio + 0.5);
    });
  }
}

export type PermisoNotificaciones = NotificationPermission | "no-soportado";

export function permisoNotificaciones(): PermisoNotificaciones {
  if (typeof window === "undefined" || !("Notification" in window)) return "no-soportado";
  return Notification.permission;
}

export async function pedirPermisoNotificaciones(): Promise<PermisoNotificaciones> {
  if (permisoNotificaciones() === "no-soportado") return "no-soportado";
  return Notification.requestPermission();
}

/** La notificación del sistema. Si no hay permiso, no hace nada: queda el cartel en pantalla. */
export function notificar(titulo: string, cuerpo: string, etiqueta: string) {
  if (permisoNotificaciones() !== "granted") return;
  try {
    const n = new Notification(titulo, {
      body: cuerpo,
      tag: etiqueta,
      icon: "/apple-icon.png",
      requireInteraction: true,
    });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {
    // Algunos navegadores móviles sólo permiten notificar desde un service
    // worker y tiran acá. El cartel en pantalla avisa igual.
  }
}

// ---------------------------------------------------------------------------
//  Qué ya se avisó
// ---------------------------------------------------------------------------
//
// En localStorage para que recargar la página no vuelva a sonar lo que ya
// sonó. La clave lleva la hora de inicio: si la tarea se reprograma, es un
// aviso nuevo.

const CLAVE = "tareas-avisadas";

export function leerAvisadas(): Set<string> {
  try {
    const crudo = window.localStorage.getItem(CLAVE);
    return new Set(crudo ? (JSON.parse(crudo) as string[]) : []);
  } catch {
    return new Set();
  }
}

export function guardarAvisadas(avisadas: Set<string>) {
  try {
    // Sólo las últimas 300: alcanza de sobra para no repetir y no crece sin fin.
    window.localStorage.setItem(CLAVE, JSON.stringify([...avisadas].slice(-300)));
  } catch {
    // Modo privado o almacenamiento bloqueado: a lo sumo se repite un aviso.
  }
}
