/**
 * El reparto del flete de un envío entre sus comprobantes. Sin base.
 *
 * ---------------------------------------------------------------------------
 * POR QUE EXISTE
 *
 * El flete se PAGA por envío y se COBRA por comprobante. El transportista
 * factura una preparación; adentro pueden viajar seis comprobantes de cuatro
 * empresas distintas, y lo que cada uno se llevó de ese flete es un reparto.
 *
 * La tabla de logística iba por comprobante, que es el grano equivocado para
 * mirar un costo: un envío partido en cinco facturas se veía como cinco fletes
 * sueltos, y lo que realmente salió ese envío no estaba en ningún lado.
 *
 * Estos porcentajes son los que dicen "este comprobante se llevó el 70% del
 * flete". Si se equivocaran no habría ningún error visible: habría un número
 * convincente al lado de un comprobante, que es peor.
 *
 *     node --experimental-strip-types --import ./pruebas/registrar.mjs pruebas/envios-flete.mts
 */

import {
  destino,
  origenDelFlete,
  porQueElMargen,
  repartoDelFlete,
  resumenEmpresas,
} from "@/lib/logistica";

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

// --- El reparto ------------------------------------------------------------

revisar("la mitad del flete", repartoDelFlete(50, 100), 0.5);
revisar("todo el flete", repartoDelFlete(100, 100), 1);

// UN COMPROBANTE EN CERO ES UNA RESPUESTA DE VERDAD --no se llevó nada-- y
// pasa seguido: una nota de crédito viaja en el envío sin que le toque flete.
revisar("un comprobante sin flete se lleva cero", repartoDelFlete(0, 100), 0);

// SIN FLETE EN EL ENVIO NO HAY NADA QUE REPARTIR. "0%" sería tan falso como
// "100%": la respuesta honesta es que no se sabe.
revisar("sin flete en el envío no hay reparto", repartoDelFlete(0, 0), null);
revisar("tampoco con el comprobante cargado", repartoDelFlete(5, 0), null);

// UN DENOMINADOR NEGATIVO SALE AL REVES: el que más pagó aparecería con el
// número más chico. No debería pasar, pero una nota de crédito del
// transportista lo haría.
revisar("un flete negativo no se reparte", repartoDelFlete(10, -100), null);

revisar("un número roto no inventa un reparto", repartoDelFlete(NaN, 100), null);
revisar("ni un total roto", repartoDelFlete(10, NaN), null);

// EL CASO DE VERDAD, medido contra la base: la preparación 12750394 costó
// $127.443,77 y viajó partida en seis comprobantes de cuatro empresas. Los
// porcentajes tienen que sumar 100.
{
  const envio = 127443.77;
  const partes = [88773.67, 33139.68, 3198.74, 2331.68, 0, 0];
  const repartos = partes.map((p) => repartoDelFlete(p, envio) ?? 0);
  const suma = repartos.reduce((a, b) => a + b, 0);
  revisar(
    "el reparto de un envío real suma 100%",
    Math.abs(suma - 1) < 1e-9,
    true,
  );
  revisar(
    "y el comprobante más grande se llevó el 69,7%",
    Math.round(repartos[0]! * 1000) / 10,
    69.7,
  );
}

// --- De dónde sale el flete ------------------------------------------------
//
// Son tres estados y no dos: el flete se resuelve por preparación, y un envío
// puede tener parte de sus renglones con la factura del transportista cargada
// y parte sin ella. Decir "real" o "estimado" a secas sería mentir en la mitad
// del importe.

revisar(
  "todos los renglones con factura: real",
  origenDelFlete({ lineasReales: "40", lineasTotales: "40" }).clave,
  "real",
);
revisar(
  "ninguno: estimado",
  origenDelFlete({ lineasReales: "0", lineasTotales: "40" }).clave,
  "estimado",
);
revisar(
  "algunos: mixto, y dice cuántos",
  origenDelFlete({ lineasReales: "12", lineasTotales: "40" }).texto,
  "Mixto 12/40",
);
revisar(
  "un envío sin renglones no es real",
  origenDelFlete({ lineasReales: "0", lineasTotales: "0" }).clave,
  "estimado",
);

// LLEGAN COMO TEXTO: pg devuelve los count(*) (int8) como string, y "12" > "9"
// en texto pero no en número. Compararlos sin convertir daría mixto donde es
// real.
revisar(
  "los conteos llegan como texto y se comparan como números",
  origenDelFlete({ lineasReales: "100", lineasTotales: "99" }).clave,
  "real",
);

