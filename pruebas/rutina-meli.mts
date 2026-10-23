/**
 * Pruebas de la rutina de "Mis tareas" (lib/rutina-meli.ts). Sin base, sin red.
 *
 * Lo que se prueba es lo que decide el número de cumplimiento: qué días toca
 * cada tarea y qué cuenta como pendiente. Si eso se equivoca, la planilla mide
 * mal sin que nada se vea roto.
 *
 *     node --experimental-strip-types --import ./pruebas/registrar.mjs pruebas/rutina-meli.mts
 */

import {
  FERIADO,
  cumplimiento,
  diasDeSemana,
  lunesDe,
  tareaRutina,
  vecesEnDia,
  type MarcaRutina,
  type TareaRutina,
} from "@/lib/rutina-meli";

const FALLOS: string[] = [];

function revisar(nombre: string, ok: boolean, detalle = "") {
  console.log(ok ? `OK  ${nombre}` : `MAL ${nombre}${detalle ? `\n     ${detalle}` : ""}`);
  if (!ok) FALLOS.push(nombre);
}

function marca(fecha: string, tarea: string, estado: MarcaRutina["estado"], vez = 1): MarcaRutina {
  return { fecha, tarea, vez, estado, nota: null, usuario: "x", actualizadoEn: `${fecha}T10:00` };
}

const diaria: TareaRutina = { clave: "a", label: "A", frecuencia: { tipo: "diaria" } };
const triple: TareaRutina = { clave: "d", label: "D", frecuencia: { tipo: "diaria", veces: 3 } };

// --- semanas y días -------------------------------------------------------
revisar("el lunes de un jueves", lunesDe("2026-10-22") === "2026-10-19");
revisar("el lunes de un domingo es el de esa semana", lunesDe("2026-10-25") === "2026-10-19");
revisar(
  "la semana son cinco días hábiles",
  JSON.stringify(diasDeSemana("2026-10-19")) ===
    JSON.stringify(["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23"]),
);
revisar("una diaria no corre el sábado", vecesEnDia(diaria, "2026-10-24") === 0);
revisar("controlar dashboard son tres por día", vecesEnDia(tareaRutina("controlar_dashboard")!, "2026-10-19") === 3);

// --- la mensual del 28 ----------------------------------------------------
const stock = tareaRutina("stock_antiguo")!;
revisar("el 28 hábil cae el 28", vecesEnDia(stock, "2026-10-28") === 1); // miércoles
revisar("y no el 27", vecesEnDia(stock, "2026-10-27") === 0);
// noviembre 2026: el 28 es sábado -> viernes 27.
revisar("si el 28 es sábado, va el viernes 27", vecesEnDia(stock, "2026-11-27") === 1);
revisar("y no el lunes 30", vecesEnDia(stock, "2026-11-30") === 0);
// febrero 2027: el 28 es domingo -> viernes 26, sin salirse del mes.
revisar("si el 28 es domingo, va el viernes 26", vecesEnDia(stock, "2027-02-26") === 1);

revisar("la de evento no tiene casilleros", vecesEnDia(tareaRutina("estrategias_sic_tst")!, "2026-10-19") === 0);

// --- cumplimiento ---------------------------------------------------------
// Una semana posterior a INICIO_RUTINA, para que los vacíos cuenten.
const semana = diasDeSemana("2026-11-02");
const hoy = "2026-11-04"; // miércoles

{
  const c = cumplimiento(semana, hoy, [], [diaria]);
  revisar(
    "sin marcas: lunes y martes pendientes, hoy no cuenta todavía",
    c.pendientes === 2 && c.esperados === 2,
    JSON.stringify(c),
  );
}
{
  const c = cumplimiento(semana, hoy, [marca("2026-11-04", "a", "hecho")], [diaria]);
  revisar("lo marcado hoy sí cuenta", c.hechos === 1 && c.esperados === 3, JSON.stringify(c));
}
{
  const c = cumplimiento(
    semana,
    hoy,
    [marca("2026-11-02", "a", "no_correspondia"), marca("2026-11-03", "a", "hecho")],
    [diaria],
  );
  revisar(
    "no correspondía es una respuesta, no un pendiente",
    c.pendientes === 0 && c.noCorrespondia === 1 && c.hechos === 1,
    JSON.stringify(c),
  );
}
{
  const c = cumplimiento(semana, hoy, [marca("2026-11-02", FERIADO, "no_correspondia")], [diaria]);
  revisar("el feriado no cuenta como incumplido", c.pendientes === 1 && c.esperados === 1, JSON.stringify(c));
}
{
  const c = cumplimiento(semana, hoy, [marca("2026-11-02", "d", "hecho", 2)], [triple]);
  revisar(
    "las tres veces cuentan por separado",
    c.hechos === 1 && c.pendientes === 5 && c.esperados === 6,
    JSON.stringify(c),
  );
}
{
  const c = cumplimiento(semana, "2026-11-01", [], [diaria]);
  revisar("una semana que no empezó no tiene nada esperado", c.esperados === 0);
}

{
  const c = cumplimiento(diasDeSemana("2026-10-19"), "2026-10-23", [marca("2026-10-20", "a", "hecho")], [diaria]);
  revisar(
    "antes del inicio lo vacío no resta, lo marcado sí suma",
    c.pendientes === 0 && c.hechos === 1 && c.esperados === 1,
    JSON.stringify(c),
  );
}

console.log(FALLOS.length ? `\n${FALLOS.length} FALLARON: ${FALLOS.join(", ")}` : "\nTODO OK");
process.exit(FALLOS.length ? 1 : 0);
