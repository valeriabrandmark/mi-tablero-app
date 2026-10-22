import { esModulo, necesitaUsuarioSigma, type ClaveModulo } from "@/lib/modulos";

/**
 * EL PERMISO TAL COMO SE GUARDA, armado de lo que mandó el navegador.
 *
 * ---------------------------------------------------------------------------
 * POR QUE VIVE ACA Y NO EN LA RUTA
 *
 * Porque se equivocó dos veces seguidas y en la ruta no se podía probar: un
 * `route.ts` de Next sólo puede exportar sus handlers, así que una función
 * adentro no se puede importar desde una prueba.
 *
 * Las dos veces fue lo mismo. El número de usuario de Sigma se guardaba sólo
 * si estaba marcado `compras`, con la clave escrita a mano. Cuando la carga de
 * facturas pasó a ser su propio módulo --y también firma en Sigma-- quedaron
 * tres lugares con esa condición: el campo del panel, la validación de la
 * ruta, y ESTE. Se arreglaron los dos primeros y éste no, y el resultado fue
 * el peor de los tres: el panel pedía el número, la persona lo escribía, acá
 * se tiraba a la basura, y la validación contestaba "hace falta el número de
 * usuario de Sigma". Un error imposible de obedecer.
 *
 * Ahora la condición es una sola --`necesitaUsuarioSigma`, que sale de lo que
 * declara cada módulo-- y esta función tiene pruebas.
 */

export type CuerpoUsuario = {
  email?: unknown;
  id?: unknown;
  nombre?: unknown;
  modulos?: unknown;
  editar?: unknown;
  sigma?: unknown;
  nombreSigma?: unknown;
};

/** Las claves de módulo válidas de lo que haya mandado el navegador. */
export function modulosValidos(valor: unknown): ClaveModulo[] {
  return Array.isArray(valor) ? valor.filter(esModulo) : [];
}

export function numeroPositivo(valor: unknown): number | null {
  const n = Number(valor);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function textoNoVacio(valor: unknown): string | null {
  return typeof valor === "string" && valor.trim() !== "" ? valor.trim() : null;
}

export type ClaimUsuario = {
  rol: "personalizado";
  modulos: ClaveModulo[];
  editar: ClaveModulo[];
  sigma: number | null;
  nombre_sigma: string | null;
};

/**
 * `editar` se recorta contra `modulos` acá TAMBIÉN —aunque `permisoDelUsuario`
 * lo vuelve a hacer al leer— para que lo guardado no diga una cosa y lo
 * aplicado otra: mirar el usuario en Supabase tiene que alcanzar para saber
 * qué puede hacer.
 *
 * EL NUMERO DE SIGMA SE GUARDA SI ALGUN MODULO LO NECESITA, y se descarta si
 * ninguno: un número colgado de un permiso que no escribe en el ERP no se usa
 * para nada y lo único que hace es confundir al que lo lee.
 */
export function claimDeUsuario(cuerpo: CuerpoUsuario): ClaimUsuario {
  const ve = modulosValidos(cuerpo.modulos);
  const edita = modulosValidos(cuerpo.editar).filter((m) => ve.includes(m));
  const firma = necesitaUsuarioSigma(edita);
  return {
    rol: "personalizado",
    modulos: ve,
    editar: edita,
    sigma: firma ? numeroPositivo(cuerpo.sigma) : null,
    nombre_sigma: firma ? textoNoVacio(cuerpo.nombreSigma) : null,
  };
}
