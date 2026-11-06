import { joinCostoDelDia } from "@/lib/sql-costos";
import { joinCostos } from "@/lib/sql-descuentos";

/* ===========================================================================
   EL COSTO DEL DIA DE LA VENTA: GUARDARRAILES DEL SQL

   POR QUÉ ESTO SE PRUEBA MIRANDO EL TEXTO DEL SQL

   Lo que hace este fragmento sólo se puede probar de verdad contra Postgres, y
   acá no hay base. Pero tiene tres propiedades que SÍ se pueden fijar leyendo
   el SQL que genera, y que son justo las tres que se pierden al editarlo sin
   saber por qué estaban:

   1. LA IGUALDAD SOBRE `mes_comercial`. La herencia se escribe resolviendo
      CUÁL mes mirar (un `case`), y no con `mes = el suyo or mes = el anterior`.
      Con el `or`, Postgres pierde la igualdad y con ella el índice
      `(sku, mes_comercial, vigente_desde)`: medido, 642 ms contra 78 sobre
      tres días de ventas de Mercado Libre. Es la primera forma en que a
      cualquiera se le ocurre escribir esto, y es 8 veces más lenta.

   2. UN MES DE GRACIA Y NO MÁS. Si el mes anterior tampoco tiene lista, no hay
      costo y la pantalla muestra un guión. Sin ese techo, diciembre quedaría
      valuado con los costos de septiembre sin que nadie se entere.

   3. EL DESEMPATE DEL BOTÓN. Cuando el Excel y el botón escriben el mismo día,
      gana el botón. Sin eso, `limit 1` se queda con lo que Postgres devuelva
      primero y el costo del tablero depende del plan de ejecución.

   Y una cuarta, que ya costó un build: NADA DE ACENTOS GRAVES adentro del SQL.
   Vive en un template literal y uno solo parte la cadena en dos.
   ========================================================================= */

const FALLOS: string[] = [];

function revisar(nombre: string, obtenido: unknown, esperado: unknown) {
  const ok = obtenido === esperado;
  console.log(
    ok
      ? `OK  ${nombre}`
      : `MAL ${nombre}\n     esperado: ${JSON.stringify(esperado)}\n     obtenido: ${JSON.stringify(obtenido)}`,
  );
  if (!ok) FALLOS.push(nombre);
}

const sql = joinCostoDelDia("fv", "c.oferta_pct, c.desc_propio_pct");

/* --- 1. LA IGUALDAD SOBRE EL MES ---------------------------------------- */

revisar(
  "el mes se resuelve con un case, no con un or",
  /and c\.mes_comercial = case/.test(sql),
  true,
);

// La prueba que importa: ningún `or` adentro del lateral. Si alguien reescribe
// la herencia como una condición en vez de un valor, esto se rompe.
revisar(
  "no hay ningun or en la condicion",
  /\bor\b/i.test(sql),
  false,
);

// Y la subconsulta de los meses tiene que quedar SIN CORRELACIONAR --no mira
// ninguna columna de la tabla de ventas-- para que Postgres la hashee y la
// resuelva una vez. Un `exists` que mire `fv` la ejecuta por cada línea.
const meses = sql.slice(sql.indexOf("in ("), sql.indexOf("then"));
revisar("la subconsulta de meses no mira la tabla de ventas", meses.includes("fv."), false);
revisar("y agrupa en vez de usar exists", meses.includes("group by mes_comercial"), true);

/* --- 2. UN MES DE GRACIA ------------------------------------------------ */

revisar("se mira un mes para atras", sql.includes("interval '1 month'"), true);
revisar("y nada mas que uno", /interval '[2-9] month/.test(sql), false);

/* --- 3. EL DESEMPATE DEL BOTON ------------------------------------------ */

revisar(
  "el tramo del tablero desempata",
  sql.includes("(c.origen = 'tablero') desc"),
  true,
);
revisar(
  "y antes manda la vigencia mas nueva",
  sql.indexOf("c.vigente_desde desc") < sql.indexOf("(c.origen = 'tablero') desc"),
  true,
);

/* --- LO QUE YA TENIA QUE SEGUIR ESTANDO --------------------------------- */

revisar("sigue siendo un lateral", sql.startsWith("left join lateral ("), true);
revisar("devuelve una fila o ninguna", sql.includes("limit 1"), true);
revisar("se cuelga como ch", sql.trimEnd().endsWith(") ch on true"), true);
revisar("filtra por el sku de la venta", sql.includes("c.sku = fv.sku"), true);
revisar("y no toma tramos futuros", sql.includes("c.vigente_desde <= fv.fecha"), true);

// El alias entra tal cual: las consultas lo llaman con distintas tablas.
const conOtroAlias = joinCostoDelDia("v", "c.costo_real");
revisar("respeta el alias que le pasan", conOtroAlias.includes("c.sku = v.sku"), true);
revisar("tambien adentro del case", conOtroAlias.includes("v.mes_comercial in ("), true);
revisar("y las columnas pedidas", conOtroAlias.includes("select c.costo_real"), true);

/* --- NADA DE ACENTOS GRAVES --------------------------------------------- */

revisar("sin acentos graves en el SQL", sql.includes("`"), false);

/* --- EL QUE USAN LAS PANTALLAS DE VENTA --------------------------------- */

// `joinCostos` es el envoltorio que usan Mercado Libre y Tienda Nube. Hereda
// lo mismo porque llama al de arriba; si alguien lo reescribiera aparte, estas
// dos lo delatan.
const conDescuentos = joinCostos("fv");
revisar(
  "joinCostos hereda igual",
  conDescuentos.includes("and c.mes_comercial = case"),
  true,
);
revisar("y tampoco tiene ors", /\bor\b/i.test(conDescuentos), false);

console.log(
  FALLOS.length ? `\n${FALLOS.length} FALLARON: ${FALLOS.join(", ")}` : "\nTODO OK",
);
process.exit(FALLOS.length ? 1 : 0);
