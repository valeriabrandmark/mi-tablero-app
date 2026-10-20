/**
 * El aviso de "se recalcularon cantidades" del borrador de orden de compra.
 * Sin base ni navegador.
 *
 * ---------------------------------------------------------------------------
 * POR QUE EXISTE
 *
 * El borrador guarda LAS DECISIONES, no la orden: lo que la persona cargó a
 * mano y lo que sacó. Todo lo demás --el sugerido de cada artículo-- se vuelve
 * a calcular al retomarlo.
 *
 * Es la decisión más importante del diseño y es la correcta: un borrador del
 * viernes abierto el lunes tiene que mostrar los números del LUNES. Guardando
 * la orden entera mostraría los del viernes y nadie se enteraría.
 *
 * Pero tiene una consecuencia que hay que decir en voz alta: la orden puede
 * cambiar sola entre que se guarda y se retoma, porque el pipeline corre cada
 * hora y media y los sugeridos salen de las ventas. Sin este aviso, alguien
 * retomaría el borrador de ayer, lo bajaría convencido de que es el que dejó,
 * y serían otras cantidades.
 *
 *     node --experimental-strip-types --import ./pruebas/registrar.mjs pruebas/borrador-orden.mts
 */

import {
  firmaDeLasDecisiones,
  queSeRecalculo,
  type RenglonOrden,
} from "@/lib/compras";

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

/** Los sugeridos de hoy, como los arma la pantalla desde la lista completa. */
const hoy = (o: Record<string, number>) => new Map(Object.entries(o));
/** Las ediciones; sólo importa QUE SKU está tocado, no con qué cantidad. */
const tocados = (...skus: string[]) =>
  new Map(skus.map((s) => [s, { cantidad: 1 }]));

const SIN_TOCAR = new Map<string, { cantidad: number }>();

// --- Cuándo NO hay que avisar ----------------------------------------------
//
// Avisar de más es tan malo como no avisar: un aviso que aparece siempre se
// deja de leer, y éste tiene que frenar a alguien que está por bajar un
// archivo.

revisar("sin borrador guardado no hay nada que comparar", queSeRecalculo({}, hoy({ A: 5 }), SIN_TOCAR), []);

revisar(
  "los sugeridos iguales no son un cambio",
  queSeRecalculo({ A: 5, B: 0 }, hoy({ A: 5, B: 0 }), SIN_TOCAR),
  [],
);

// DOS CEROS NO SON UN CAMBIO NI CUANDO UNO DE LOS DOS FALTA. Un artículo que
// no se sugería y sigue sin sugerirse --porque salió de la lista, por ejemplo--
// no movió nada: informarlo llenaría el aviso de renglones que nunca
// estuvieron en la orden.
revisar(
  "un cero que ahora no está sigue siendo cero",
  queSeRecalculo({ A: 0 }, hoy({}), SIN_TOCAR),
  [],
);

// LO EDITADO NO SE INFORMA, y es la mitad del diseño. Si la persona puso una
// cantidad a mano, el sugerido ya no decide nada en ese renglón: su decisión
// está intacta. Avisar de un número que no se usa es ruido justo en el aviso
// que no puede ser ruido.
revisar(
  "lo que se cargó a mano no se informa aunque el sugerido se haya movido",
  queSeRecalculo({ A: 5 }, hoy({ A: 40 }), tocados("A")),
  [],
);

// --- Cuándo SÍ -------------------------------------------------------------

revisar(
  "subió",
  queSeRecalculo({ A: 5 }, hoy({ A: 8 }), SIN_TOCAR),
  [{ sku: "A", antes: 5, ahora: 8 }],
);

revisar(
  "bajó",
  queSeRecalculo({ A: 8 }, hoy({ A: 5 }), SIN_TOCAR),
  [{ sku: "A", antes: 8, ahora: 5 }],
);

// EMPEZO A SUGERIRSE. Pasa cuando el artículo vendió en el medio, o cuando
// llegó mercadería y el cálculo cambió de opinión.
revisar(
  "lo que antes no se sugería y ahora sí",
  queSeRecalculo({ A: 0 }, hoy({ A: 12 }), SIN_TOCAR),
  [{ sku: "A", antes: 0, ahora: 12 }],
);

// DEJO DE ESTAR EN LA LISTA. Es un caso real: si se quedó sin stock en los dos
// depósitos sale de la consulta, y el renglón que estaba en la orden
// desaparece. Que desaparezca está bien; que desaparezca en silencio, no.
revisar(
  "un SKU que ya no está cuenta como cero",
  queSeRecalculo({ A: 12 }, hoy({}), SIN_TOCAR),
  [{ sku: "A", antes: 12, ahora: 0 }],
);

// --- El orden del listado --------------------------------------------------
//
// Vienen por cuánto se movieron, de mayor a menor: si hay treinta cambios, la
// pantalla muestra los doce primeros y tienen que ser los que pueden cambiar
// la orden de verdad, no los que empiezan con A.

revisar(
  "primero los que más se movieron",
  queSeRecalculo(
    { CHICO: 10, GRANDE: 10, MEDIO: 10 },
    hoy({ CHICO: 11, GRANDE: 200, MEDIO: 30 }),
    SIN_TOCAR,
  ).map((r) => r.sku),
  ["GRANDE", "MEDIO", "CHICO"],
);

