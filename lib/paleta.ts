/** Paleta de gráficos: 6 colores que funcionan bien sobre fondo casi negro. */
export const PALETA = [
  "#3b82f6", // azul
  "#22c55e", // verde
  "#f59e0b", // ámbar
  "#a78bfa", // violeta
  "#22d3ee", // cian
  "#f472b6", // rosa
] as const;

export function colorSerie(indice: number): string {
  return PALETA[indice % PALETA.length];
}

/** Tokens del tema oscuro reutilizados por los gráficos (recharts pide hex/rgb). */
export const TEMA = {
  ink: "#e7e9ee",
  muted: "#8b93a1",
  line: "#242a33",
  panel: "#14171c",
  negativo: "#f43f5e",
} as const;
