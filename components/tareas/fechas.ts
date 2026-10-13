/**
 * Fechas de la pantalla de tareas, en la hora LOCAL del navegador.
 *
 * El tablero se usa desde Argentina, así que la hora local y la de la base
 * (`America/Argentina/Buenos_Aires`) coinciden. Si alguien lo abre desde otro
 * huso, las tareas se ven en su hora --que es lo que espera quien mira un
 * calendario-- y las reglas que se repiten siguen siendo "a las 9 de acá".
 */

export function inicioDelDia(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function sumarDias(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

/** El lunes de la semana de `d`. */
export function inicioDeSemana(d: Date): Date {
  const dia = (d.getDay() + 6) % 7; // lunes = 0
  return sumarDias(inicioDelDia(d), -dia);
}

export function inicioDeMes(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export function finDeMes(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 1);
}

/** "YYYY-MM-DD" local. */
export function claveDia(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${dd}`;
}

/** "HH:MM" local. */
export function horaDe(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function mismoDia(a: Date, b: Date): boolean {
  return claveDia(a) === claveDia(b);
}

/** Fecha y hora locales de los inputs → ISO. */
export function aISO(fecha: string, hora: string): string {
  const [y, m, d] = fecha.split("-").map(Number);
  const [hh, mm] = hora.split(":").map(Number);
  return new Date(y, m - 1, d, hh, mm).toISOString();
}

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio",
  "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

export function nombreMes(d: Date): string {
  return `${MESES[d.getMonth()]} ${d.getFullYear()}`;
}

/** "martes 13/10". */
export function diaLargo(d: Date): string {
  return `${DIAS[d.getDay()]} ${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
}
