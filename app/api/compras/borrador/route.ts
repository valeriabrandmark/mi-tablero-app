import { NextResponse } from "next/server";
import { enConstruccion, permisoDelUsuario, puedeVer, puedeVerBorradores } from "@/lib/permisos";
import {
  borrarBorrador,
  getBorrador,
  getBorradoresVigentes,
  guardarBorrador,
  type RenglonBorrador,
} from "@/lib/queries-borrador";
import { authConfigurada } from "@/lib/supabase/env";
import { getUsuario } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * El borrador de una orden de compra a medio armar.
 *
 * ---------------------------------------------------------------------------
 * EL BORRADOR ES DE CADA UNO, Y ESO NO ES UN PERMISO SINO LA CLAVE
 *
 * El usuario nunca viaja en el pedido: sale de la sesión, acá. Mandarlo desde
 * el navegador dejaría que cualquiera leyera o pisara el borrador de otro con
 * sólo cambiar un parámetro -- y no haría falta ningún permiso especial,
 * porque todos los que ven Compras pueden usar esta ruta.
 *
 * ALCANZA CON VER COMPRAS. Guardar un borrador no escribe en el ERP ni cambia
 * lo que nadie más ve: es la pantalla acordándose de lo que esa persona estaba
 * haciendo. Mandar la orden sí pide más, y eso lo chequea su propia ruta.
 */

type Sesion = { usuario: string } | { error: NextResponse };

async function sesion(): Promise<Sesion> {
  if (!authConfigurada) {
    // Sin auth (desarrollo local) hay un solo usuario y es cualquiera.
    return { usuario: "local" };
  }

  const u = await getUsuario();
  const permiso = permisoDelUsuario(u);

  if (!puedeVer(permiso, "/api/compras")) {
    return { error: NextResponse.json({ error: "Sin permiso" }, { status: 403 }) };
  }
  if (enConstruccion("/stock/compras") && !puedeVerBorradores(permiso)) {
    return { error: NextResponse.json({ error: "En construcción" }, { status: 403 }) };
  }

  // Sin identidad no hay de quién sea el borrador. No debería pasar --`puedeVer`
  // ya devolvió true-- pero guardar todo bajo "" mezclaría a todos en uno.
  const usuario = u?.email ?? u?.id ?? "";
  if (!usuario) {
    return { error: NextResponse.json({ error: "Sin usuario" }, { status: 403 }) };
  }

  return { usuario };
}

/**
 * Lee el borrador de un proveedor, o la lista de los que hay si no se pide uno.
 * La lista es lo que deja avisar "tenés una orden a medio armar" sin que haya
 * que acordarse de con qué proveedor era.
 */
export async function GET(request: Request) {
  const s = await sesion();
  if ("error" in s) return s.error;

  const proveedor = new URL(request.url).searchParams.get("proveedor");

  try {
    if (!proveedor) {
      return NextResponse.json({ borradores: await getBorradoresVigentes(s.usuario) });
    }
    return NextResponse.json({ borrador: await getBorrador(s.usuario, proveedor) });
  } catch (error) {
    console.error("[api/compras/borrador] GET", error);
    return NextResponse.json({ error: "No se pudo leer el borrador" }, { status: 500 });
  }
}

/** Cuántos renglones puede tener un borrador. Ver abajo. */
const MAX_RENGLONES = 5000;

/** Una decisión del navegador, saneada. Devuelve null si no es una. */
function renglonValido(v: unknown): RenglonBorrador | null {
  if (typeof v !== "object" || v === null) return null;
  const r = v as Record<string, unknown>;
  const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : 0);
  if (typeof r.unidad !== "string") return null;
  return {
    unidad: r.unidad === "bulto" ? "bulto" : "unidad",
    cantidad: Math.max(0, num(r.cantidad)),
    descuento: num(r.descuento),
    descuento2: num(r.descuento2),
  };
}

/**
 * Guarda el borrador. Lo llama el guardado automático de la pantalla, así que
 * entra seguido: tiene que ser barato y no tirar nunca por un dato raro.
 *
 * SE SANEA TODO LO QUE ENTRA aunque venga de nuestra propia pantalla. Esto
 * escribe un jsonb que después se lee para armar una orden de compra; un campo
 * inventado desde la consola del navegador terminaría en el archivo que se le
 * manda al proveedor. Lo que no se reconoce no se guarda.
 */
export async function PUT(request: Request) {
  const s = await sesion();
  if ("error" in s) return s.error;

  let cuerpo: unknown;
  try {
    cuerpo = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }

  const b = cuerpo as Record<string, unknown>;
  const proveedor = typeof b.proveedor === "string" ? b.proveedor.trim() : "";
  if (!proveedor) {
    return NextResponse.json({ error: "Falta el proveedor" }, { status: 400 });
  }

  const entero = (v: unknown) =>
    typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : null;
  const texto = (v: unknown, max: number) =>
    typeof v === "string" && v.trim() !== "" ? v.slice(0, max) : null;

  const renglones: Record<string, RenglonBorrador> = {};
  if (typeof b.renglones === "object" && b.renglones !== null) {
    for (const [sku, valor] of Object.entries(b.renglones)) {
      // El tope no es por la base --son unos kB-- sino para que un bucle mal
      // escrito en el navegador no pueda escribir sin fin.
      if (Object.keys(renglones).length >= MAX_RENGLONES) break;
      const r = renglonValido(valor);
      if (r) renglones[sku] = r;
    }
  }

  const sugeridos: Record<string, number> = {};
  if (typeof b.sugeridos === "object" && b.sugeridos !== null) {
    for (const [sku, valor] of Object.entries(b.sugeridos)) {
      if (Object.keys(sugeridos).length >= MAX_RENGLONES) break;
      if (typeof valor === "number" && Number.isFinite(valor)) sugeridos[sku] = valor;
    }
  }

  try {
    await guardarBorrador(s.usuario, {
      proveedor,
      mes: texto(b.mes, 20),
      ventana: entero(b.ventana),
      cobertura: entero(b.cobertura),
      nota: texto(b.nota, 120),
      renglones,
      sugeridos,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[api/compras/borrador] PUT", error);
    return NextResponse.json({ error: "No se pudo guardar" }, { status: 500 });
  }
}

/** Lo descarta. Lo llama el botón y también el envío, cuando la orden ya salió. */
export async function DELETE(request: Request) {
  const s = await sesion();
  if ("error" in s) return s.error;

  const proveedor = new URL(request.url).searchParams.get("proveedor");
  if (!proveedor) {
    return NextResponse.json({ error: "Falta el proveedor" }, { status: 400 });
  }

  try {
    await borrarBorrador(s.usuario, proveedor);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[api/compras/borrador] DELETE", error);
    return NextResponse.json({ error: "No se pudo descartar" }, { status: 500 });
  }
}
