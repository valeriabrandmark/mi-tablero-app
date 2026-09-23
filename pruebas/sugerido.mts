/**
 * Pruebas del tooltip que explica el sugerido de Compras. Sin base, sin red.
 *
 * POR QUE EXISTE. Este texto es lo único que hay entre un número y una orden de
 * compra firmada: quien decide lee ahí de dónde salió el sugerido y le cree. Un
 * tooltip que dice la cuenta equivocada es peor que uno que no dice nada,
 * porque convence.
 *
 * Y ya pasó una vez. El "habitual" era la MEDIANA de los últimos seis meses
 * contando los ceros, así que un artículo con historia 10 · 10 · 0 · 10 · 0 · 0
 * --el proveedor le da 10 % cada vez que le da algo-- mostraba "10 % contra
 * 5 % habitual: 5 puntos de ventaja" y multiplicaba la compra por 1,17. No
 * había ninguna ventaja: 10 es lo de siempre. Lo encontró ANA leyendo el
 * tooltip de una fila.
 *
 *     node --experimental-strip-types --import ./pruebas/registrar.mjs pruebas/sugerido.mts
 */

import {
  porQueSugerido,
  RECORTES_COMPRAS,
  RECORTES_POR_DEFECTO,
  recortesValidos,
} from "@/lib/compras";
import type { FilaCompra } from "@/lib/types";

const FALLOS: string[] = [];

function revisar(nombre: string, ok: boolean, detalle = "") {
  console.log(ok ? `OK  ${nombre}` : `MAL ${nombre}${detalle ? `\n     ${detalle}` : ""}`);
  if (!ok) FALLOS.push(nombre);
}

/** Dice si el texto del tooltip contiene esa frase. */
function dice(f: FilaCompra, frase: string, cobertura = 30): boolean {
  return porQueSugerido(f, cobertura).join("\n").includes(frase);
}

/** Una fila cualquiera, con lo que haga falta cambiado encima. */
function fila(cambios: Partial<FilaCompra>): FilaCompra {
  return {
    sku: "IM08004",
    producto: "Un artículo",
    proveedor: "IMPROM S.A.",
    grupo: "QUO MKT",
    marca: "BUBBA",
    codigoCompra: "A-123",
    ean: null,
    unidadesPorBulto: 1,
    tuc: 1,
    full: 0,
    total: 1,
    costo: 1000,
    valor: 1000,
    costoLista: 1000,
    sellInPct: 10,
    uds: 74,
    ritmoDiario: 0.62,
    diasRitmo: 120,
    ritmoRecortado: false,
    alta: "2025-03-05",
    esDiscontinuo: false,
    sellInVendidoPct: null,
    sellInVendidoCobertura: null,
    esNuevo: false,
    cobertura: 2,
    sugerido: 24,
    sugeridoMinimo: false,
    sugeridoBase: 24,
    sugeridoTope: 55,
    factorOferta: 1,
    habitualSellIn: 10,
    mesesConOferta: 3,
    sinOfertaPorAhora: false,
    dejoDeTenerSellIn: false,
    udsRentabilidad: 40,
    rentabilidad: 0.3,
    udsMesPasado: 10,
    rentMesPasado: 0.3,
    compradoMesPasado: true,
    unidadesMesPasado: 12,
    proveedorComproMesPasado: true,
    histSellIn: [],
    histCalculado: [],
    ultimaVenta: "2026-09-20",
    ultimaCompra: "2026-08-14",
    ...cambios,
  };
}

// --- El caso que lo pidió: 10 % contra un habitual de 10 %, no de 5 % -------
//
// Historia 10 · 10 · 0 · 10 · 0 · 0. El habitual es el promedio de los meses
// CON oferta (10), no la mediana con los ceros adentro (5).

revisar(
  "el descuento de siempre no es una ventaja",
  dice(fila({ sellInPct: 10, habitualSellIn: 10, factorOferta: 1 }),
       "no supera al habitual"),
);
revisar(
  "y dice contra qué número se comparó",
  dice(fila({ sellInPct: 10, habitualSellIn: 10, factorOferta: 1 }), "(10.0 %)"),
);

