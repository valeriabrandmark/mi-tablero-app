import { VENDEDORES_OBJETIVOS, type VendedorObjetivos } from "@/lib/constantes";
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
  vendedoresObjetivos?: unknown;
};

/**
 * DE QUE VENDEDORES VE LOS OBJETIVOS, leído del claim.
 *
 * Hasta el 12/11/2026 el módulo Objetivos era una sola casilla y abría las
 * páginas de los cuatro vendedores. Ahora se elige vendedor por vendedor, y la
 * lista se guarda en `vendedores_objetivos`.
 *
 * SIN LISTA SON LOS CUATRO, a propósito: es el claim de quien tenía la casilla
 * antes de que existiera la lista (eran tres personas). Leerlo como "ninguno"
 * los dejaba sin objetivos el día del despliegue sin que nadie lo decidiera.
 * Con una lista guardada --aunque sea vacía-- vale la lista.
 */
export function vendedoresObjetivosDel(valor: unknown): VendedorObjetivos[] {
  if (!Array.isArray(valor)) return [...VENDEDORES_OBJETIVOS];
  const pedidos = valor
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim().toUpperCase());
  // En el orden de VENDEDORES_OBJETIVOS, que es el de las pestañas.
  return VENDEDORES_OBJETIVOS.filter((v) => pedidos.includes(v));
}

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
  /** Vacía si no tiene el módulo Objetivos. Ver `vendedoresObjetivosDel`. */
  vendedores_objetivos: VendedorObjetivos[];
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
  // LOS VENDEDORES SE MANDAN SIEMPRE EXPLICITOS desde el panel. Si no vino la
  // lista se toma vacía, no "los cuatro": lo de "sin lista son los cuatro" es
  // para leer claims viejos, no para escribir uno nuevo sin haber elegido.
  const vendedores = Array.isArray(cuerpo.vendedoresObjetivos)
    ? vendedoresObjetivosDel(cuerpo.vendedoresObjetivos)
    : [];
  // Objetivos sin ningún vendedor no abre ninguna página: se saca el módulo,
  // para que no aparezca en el menú una entrada que lleva a un 403. La ruta
  // de usuarios avisa antes de guardar (ver `faltaVendedorObjetivos`).
  const ve = modulosValidos(cuerpo.modulos).filter(
    (m) => m !== "objetivos" || vendedores.length > 0,
  );
  const edita = modulosValidos(cuerpo.editar).filter((m) => ve.includes(m));
  const firma = necesitaUsuarioSigma(edita);
  return {
    rol: "personalizado",
    modulos: ve,
    editar: edita,
    sigma: firma ? numeroPositivo(cuerpo.sigma) : null,
    nombre_sigma: firma ? textoNoVacio(cuerpo.nombreSigma) : null,
    vendedores_objetivos: ve.includes("objetivos") ? vendedores : [],
  };
}

/**
 * `true` si marcaron Objetivos sin elegir ningún vendedor. La ruta lo frena con
 * un mensaje en vez de guardar el permiso sin el módulo, que se vería como que
 * la casilla "no se guardó".
 */
export function faltaVendedorObjetivos(cuerpo: CuerpoUsuario): boolean {
  return (
    modulosValidos(cuerpo.modulos).includes("objetivos") &&
    claimDeUsuario(cuerpo).vendedores_objetivos.length === 0
  );
}
