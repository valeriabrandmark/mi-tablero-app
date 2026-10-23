/**
 * La foto de costos: leer la planilla y decidir si se puede aplicar.
 *
 * ---------------------------------------------------------------------------
 * POR QUE EXISTE
 *
 * Esto reescribe el costo del que sale el margen de TODO el tablero, y un
 * costo mal cargado no se ve donde se carga: se ve semanas después en una
 * pantalla, como un margen raro que nadie sabe explicar.
 *
 * Ya pasó. El 07/09/2026 entró un archivo con la coma decimal borrada en el
 * 63 % de los artículos y el margen del día dio -$42.421 millones. El guard
 * que frena eso se prueba acá, junto con el parser que lo alimenta.
 *
 *     node --experimental-strip-types --import ./pruebas/registrar.mjs pruebas/costos-snapshot.mts
 */

import {
  armarSnapshot,
  costoRealDe,
  PROPORCION_PARA_ABORTAR,
  SALTO_SOSPECHOSO,
  type ArticuloParaCostear,
} from "@/lib/costos-snapshot";
import { leerOfertas } from "@/lib/ofertas-planilla";

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

/**
 * Compara plata con tolerancia de un centavo.
 *
 * NO SE REDONDEA EL COSTO, a propósito: la cuenta es idéntica a la de
 * costos.py --`teorico * (1 - oferta/100)`, sin redondeo-- para que el mismo
 * artículo cargado por los dos caminos dé exactamente el mismo double. El
 * precio de eso es que 1000 x 0,82 da 820.0000000000001, así que la
 * comparación es la que se afloja, no la cuenta.
 */
function cerca(nombre: string, obtenido: number, esperado: number) {
  const ok = Math.abs(obtenido - esperado) < 0.01;
  console.log(ok ? `OK  ${nombre}` : `MAL ${nombre}\n     esperado: ${esperado}\n     obtenido: ${obtenido}`);
  if (!ok) FALLOS.push(nombre);
}

/* --- EL PARSER ----------------------------------------------------------
   Las filas son tal como llegan de la planilla: los encabezados CON ESPACIOS
   AL FINAL y los porcentajes como texto con coma, que es lo que manda el
   Apps Script a propósito (`getDisplayValues`). */

const ENCABEZADO = [
  "PROVEEDOR ", "EAN", "MARCA", "SKU ", "DESCRIPCION",
  "DESCUENTO SELL IN", "DESCUENTO SELL OUT", "DESCUENTO TOTAL PROVEEDOR",
  "DESC PROPIO", "DTO TOTAL", "Linea",
];

const fila = (sku: string, oferta: string, propio = "0,00%") =>
  ["ALGABO S. A.", "779", "ALGABO", sku, "UN ARTICULO",
   "0,00%", "0,00%", oferta, propio, "0,00%", "Capilares"];

{
  const o = leerOfertas([
    ENCABEZADO,
    fila("AL10005", "18,00%"),
    fila("AL10006", "0,00%", "15,00%"),
  ]);
  revisar("lee sin problemas", o.problemas, []);
  revisar("el encabezado con espacios igual se encuentra", o.porSku.size, 2);
  revisar("el porcentaje con coma se lee", o.porSku.get("AL10005")!.ofertaPct, 18);
  revisar("y el desc propio también", o.porSku.get("AL10006")!.descPropioPct, 15);
  revisar("cuenta las que tienen oferta", o.conOferta, 1);
}

// LAS FILAS SIN SKU SE DESCARTAN. En la planilla de verdad son ~2.700 filas de
// fórmula que dan "#N/A" con "0,00%" en los porcentajes: no están vacías, así
// que el filtro del Apps Script no las saca.
{
  const o = leerOfertas([
    ENCABEZADO,
    fila("AL10005", "18,00%"),
    ["", "", "", "", "", "0,00%", "0,00%", "0,00%", "0,00%", "0,00%", "#N/A"],
    ["", "", "", "", "", "0,00%", "0,00%", "0,00%", "0,00%", "0,00%", "#N/A"],
  ]);
  revisar("las de #N/A no entran", o.porSku.size, 1);
  revisar("pero se cuentan", o.sinSku, 2);
}

