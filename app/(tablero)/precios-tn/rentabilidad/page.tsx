import DashboardRentabilidad from "@/components/DashboardRentabilidad";

export const dynamic = "force-dynamic";

export const metadata = { title: "Rentabilidad por proveedor — Tablero Brandmark" };

/**
 * Rentabilidad y markup por proveedor.
 *
 * QUÉ CONTESTA. Compras pregunta cuánto markup ponerle a cada proveedor; la
 * objeción es que sin precio competitivo no se vende. Esta pantalla pone los
 * dos números uno al lado del otro —el markup que hace falta y el que permite
 * el mercado— para que la discusión deje de ser de opiniones.
 *
 * SÓLO LEE. No aprueba ni escribe nada: es la misma corrida que mira el
 * comparador, agrupada por proveedor.
 *
 * VIVE BAJO `/precios-tn/` A PROPÓSITO, y no es sólo prolijidad de rutas:
 * `esDePreciosTn` en lib/permisos.ts cubre todo lo que empieza con ese prefijo,
 * así que hereda el permiso del módulo —`superadmin` y `admin_tn`— sin agregar
 * una regla nueva. Una página de costos y márgenes por proveedor no tiene que
 * verla todo el que ve el resto del tablero.
 *
 * Sin guarda en este archivo, igual que la página del comparador: el permiso lo
 * resuelve el middleware antes de que esto se ejecute, y una segunda
 * comprobación acá sólo agregaría un lugar más donde la regla puede quedar
 * desincronizada.
 */
export default function RentabilidadPage() {
  return <DashboardRentabilidad />;
}
