/**
 * Variables públicas de Supabase Auth. Se leen literalmente (sin destructuring
 * dinámico) porque Next reemplaza `process.env.NEXT_PUBLIC_*` en tiempo de build.
 */
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

/** `false` si todavía no se cargaron las variables de Supabase Auth. */
export const authConfigurada = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