// UNA HOJA QUE NO SE ENTIENDE NO SE USA. Sin esto, una planilla renombrada
// dejaría a todo el catálogo en 0 % de oferta -- o sea, todo a precio de
// lista-- y eso no se lee como un error sino como un mes sin ofertas.
{
  const o = leerOfertas([["COSA", "OTRA"], ["1", "2"]]);
  revisar("sin las columnas no devuelve nada", o.porSku.size, 0);
  revisar("y lo dice", o.problemas.length > 0, true);
}
revisar("una hoja vacía tampoco", leerOfertas([]).problemas.length > 0, true);

// El encabezado puede no estar en la primera fila: un export que agrega un
// título arriba desalinearía todo sin fallar.
{
  const o = leerOfertas([["2026 - Consolidador"], [], ENCABEZADO, fila("A", "5,00%")]);
  revisar("encuentra el encabezado más abajo", o.porSku.get("A")!.ofertaPct, 5);
}

/* --- LA CUENTA ---------------------------------------------------------- */

cerca("el costo real es la lista con la oferta", costoRealDe(1000, 18), 820);
revisar("sin oferta es la lista", costoRealDe(1000, 0), 1000);

/* --- EL SNAPSHOT -------------------------------------------------------- */

const art = (sku: string, costoTeorico: number | null): ArticuloParaCostear => ({
  sku,
  proveedor: "ALGABO S. A.",
  descripcion: sku,
  costoTeorico,
});

{
  const ofertas = leerOfertas([ENCABEZADO, fila("A", "18,00%")]);
  const s = armarSnapshot([art("A", 1000), art("B", 500)], ofertas, new Map());

  revisar("arma una fila por artículo", s.filas.length, 2);
  cerca("el que está en la planilla lleva su oferta", s.filas[0]!.costoReal, 820);
  // EL QUE NO ESTA QUEDA EN CERO, no afuera: sin oferta se paga la lista, así
  // que el costo no queda subestimado.
  revisar("el que no está queda a precio de lista", s.filas[1]!.costoReal, 500);
  revisar("y se avisa cuál falta", s.faltantes.map((f) => f.sku), ["B"]);
}

// EL DESCUENTO PROPIO NO BAJA EL COSTO. Es lo que resignamos nosotros, no lo
// que nos cuesta. Si entrara, el margen se calcularía contra un costo que no
// pagamos.
{
  const ofertas = leerOfertas([ENCABEZADO, fila("A", "0,00%", "30,00%")]);
  const s = armarSnapshot([art("A", 1000)], ofertas, new Map());
  revisar("el desc propio no toca el costo real", s.filas[0]!.costoReal, 1000);
  revisar("pero se guarda", s.filas[0]!.descPropioPct, 30);
}

// UN ARTICULO SIN COSTO TEORICO NO "CAMBIA", se queda sin costo. Salió de
// probar el botón contra los datos de verdad: de 16 que cambiaban, 3 iban a
// cero (CI123, PU02004, PU03095) porque el maestro no los cotiza. Leerlos como
// cambios hacía creer que cambiaban 16 precios cuando cambiaban 13.
{
  const ofertas = leerOfertas([ENCABEZADO, fila("A", "0,00%"), fila("B", "0,00%")]);
  const s = armarSnapshot(
    [art("A", 1200), art("B", null)],
    ofertas,
    new Map([["A", 1000], ["B", 450000]]),
  );

  revisar("el que no tiene teorico no cuenta como cambio", s.cambian, 1);
  revisar("se avisa aparte", s.sinCostoTeorico.map((x) => x.sku), ["B"]);
  revisar("con lo que tenia, para poder mirarlo", s.sinCostoTeorico[0]!.antes, 450000);
  // NO FRENA: el lector saltea los ceros (`where costo_real > 0`) y se queda
  // con el ultimo tramo que tenga costo, asi que el viejo sigue rigiendo.
  revisar("pero no frena la carga", s.abortar, false);
  revisar("ni es un problema", s.problemas, []);
}