// Cuando la ventaja existe de verdad, se explica y se nombra de dónde sale el
// habitual: sin eso, "30 contra 10" invita a preguntar de dónde salió el 10.
revisar(
  "una ventaja real sí se explica",
  dice(fila({ sellInPct: 30, habitualSellIn: 10, factorOferta: 1.67 }),
       "20.0 puntos de ventaja"),
);
revisar(
  "y aclara que el habitual es el promedio de los meses con oferta",
  dice(fila({ sellInPct: 30, habitualSellIn: 10, factorOferta: 1.67 }),
       "el promedio de los meses en que hubo oferta"),
);

// --- El freno: este mes no le dieron oferta y el mes pasado sí --------------

const frenado = fila({
  sellInPct: null,
  habitualSellIn: 20,
  sinOfertaPorAhora: true,
  sugerido: 0,
  sugeridoBase: 24,
});

revisar("el freno dice que este mes no hubo sell in",
  dice(frenado, "Este mes el proveedor NO le dio sell in"));
revisar("y que por eso no se sugiere ni el mínimo",
  dice(frenado, "no se sugiere nada, ni el mínimo"));
revisar("y deja a mano cuánto habría pedido",
  dice(frenado, "daría 24 u."));
// NO tiene que terminar en "Sugerido: 0 u.": ese renglón cierra la cuenta
// normal, y acá la cuenta no es lo que manda.
revisar("no cierra con el sugerido de siempre",
  !dice(frenado, "Sugerido: 0 u."));

// --- El aviso: hace meses que no tiene oferta, pero se compra igual ---------

const sinOfertaHaceRato = fila({
  sellInPct: null,
  habitualSellIn: 20,
  dejoDeTenerSellIn: true,
  mesesConOferta: 4,
  sugerido: 24,
});

revisar("avisa que dejó de tener sell in",
  dice(sinOfertaHaceRato, "hace 3 meses que no tiene sell in"));
revisar("dice en cuántos meses sí tuvo",
  dice(sinOfertaHaceRato, "4 de los últimos 6"));
revisar("y que la compra va a precio de lista",
  dice(sinOfertaHaceRato, "a precio de lista"));
revisar("pero igual cierra con el sugerido",
  dice(sinOfertaHaceRato, "Sugerido: 24 u."));

// --- Lo que ya andaba y tiene que seguir andando ---------------------------

revisar("sin ventas no inventa un ritmo",
  dice(fila({ cobertura: null }), "no hay ritmo con el que calcular nada"));
revisar("la cobertura elegida es la que se nombra",
  dice(fila({}), "Para cubrir 90 días de compra", 90));
revisar("sin sell in cargado, se dice que no hay con qué comparar",
  dice(fila({ sellInPct: null, habitualSellIn: null }),
       "Sin sell in del proveedor con qué comparar"));
revisar("lo que ya sobra no se infla por una oferta",
  dice(fila({ cobertura: 200 }), "la oferta no infla la compra"));

// --- El minimo de un bulto cuando no hay historial de venta ----------------
//
// Sin ventas en la ventana no hay ritmo, asi que la cuenta da 0 y el articulo
// desaparecia de la tabla. Ahora se propone un bulto, y el tooltip tiene que
// dejar claro que ese numero NO es una cuenta: es un punto de partida.

const sinHistorial = fila({
  cobertura: null,
  uds: 0,
  ritmoDiario: 0,
  sugerido: 12,
  sugeridoMinimo: true,
  unidadesPorBulto: 12,
  total: 0,
  esNuevo: false,
});

revisar("dice que es el minimo y cuantas unidades son",
  dice(sinHistorial, "MÍNIMO: 1 bulto = 12 u."));
revisar("y que no es una necesidad medida",
  dice(sinHistorial, "no una necesidad medida"));
revisar("sigue diciendo que no hay ritmo",
  dice(sinHistorial, "no hay ritmo con el que calcular nada"));

