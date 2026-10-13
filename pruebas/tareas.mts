/**
 * Pruebas del organizador de tareas. Sin base, sin red, sin navegador.
 *
 * Lo que se fija acá es lo que no se ve hasta que falla en silencio:
 *
 *   - que un aviso no suene dos veces ni se saltee (la ventana de tiempo);
 *   - que las automáticas no avisen (no hay nada que arrancar);
 *   - que la validación rechace lo que la base rechazaría con un error feo;
 *   - que el día de una tarea de las 22 h sea ESE día y no el siguiente;
 *   - que las sugerencias aparezcan con el patrón y no sin él.
 *
 * Las reglas que se repiten se generan en SQL (migraciones/tareas.sql) y se
 * probaron contra un Postgres local al escribir la migración.
 *
 *     node --experimental-strip-types --import ./pruebas/registrar.mjs pruebas/tareas.mts
 */

import {
  describirRecurrencia,
  diaAR,
  estaAtrasada,
  minutosReales,
  normalizarTitulo,
  resumir,
  sugerir,
  tareasParaAvisar,
  validarRecurrencia,
  validarTarea,
  type Tarea,
} from "@/lib/tareas";

const FALLOS: string[] = [];

function revisar(nombre: string, obtenido: unknown, esperado: unknown) {
  const ok = JSON.stringify(obtenido) === JSON.stringify(esperado);
  console.log(
    ok
      ? `OK  ${nombre}`
      : `MAL ${nombre}\n     esperado: ${JSON.stringify(esperado)}\n     obtenido: ${JSON.stringify(obtenido)}`,
  );
  if (!ok) FALLOS.push(nombre);
}

let id = 0;
function tarea(p: Partial<Tarea>): Tarea {
  id += 1;
  return {
    id: String(id),
    titulo: "Algo",
    nota: null,
    categoria: null,
    prioridad: "media",
    inicio: "2026-10-13T12:00:00.000Z", // 09:00 de Argentina
    duracionMin: 30,
    recordarMinAntes: 0,
    estado: "pendiente",
    iniciadaEn: null,
    hechaEn: null,
    vecesPostergada: 0,
    accion: null,
    resultadoAccion: null,
    recurrenciaId: null,
    ...p,
  };
}

const ms = (iso: string) => new Date(iso).getTime();

// --- Avisos -----------------------------------------------------------------

const t9 = tarea({ titulo: "a las 9" });
const t9con10 = tarea({ titulo: "a las 9, aviso 10 antes", recordarMinAntes: 10 });
const auto = tarea({ titulo: "automática", accion: "actualizar_tablero" });
const hecha = tarea({ titulo: "ya hecha", estado: "hecha" });
const lista = [t9, t9con10, auto, hecha];

revisar(
  "a las 9:00 en punto avisa la de las 9",
  tareasParaAvisar(lista, ms("2026-10-13T11:59:40Z"), ms("2026-10-13T12:00:00Z"), new Set()).map((t) => t.titulo),
  ["a las 9"],
);
revisar(
  "la de aviso previo suena a las 8:50",
  tareasParaAvisar(lista, ms("2026-10-13T11:49:50Z"), ms("2026-10-13T11:50:10Z"), new Set()).map((t) => t.titulo),
  ["a las 9, aviso 10 antes"],
);
revisar(
  "la ventana es abierta abajo: lo que se avisó en la revisión anterior no se repite",
  tareasParaAvisar(lista, ms("2026-10-13T12:00:00Z"), ms("2026-10-13T12:00:20Z"), new Set()).length,
  0,
);
revisar(
  "ya avisada (misma hora) no se repite aunque caiga en la ventana",
  tareasParaAvisar(lista, ms("2026-10-13T11:59:00Z"), ms("2026-10-13T12:00:00Z"), new Set([`${t9.id}@${t9.inicio}`])).length,
  0,
);
revisar(
  "las automáticas y las hechas no avisan",
  tareasParaAvisar([auto, hecha], 0, ms("2027-01-01T00:00:00Z"), new Set()).length,
  0,
);