// Bajar 50 pesa igual que subir 50: las dos cambian la orden en la misma
// medida, y una que baja a cero saca un renglón entero del archivo.
revisar(
  "subir y bajar pesan lo mismo",
  queSeRecalculo({ SUBE: 10, BAJA: 60 }, hoy({ SUBE: 60, BAJA: 10 }), SIN_TOCAR).map(
    (r) => r.sku,
  ),
  ["BAJA", "SUBE"],
);

// Con el mismo movimiento, el SKU decide: sin esto el orden dependería de cómo
// vino el jsonb de la base y la lista se reordenaría sola entre dos cargas.
revisar(
  "a igual movimiento, ordenado por SKU",
  queSeRecalculo({ GL02: 10, GL01: 10 }, hoy({ GL02: 15, GL01: 15 }), SIN_TOCAR).map(
    (r) => r.sku,
  ),
  ["GL01", "GL02"],
);

// --- El caso completo ------------------------------------------------------
//
// Un borrador de ayer con las cuatro cosas a la vez, que es como llega en la
// vida real.
revisar(
  "un borrador de ayer, con todo junto",
  queSeRecalculo(
    {
      QUIETO: 6, //        igual: no se informa
      CARGADO: 4, //       tocado a mano: no se informa
      SUBIO: 10, //        +14
      SE_FUE: 3, //        salió de la lista: -3
      ARRANCO: 0, //       empezó a sugerirse: +2
    },
    hoy({ QUIETO: 6, CARGADO: 99, SUBIO: 24, ARRANCO: 2 }),
    tocados("CARGADO"),
  ),
  [
    { sku: "SUBIO", antes: 10, ahora: 24 },
    { sku: "SE_FUE", antes: 3, ahora: 0 },
    { sku: "ARRANCO", antes: 0, ahora: 2 },
  ],
);

// --- La firma de las decisiones --------------------------------------------
//
// Con esto se sabe si lo que hay en pantalla es lo mismo que la base tiene
// guardado. Se calcula en DOS lugares --con lo que hay en pantalla y con lo
// que vino de la base-- y de que las dos cuentas coincidan dependen dos cosas:
// que el borrador no se guarde en loop al abrirlo, y que el cartel de "¿salir
// del sitio?" aparezca cuando hay algo que perder y sólo cuando lo hay.

const renglon = (p: Partial<RenglonOrden> = {}): RenglonOrden => ({
  unidad: "unidad",
  cantidad: 1,
  descuento: 0,
  descuento2: 0,
  ...p,
});

revisar(
  "las mismas decisiones dan la misma firma",
  firmaDeLasDecisiones("GLAM", "Ofertas", new Map([["A", renglon()]])) ===
    firmaDeLasDecisiones("GLAM", "Ofertas", new Map([["A", renglon()]])),
  true,
);

// EL ORDEN DEL MAP ES EL ORDEN EN QUE SE TOCO CADA ARTICULO. Dos personas que
// llegan a la misma orden por caminos distintos --una cargó A y después B, la
// otra al revés-- tienen que dar la misma firma. Si no, el borrador se
// guardaría de nuevo después de retomarlo, con la foto nueva adentro, y el
// aviso de recalculado se borraría solo.
revisar(
  "el orden en que se cargaron los artículos no cambia la firma",
  firmaDeLasDecisiones(
    "GLAM",
    "",
    new Map([
      ["A", renglon()],
      ["B", renglon({ cantidad: 9 })],
    ]),
  ) ===
    firmaDeLasDecisiones(
      "GLAM",
      "",
      new Map([
        ["B", renglon({ cantidad: 9 })],
        ["A", renglon()],
      ]),
    ),
  true,
);

// Y todo lo que SÍ es una decisión tiene que mover la firma, o se perdería sin
// guardarse.
const base = firmaDeLasDecisiones("GLAM", "", new Map([["A", renglon()]]));

revisar(
  "cambiar la cantidad mueve la firma",
  firmaDeLasDecisiones("GLAM", "", new Map([["A", renglon({ cantidad: 2 })]])) !==
    base,
  true,
);
revisar(
  "cambiar la unidad también",
  firmaDeLasDecisiones("GLAM", "", new Map([["A", renglon({ unidad: "bulto" })]])) !==
    base,
  true,
);
revisar(
  "cambiar un descuento también",
  firmaDeLasDecisiones("GLAM", "", new Map([["A", renglon({ descuento: 15 })]])) !==
    base,
  true,
);
revisar(
  "cambiar el segundo descuento también",
  firmaDeLasDecisiones("GLAM", "", new Map([["A", renglon({ descuento2: 5 })]])) !==
    base,
  true,
);
revisar(
  "la nota también",
  firmaDeLasDecisiones("GLAM", "Ofertas", new Map([["A", renglon()]])) !== base,
  true,
);
revisar(
  "sacar un artículo también",
  firmaDeLasDecisiones("GLAM", "", new Map()) !== base,
  true,
);

// EL PROVEEDOR ENTRA EN LA FIRMA: un borrador es de una persona y de un
// proveedor. Sin esto, cambiar de proveedor con las mismas cantidades cargadas
// pasaría por "ya guardado".
revisar(
  "el proveedor entra en la firma",
  firmaDeLasDecisiones("COTY", "", new Map([["A", renglon()]])) !== base,
  true,
);

console.log(FALLOS.length ? `\n${FALLOS.length} FALLARON: ${FALLOS.join(", ")}` : "\nTODO OK");
process.exit(FALLOS.length ? 1 : 0);
