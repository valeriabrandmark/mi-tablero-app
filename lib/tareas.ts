/**
 * "Mis tareas": el menú donde cada rol tiene lo que tiene que HACER, separado
 * de los tableros, que son para mirar.
 *
 * Una página por rol bajo `/tareas/<rol>`, con el mismo esquema en todas: la
 * rutina arriba y las alertas para contestar abajo. Es el mismo criterio que
 * Objetivos, que tiene una página por vendedor para poder dar permiso sobre una
 * sola.
 *
 * Para sumar un rol: una entrada acá, su página en app/(tablero)/tareas/<slug>,
 * y su regla en `puedeVer` (lib/permisos.ts). El menú y la redirección de
 * `/tareas` salen de esta lista solos.
 */
export const RAIZ_TAREAS = "/tareas";

export const PAGINAS_TAREAS = [
  // `icono` es la clave del ícono de la barra lateral (ClaveIcono en
  // components/BarraLateral.tsx): la marca del canal, como en los tableros.
  {
    slug: "mercado-libre",
    label: "Mercado Libre",
    href: `${RAIZ_TAREAS}/mercado-libre`,
    icono: "mercadolibre",
  },
] as const;