// --- Atrasadas y tiempo real --------------------------------------------------

revisar("a las 9:29 no está atrasada", estaAtrasada(t9, new Date("2026-10-13T12:29:00Z")), false);
revisar("a las 9:31 sí", estaAtrasada(t9, new Date("2026-10-13T12:31:00Z")), true);
revisar("una hecha nunca", estaAtrasada(hecha, new Date("2027-01-01T00:00:00Z")), false);
revisar("una automática tampoco: no es trabajo de nadie", estaAtrasada(auto, new Date("2027-01-01T00:00:00Z")), false);

revisar(
  "minutos reales: arrancar y terminar",
  minutosReales(tarea({ iniciadaEn: "2026-10-13T12:00:00Z", hechaEn: "2026-10-13T12:45:00Z" })),
  45,
);
revisar(
  "tocar los dos botones seguidos no es una medida",
  minutosReales(tarea({ iniciadaEn: "2026-10-13T12:00:00Z", hechaEn: "2026-10-13T12:00:20Z" })),
  null,
);

// --- Día de Argentina -------------------------------------------------------

revisar("las 22 h del 13 son del 13", diaAR("2026-10-14T01:00:00Z"), "2026-10-13");
revisar("las 0 h del 14 son del 14", diaAR("2026-10-14T03:00:00Z"), "2026-10-14");

// --- Validación -------------------------------------------------------------

revisar("sin título no", validarTarea({ titulo: "  ", inicio: "2026-10-13T12:00:00Z" }).ok, false);
revisar("sin fecha no", validarTarea({ titulo: "x" }).ok, false);
revisar("acción inventada no", validarTarea({ titulo: "x", inicio: "2026-10-13T12:00:00Z", accion: "borrar_todo" }).ok, false);
const ok = validarTarea({ titulo: " Llamar a X ", inicio: "2026-10-13T12:00:00Z", categoria: "" });
revisar("recorta y completa defaults", ok.ok ? [ok.valor.titulo, ok.valor.categoria, ok.valor.duracionMin, ok.valor.prioridad] : null, [
  "Llamar a X",
  null,
  30,
  "media",
]);

revisar(
  "semanal sin días no",
  validarRecurrencia({ titulo: "x", frecuencia: "semanal", hora: "09:00", desde: "2026-10-13", diasSemana: [] }).ok,
  false,
);
revisar(
  "hora inválida no",
  validarRecurrencia({ titulo: "x", frecuencia: "diaria", hora: "25:00", desde: "2026-10-13" }).ok,
  false,
);
revisar(
  "hasta antes que desde no",
  validarRecurrencia({ titulo: "x", frecuencia: "diaria", hora: "09:00", desde: "2026-10-13", hasta: "2026-10-01" }).ok,
  false,
);
const rec = validarRecurrencia({
  titulo: "x", frecuencia: "semanal", hora: "09:00", desde: "2026-10-13", diasSemana: [4, 1, 1, 9],
});
revisar("días: sin repetidos, válidos y ordenados", rec.ok ? rec.valor.diasSemana : null, [1, 4]);
const mensual = validarRecurrencia({ titulo: "x", frecuencia: "mensual", hora: "09:00", desde: "2026-10-06" });
revisar("mensual sin día toma el de inicio", mensual.ok ? mensual.valor.diaMes : null, 6);

// --- Textos -----------------------------------------------------------------

revisar(
  "lunes y jueves",
  describirRecurrencia({ frecuencia: "semanal", cada: 1, diasSemana: [1, 4], diaMes: null, hora: "09:00" }),
  "Todos los lunes y jueves a las 09:00",
);
revisar(
  "días hábiles",
  describirRecurrencia({ frecuencia: "semanal", cada: 1, diasSemana: [1, 2, 3, 4, 5], diaMes: null, hora: "08:30" }),
  "De lunes a viernes a las 08:30",
);
revisar(
  "mensual",
  describirRecurrencia({ frecuencia: "mensual", cada: 1, diasSemana: null, diaMes: 6, hora: "10:00" }),
  "Todos los meses, el día 6 a las 10:00",
);
revisar("títulos iguales con distinta forma", normalizarTitulo("Revisar  Stock!"), normalizarTitulo("revisar stock"));

