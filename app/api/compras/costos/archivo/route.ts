import { NextResponse, type NextRequest } from "next/server";
import { permisoDelUsuario } from "@/lib/permisos";
import { caratulaDeTramo, filasDeTramo, fotoParaArchivo, listarTramos } from "@/lib/queries-costos";
import { libroDeCostos, nombreDelArchivo } from "@/lib/exportar-costos";
import { authConfigurada } from "@/lib/supabase/env";
import { getUsuario } from "@/lib/supabase/server";
import { aXlsx } from "@/lib/xlsx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Bajar una foto de costos como Excel.
 *
 * ---------------------------------------------------------------------------
 * EL ARCHIVO SE ARMA ACA Y NO EN EL NAVEGADOR
 *
 * Son ocho mil filas. Armarlo del lado del cliente obligaría a mandarle las
 * ocho mil --con proveedor, descripción y costo anterior, que la pantalla no
 * usa-- para que escriba un archivo. Y los tramos viejos no los tiene: habría
 * que mandárselos igual. Acá ya están.
 *
 * SIN PARAMETROS baja la foto de ahora, todavía sin aplicar. Con `mes`,
 * `desde` y `origen` baja un tramo guardado.
 */
async function puede(): Promise<boolean> {
  if (!authConfigurada) return true;
  // EL MISMO ROL QUE PARA APLICAR. El archivo tiene el costo de cada artículo
  // del catálogo: es la lista de precios de compra entera.
  return permisoDelUsuario(await getUsuario())?.rol === "superadmin";
}

export async function GET(request: NextRequest) {
  if (!(await puede())) {
    return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  }

  const p = request.nextUrl.searchParams;
  const mes = p.get("mes");
  const desde = p.get("desde");
  const origen = p.get("origen");

  try {
    const { libro, nombre } =
      mes && desde && origen
        ? await libroDeUnTramo(mes, desde, origen)
        : await libroDeLaFoto();

    if (!libro) {
      return NextResponse.json({ error: "No existe esa foto." }, { status: 404 });
    }

    const bytes = aXlsx(libro);
    return new NextResponse(bytes, {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${nombre}"`,
        // NO SE CACHEA. La foto sin aplicar cambia cada vez que llega una
        // planilla nueva, y bajar la de ayer creyendo que es la de hoy es
        // exactamente el error que este archivo tiene que evitar.
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : "Error desconocido";
    console.error("[api/compras/costos/archivo]", error);
    return NextResponse.json({ error: mensaje }, { status: 500 });
  }
}

async function libroDeLaFoto() {
  const { caratula, filas, mes, vigenteDesde } = await fotoParaArchivo();
  return {
    libro: libroDeCostos(caratula, filas),
    nombre: `costos-foto-${mes}-${vigenteDesde}.xlsx`,
  };
}

async function libroDeUnTramo(mes: string, desde: string, origen: string) {
  // SE BUSCA EN LA LISTA en vez de confiar en los tres parámetros: así el
  // archivo sale con los contadores y la nota del tramo, y de paso un pedido
  // con valores inventados devuelve 404 en vez de un archivo vacío.
  const tramos = await listarTramos(200);
  const tramo = tramos.find(
    (t) => t.mes === mes && t.vigenteDesde === desde && t.origen === origen,
  );
  if (!tramo) return { libro: null, nombre: "" };

  const filas = await filasDeTramo(mes, desde, origen);
  return {
    libro: libroDeCostos(caratulaDeTramo(tramo), filas),
    nombre: nombreDelArchivo(mes, desde),
  };
}