// El articulo nuevo sin ventas lleva el mismo minimo pero otra explicacion:
// uno esta muerto y el otro todavia no tuvo la oportunidad.
const nuevoSinVentas = fila({
  ...sinHistorial,
  esNuevo: true,
  alta: "2026-08-12",
});
revisar("el nuevo dice desde cuando existe",
  dice(nuevoSinVentas, "alta el 2026-08-12"));
revisar("y que nunca se compro, si no tiene stock",
  dice(nuevoSinVentas, "nunca se compró"));
revisar("y tambien propone el minimo",
  dice(nuevoSinVentas, "MÍNIMO: 1 bulto"));

// EL FRENO MANDA POR ENCIMA DEL MINIMO. Un articulo al que le sacaron la
// oferta no se compra, tenga o no historial: proponerle un bulto seria
// justamente pagar a precio de lista lo que el mes que viene tiene descuento.
const sinVentasYFrenado = fila({
  ...sinHistorial,
  sugerido: 0,
  sugeridoMinimo: false,
  sinOfertaPorAhora: true,
});
revisar("frenado: no propone ningun minimo",
  !dice(sinVentasYFrenado, "MÍNIMO"));
revisar("frenado: dice por que",
  dice(sinVentasYFrenado, "NO le dio sell in"));

// SIN VENTAS PERO CON STOCK: tampoco el minimo. Proponer un bulto de algo que
// no se vende y que ademas ya esta en el deposito es plata quieta pidiendo mas
// plata quieta. Son 875 de los 4.475 sin ventas.
const sinVentasConStock = fila({
  ...sinHistorial,
  total: 40,
  sugerido: 0,
  sugeridoMinimo: false,
});
revisar("con stock: no propone el minimo",
  !dice(sinVentasConStock, "MÍNIMO"));
revisar("con stock: dice que ya hay mercaderia",
  dice(sinVentasConStock, "ya hay 40 u. en el depósito"));
revisar("con stock: deja la puerta abierta para cargarlo a mano",
  dice(sinVentasConStock, "se carga a mano"));

// --- Los dos frenos duros --------------------------------------------------
//
// Van antes que cualquier cuenta: con cualquiera de los dos puesto no hay
// compra que sugerir, y lo unico que importa es por que.

const discontinuo = fila({ esDiscontinuo: true, sugerido: 0, producto: "DF ALGO" });
revisar("el discontinuo lo dice primero",
  porQueSugerido(discontinuo, 30)[0].startsWith("DISCONTINUO"));
revisar("y aclara que a liquidacion se compra igual",
  dice(discontinuo, "liquidación"));
// No tiene que hablar de ritmo ni de cobertura: no viene al caso.
revisar("el discontinuo no explica cuentas",
  !dice(discontinuo, "Se vende") && !dice(discontinuo, "Sugerido:"));

const sinCosto = fila({ costo: 0, sugerido: 0 });
revisar("el costo 0 lo dice primero",
  porQueSugerido(sinCosto, 30)[0].startsWith("SIN COSTO CARGADO"));
revisar("y explica que Sigma lo rechaza",
  dice(sinCosto, "Sigma rechaza"));
// El discontinuo manda sobre el costo 0: si es las dos cosas, el motivo que
// importa es que el proveedor lo esta dando de baja.
revisar("discontinuo y sin costo: manda el discontinuo",
  porQueSugerido(fila({ esDiscontinuo: true, costo: 0 }), 30)[0]
    .startsWith("DISCONTINUO"));

// --- Con que oferta se vendio lo que se vendio -----------------------------
//
// El sugerido proyecta hacia adelante las unidades de atras, y las unidades
// solas no dicen en que condiciones salieron. Hoy son 372 los articulos cuyo
// ritmo se hizo con una oferta que este mes ya no esta.

const conBuenaOfertaAntes = fila({
  sellInVendidoPct: 40,
  sellInVendidoCobertura: 1,
  sellInPct: 10,
  habitualSellIn: 25,
  diasRitmo: 120,
});
revisar("dice con cuanto sell in se vendio",
  dice(conBuenaOfertaAntes, "se había comprado con 40.0 % de sell in"));