// Y EL QUE NO TIENE NI TEORICO NI COSTO HOY no se reporta: no pierde nada.
// Son los testers y exhibidores, que son cientos; listarlos tapaba los tres
// que si importan.
{
  const ofertas = leerOfertas([ENCABEZADO, fila("A", "0,00%")]);
  const s = armarSnapshot([art("A", null)], ofertas, new Map());
  revisar("el que nunca tuvo costo no se avisa", s.sinCostoTeorico.length, 0);
}

/* --- EL GUARD ----------------------------------------------------------- */

// Un aumento normal pasa.
{
  const ofertas = leerOfertas([ENCABEZADO, fila("A", "0,00%"), fila("B", "0,00%")]);
  const s = armarSnapshot(
    [art("A", 1200), art("B", 1300)],
    ofertas,
    new Map([["A", 1000], ["B", 1000]]),
  );
  revisar("un aumento del 20-30 % no frena", s.abortar, false);
  revisar("pero dice cuántos cambian", s.cambian, 2);
}

// LA COMA DECIMAL BORRADA. Es el 07/09 exacto: los costos quedan x100.
{
  const ofertas = leerOfertas([
    ENCABEZADO, fila("A", "0,00%"), fila("B", "0,00%"), fila("C", "0,00%"),
  ]);
  const s = armarSnapshot(
    [art("A", 100000), art("B", 150000), art("C", 1200)],
    ofertas,
    new Map([["A", 1000], ["B", 1500], ["C", 1000]]),
  );
  revisar("dos de tres saltaron 100x", s.saltos.length, 2);
  revisar("eso supera la proporción", s.proporcionDeSaltos >= PROPORCION_PARA_ABORTAR, true);
  revisar("y aborta", s.abortar, true);
  revisar("diciendo por qué", s.problemas.some((p) => p.includes("07/09")), true);
  // Los más grandes primero: es lo que se mira para decidir.
  revisar("el salto más grande va primero", s.saltos[0]!.sku, "A");
}

// UN SOLO ARTICULO QUE SALTA NO FRENA LA CARGA. Puede ser un costo que estaba
// mal antes, y abortar por uno dejaría todo el mes sin actualizar.
{
  const ofertas = leerOfertas([
    ENCABEZADO, ...["A", "B", "C", "D", "E", "F"].map((s) => fila(s, "0,00%")),
  ]);
  const antes = new Map([["A", 1000], ["B", 1000], ["C", 1000], ["D", 1000], ["E", 1000], ["F", 1000]]);
  const s = armarSnapshot(
    [art("A", 100000), art("B", 1100), art("C", 1100), art("D", 1100), art("E", 1100), art("F", 1100)],
    ofertas,
    antes,
  );
  revisar("uno solo de seis no aborta", s.abortar, false);
  revisar("pero queda a la vista", s.saltos.length, 1);
}

// LOS QUE NO TENIAN COSTO NO CUENTAN COMO SALTO. Un artículo que arranca de
// cero no "saltó cien veces": no había con qué comparar, y contarlo inflaría
// la proporción hasta abortar cargas sanas.
{
  const ofertas = leerOfertas([ENCABEZADO, fila("A", "0,00%"), fila("B", "0,00%")]);
  const s = armarSnapshot(
    [art("A", 90000), art("B", 1000)],
    ofertas,
    new Map([["B", 1000]]),
  );
  revisar("sin costo anterior no hay salto", s.saltos.length, 0);
  revisar("ni aborta", s.abortar, false);
}

revisar("el umbral es 50x", SALTO_SOSPECHOSO, 50);
revisar("y la proporción, 20 %", PROPORCION_PARA_ABORTAR, 0.2);

console.log(FALLOS.length ? `\n${FALLOS.length} FALLARON: ${FALLOS.join(", ")}` : "\nTODO OK");
process.exit(FALLOS.length ? 1 : 0);
