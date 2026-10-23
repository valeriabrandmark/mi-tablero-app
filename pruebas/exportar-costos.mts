import { libroDeCostos, nombreDelArchivo, type FilaDeArchivo } from "@/lib/exportar-costos";

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

/* ===========================================================================
   EL ARCHIVO DE COSTOS

   Lo que se prueba acá no es que el .xlsx se arme --eso lo hace lib/xlsx, que
   ya escribe los de Compras y Precios TN-- sino las tres decisiones de ESTE
   archivo, que son las que pueden hacerle creer algo falso a quien lo abra:

     1. el porcentaje va como fracción, porque Excel lo multiplica por cien;
     2. "no tenía costo" se escribe vacío y no cero;
     3. la carátula dice si el tramo se aplicó o es sólo una foto.
   ========================================================================= */

const fila = (p: Partial<FilaDeArchivo> = {}): FilaDeArchivo => ({
  sku: "A",
  proveedor: "ALGABO S. A.",
  descripcion: "UN ARTICULO",
  costoTeorico: 1000,
  ofertaPct: 18,
  descPropioPct: 0,
  costoReal: 820,
  antes: 800,
  ...p,
});

const CARATULA = {
  mes: "2026-10",
  vigenteDesde: "23/10/2026",
  origen: "tablero",
  nota: "Aumento Algabo",
  aplicadoPor: "ana@brandmark.com.ar",
  aplicadoEn: "23/10/2026 14:37",
  contadores: "8232 artículos",
};

/* --- EL PORCENTAJE ------------------------------------------------------- */

// EXCEL GUARDA LOS PORCENTAJES COMO FRACCION. El formato `0.0%` de lib/xlsx
// multiplica por cien al mostrar, así que un 18 guardado tal cual se abriría
// como 1.800 % -- y un costo con 1.800 % de descuento no se lee como un error
// de formato, se lee como un costo negativo.
{
  const libro = libroDeCostos(CARATULA, [fila({ ofertaPct: 18, descPropioPct: 30 })]);
  revisar("la oferta va como fracción", libro.filas[0]![4], 0.18);
  revisar("el desc propio también", libro.filas[0]![5], 0.3);
}

/* --- LO QUE NO SE SABE VA VACIO ------------------------------------------ */

// UN ARTICULO QUE NO TENIA COSTO NO "BAJO A CERO": no tenía. Son cosas
// distintas y en una planilla de ocho mil filas la diferencia no se recupera.
{
  const libro = libroDeCostos(CARATULA, [fila({ antes: null })]);
  revisar("sin costo anterior queda vacío", libro.filas[0]![7], null);
  revisar("y la diferencia también", libro.filas[0]![8], null);
}

{
  const libro = libroDeCostos(CARATULA, [fila({ costoReal: 820, antes: 800 })]);
  revisar("con costo anterior se calcula la diferencia", libro.filas[0]![8], 20);
}

// Y BAJAR A CERO SI ES UN CAMBIO, con su diferencia en negativo: son los que
// el maestro dejó de cotizar.
{
  const libro = libroDeCostos(CARATULA, [
    fila({ costoTeorico: 0, ofertaPct: 0, costoReal: 0, antes: 450000 }),
  ]);
  revisar("bajar a cero sí es un cambio", libro.filas[0]![8], -450000);
}

/* --- LA CARATULA --------------------------------------------------------- */

{
  const libro = libroDeCostos(CARATULA, [fila()]);
  const texto = (libro.titulos ?? []).join("\n");
  revisar("dice el mes", texto.includes("2026-10"), true);
  revisar("dice desde cuándo", texto.includes("23/10/2026"), true);
  revisar("dice la nota", texto.includes("Aumento Algabo"), true);
  revisar("dice quién", texto.includes("ana@brandmark.com.ar"), true);
  // LA FORMULA, EN EL ARCHIVO. Se abre lejos de la pantalla que la explica.
  revisar("y cómo se calcula el costo", texto.includes("1 − oferta"), true);
}

// UN TRAMO DEL EXCEL VIEJO NO TIENE NOTA, y el archivo tiene que decirlo en
// vez de dejar el renglón en blanco: la diferencia entre "no se anotó" y "se
// anotó vacío" es la que hace dudar de todo lo demás.
{
  const libro = libroDeCostos(
    { ...CARATULA, origen: "excel", nota: null, aplicadoPor: null, aplicadoEn: null },
    [fila()],
  );
  const texto = (libro.titulos ?? []).join("\n");
  revisar("avisa que vino del Excel", texto.includes("Excel del orquestador"), true);
  revisar("y que por eso no tiene nota", texto.includes("no tiene nota"), true);
}

/* --- EL NOMBRE ----------------------------------------------------------- */

// LLEVA LA FECHA DEL TRAMO Y NO LA DE HOY: dos tramos bajados el mismo día
// tienen que poder convivir en la misma carpeta sin pisarse.
revisar(
  "el nombre lleva la fecha del tramo",
  nombreDelArchivo("2026-10", "2026-10-23"),
  "costos-2026-10-desde-2026-10-23.xlsx",
);

/* --- LAS COLUMNAS -------------------------------------------------------- */

{
  const libro = libroDeCostos(CARATULA, [fila(), fila({ sku: "B" })]);
  revisar(
    "cada fila tiene tantas celdas como columnas",
    libro.filas.every((f) => f.length === libro.columnas.length),
    true,
  );
  revisar("y están todas las filas", libro.filas.length, 2);
}

console.log(FALLOS.length ? `\n${FALLOS.length} FALLARON: ${FALLOS.join(", ")}` : "\nTODO OK");
process.exit(FALLOS.length ? 1 : 0);
