/**
 * Pruebas de quién ve qué. Sin base, sin red, sin navegador.
 *
 * POR QUÉ EXISTE. El 16/09/2026 se cargó un usuario con Precios TN tildado y el
 * módulo no le aparecía. La causa era el ORDEN de los bloques de `puedeVer`: la
 * excepción de Precios TN se evaluaba antes que el permiso a medida y contestaba
 * por él. Había pruebas del catálogo de módulos y pasaban todas — pero ninguna
 * llamaba a `puedeVer`, que es la función que deciden las tres barreras.
 *
 * Un permiso que falla no se ve como un error: se ve como un menú al que le
 * falta una entrada, y eso se descubre cuando alguien se queja.
 *
 *     node --experimental-strip-types --import ./pruebas/registrar.mjs pruebas/permisos.mts
 */

import { moduloDeRuta, moduloPermiteRuta } from "@/lib/modulos";
import { puedeEditar, puedeVer, type Permiso } from "@/lib/permisos";

const FALLOS: string[] = [];

function revisar(nombre: string, obtenido: unknown, esperado: unknown) {
  const ok = JSON.stringify(obtenido) === JSON.stringify(esperado);
  console.log(
    ok ? `OK  ${nombre}` : `MAL ${nombre}\n     esperado: ${esperado}\n     obtenido: ${obtenido}`,
  );
  if (!ok) FALLOS.push(nombre);
}

// --- El catálogo: de quién es cada ruta -------------------------------------
//
// Lo que importa acá es que gana el prefijo MÁS LARGO. /stock/compras empieza
// con /stock: sin esa regla, ver Stock abriría Compras de regalo — y Compras es
// el módulo que manda órdenes al ERP.

revisar("compras es de compras", moduloDeRuta("/stock/compras"), "compras");
revisar("su api también", moduloDeRuta("/api/compras/sigma"), "compras");
revisar("stock es de stock", moduloDeRuta("/stock"), "stock");
revisar("antigüedad es de stock", moduloDeRuta("/stock/antiguedad"), "stock");
revisar("una ruta de nadie", moduloDeRuta("/inventada"), null);

revisar("con stock NO se entra a compras", moduloPermiteRuta(["stock"], "/stock/compras"), false);
revisar("con compras NO se entra a stock", moduloPermiteRuta(["compras"], "/stock"), false);
revisar("sin módulos no se ve nada", moduloPermiteRuta([], "/api/filtros"), false);

// --- puedeVer, que es la función que usan las tres barreras -----------------

const tiendaNube: Permiso = {
  rol: "personalizado",
  modulos: ["tienda_nube", "precios_tn"],
  editar: ["precios_tn"],
  sigma: null,
  nombreSigma: null,
};

// EL CASO QUE SE ESCAPÓ. Tenía el módulo marcado y no lo veía.
revisar("a medida: ve Precios TN", puedeVer(tiendaNube, "/precios-tn"), true);
revisar("a medida: ve su api", puedeVer(tiendaNube, "/api/precios-tn"), true);
revisar("a medida: ve el tablero de Tienda Nube",
  puedeVer(tiendaNube, "/venta-minorista/tienda-nube"), true);
revisar("a medida: ve la portada de minorista",
  puedeVer(tiendaNube, "/venta-minorista"), true);
revisar("a medida: NO ve Mercado Libre",
  puedeVer(tiendaNube, "/venta-minorista/mercado-libre"), false);
revisar("a medida: NO ve mayoristas", puedeVer(tiendaNube, "/ventas-mayoristas"), false);
revisar("a medida: NO ve compras", puedeVer(tiendaNube, "/stock/compras"), false);
revisar("a medida: ve su cuenta", puedeVer(tiendaNube, "/cuenta"), true);

const soloMira: Permiso = {
  rol: "personalizado",
  modulos: ["precios_tn"],
  editar: [],
  sigma: null,
  nombreSigma: null,
};
revisar("sólo ver: entra al módulo", puedeVer(soloMira, "/precios-tn"), true);
revisar("sólo ver: NO aprueba", puedeEditar(soloMira, "precios_tn"), false);
revisar("el otro sí aprueba", puedeEditar(tiendaNube, "precios_tn"), true);
revisar("y ninguno manda órdenes", puedeEditar(tiendaNube, "compras"), false);

// --- Los roles viejos siguen exactamente como estaban -----------------------
//
// La excepción de Precios TN existe para dejar a `admin` afuera. Moverla de
// lugar para arreglar lo de arriba no podía cambiar esto.

revisar("admin NO ve Precios TN", puedeVer({ rol: "admin" }, "/precios-tn"), false);
revisar("admin ve el resto", puedeVer({ rol: "admin" }, "/ventas-mayoristas"), true);
revisar("superadmin ve Precios TN", puedeVer({ rol: "superadmin" }, "/precios-tn"), true);
revisar("admin_tn ve Precios TN", puedeVer({ rol: "admin_tn" }, "/precios-tn"), true);
revisar("admin_tn no ve nada más", puedeVer({ rol: "admin_tn" }, "/ventas-mayoristas"), false);
revisar("meli ve lo suyo",
  puedeVer({ rol: "responsable_meli" }, "/venta-minorista/mercado-libre"), true);
revisar("meli NO ve Precios TN", puedeVer({ rol: "responsable_meli" }, "/precios-tn"), false);
revisar("sin permiso, nada", puedeVer(null, "/ventas-mayoristas"), false);

// --- "Actualizar ahora" la aprieta cualquiera que tenga algo que mirar -------
//
// Es la ruta que le pide al pipeline que traiga datos frescos. No es de ningún
// módulo y no escribe nada: quien sólo mira tiene el mismo problema con un dato
// de hace tres horas que quien puede editar.
//
// Los casos que importan son los roles viejos ACOTADOS. El responsable de Meli
// y los vendedores son justamente quienes miran los dos tableros donde está el
// botón, y sus reglas se resuelven por listas cerradas de rutas: sin una regla
// propia, el botón les contestaría 403 y el resto del tablero andaría igual --
// o sea que el error se vería como un botón que no hace nada.

const ACTUALIZAR = "/api/actualizar";
const vendedorSilvio: Permiso = { rol: "vendedor", vendedor: "SILVIO" };

revisar("el responsable de Meli puede actualizar",
  puedeVer({ rol: "responsable_meli" }, ACTUALIZAR), true);
revisar("un vendedor puede actualizar", puedeVer(vendedorSilvio, ACTUALIZAR), true);
revisar("un supervisor puede actualizar", puedeVer({ rol: "supervisor" }, ACTUALIZAR), true);
revisar("un admin puede actualizar", puedeVer({ rol: "admin" }, ACTUALIZAR), true);
revisar("y el admin_tn también",
  puedeVer({ rol: "admin_tn" }, ACTUALIZAR), true);
revisar("un personalizado con módulos puede", puedeVer(soloMira, ACTUALIZAR), true);

// Sin módulos no ve ninguna pantalla, así que no tiene qué actualizar: dejarlo
// disparar corridas del pipeline sería darle lo único que puede hacer.
const sinNada: Permiso = {
  rol: "personalizado",
  modulos: [],
  editar: [],
  sigma: null,
  nombreSigma: null,
};
revisar("un personalizado SIN módulos no puede", puedeVer(sinNada, ACTUALIZAR), false);
revisar("sin sesión tampoco", puedeVer(null, ACTUALIZAR), false);

console.log(FALLOS.length ? `\n${FALLOS.length} FALLARON: ${FALLOS.join(", ")}` : "\nTODO OK");
process.exit(FALLOS.length ? 1 : 0);