// NO nombra los dias. Este promedio sale de la ventana entera, mientras que
// `diasRitmo` es por articulo: poner ese numero decia "en estos 100 dias" en
// una fila y "120" en la de al lado, por un motivo que no viene al caso.
revisar("y NO inventa una cantidad de dias por articulo",
  !dice(fila({ ...conBuenaOfertaAntes, diasRitmo: 100 }), "en estos 100 días"));
revisar("avisa la caida y cuantos puntos son",
  dice(conBuenaOfertaAntes, "30.0 puntos menos"));
revisar("y por que importa",
  dice(conBuenaOfertaAntes, "puede no repetirse"));
// Con cobertura entera no se nombra: decir "100 %" en cada fila es ruido.
revisar("cobertura entera no se menciona",
  !dice(conBuenaOfertaAntes, "de lo vendido, que es de lo que hay dato"));

// Con cobertura floja SI, porque un promedio sobre el 20 % de lo vendido no se
// puede leer como si fuera el de todas las unidades.
revisar("cobertura floja se aclara",
  dice(fila({ ...conBuenaOfertaAntes, sellInVendidoCobertura: 0.2 }),
       "sobre el 20 % de lo vendido"));

// Sin caida no hay aviso: el ritmo se sostiene en las mismas condiciones.
const mismaOferta = fila({
  sellInVendidoPct: 20,
  sellInVendidoCobertura: 1,
  sellInPct: 20,
});
revisar("sin caida, no avisa",  !dice(mismaOferta, "OJO"));
revisar("pero igual dice con cuanto se vendio",
  dice(mismaOferta, "se había comprado con 20.0 % de sell in"));

// Sin dato no se inventa nada.
revisar("sin sell in de las ventas, no dice nada",
  !dice(fila({ sellInVendidoPct: null }), "se había comprado con"));

// --- Los recortes de la tabla ----------------------------------------------
//
// Llegan de una query string que se puede escribir a mano, asi que lo que no
// existe no puede terminar en un `where`. Y el orden importa: dos URLs con los
// mismos recortes en distinto orden tienen que dar la misma clave de cache.

revisar("los cuatro que existen, en su orden",
  RECORTES_COMPRAS.map((r) => r.valor).join(" ")
    === "sugerido oferta discontinuos sin_ventas",
  RECORTES_COMPRAS.map((r) => r.valor).join(" "));

revisar("arranca recortando a lo que hay que comprar",
  RECORTES_POR_DEFECTO.join() === "sugerido");

revisar("los cuatro se aceptan",
  recortesValidos(["sugerido", "oferta", "discontinuos", "sin_ventas"]).join()
    === "sugerido,oferta,discontinuos,sin_ventas");
revisar("uno solo tambien",
  recortesValidos(["oferta"]).join() === "oferta");

// Sin nada marcado son TODOS los articulos: es el caso que hace falta para
// cargar cantidades a mano en lo que el calculo no pidio.
revisar("lista vacia es lista vacia", recortesValidos([]).length === 0);
revisar("undefined tambien", recortesValidos(undefined).length === 0);
revisar("y algo que no es lista", recortesValidos("sugerido").length === 0);

revisar("lo inventado se descarta",
  recortesValidos(["sugerido", "todos", "xx"]).join() === "sugerido");
revisar("y si es todo inventado no queda nada",
  recortesValidos(["todos"]).length === 0);

// Repetido una sola vez: marcarlo dos veces agregaria la condicion dos veces.
revisar("no repite", recortesValidos(["oferta", "oferta"]).join() === "oferta");
// Siempre en el orden del catalogo, venga como venga.
revisar("normaliza el orden",
  recortesValidos(["sin_ventas", "discontinuos", "oferta", "sugerido"]).join()
    === "sugerido,oferta,discontinuos,sin_ventas");

console.log(FALLOS.length ? `\n${FALLOS.length} FALLARON: ${FALLOS.join(", ")}` : "\nTODO OK");
process.exit(FALLOS.length ? 1 : 0);
