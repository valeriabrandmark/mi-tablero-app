import { register } from "node:module";

/** Engancha el resolutor del alias antes de que se cargue la prueba. */
register("./alias.mjs", import.meta.url);