// --- Resumen ----------------------------------------------------------------

const ahora = new Date("2026-10-13T18:00:00Z");
const r = resumir(
  [
    tarea({ estado: "hecha", categoria: "Stock y compras", duracionMin: 30 }),
    tarea({ estado: "hecha", categoria: "Stock y compras", iniciadaEn: "2026-10-13T13:00:00Z", hechaEn: "2026-10-13T14:00:00Z" }),
    tarea({ estado: "hecha", accion: "actualizar_tablero" }),
    tarea({ estado: "pendiente" }),
    tarea({ estado: "cancelada" }),
    tarea({ estado: "pendiente", inicio: "2026-10-20T12:00:00Z" }), // futura: no cuenta para el cumplimiento
  ],
  ahora,
);
// La automática no cuenta en los totales: se informa aparte.
revisar("totales", [r.total, r.hechas, r.atrasadas, r.canceladas, r.automaticas], [4, 2, 1, 1, 1]);
revisar("cumplimiento sobre lo que vencía", Math.round(r.cumplimiento ?? 0), 67);
revisar("minutos: estimado + real, las automáticas no suman", r.minutosHechos, 90);

// --- Sugerencias ------------------------------------------------------------

const claves = (s: { clave: string }[]) => s.map((x) => x.clave.split("-")[0]);

revisar("sin historia, sin sugerencias", sugerir([tarea({})], [], ahora).length, 0);
revisar(
  "postergada 3 veces",
  claves(sugerir([tarea({ vecesPostergada: 3, inicio: "2026-10-14T12:00:00Z" })], [], ahora)),
  ["postergada"],
);
const repetidas = [1, 2, 3].map((d) => tarea({ titulo: "Revisar stock", estado: "hecha", inicio: `2026-10-0${d}T12:00:00Z` }));
revisar("cargada 3 veces a mano", claves(sugerir(repetidas, [], ahora)), ["repetida"]);
revisar(
  "si ya existe la regla, no se sugiere",
  sugerir(
    repetidas,
    [{ id: "1", titulo: "revisar STOCK", activa: true } as never],
    ahora,
  ).length,
  0,
);
revisar(
  "actualizar el tablero a mano",
  claves(sugerir([tarea({ titulo: "Actualizar datos del tablero", inicio: "2026-10-14T12:00:00Z" })], [], ahora)),
  ["automatizable"],
);
revisar(
  "cortas de una tarea que se repite: ya es un bloque, no se sugiere agrupar",
  sugerir(
    [1, 2, 3, 4, 5].map((d) => tarea({ categoria: "Mercado Libre", duracionMin: 15, recurrenciaId: "9", estado: "hecha", inicio: `2026-10-0${d}T12:00:00Z` })),
    [],
    ahora,
  ).length,
  0,
);
revisar(
  "cortas sueltas en 4 días: agrupar",
  claves(sugerir([1, 2, 3, 4].map((d) => tarea({ titulo: `t${d}`, categoria: "Cobranzas", duracionMin: 15, inicio: `2026-10-0${d}T12:00:00Z` })), [], ahora)),
  ["agrupar"],
);
revisar(
  "día con más de 7 h",
  claves(sugerir([tarea({ inicio: "2026-10-15T12:00:00Z", duracionMin: 480 })], [], ahora)),
  ["cargado"],
);

console.log(FALLOS.length ? `\n${FALLOS.length} FALLARON: ${FALLOS.join(", ")}` : "\nTODO OK");
process.exit(FALLOS.length ? 1 : 0);