// El orden pone arriba lo que falta cargar, que es lo accionable.
revisar(
  "lo estimado pesa menos que lo real",
  origenDelFlete({ lineasReales: "0", lineasTotales: "5" }).peso <
    origenDelFlete({ lineasReales: "5", lineasTotales: "5" }).peso,
  true,
);

// --- Las empresas del envío ------------------------------------------------
//
// Un mismo envío puede llevar facturas de Quo y de Noa, y ése es justamente el
// motivo por el que la tabla vieja no servía.

revisar("una sola empresa se nombra", resumenEmpresas(["Quo Marketing SRL"]), "Quo Marketing SRL");
revisar(
  "varias se cuentan",
  resumenEmpresas(["Quo Marketing SRL", "Noa Comercial SRL", "Presupuesto QUO"]),
  "3 empresas",
);
revisar("sin empresas no inventa", resumenEmpresas([]), "—");
revisar("ni con null", resumenEmpresas(null), "—");
revisar("los vacíos no cuentan", resumenEmpresas(["", "  ", "Quo"]), "Quo");

// --- El destino ------------------------------------------------------------

revisar(
  "localidad y provincia",
  destino({ localidad: "SAN MIGUEL DE TUCUMAN", provincia: "TUCUMAN" }),
  "SAN MIGUEL DE TUCUMAN, TUCUMAN",
);
// Pasa con CAPITAL FEDERAL y con varias más: repetirlo ocupa la celda sin
// decir nada.
revisar(
  "no se repite cuando son lo mismo",
  destino({ localidad: "CAPITAL FEDERAL", provincia: "Capital Federal" }),
  "Capital Federal",
);
revisar(
  "sin localidad no deja la coma colgada",
  destino({ localidad: null, provincia: "SALTA" }),
  "SALTA",
);
revisar(
  "sin provincia tampoco",
  destino({ localidad: "METAN", provincia: "   " }),
  "METAN",
);
revisar("sin nada", destino({ localidad: null, provincia: null }), "—");

// --- Por qué un renglón da lo que da -------------------------------------
//
// Un margen malo tiene DOS causas y se arreglan de maneras opuestas: o el
// artículo se vendió por debajo del costo --hay que mirarle el precio-- o
// ganaba plata y el flete se la comió --el precio está bien, lo caro es
// mandarlo--. Los dos terminan en un número rojo, y mirando sólo ese número
// los dos parecen el mismo problema.

revisar("si deja plata después del flete, está bien", porQueElMargen(1000, 100), "ok");

// LOS DOS CASOS DE VERDAD, del envío 12750394.
// La pala de pie: ganaba $7.445 y el flete se llevó $34.936.
revisar(
  "una pala de pie: el flete se la comió",
  porQueElMargen(7445.93, 34936.42),
  "flete",
);
// El perfume: perdía $4.863 con $121 de flete. Con flete cero igual perdía.
revisar(
  "un perfume bajo costo: no es el flete",
  porQueElMargen(-4863.94, 121.29),
  "bajo_costo",
);

// SE MIRA PRIMERO EL MARGEN SIN FLETE. Si se mirara el resultado final, los
// dos de arriba darían lo mismo y no habría forma de saber cuál arreglar.
revisar(
  "bajo costo manda aunque el flete sea enorme",
  porQueElMargen(-10, 5000),
  "bajo_costo",
);

// VENDER SIN GANAR NADA NO ES UN CASO APARTE. Tratarlo como "ok" dejaría
// afuera justo la lista de precios desactualizada.
revisar("margen cero es bajo costo", porQueElMargen(0, 10), "bajo_costo");

// Justo en el límite: el flete se lleva exactamente lo que dejaba. No quedó
// nada, así que es un problema, y es del flete.
revisar("el flete se lleva exactamente el margen", porQueElMargen(100, 100), "flete");
revisar("un peso menos de flete y está bien", porQueElMargen(100, 99), "ok");

// Sin flete cargado la pregunta sigue teniendo respuesta: la del artículo.
revisar("sin flete, decide el artículo", porQueElMargen(500, 0), "ok");
revisar("sin flete y bajo costo igual", porQueElMargen(-500, 0), "bajo_costo");

// Un número roto no puede inventar un diagnóstico ni pintar de rojo algo que
// no se sabe.
revisar("un margen roto no diagnostica", porQueElMargen(NaN, 100), "ok");
revisar("un flete roto no cuenta como flete", porQueElMargen(100, NaN), "ok");

console.log(FALLOS.length ? `\n${FALLOS.length} FALLARON: ${FALLOS.join(", ")}` : "\nTODO OK");
process.exit(FALLOS.length ? 1 : 0);
