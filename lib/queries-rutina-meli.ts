import { query } from "@/lib/db";
import {
  hoyAR,
  sumarDias,
  type DashboardRutinaMeli,
  type EstadoRutina,
  type MarcaRutina,
} from "@/lib/rutina-meli";

/**
 * Consultas de la rutina de "Mis tareas". Reglas en lib/rutina-meli.ts, tabla
 * en migraciones/tareas_meli_rutina.sql.
 */

/**
 * Los casilleros marcados de una semana.
 *
 * En un try por lo mismo que las respuestas a alertas: si la migración todavía
 * no se aplicó, la planilla se ve vacía y avisa, en vez de tumbar la pantalla.
 */
export async function getRutinaMeli(lunes: string): Promise<DashboardRutinaMeli> {
  const hoy = hoyAR();
  try {
    const filas = await query<Record<string, unknown>>(
      `select to_char(fecha, 'YYYY-MM-DD') as fecha, tarea, vez, estado, nota, usuario,
              to_char(actualizado_en at time zone 'America/Argentina/Buenos_Aires',
                      'YYYY-MM-DD"T"HH24:MI') as actualizado_en
       from app.tareas_meli_rutina
       where fecha between $1::date and $2::date`,
      [lunes, sumarDias(lunes, 6)],
    );
    const marcas: MarcaRutina[] = filas.map((r) => ({
      fecha: r.fecha as string,
      tarea: r.tarea as string,
      vez: Number(r.vez),
      estado: r.estado as EstadoRutina,
      nota: (r.nota as string | null) ?? null,
      usuario: r.usuario as string,
      actualizadoEn: r.actualizado_en as string,
    }));
    return { lunes, hoy, marcas, disponible: true };
  } catch {
    return { lunes, hoy, marcas: [], disponible: false };
  }
}

export async function marcarRutina(m: {
  fecha: string;
  tarea: string;
  vez: number;
  estado: EstadoRutina;
  nota: string | null;
  usuario: string;
}): Promise<void> {
  await query(
    `insert into app.tareas_meli_rutina (fecha, tarea, vez, estado, nota, usuario)
     values ($1::date, $2, $3, $4, $5, $6)
     on conflict (fecha, tarea, vez) do update
       set estado = excluded.estado,
           nota = excluded.nota,
           usuario = excluded.usuario,
           actualizado_en = now()`,
    [m.fecha, m.tarea, m.vez, m.estado, m.nota, m.usuario],
  );
}

/** Volver el casillero a vacío. */
export async function desmarcarRutina(m: { fecha: string; tarea: string; vez: number }) {
  await query(
    `delete from app.tareas_meli_rutina where fecha = $1::date and tarea = $2 and vez = $3`,
    [m.fecha, m.tarea, m.vez],
  );
}
