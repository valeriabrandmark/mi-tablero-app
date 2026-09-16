import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Resuelve el alias `@/` de TypeScript para que Node pueda importar los
 * módulos del tablero tal como están escritos.
 *
 * POR QUÉ HACE FALTA. `tsconfig.json` mapea `@/lib/permisos` a la raíz del
 * proyecto, pero eso lo entienden TypeScript y el bundler de Next, no Node.
 * Sin esto, probar una función que importa `@/lib/constantes` obligaría a
 * reescribir los imports del código real —o a copiarlo a un lado, que es
 * probar otra cosa parecida y no lo que se despliega—.
 *
 * También completa la extensión: el código escribe `@/lib/modulos` sin `.ts`,
 * que es lo normal en TypeScript y lo que Node no hace solo.
 */
const RAIZ = new URL("../", import.meta.url);

export function resolve(especificador, contexto, siguiente) {
  if (!especificador.startsWith("@/")) return siguiente(especificador, contexto);

  const base = new URL(especificador.slice(2), RAIZ);
  for (const url of [base, new URL(base.href + ".ts"), new URL(base.href + ".tsx")]) {
    if (existsSync(fileURLToPath(url))) return siguiente(url.href, contexto);
  }
  return siguiente(base.href, contexto);
}
