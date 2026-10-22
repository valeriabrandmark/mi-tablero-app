"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Aviso, Esqueleto, Panel, TarjetaKpi } from "@/components/ui";
import {
  buscarArticulo,
  cruzar,
  indexarMaestro,
  leerNumero,
  renglonesDeOrdenEnviada,
  totalesComprobante,
  type ArticuloMaestro,
  type EstadoCruce,
  type LineaCruce,
  type RenglonFactura,
  type RenglonOC,
  type ResultadoCruce,
  type TotalesComprobante,
  CLASES_DIFERENCIA,
  entraEnLaTabla,
  type ClaseDiferencia,
} from "@/lib/factura-cruce";
import {
  armarImportCompras,
  CONCEPTOS_PERCEPCION,
  EMPRESAS_SIGMA,
  SUCURSALES_SIGMA,
  type DatosFactura,
  type Imputacion,
} from "@/lib/sigma-compra";
import { fmtMoneda, fmtNumero } from "@/lib/format";
import type { OrdenEnviada } from "@/lib/queries-ordenes";

/* -------------------------------------------------------------------------
   LO QUE SE GUARDA EN EL NAVEGADOR

   Una factura de 80 renglones a medio tipear no se puede perder porque se
   cerró la pestaña. Se guarda en este navegador y nada más: es un borrador de
   trabajo, no un registro. Si el navegador no deja guardar (ventana privada),
   la pantalla anda igual.
   ------------------------------------------------------------------------- */

const CLAVE_BORRADOR = "carga-factura:borrador:v2";

type Unidad = "U" | "B";

/** Un renglón de la factura tal como se tipea. Todo texto: se lee al cruzar. */
type LineaCarga = {
  id: string;
  /** SKU, EAN o código de compra del proveedor: cualquiera sirve. */
  codigo: string;
  cantidad: string;
  unidad: Unidad;
  /** Importe neto de la línea, sin IVA y con las bonificaciones del renglón. */
  importe: string;
};

type Cabecera = {
  /**
   * QUE COMPROBANTE ES. 'F' factura, 'C' nota de crédito, 'D' nota de débito.
   *
   * No es un detalle de presentación: viaja a Sigma como `tipoComprobante` y
   * decide el SIGNO del asiento. Una nota de crédito cargada como factura es
   * plata sumada donde había que restarla.
   */
  tipo: "F" | "C" | "D";
  letra: "A" | "B" | "C" | "M";
  numero: string;
  fecha: string;
};

const TIPOS_COMPROBANTE: { valor: Cabecera["tipo"]; label: string }[] = [
  { valor: "F", label: "Factura" },
  { valor: "C", label: "Nota de crédito" },
  { valor: "D", label: "Nota de débito" },
];

type Borrador = {
  proveedor: string;
  ordenId: string;
  cabecera: Cabecera;
  lineas: LineaCarga[];
  descuentoPie: string;
  otrosImpuestos: string;
  totalImpreso: string;
  /**
   * A QUE EMPRESA Y SUCURSAL SE CARGA, que es una decisión por factura y no
   * una constante.
   *
   * En la planilla de Google estaban fijas en la configuración, y eso no
   * alcanza: las facturas de compra que ya están en la base usan CUATRO
   * empresas y TRES sucursales, en siete combinaciones distintas. Cargar una
   * factura en la empresa equivocada es un asiento en los libros de otra
   * sociedad.
   */
  empresa: string;
  sucursal: string;
  /** El código del comprobante EN SIGMA. Factura A es "FA". */
  codigoComprobante: string;
  /** Las percepciones, para poder imputarlas una por una. */
  percepciones: { concepto: string; monto: string }[];
};

let siguienteId = 0;
const lineaVacia = (codigo = "", unidad: Unidad = "U"): LineaCarga => ({
  id: `${Date.now().toString(36)}-${(siguienteId++).toString(36)}`,
  codigo,
  cantidad: "",
  unidad,
  importe: "",
});

const BORRADOR_VACIO: Borrador = {
  proveedor: "",
  ordenId: "",
  cabecera: { tipo: "F", letra: "A", numero: "", fecha: "" },
  lineas: [],
  descuentoPie: "",
  otrosImpuestos: "",
  totalImpreso: "",
  empresa: "",
  sucursal: "",
  // "FA" es el único código confirmado: se aprendió mandando una factura de
  // verdad, después de que Sigma contestara "codigoComprobante inexistente".
  codigoComprobante: "FA",
  percepciones: [],
};

function leerBorrador(): Borrador {
  try {
    const crudo = window.localStorage.getItem(CLAVE_BORRADOR);
    if (crudo) return { ...BORRADOR_VACIO, ...JSON.parse(crudo) };
  } catch {
    /* sin almacenamiento: se arranca de cero */
  }
  return { ...BORRADOR_VACIO, lineas: [lineaVacia()] };
}

/* -------------------------------------------------------------------------
   ESTILOS
   ------------------------------------------------------------------------- */

const BOTON =
  "border-line hover:bg-panel-2 text-muted hover:text-ink rounded-lg border px-3 py-1.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40";
const BOTON_ACTIVO = "border-c1 bg-c1/15 text-c1 rounded-lg border px-3 py-1.5 text-xs";
const CAMPO =
  "border-line bg-panel-2 text-ink placeholder:text-muted/60 rounded-lg border px-2.5 py-1.5 text-sm focus:border-c1 focus:outline-none";

const COLOR_ESTADO: Record<EstadoCruce, string> = {
  ok: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  cantidad: "border-amber-500/40 bg-amber-500/10 text-amber-200",
  precio: "border-amber-500/40 bg-amber-500/10 text-amber-200",
  "cantidad y precio": "border-amber-500/40 bg-amber-500/10 text-amber-200",
  "falta en factura": "border-rose-500/30 bg-rose-500/10 text-rose-300",
  "no está en la OC": "border-c4/40 bg-c4/10 text-c4",
  "sin identificar": "border-rose-500/30 bg-rose-500/10 text-rose-300",
};

/** De qué se puede fiar menos: va primero en la tabla. */
const ORDEN_ESTADO: EstadoCruce[] = [
  "sin identificar",
  "no está en la OC",
  "falta en factura",
  "cantidad y precio",
  "cantidad",
  "precio",
  "ok",
];

/** Cómo se dice cada diferencia en el mail al proveedor. */
const MOTIVO_MAIL: Record<EstadoCruce, string> = {
  ok: "OK",
  cantidad: "Diferencia de cantidad",
  precio: "Diferencia de costo",
  "cantidad y precio": "Diferencia de cantidad y costo",
  "falta en factura": "Pedido y no facturado",
  "no está en la OC": "Facturado sin estar en la OC",
  "sin identificar": "Artículo no identificado",
};

/* -------------------------------------------------------------------------
   LAS CUENTAS DE CADA DIFERENCIA
   ------------------------------------------------------------------------- */

/**
 * Lo que cuesta una línea del cruce, separado en sus dos causas.
 *
 * POR PRECIO es lo que ya calcula el cruce: (costo facturado − costo de la OC)
 * × unidades facturadas. POR CANTIDAD son las unidades de más o de menos a
 * costo de la OC; lo que vino sin estar en la OC va entero acá. Sumadas dan
 * neto facturado − neto pedido de esa línea.
 */
function difPorCantidad(l: LineaCruce): number {
  if (l.oc) return Math.round(l.difUnidades * l.oc.precioNeto * 100) / 100;
  return l.factura?.neto ?? 0;
}

/* -------------------------------------------------------------------------
   LA PANTALLA
   ------------------------------------------------------------------------- */

/**
 * El borrador vive en el navegador, así que la pantalla se dibuja recién ahí:
 * en el servidor no hay localStorage, y arrancar vacía para después llenarse
 * haría parpadear todo lo cargado (y React se quejaría de la hidratación).
 */
const sinSuscripcion = () => () => {};
export default function CargaFactura() {
  const enCliente = useSyncExternalStore(
    sinSuscripcion,
    () => true,
    () => false,
  );
  if (!enCliente) return <Esqueleto className="h-96" />;
  return <Formulario />;
}

function Formulario() {
  const [b, setB] = useState<Borrador>(leerBorrador);
  const [ordenes, setOrdenes] = useState<OrdenEnviada[] | null>(null);
  const [errorOrdenes, setErrorOrdenes] = useState<string | null>(null);
  // El maestro y su error quedan atados a los SKU que los pidieron: cuando la
  // OC cambia, lo viejo deja de valer solo, sin tener que vaciarlo.
  const [maestroDe, setMaestroDe] = useState<{
    clave: string;
    articulos: ArticuloMaestro[];
    error: string | null;
  }>({ clave: "", articulos: [], error: null });
  const [soloDiferencias, setSoloDiferencias] = useState(true);
  const enfocar = useRef<string | null>(null);

  const cambiar = (parcial: Partial<Borrador>) => setB((x) => ({ ...x, ...parcial }));
  const cambiarLinea = (id: string, parcial: Partial<LineaCarga>) =>
    setB((x) => ({
      ...x,
      lineas: x.lineas.map((l) => (l.id === id ? { ...l, ...parcial } : l)),
    }));
  const agregarLinea = () => {
    const nueva = lineaVacia();
    enfocar.current = nueva.id;
    setB((x) => ({ ...x, lineas: [...x.lineas, nueva] }));
  };

  useEffect(() => {
    try {
      window.localStorage.setItem(CLAVE_BORRADOR, JSON.stringify(b));
    } catch {
      /* sin almacenamiento: no se guarda y listo */
    }
  }, [b]);

  // Después de agregar un renglón, el cursor va al código del nuevo.
  useEffect(() => {
    if (!enfocar.current) return;
    document.getElementById(`codigo-${enfocar.current}`)?.focus();
    enfocar.current = null;
  }, [b.lineas.length]);

  // TODOS los proveedores del maestro, no sólo los que tienen OC en el
  // tablero. Ver el GET de /api/compras/facturas.
  const [todosLosProveedores, setTodosLosProveedores] = useState<
    { codigo: string; nombre: string }[] | null
  >(null);
  useEffect(() => {
    fetch("/api/compras/facturas")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: { proveedores?: { codigo: string; nombre: string }[] }) =>
        setTodosLosProveedores(j.proveedores ?? []),
      )
      // Si falla, la lista cae a los proveedores de las órdenes: menos, pero
      // la pantalla sigue andando.
      .catch(() => setTodosLosProveedores([]));
  }, []);

  useEffect(() => {
    fetch("/api/compras/ordenes")
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? `Error ${r.status}`);
        setOrdenes(j.ordenes as OrdenEnviada[]);
      })
      .catch((e: Error) => setErrorOrdenes(e.message));
  }, []);

  /* --- El proveedor y la OC ---------------------------------------------- */

  /**
   * LOS PROVEEDORES QUE SE PUEDEN ELEGIR: los del maestro.
   *
   * Antes salían de las órdenes mandadas desde el tablero, y eso dejaba 12
   * sobre 46: la factura de un proveedor al que la OC se le pasó por teléfono
   * no se podía cargar. La OC sirve para CRUZAR la factura, no para que la
   * factura exista.
   *
   * Los de las órdenes se suman igual, por si alguno no tuviera artículos en
   * el maestro: la lista no puede perder un proveedor al que ya se le mandó
   * una OC.
   */
  const proveedores = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of todosLosProveedores ?? []) {
      if (p.codigo) m.set(p.codigo, p.nombre || p.codigo);
    }
    for (const o of ordenes ?? []) {
      const clave = o.proveedorCodigo ?? o.proveedorNombre ?? "";
      if (clave && !m.has(clave)) m.set(clave, o.proveedorNombre ?? clave);
    }
    return [...m].sort((x, y) => x[1].localeCompare(y[1]));
  }, [todosLosProveedores, ordenes]);

  /** Cuántos de esos tienen al menos una OC mandada desde el tablero. */
  const conOrden = useMemo(() => {
    const c = new Set<string>();
    for (const o of ordenes ?? []) {
      const clave = o.proveedorCodigo ?? o.proveedorNombre ?? "";
      if (clave) c.add(clave);
    }
    return c;
  }, [ordenes]);

  const ordenesDelProveedor = useMemo(
    () =>
      (ordenes ?? []).filter(
        (o) => (o.proveedorCodigo ?? o.proveedorNombre ?? "") === b.proveedor,
      ),
    [ordenes, b.proveedor],
  );
  const orden = ordenesDelProveedor.find((o) => o.id === b.ordenId) ?? null;
  const renglonesOC: RenglonOC[] = useMemo(
    () => (orden ? renglonesDeOrdenEnviada(orden.payload) : []),
    [orden],
  );

  /**
   * CON QUE SE PIDE EL MAESTRO.
   *
   * Con OC, por sus SKU --así sirve igual para una OC pegada desde Sigma--.
   * Sin OC, por el proveedor: no hay SKU de los que partir, pero el maestro
   * que hace falta es el mismo.
   */
  const claveSkus = useMemo(
    () => [...new Set(renglonesOC.map((r) => r.sku))].sort().join("|"),
    [renglonesOC],
  );
  const claveMaestro = claveSkus
    ? `sku:${claveSkus}`
    : b.proveedor
      ? `prov:${b.proveedor}`
      : "";

  useEffect(() => {
    if (!claveMaestro) return;
    let vigente = true;
    fetch("/api/compras/facturas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        claveMaestro.startsWith("sku:")
          ? { skus: claveMaestro.slice(4).split("|") }
          : { proveedor: claveMaestro.slice(5) },
      ),
    })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? `Error ${r.status}`);
        if (vigente) {
          setMaestroDe({ clave: claveMaestro, articulos: j.articulos as ArticuloMaestro[], error: null });
        }
      })
      .catch(
        (e: Error) =>
          vigente && setMaestroDe({ clave: claveMaestro, articulos: [], error: e.message }),
      );
    return () => {
      vigente = false;
    };
  }, [claveMaestro]);
  const maestro = useMemo(
    () => (maestroDe.clave === claveMaestro ? maestroDe.articulos : []),
    [maestroDe, claveMaestro],
  );
  const errorMaestro = maestroDe.clave === claveMaestro ? maestroDe.error : null;
  const cargandoMaestro = !!claveMaestro && maestroDe.clave !== claveMaestro;
  const indice = useMemo(() => indexarMaestro(maestro), [maestro]);
  const skusOC = useMemo(() => new Set(renglonesOC.map((r) => r.sku)), [renglonesOC]);

  /* --- La factura, renglón por renglón ----------------------------------- */

  /**
   * Cada renglón tipeado, ya resuelto: qué artículo es y cuántas UNIDADES son.
   *
   * La cantidad se pasa a unidades acá, con el bulto del maestro, y el renglón
   * va al cruce con `unidadFija`: la persona ya dijo si eran bultos o
   * unidades, así que el cruce no tiene que adivinarlo.
   */
  const leidas = useMemo(
    () =>
      b.lineas.map((l, i) => {
        const encontrado = buscarArticulo(indice, [l.codigo]);
        const a = encontrado && "a" in encontrado ? encontrado.a : null;
        const cant = leerNumero(l.cantidad);
        const importe = leerNumero(l.importe);
        const porBulto = l.unidad === "B" ? (a?.unidadesPorBulto ?? 1) : 1;
        const vacia = !l.codigo.trim() && cant == null && importe == null;
        const renglon: RenglonFactura | null = vacia
          ? null
          : {
              fila: i + 1,
              codigo: a?.sku ?? "",
              ean: "",
              // Sin artículo, la descripción es el error: así el cruce no la
              // empareja por parecido con nada de la OC y queda sin identificar.
              descripcion: a
                ? a.descripcion
                : encontrado && "error" in encontrado
                  ? encontrado.error
                  : "Sin código",
              cantidad: cant == null ? null : cant * porBulto,
              precio: null,
              descuento1: 0,
              descuento2: 0,
              importe,
              unidadFija: true,
            };
        return {
          l,
          a,
          error: encontrado && "error" in encontrado ? encontrado.error : null,
          unidades: cant == null ? null : cant * porBulto,
          sinBulto: l.unidad === "B" && !!a && a.unidadesPorBulto <= 1,
          renglon,
        };
      }),
    [b.lineas, indice],
  );
  const renglonesFactura = useMemo(
    () => leidas.flatMap((x) => (x.renglon ? [x.renglon] : [])),
    [leidas],
  );

  /**
   * LAS LINEAS QUE VINIERON DE LA OC Y SIGUEN SIN CARGAR NADA.
   *
   * "Sin cargar" es sin cantidad Y sin importe. El código no cuenta: lo puso
   * el botón, no la persona.
   *
   * IMPORTA MAS DE LO QUE PARECE. Una línea con código y sin cantidad NO es
   * una línea vacía para el cruce --entra como un renglón de la factura con
   * cantidad nula, ver `leidas`-- así que traer los 43 artículos de la OC
   * cuando la factura tiene 12 no deja 31 casilleros en blanco: deja 31
   * renglones afirmando que la factura los trae.
   */
  const vaciasDeLaOC = useMemo(() => {
    const deLaOC = new Set(renglonesOC.map((r) => r.sku));
    return b.lineas.filter(
      (l) =>
        deLaOC.has(l.codigo.trim()) &&
        leerNumero(l.cantidad) == null &&
        leerNumero(l.importe) == null,
    );
  }, [b.lineas, renglonesOC]);

  /** Si alguna de las traídas ya tiene algo cargado. Cambia lo que dice el botón. */
  const hayCargadasDeLaOC = useMemo(() => {
    const deLaOC = new Set(renglonesOC.map((r) => r.sku));
    return b.lineas.some(
      (l) =>
        deLaOC.has(l.codigo.trim()) &&
        (leerNumero(l.cantidad) != null || leerNumero(l.importe) != null),
    );
  }, [b.lineas, renglonesOC]);

  /**
   * Saca las que vinieron de la OC y siguen sin cargar.
   *
   * NO PUEDE BORRAR TRABAJO: una línea con cantidad o con importe no entra en
   * `vaciasDeLaOC`, y una con un código tipeado a mano tampoco --el código
   * tiene que ser uno de los SKU de la OC--. Por eso no pregunta nada.
   */
  const sacarVaciasDeLaOC = () => {
    const fuera = new Set(vaciasDeLaOC.map((l) => l.id));
    setB((x) => {
      const quedan = x.lineas.filter((l) => !fuera.has(l.id));
      // Nunca dejar la tabla sin una fila donde escribir.
      return { ...x, lineas: quedan.length > 0 ? quedan : [lineaVacia()] };
    });
  };

  /** Carga un renglón por artículo de la OC, para completar cantidad e importe. */
  const traerArticulosDeLaOC = () => {
    const yaEstan = new Set(leidas.map((x) => x.a?.sku).filter(Boolean));
    const nuevas = renglonesOC
      .filter((r) => !yaEstan.has(r.sku))
      .map((r) => lineaVacia(r.sku));
    setB((x) => ({
      ...x,
      lineas: [...x.lineas.filter((l) => l.codigo || l.cantidad || l.importe), ...nuevas],
    }));
  };

  /* --- El cruce ---------------------------------------------------------- */

  const resultado = useMemo(
    () => cruzar(renglonesOC, renglonesFactura, maestro),
    [renglonesOC, renglonesFactura, maestro],
  );
  const totales = useMemo(
    () =>
      totalesComprobante(resultado, {
        descuentoPie: leerNumero(b.descuentoPie) ?? 0,
        otrosImpuestos: leerNumero(b.otrosImpuestos) ?? 0,
        totalImpreso: leerNumero(b.totalImpreso),
      }),
    [resultado, b.descuentoPie, b.otrosImpuestos, b.totalImpreso],
  );

  const ordenadas = useMemo(() => {
    const orden = (l: LineaCruce) => ORDEN_ESTADO.indexOf(l.estado);
    return [...resultado.lineas].sort((x, y) => orden(x) - orden(y));
  }, [resultado]);
  const diferencias = ordenadas.filter((l) => l.estado !== "ok");
  const lineasVisibles = soloDiferencias ? diferencias : ordenadas;

  const descripcionDe = useMemo(
    () => new Map(maestro.map((a) => [a.sku, a.descripcion])),
    [maestro],
  );

  /**
   * SKU nuestro -> código con el que el proveedor lo vende.
   *
   * Es para la tabla que se le manda: nuestro SKU no le dice nada y lo obliga
   * a traducir renglón por renglón antes de poder contestar. Los que no lo
   * tienen cargado quedan afuera del mapa y la celda sale vacía, que es lo
   * honesto: un código inventado es peor que ninguno.
   */
  const codigoDe = useMemo(
    () =>
      new Map(
        maestro
          .filter((a) => a.codigoCompra)
          .map((a) => [a.sku, a.codigoCompra as string]),
      ),
    [maestro],
  );

  const hayOC = renglonesOC.length > 0;
  /** El nombre del proveedor elegido, para la constancia del envío. */
  const nombreDelProveedor =
    proveedores.find(([clave]) => clave === b.proveedor)?.[1] ?? null;
  /**
   * LA PANTALLA SE ABRE CON EL PROVEEDOR, no con la OC.
   *
   * Es el cambio que deja cargar la factura de una OC que no se mandó desde el
   * tablero. Con el proveedor alcanza para tener el maestro, que es lo único
   * que hace falta para reconocer los renglones; la OC agrega el cruce, que es
   * valioso pero no imprescindible.
   */
  const hayProveedor = !!b.proveedor;
  const hayFactura = renglonesFactura.length > 0;

  // El armado del envío, para las dos mitades: el destino (panel 2) y el
  // botón (abajo de los totales). Ver `useArmadoDeFactura`.
  const sigma = useArmadoDeFactura(b, resultado, totales);
  const r = resultado.resumen;
  const difCantidadTotal = diferencias.reduce((s, l) => s + difPorCantidad(l), 0);

  const datosMail: DatosMail = {
    proveedor: orden?.proveedorNombre ?? orden?.proveedorCodigo ?? "",
    oc: orden ? `OC enviada el ${orden.enviadaEn}` : "",
    factura: [
      `Factura ${b.cabecera.letra}`,
      b.cabecera.numero,
      b.cabecera.fecha ? `del ${b.cabecera.fecha.split("-").reverse().join("/")}` : "",
    ]
      .filter(Boolean)
      .join(" "),
    // El número solo, para la columna que va en cada renglón.
    numeroFactura: b.cabecera.numero
      ? `${b.cabecera.letra} ${b.cabecera.numero}`
      : "",
    lineas: diferencias,
    descripcionDe,
    codigoDe,
    totales,
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold tracking-tight">Carga de Facturas de compra</h1>
        <button
          className={BOTON}
          onClick={() => {
            if (window.confirm("¿Empezar una factura nueva? Se borra lo cargado.")) {
              setB({ ...BORRADOR_VACIO, proveedor: b.proveedor, lineas: [lineaVacia()] });
            }
          }}
        >
          Empezar otra
        </button>
      </div>

      {/* 1. LA OC ------------------------------------------------------- */}
      <Panel
        titulo="1. Orden de compra"
        nota={hayOC ? `${renglonesOC.length} artículos · ${fmtNumero(orden?.unidades)} unidades` : undefined}
      >
        {errorOrdenes ? (
          <Aviso>No se pudieron leer las órdenes: {errorOrdenes}</Aviso>
        ) : (
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
            <label className="text-muted space-y-1 text-xs">
              <span>Proveedor</span>
              <select
                className={`${CAMPO} w-full`}
                value={b.proveedor}
                onChange={(e) => cambiar({ proveedor: e.target.value, ordenId: "" })}
              >
                <option value="">{ordenes ? "Elegí el proveedor…" : "Cargando…"}</option>
                {proveedores.map(([clave, nombre]) => (
                  <option key={clave} value={clave}>
                    {nombre}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-muted space-y-1 text-xs">
              <span>Orden de compra</span>
              <select
                className={`${CAMPO} w-full`}
                value={b.ordenId}
                disabled={!b.proveedor}
                onChange={(e) => cambiar({ ordenId: e.target.value })}
              >
                <option value="">
                  {!b.proveedor
                    ? "Primero el proveedor"
                    : ordenesDelProveedor.length === 0
                      ? "Sin OC en el tablero — cargala igual"
                      : `Sin OC · o elegí una de las ${ordenesDelProveedor.length}…`}
                </option>
                {ordenesDelProveedor.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.enviadaEn} · {o.renglones} artículos · {fmtNumero(o.unidades)} u. ·{" "}
                    {fmtMoneda(o.totalBruto)}
                    {o.usuario ? ` · ${o.usuario}` : ""}
                    {o.nota ? ` · ${o.nota}` : ""}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
        <p className="text-muted mt-2 text-xs">
          Son las órdenes mandadas a Sigma desde Compras. Ya están en unidades y a costo de
          lista, así que no hace falta cargarlas.
        </p>
        {/* POR QUE LA LISTA DE PROVEEDORES ES CORTA.
            Esta pantalla cruza la factura CONTRA una OC, así que el
            desplegable sólo puede ofrecer proveedores a los que se les mandó
            una. Sin decirlo, la lista parece incompleta --y la pregunta que
            genera es "¿se rompió algo?" en vez de "falta mandar esa OC". */}
        {proveedores.length > 0 && (
          <p className="text-muted mt-1 text-xs">
            Están los{" "}
            <strong className="text-ink">
              {fmtNumero(proveedores.length)} proveedores
            </strong>{" "}
            del maestro
            {conOrden.size > 0 && (
              <>
                {" "}
                —{fmtNumero(conOrden.size)} con OC mandada desde el tablero—
              </>
            )}
            . La OC sirve para <strong className="text-ink">cruzar</strong> la
            factura: sin ella se puede cargar igual, sólo que no hay contra qué
            compararla.
          </p>
        )}
        {errorMaestro && (
          <div className="mt-3">
            <Aviso>No se pudo leer el maestro de Sigma: {errorMaestro}</Aviso>
          </div>
        )}
      </Panel>

      {/* 2. CARGAR EN SIGMA ----------------------------------------------
          VA ACA ARRIBA Y NO AL FINAL. Empresa y sucursal son las decisiones
          que no se pueden deshacer --una factura en la empresa equivocada es
          un asiento en los libros de otra sociedad-- y al final de la
          pantalla se eligen después de haber cargado todo, cuando ya se está
          apurado. Acá se eligen antes de empezar, y el botón queda a mano sin
          tener que bajar por la tabla entera. */}
      {hayProveedor && <DestinoSigma b={b} cambiar={cambiar} datos={sigma.datos} />}

      {/* 3. LOS ARTICULOS DE LA FACTURA ---------------------------------- */}
      {hayProveedor && (
        <Panel
          titulo="3. Carga de artículos"
          nota={hayFactura ? `${renglonesFactura.length} renglones` : undefined}
        >
          <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <label className="text-muted space-y-1 text-xs">
              <span>Tipo</span>
              <select
                className={`${CAMPO} w-full`}
                value={b.cabecera.tipo}
                onChange={(e) =>
                  cambiar({
                    cabecera: {
                      ...b.cabecera,
                      tipo: e.target.value as Cabecera["tipo"],
                    },
                  })
                }
                title="Decide el signo del asiento en Sigma. Una nota de crédito cargada como factura suma donde había que restar."
              >
                {TIPOS_COMPROBANTE.map((t) => (
                  <option key={t.valor} value={t.valor}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-muted space-y-1 text-xs">
              <span>Letra</span>
              <select
                className={`${CAMPO} w-full`}
                value={b.cabecera.letra}
                onChange={(e) =>
                  cambiar({ cabecera: { ...b.cabecera, letra: e.target.value as Cabecera["letra"] } })
                }
              >
                {["A", "B", "C", "M"].map((l) => (
                  <option key={l}>{l}</option>
                ))}
              </select>
            </label>
            <label className="text-muted space-y-1 text-xs">
              <span>Número</span>
              <input
                className={`${CAMPO} w-full`}
                placeholder="00004-00000232"
                value={b.cabecera.numero}
                onChange={(e) => cambiar({ cabecera: { ...b.cabecera, numero: e.target.value } })}
              />
            </label>
            <label className="text-muted space-y-1 text-xs">
              <span>Fecha</span>
              <input
                type="date"
                className={`${CAMPO} w-full`}
                value={b.cabecera.fecha}
                onChange={(e) => cambiar({ cabecera: { ...b.cabecera, fecha: e.target.value } })}
              />
            </label>
          </div>

          <div className="mb-2 flex flex-wrap items-center gap-2">
            {hayOC && (
              <button className={BOTON} onClick={traerArticulosDeLaOC} disabled={cargandoMaestro}>
                Traer los artículos de la OC
              </button>
            )}
            {/* DESHACER, que antes no existía: traídos los 43 artículos no había
                forma de volver atrás salvo borrarlos de a uno. Dice dos cosas
                distintas seguún el momento porque son dos gestos distintos --
                arrepentirse, o limpiar lo que sobró-- y los dos son seguros:
                una línea con cantidad o importe nunca se toca. */}
            {vaciasDeLaOC.length > 0 && (
              <button
                className={BOTON}
                onClick={sacarVaciasDeLaOC}
                title={
                  hayCargadasDeLaOC
                    ? "Saca los renglónes que trajiste de la OC y quedaron sin cantidad ni importe. Los que cargaste no se tocan."
                    : "Saca los artículos que trajiste de la OC. Como no cargaste ninguno, no se pierde nada."
                }
              >
                {hayCargadasDeLaOC
                  ? `Sacar los ${fmtNumero(vaciasDeLaOC.length)} sin cargar`
                  : "Deshacer"}
              </button>
            )}
            <span className="text-muted text-xs">
              En código va el SKU, el EAN o el código del proveedor. El importe es el total neto
              de la línea, sin IVA.
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-xs">
              <thead>
                <tr className="text-muted text-left">
                  <th className="w-8 pb-2 font-normal">#</th>
                  <th className="pr-2 pb-2 font-normal">Código</th>
                  <th className="pr-2 pb-2 font-normal">Descripción</th>
                  {/* LOS CODIGOS DEL PROVEEDOR, que son con los que viene
                      escrita SU factura. En "Código" se tipea cualquiera de
                      los tres; acá se ven los otros dos, que es lo que deja
                      confirmar que el renglón es el que parece. */}
                  <th
                    className="w-32 pr-2 pb-2 font-normal"
                    title="El código con el que el proveedor vende el artículo, como figura en su factura."
                  >
                    Cód. proveedor
                  </th>
                  <th
                    className="w-36 pr-2 pb-2 font-normal"
                    title="El EAN de la unidad. Si el artículo se cargó por el EAN del bulto, abajo se ve ese."
                  >
                    EAN
                  </th>
                  <th className="w-24 pr-2 pb-2 text-right font-normal">Cantidad</th>
                  <th className="w-28 pr-2 pb-2 font-normal">Unidad</th>
                  <th className="w-36 pr-2 pb-2 text-right font-normal">Importe línea</th>
                  <th className="w-24 pr-2 pb-2 text-right font-normal">Unidades</th>
                  <th className="w-6 pb-2" />
                </tr>
              </thead>
              <tbody>
                {leidas.map((x, i) => (
                  <tr key={x.l.id} className="border-line border-t align-top">
                    <td className="text-muted py-1.5 pr-2">{i + 1}</td>
                    <td className="py-1 pr-2">
                      <input
                        id={`codigo-${x.l.id}`}
                        list="articulos-factura"
                        className={`${CAMPO} w-40 py-1 font-mono text-xs`}
                        value={x.l.codigo}
                        onChange={(e) => {
                          const codigo = e.target.value;
                          // El EAN del bulto dice solo que viene en bultos.
                          const h = buscarArticulo(indice, [codigo]);
                          cambiarLinea(x.l.id, {
                            codigo,
                            ...(h && "a" in h && h.porBulto ? { unidad: "B" as Unidad } : {}),
                          });
                        }}
                      />
                    </td>
                    <td className="py-1.5 pr-2">
                      {x.a ? (
                        <>
                          <span className="block max-w-[320px] truncate" title={x.a.descripcion}>
                            {x.a.descripcion}
                          </span>
                          <span className="text-muted">
                            {x.a.sku}
                            {x.a.unidadesPorBulto > 1 ? ` · bulto x ${x.a.unidadesPorBulto}` : ""}
                            {!hayOC || skusOC.has(x.a.sku) ? "" : " · no está en la OC"}
                          </span>
                        </>
                      ) : x.error ? (
                        <span className="text-rose-300">{x.error}</span>
                      ) : cargandoMaestro && x.l.codigo ? (
                        <span className="text-muted">Buscando…</span>
                      ) : null}
                    </td>
                    {/* Se llenan solos desde el maestro, en cuanto el código
                        resuelve. No se escriben: son identificación, no datos
                        de la factura. */}
                    <td className="text-muted py-1.5 pr-2 font-mono">
                      {x.a?.codigoCompra ?? ""}
                    </td>
                    <td className="text-muted py-1.5 pr-2 font-mono">
                      {x.a ? (
                        <>
                          <span className="block">{x.a.eanUnidad ?? ""}</span>
                          {x.a.eanBulto && x.a.eanBulto !== x.a.eanUnidad && (
                            <span className="block opacity-70">
                              bulto {x.a.eanBulto}
                            </span>
                          )}
                        </>
                      ) : (
                        ""
                      )}
                    </td>
                    <td className="py-1 pr-2">
                      <input
                        className={`${CAMPO} w-full py-1 text-right text-xs`}
                        inputMode="decimal"
                        value={x.l.cantidad}
                        onChange={(e) => cambiarLinea(x.l.id, { cantidad: e.target.value })}
                      />
                    </td>
                    <td className="py-1 pr-2">
                      <select
                        className={`${CAMPO} w-full py-1 text-xs`}
                        value={x.l.unidad}
                        onChange={(e) => cambiarLinea(x.l.id, { unidad: e.target.value as Unidad })}
                      >
                        <option value="U">Unidades</option>
                        <option value="B">Bultos</option>
                      </select>
                      {x.sinBulto && (
                        <span className="mt-1 block text-amber-200">
                          Sigma no tiene unidades por bulto: se cuenta 1
                        </span>
                      )}
                    </td>
                    <td className="py-1 pr-2">
                      <input
                        className={`${CAMPO} w-full py-1 text-right text-xs`}
                        inputMode="decimal"
                        placeholder="0,00"
                        value={x.l.importe}
                        onChange={(e) => cambiarLinea(x.l.id, { importe: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && i === leidas.length - 1) agregarLinea();
                        }}
                      />
                    </td>
                    <td className="text-muted py-1.5 pr-2 text-right tabular-nums">
                      {x.unidades == null ? "" : fmtNumero(x.unidades)}
                    </td>
                    <td className="py-1">
                      <button
                        className="text-muted hover:text-ink px-1"
                        title="Quitar el renglón"
                        onClick={() =>
                          setB((s) => ({ ...s, lineas: s.lineas.filter((l) => l.id !== x.l.id) }))
                        }
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <datalist id="articulos-factura">
              {[
                ...maestro.filter((a) => skusOC.has(a.sku)),
                ...maestro.filter((a) => !skusOC.has(a.sku)),
              ].map((a) => (
                <option key={a.sku} value={a.sku}>
                  {a.descripcion}
                  {skusOC.has(a.sku) ? " (en la OC)" : ""}
                </option>
              ))}
            </datalist>
          </div>
          <button className={`${BOTON} mt-2`} onClick={agregarLinea}>
            + Agregar renglón
          </button>
        </Panel>
      )}

          {/* 4. LOS TOTALES, Y EL ENVIO ---------------------------------- */}
          <Panel titulo="4. Totales del comprobante">
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <label className="text-muted space-y-1 text-xs">
                  <span>Bonificación al pie %</span>
                  <input
                    className={`${CAMPO} w-full text-right`}
                    inputMode="decimal"
                    placeholder="0"
                    value={b.descuentoPie}
                    onChange={(e) => cambiar({ descuentoPie: e.target.value })}
                  />
                </label>
                <label className="text-muted space-y-1 text-xs">
                  <span>Percepciones y otros</span>
                  <input
                    className={`${CAMPO} w-full text-right`}
                    inputMode="decimal"
                    placeholder="0,00"
                    value={b.otrosImpuestos}
                    onChange={(e) => cambiar({ otrosImpuestos: e.target.value })}
                  />
                </label>
                <label className="text-muted space-y-1 text-xs">
                  <span>Total impreso</span>
                  <input
                    className={`${CAMPO} w-full text-right`}
                    inputMode="decimal"
                    placeholder="0,00"
                    value={b.totalImpreso}
                    onChange={(e) => cambiar({ totalImpreso: e.target.value })}
                  />
                </label>
              </div>

              <table className="w-full text-sm tabular-nums">
                <tbody>
                  <FilaTotal label="Neto de los renglones" valor={totales.neto} />
                  {totales.descuentoPie !== 0 && (
                    <FilaTotal label="Bonificación al pie" valor={-totales.descuentoPie} />
                  )}
                  <FilaTotal label="Neto gravado" valor={totales.netoGravado} />
                  {totales.iva.map((i) => (
                    <FilaTotal
                      key={i.alicuota}
                      label={`IVA ${String(i.alicuota).replace(".", ",")} %`}
                      valor={i.importe}
                    />
                  ))}
                  {totales.otrosImpuestos !== 0 && (
                    <FilaTotal label="Percepciones y otros" valor={totales.otrosImpuestos} />
                  )}
                  <FilaTotal label="Total calculado" valor={totales.total} fuerte />
                  {totales.diferencia != null && (
                    <tr>
                      <td className="pt-2" colSpan={2}>
                        <span
                          className={`inline-block rounded-full border px-3 py-1 text-xs font-medium ${
                            totales.cuadra
                              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                              : "border-rose-500/30 bg-rose-500/10 text-rose-300"
                          }`}
                        >
                          {totales.cuadra
                            ? "Cuadra con el total impreso"
                            : `No cuadra: el calculado da ${fmtMoneda(Math.abs(totales.diferencia))} ${
                                totales.diferencia > 0 ? "más" : "menos"
                              } que el impreso`}
                        </span>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <p className="text-muted mt-3 text-xs">
              El IVA sale de la alícuota de cada artículo en Sigma. Si el total no cuadra por
              centavos es redondeo; si no cuadra por más, casi siempre falta una percepción o un
              renglón.
            </p>

            {/* EL BOTON VA ACA Y NO EN UN PANEL APARTE: lo último que se
                mira antes de escribir en la contabilidad tiene que ser el
                total contra el papel. */}
            <EnviarASigma
              b={b}
              armado={sigma.armado}
              imputacion={sigma.imputacion}
              onImputacion={sigma.setImputacion}
              cruce={resultado}
              totales={totales}
              datos={sigma.datos}
              proveedorNombre={nombreDelProveedor}
              hayFactura={hayFactura}
            />
          </Panel>

          {/* 5. EL REPORTE DE DIFERENCIAS, CON LA TABLA DEL MAIL ADENTRO */}
      {hayProveedor && hayFactura && (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <TarjetaKpi titulo="Coinciden" valor={fmtNumero(r.ok)} acento="#22c55e" compacta />
            <TarjetaKpi
              titulo="Con diferencia"
              valor={fmtNumero(r.conDiferencia)}
              acento={r.conDiferencia ? "#f59e0b" : undefined}
              compacta
            />
            <TarjetaKpi
              titulo="Faltan en la factura"
              valor={fmtNumero(r.faltan)}
              acento={r.faltan ? "#f43f5e" : undefined}
              compacta
            />
            <TarjetaKpi
              titulo="No estaban en la OC"
              valor={fmtNumero(r.sobran)}
              acento={r.sobran ? "#a78bfa" : undefined}
              compacta
            />
            <TarjetaKpi
              titulo="Dif. por costo"
              valor={fmtMoneda(r.difPrecio)}
              detalle="lo facturado de más (o de menos) contra el costo de la OC"
              acento={Math.abs(r.difPrecio) > 1 ? "#f59e0b" : undefined}
              compacta
            />
            <TarjetaKpi
              titulo="Dif. por cantidad"
              valor={fmtMoneda(difCantidadTotal)}
              detalle="unidades de más o de menos, a costo de la OC"
              acento={Math.abs(difCantidadTotal) > 1 ? "#f59e0b" : undefined}
              compacta
            />
          </div>

          <Panel
            titulo="5. Reporte de diferencias"
            nota={`Neto OC ${fmtMoneda(r.netoOC)} · Neto factura ${fmtMoneda(r.netoFactura)}`}
          >
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <button
                className={soloDiferencias ? BOTON_ACTIVO : BOTON}
                onClick={() => setSoloDiferencias(true)}
              >
                Sólo diferencias ({diferencias.length})
              </button>
              <button
                className={!soloDiferencias ? BOTON_ACTIVO : BOTON}
                onClick={() => setSoloDiferencias(false)}
              >
                Todo ({resultado.lineas.length})
              </button>
              <button
                className={BOTON}
                onClick={() => descargarCsv(resultado.lineas, descripcionDe)}
              >
                Descargar cruce (CSV)
              </button>
            </div>

            {lineasVisibles.length === 0 ? (
              <Aviso tono="info">
                Todos los artículos coinciden con la OC en cantidad y costo.
              </Aviso>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[980px] text-xs">
                  <thead>
                    <tr className="border-line text-muted border-b text-left">
                      <th className="py-2 pr-2 font-normal">Estado</th>
                      <th className="py-2 pr-2 font-normal">Artículo</th>
                      <th className="py-2 pr-2 text-right font-normal">Unid. OC</th>
                      <th className="py-2 pr-2 text-right font-normal">Unid. factura</th>
                      <th className="py-2 pr-2 text-right font-normal">Dif. unid.</th>
                      <th className="py-2 pr-2 text-right font-normal">Costo unit. OC</th>
                      <th className="py-2 pr-2 text-right font-normal">Costo unit. factura</th>
                      <th className="py-2 pr-2 text-right font-normal">Dif. $ costo</th>
                      <th className="py-2 text-right font-normal">Dif. $ cantidad</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lineasVisibles.map((l, i) => (
                      <FilaCruce
                        key={`${l.sku ?? "x"}-${l.renglones[0]?.fila ?? i}`}
                        l={l}
                        descripcionDe={descripcionDe}
                        hayOC={hayOC}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="text-muted mt-3 text-xs">
              Todo en unidades y a costo neto por unidad, con las bonificaciones del renglón. El
              costo se compara con media unidad de tolerancia (0,5 % o $0,50).
            </p>

            {/* LA TABLA PARA EL PROVEEDOR, ADENTRO DEL REPORTE Y NO EN UN
                PANEL APARTE. Es lo mismo mirado de dos formas: arriba
                para entender qué pasó, abajo para mandárselo. Separadas,
                había que bajar hasta otro panel para armar un mail sobre
                la tabla que se estaba leyendo. */}
            <TablaParaMail datos={datosMail} />
          </Panel>
        </>
      )}

      {!b.proveedor && (
        <Aviso tono="info">
          Elegí el proveedor para empezar. Si la OC se mandó desde el tablero,
          elegíla también y la factura se cruza contra ella.
        </Aviso>
      )}
      {hayProveedor && !hayFactura && (
        <Aviso tono="info">
          {hayOC
            ? "Ahora cargá los renglones de la factura, o tocá “Traer los artículos de la OC” y completá cantidades e importes."
            : "Ahora cargá los renglones de la factura. En código entra el SKU, el EAN o el código del proveedor."}
        </Aviso>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------
   PIEZAS
   ------------------------------------------------------------------------- */

function FilaCruce({
  l,
  descripcionDe,
  hayOC,
}: {
  l: LineaCruce;
  descripcionDe: Map<string, string>;
  /** Sin OC, "no está en la OC" no es una diferencia: es que no hay con qué. */
  hayOC: boolean;
}) {
  const precio = (n: number | null | undefined) =>
    n == null ? "—" : fmtMoneda(Math.round(n * 100) / 100);
  const porCantidad = difPorCantidad(l);
  const filas = l.renglones.map((x) => x.fila).join(", ");

  return (
    <tr className="border-line border-b align-top">
      <td className="py-2 pr-2">
        <span className={`inline-block rounded-full border px-2 py-0.5 whitespace-nowrap ${COLOR_ESTADO[l.estado]}`}>
          {/* SIN OC NO SE PUEDE DECIR "no está en la OC": sería señalar una
              diferencia contra algo que no existe, y en una pantalla de
              diferencias eso se lee como un problema. */}
          {!hayOC && l.estado === "no está en la OC" ? "sin OC" : l.estado}
        </span>
      </td>
      <td className="py-2 pr-2">
        {l.sku ? (
          <>
            <span className="font-mono">{l.sku}</span>
            <span className="text-muted block max-w-[320px] truncate" title={descripcionDe.get(l.sku)}>
              {descripcionDe.get(l.sku) ?? l.descripcion}
            </span>
          </>
        ) : (
          <span className="text-rose-300">{l.descripcion}</span>
        )}
        {filas && <span className="text-muted block">renglón {filas} de la factura</span>}
      </td>
      <td className="py-2 pr-2 text-right tabular-nums">{l.oc ? fmtNumero(l.oc.unidades) : "—"}</td>
      <td className="py-2 pr-2 text-right tabular-nums">
        {l.factura ? fmtNumero(l.factura.unidades) : "—"}
      </td>
      <td
        className={`py-2 pr-2 text-right tabular-nums ${
          l.difUnidades < 0 ? "text-rose-300" : l.difUnidades > 0 ? "text-amber-200" : "text-muted"
        }`}
      >
        {l.difUnidades === 0 ? "—" : `${l.difUnidades > 0 ? "+" : ""}${fmtNumero(l.difUnidades)}`}
      </td>
      <td className="py-2 pr-2 text-right tabular-nums">{precio(l.oc?.precioNeto)}</td>
      <td
        className={`py-2 pr-2 text-right tabular-nums ${
          l.estado === "precio" || l.estado === "cantidad y precio" ? "text-amber-200" : ""
        }`}
      >
        {precio(l.factura?.precioNeto)}
      </td>
      <td className="py-2 pr-2 text-right tabular-nums">
        {l.difPrecio === 0 ? <span className="text-muted">—</span> : fmtMoneda(l.difPrecio)}
      </td>
      <td className="py-2 text-right tabular-nums">
        {porCantidad === 0 ? <span className="text-muted">—</span> : fmtMoneda(porCantidad)}
      </td>
    </tr>
  );
}

function FilaTotal({ label, valor, fuerte = false }: { label: string; valor: number; fuerte?: boolean }) {
  return (
    <tr className={fuerte ? "border-line border-t font-semibold" : ""}>
      <td className={`py-1 ${fuerte ? "" : "text-muted"}`}>{label}</td>
      <td className="py-1 text-right">{fmtMoneda(valor)}</td>
    </tr>
  );
}

/* -------------------------------------------------------------------------
   LA TABLA PARA EL MAIL

   Igual que "Para mail" en la planilla de sell in: una tabla con estilos en
   línea, lista para pegar en Gmail u Outlook. Se copia como HTML (y como texto
   con tabulaciones, por si se pega en un Excel), así que al pegarla en el
   correo mantiene bordes y colores. Los estilos van escritos en cada celda
   porque los correos ignoran las hojas de estilo.
   ------------------------------------------------------------------------- */

type DatosMail = {
  proveedor: string;
  oc: string;
  /** "Factura A 0001-00000111 del 01/10/2026", para el encabezado. */
  factura: string;
  /**
   * EL NUMERO SOLO, PARA LA COLUMNA. Va en cada renglón y no sólo en el
   * título: la tabla se pega en un mail, se reenvía, se copia a una planilla
   * del proveedor — y en cualquiera de esos pasos el encabezado se pierde y
   * las filas quedan sin decir de qué factura hablan.
   */
  numeroFactura: string;
  lineas: LineaCruce[];
  descripcionDe: Map<string, string>;
  /**
   * SKU nuestro -> código con el que el proveedor lo vende. Es el dato que al
   * proveedor le sirve: nuestro SKU no le dice nada y lo obliga a traducir
   * renglón por renglón antes de poder contestar.
   */
  codigoDe: Map<string, string>;
  totales: ReturnType<typeof totalesComprobante>;
};

const n2 = (n: number) =>
  n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pesos = (n: number) => `${n < 0 ? "-" : ""}$ ${n2(Math.abs(n))}`;
const n0 = (n: number) => n.toLocaleString("es-AR", { maximumFractionDigits: 2 });
const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const ENCABEZADOS_MAIL = [
  "Motivo",
  "Factura",
  "SKU",
  "Cód. proveedor",
  "Descripción",
  "Unid. OC",
  "Unid. facturadas",
  "Dif. unid.",
  "Costo unit. OC",
  "Costo unit. facturado",
  "Dif. $ costo",
  "Dif. $ cantidad",
];

function celdasMail(l: LineaCruce, d: DatosMail): string[] {
  return [
    MOTIVO_MAIL[l.estado],
    d.numeroFactura,
    l.sku ?? "",
    (l.sku && d.codigoDe.get(l.sku)) || "",
    (l.sku && d.descripcionDe.get(l.sku)) || l.descripcion,
    l.oc ? n0(l.oc.unidades) : "—",
    l.factura ? n0(l.factura.unidades) : "—",
    l.difUnidades === 0 ? "—" : `${l.difUnidades > 0 ? "+" : ""}${n0(l.difUnidades)}`,
    l.oc ? pesos(l.oc.precioNeto) : "—",
    l.factura?.precioNeto != null ? pesos(l.factura.precioNeto) : "—",
    l.difPrecio === 0 ? "—" : pesos(l.difPrecio),
    difPorCantidad(l) === 0 ? "—" : pesos(difPorCantidad(l)),
  ];
}

function htmlMail(d: DatosMail): string {
  const th =
    "border:1px solid #cbd5e1;background:#1e293b;color:#ffffff;padding:6px 8px;font-size:12px;text-align:left;";
  const td = "border:1px solid #cbd5e1;padding:5px 8px;font-size:12px;";
  const num = `${td}text-align:right;white-space:nowrap;`;
  const fondo: Partial<Record<EstadoCruce, string>> = {
    "falta en factura": "#fee2e2",
    "sin identificar": "#fee2e2",
    "no está en la OC": "#ede9fe",
  };
  const totalCosto = d.lineas.reduce((s, l) => s + l.difPrecio, 0);
  const totalCantidad = d.lineas.reduce((s, l) => s + difPorCantidad(l), 0);
  const titulo = [d.proveedor, d.factura, d.oc].filter(Boolean).map(esc).join(" · ");

  const filas = d.lineas
    .map((l) => {
      const c = celdasMail(l, d);
      const bg = fondo[l.estado] ?? "#fef3c7";
      return `<tr style="background:${bg};">${c
        .map((v, i) => `<td style="${i >= 5 ? num : td}">${esc(v)}</td>`)
        .join("")}</tr>`;
    })
    .join("");

  return `<div style="font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
<p style="font-size:13px;margin:0 0 8px;"><b>Diferencias factura vs. OC</b>${titulo ? ` — ${titulo}` : ""}</p>
<table style="border-collapse:collapse;">
<thead><tr>${ENCABEZADOS_MAIL.map((h) => `<th style="${th}">${esc(h)}</th>`).join("")}</tr></thead>
<tbody>${filas}
<tr style="background:#f1f5f9;font-weight:bold;"><td style="${td}" colspan="10">Total diferencias</td><td style="${num}">${pesos(totalCosto)}</td><td style="${num}">${pesos(totalCantidad)}</td></tr>
</tbody></table>
<p style="font-size:12px;margin:8px 0 0;">Total factura calculado: ${pesos(d.totales.total)}${
    d.totales.diferencia != null && !d.totales.cuadra
      ? ` · Total impreso: ${pesos(d.totales.total - d.totales.diferencia)}`
      : ""
  }</p>
</div>`;
}

function textoMail(d: DatosMail): string {
  return [
    ENCABEZADOS_MAIL.join("\t"),
    ...d.lineas.map((l) => celdasMail(l, d).join("\t")),
  ].join("\n");
}

function TablaParaMail({ datos }: { datos: DatosMail }) {
  const [copiado, setCopiado] = useState<"ok" | "error" | null>(null);
  const [elegidas, setElegidas] = useState<Set<ClaseDiferencia>>(
    () => new Set(CLASES_DIFERENCIA.map((c) => c.clave)),
  );

  const recortados: DatosMail = useMemo(
    () => ({ ...datos, lineas: datos.lineas.filter((l) => entraEnLaTabla(l, elegidas)) }),
    [datos, elegidas],
  );
  const html = useMemo(() => htmlMail(recortados), [recortados]);

  const alternar = (clave: ClaseDiferencia) =>
    setElegidas((antes) => {
      const ahora = new Set(antes);
      if (ahora.has(clave)) ahora.delete(clave);
      else ahora.add(clave);
      return ahora;
    });

  const copiar = async () => {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([textoMail(recortados)], { type: "text/plain" }),
        }),
      ]);
      setCopiado("ok");
    } catch {
      setCopiado("error");
    }
  };

  if (datos.lineas.length === 0) {
    return (
      <div className="border-line mt-4 border-t pt-4">
        <Aviso tono="info">No hay diferencias para mandarle al proveedor.</Aviso>
      </div>
    );
  }

  return (
    <div className="border-line mt-4 border-t pt-4">
      <p className="text-ink mb-2 text-sm font-medium">
        Tabla para el mail{" "}
        <span className="text-muted font-normal">
          · {recortados.lineas.length} de {datos.lineas.length} diferencias
        </span>
      </p>

      {/* QUE SE INCLUYE. Ver CLASES_DIFERENCIA. */}
      <div className="mb-3 grid gap-1.5 sm:grid-cols-2">
        {CLASES_DIFERENCIA.map((c) => {
          const cuantas = datos.lineas.filter(c.entra).length;
          return (
            <label
              key={c.clave}
              className="text-muted flex items-center gap-2 text-xs"
              title={c.ayuda}
            >
              <input
                type="checkbox"
                checked={elegidas.has(c.clave)}
                onChange={() => alternar(c.clave)}
                disabled={cuantas === 0}
              />
              <span className={cuantas === 0 ? "opacity-50" : "text-ink"}>
                {c.label}
              </span>
              <span className="opacity-70">({cuantas})</span>
            </label>
          );
        })}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button
          className={recortados.lineas.length > 0 ? BOTON_ACTIVO : BOTON}
          onClick={() => void copiar()}
          disabled={recortados.lineas.length === 0}
        >
          Copiar tabla para el mail
        </button>
        {copiado === "ok" && (
          <span className="text-xs text-emerald-300">Copiada: pegala en el correo con Ctrl+V.</span>
        )}
        {copiado === "error" && (
          <span className="text-xs text-rose-300">
            El navegador no dejó copiar: seleccioná la tabla de abajo y copiala a mano.
          </span>
        )}
      </div>

      {recortados.lineas.length === 0 ? (
        <Aviso tono="info">
          No queda ninguna diferencia con lo tildado. Marcá al menos una clase
          para armar la tabla.
        </Aviso>
      ) : (
        /* Vista previa tal cual va a quedar en el correo, sobre fondo blanco. */
        <div
          className="overflow-x-auto rounded-lg bg-white p-3"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      )}
    </div>
  );
}

/** El cruce entero en CSV, con punto y coma y coma decimal para que Excel lo abra bien. */
function descargarCsv(lineas: LineaCruce[], descripcionDe: Map<string, string>) {
  const num = (n: number | null | undefined) =>
    n == null ? "" : String(Math.round(n * 100) / 100).replace(".", ",");
  const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const filas = [
    [
      "Estado", "SKU", "Descripción", "Renglones factura", "Unid. OC", "Unid. factura",
      "Dif. unid.", "Costo unit. OC", "Costo unit. factura", "Dif. $ costo", "Dif. $ cantidad",
    ].join(";"),
    ...lineas.map((l) =>
      [
        q(l.estado),
        q(l.sku ?? ""),
        q((l.sku && descripcionDe.get(l.sku)) || l.descripcion),
        q(l.renglones.map((r) => r.fila).join(", ")),
        num(l.oc?.unidades),
        num(l.factura?.unidades),
        num(l.difUnidades),
        num(l.oc?.precioNeto),
        num(l.factura?.precioNeto),
        num(l.difPrecio),
        num(difPorCantidad(l)),
      ].join(";"),
    ),
  ];
  const blob = new Blob(["﻿" + filas.join("\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "cruce-factura-oc.csv";
  a.click();
  URL.revokeObjectURL(a.href);
}

/* -------------------------------------------------------------------------
   CARGAR LA FACTURA EN SIGMA

   Lo que sale de acá queda cargado en la CONTABILIDAD de la empresa, así que
   la pantalla tiene una sola obligación: que nadie apriete el botón sin saber
   qué se va a mandar y a dónde.

   ESTA PARTIDO EN DOS, y el orden de la pantalla es el motivo:

     2. A DONDE VA      empresa, sucursal, código y percepciones, antes de
                        cargar nada. Es lo que no se puede deshacer.
     4. MANDARLA        abajo de los totales, que es contra lo que se
                        corrobora el papel del proveedor.

   Las dos mitades leen el MISMO armado (ver `useArmadoDeFactura`): si cada
   una se lo trajera por su cuenta, la de arriba podría estar diciendo que
   falta algo que la de abajo ya tiene.

   Los problemas se muestran ANTES de apretar nada --el mismo
   `armarImportCompras` que usa el servidor corre acá para eso-- y el botón
   recién se habilita cuando no queda ninguno. El servidor vuelve a validar
   igual: lo de acá es para la persona, no para el ERP.

   PROBLEMAS Y ADVERTENCIAS NO SON LO MISMO. Un problema es algo que Sigma va
   a rechazar o que deja un asiento equivocado, y frena. Que el total no
   cuadre por unos pesos no: la factura entra pendiente y se corrige del otro
   lado, así que se avisa en amarillo y se manda igual.
   ------------------------------------------------------------------------- */

/** El nombre con el que se eligió la empresa, para repetirlo al confirmar. */
const nombreDeEmpresa = (codigo: string) =>
  EMPRESAS_SIGMA.find((e) => e.codigo === codigo)?.nombre ?? codigo;

/** Lo mismo para la sucursal. */
const nombreDeSucursal = (codigo: string) =>
  SUCURSALES_SIGMA.find((x) => x.codigo === codigo)?.nombre ?? codigo;

/** Lo que contesta el servidor cuando algo sale mal. */
type ResultadoEnvio =
  | { ok: true; respuesta: string }
  | { ok: false; error: string; mandado?: boolean; yaEnviada?: { enviadaEn: string } };

/** Lo que sale de armar el envío: el cuerpo y las dos listas. */
type ArmadoFactura = ReturnType<typeof armarImportCompras> | {
  cuerpo: null;
  problemas: string[];
  advertencias: string[];
};

/**
 * EL ARMADO DEL ENVIO, UNA SOLA VEZ PARA LAS DOS MITADES DE LA PANTALLA.
 *
 * A dónde va la factura se elige arriba (panel 2, antes de cargar nada) y se
 * manda abajo (panel 4, después de corroborar los totales contra el papel).
 * Están separados a propósito, pero los dos necesitan lo mismo: las cuentas
 * contables y el cuerpo armado.
 *
 * Vive en un hook y no en cada componente porque si cada mitad se lo trajera
 * por su cuenta serían dos consultas de cuentas y, peor, dos verdades: la de
 * arriba podría estar diciendo que falta algo que la de abajo ya tiene.
 */
function useArmadoDeFactura(
  b: Borrador,
  cruce: ResultadoCruce,
  totales: TotalesComprobante,
) {
  const [imputacion, setImputacion] = useState<Record<string, Imputacion> | null>(null);

  useEffect(() => {
    fetch("/api/compras/facturas/imputacion")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: { imputacion?: Record<string, Imputacion> }) =>
        setImputacion(j.imputacion ?? {}),
      )
      // Sin las cuentas no se puede mandar, pero la pantalla tiene que decirlo
      // en vez de romperse: queda el panel con el problema a la vista.
      .catch(() => setImputacion({}));
  }, []);

  const datos: DatosFactura = useMemo(
    () => ({
      tipo: b.cabecera.tipo,
      codigoComprobante: b.codigoComprobante.trim(),
      numeroComprobante: b.cabecera.numero.trim(),
      fechaFactura: b.cabecera.fecha,
      proveedorId: b.proveedor,
      empresa: b.empresa,
      sucursal: b.sucursal,
      categoria: null,
      descuentoPie: leerNumero(b.descuentoPie) ?? 0,
      otrosImpuestos: leerNumero(b.otrosImpuestos) ?? 0,
      totalImpreso: leerNumero(b.totalImpreso),
      percepciones: b.percepciones
        .map((p) => ({ concepto: p.concepto, monto: leerNumero(p.monto) ?? 0 }))
        .filter((p) => p.concepto && p.monto),
    }),
    [b],
  );

  const armado: ArmadoFactura = useMemo(
    () =>
      imputacion
        ? armarImportCompras(cruce, totales, datos, imputacion)
        : {
            cuerpo: null,
            problemas: ["Trayendo las cuentas contables…"],
            advertencias: [] as string[],
          },
    [cruce, totales, datos, imputacion],
  );

  return { armado, datos, imputacion, setImputacion };
}

/* -------------------------------------------------------------------------
   2. A DONDE VA LA FACTURA

   Empresa, sucursal, código y percepciones. Nada más: el botón está abajo,
   con los totales.

   VA ANTES DE CARGAR NADA porque es lo que no se puede deshacer --una factura
   en la empresa equivocada es un asiento en los libros de otra sociedad-- y
   al final de la pantalla se elegía con la carga ya hecha, cuando uno ya está
   apurado por terminar.
   ------------------------------------------------------------------------- */

function DestinoSigma({
  b,
  cambiar,
  datos,
}: {
  b: Borrador;
  cambiar: (parche: Partial<Borrador>) => void;
  datos: DatosFactura;
}) {
  const campo = "text-muted space-y-1 text-xs";

  return (
    <Panel titulo="2. Cargar en Sigma">
      <div className="mb-3 grid gap-2 sm:grid-cols-3">
        <label className={campo}>
          <span>Empresa</span>
          <select
            className={`${CAMPO} w-full`}
            value={b.empresa}
            onChange={(e) => cambiar({ empresa: e.target.value })}
          >
            <option value="">Elegí la empresa…</option>
            {EMPRESAS_SIGMA.map((e) => (
              <option key={e.codigo} value={e.codigo}>
                {e.nombre}
              </option>
            ))}
          </select>
        </label>
        <label className={campo}>
          <span>Sucursal</span>
          <select
            className={`${CAMPO} w-full`}
            value={b.sucursal}
            onChange={(e) => cambiar({ sucursal: e.target.value })}
          >
            <option value="">Elegí la sucursal…</option>
            {SUCURSALES_SIGMA.map((x) => (
              <option key={x.codigo} value={x.codigo}>
                {x.nombre}
              </option>
            ))}
          </select>
        </label>
        <label className={campo}>
          <span>Código del comprobante en Sigma</span>
          <input
            className={`${CAMPO} w-full font-mono`}
            value={b.codigoComprobante}
            onChange={(e) => cambiar({ codigoComprobante: e.target.value })}
            title="Factura A es FA. Es el único confirmado: se aprendió después de que Sigma contestara «codigoComprobante inexistente»."
          />
        </label>
      </div>

      {/* LAS PERCEPCIONES SON OPCIONALES. Detallarlas las manda imputadas;
          dejarlas vacías las deja para cargar en Sigma, donde se las ve junto
          al resto del asiento. Lo que no se puede es mandarlas sin concepto:
          un monto suelto no se puede imputar a ninguna cuenta. */}
      <div>
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <span className="text-muted text-xs">
            Percepciones y otros impuestos
            {datos.otrosImpuestos
              ? ` · hay ${fmtMoneda(datos.otrosImpuestos)} en el total. Detallalas acá o cargalas en Sigma`
              : " · opcional"}
          </span>
          <button
            className={BOTON}
            onClick={() =>
              cambiar({ percepciones: [...b.percepciones, { concepto: "", monto: "" }] })
            }
          >
            + Agregar percepción
          </button>
        </div>
        {b.percepciones.map((p, i) => (
          <div key={i} className="mb-1 flex flex-wrap items-center gap-2">
            <select
              className={`${CAMPO} w-64 text-xs`}
              value={p.concepto}
              onChange={(e) => {
                const copia = [...b.percepciones];
                copia[i] = { ...copia[i]!, concepto: e.target.value };
                cambiar({ percepciones: copia });
              }}
            >
              <option value="">Elegí el concepto…</option>
              {CONCEPTOS_PERCEPCION.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <input
              className={`${CAMPO} w-32 text-right text-xs`}
              inputMode="decimal"
              value={p.monto}
              placeholder="0,00"
              onChange={(e) => {
                const copia = [...b.percepciones];
                copia[i] = { ...copia[i]!, monto: e.target.value };
                cambiar({ percepciones: copia });
              }}
            />
            <button
              className="text-muted hover:text-rose-300 text-xs"
              onClick={() =>
                cambiar({ percepciones: b.percepciones.filter((_, j) => j !== i) })
              }
              aria-label="Sacar la percepción"
            >
              ×
            </button>
          </div>
        ))}
      </div>

      <p className="text-muted mt-3 text-xs">
        Acá se elige dónde queda asentada la factura. El botón para mandarla
        está abajo, con los totales: es ahí donde se corrobora contra el papel.
      </p>
    </Panel>
  );
}

/* -------------------------------------------------------------------------
   EL ENVIO, ADENTRO DE LOS TOTALES

   VA JUSTO DEBAJO DE LOS NUMEROS y no en un panel aparte. Lo último que se
   mira antes de escribir en la contabilidad tiene que ser el total contra el
   papel, no un botón tres paneles más abajo que ya no muestra ninguno.
   ------------------------------------------------------------------------- */

function EnviarASigma({
  b,
  armado,
  imputacion,
  onImputacion,
  cruce,
  totales,
  datos,
  proveedorNombre,
  hayFactura,
}: {
  b: Borrador;
  armado: ArmadoFactura;
  imputacion: Record<string, Imputacion> | null;
  onImputacion: (nueva: Record<string, Imputacion>) => void;
  cruce: ResultadoCruce;
  totales: TotalesComprobante;
  datos: DatosFactura;
  proveedorNombre: string | null;
  /** Si ya hay renglones cargados. Sin ellos no hay nada que validar todavía. */
  hayFactura: boolean;
}) {
  const [enviando, setEnviando] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [resultado, setResultado] = useState<ResultadoEnvio | null>(null);

  /**
   * Los conceptos a los que les falta la cuenta, para poder cargarla acá.
   *
   * MIRA LAS DOS LISTAS. La del IVA frena y la de una percepción no, pero las
   * dos se cargan igual desde el mismo formulario: que una no frene no
   * significa que no se quiera cargar.
   */
  const cuentasQueFaltan = useMemo(() => {
    const m = /Falta la cuenta o el tipo de impuesto de "(.+?)"/;
    return [...armado.problemas, ...armado.advertencias]
      .map((p) => m.exec(p)?.[1])
      .filter((x): x is string => !!x);
  }, [armado.problemas, armado.advertencias]);

  const listo = hayFactura && armado.problemas.length === 0 && !!armado.cuerpo;

  const mandar = async () => {
    setEnviando(true);
    setResultado(null);
    try {
      const r = await fetch("/api/compras/facturas/sigma", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cruce, totales, datos, proveedorNombre }),
      });
      const j = await r.json();
      setResultado(
        r.ok
          ? { ok: true, respuesta: String(j.respuesta ?? "") }
          : {
              ok: false,
              error: String(j.error ?? `Error ${r.status}`),
              mandado: j.mandado !== false,
              yaEnviada: j.yaEnviada,
            },
      );
      if (r.ok) setConfirmando(false);
    } catch (e) {
      setResultado({
        ok: false,
        error: e instanceof Error ? e.message : "Error de red",
        mandado: true,
      });
    } finally {
      setEnviando(false);
    }
  };

  if (!hayFactura) return null;

  return (
    <div className="border-line mt-4 border-t pt-4">
      {/* LO QUE HAY QUE MIRAR ANTES DE APRETAR. Los subtotales de arriba salen
          de los renglones que se cargaron; el papel es la única fuente de
          verdad de lo que el proveedor cobró. */}
      <p className="text-ink mb-3 text-sm font-medium">
        Corroborá que los subtotales coincidan con la factura del proveedor.
      </p>

      {/* LO QUE FALTA, antes de ofrecer el botón. */}
      {armado.problemas.length > 0 && (
        <Aviso>
          <p className="font-medium">
            Todavía no se puede mandar. Falta{armado.problemas.length > 1 ? "n" : ""}{" "}
            {armado.problemas.length === 1 ? "una cosa" : `${armado.problemas.length} cosas`}:
          </p>
          <ul className="mt-1 list-disc pl-5 text-xs">
            {armado.problemas.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        </Aviso>
      )}

      {/* LO QUE NO FRENA. Se avisa y se manda igual: la factura entra
          pendiente y en Sigma se corrige hasta que procesa. */}
      {armado.advertencias.length > 0 && (
        <div className={armado.problemas.length > 0 ? "mt-2" : ""}>
          <Aviso tono="alerta">
            <p className="font-medium">Se puede mandar igual, pero mirá esto:</p>
            <ul className="mt-1 list-disc pl-5 text-xs">
              {armado.advertencias.map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ul>
          </Aviso>
        </div>
      )}

      {/* LAS CUENTAS SE CARGAN ACA MISMO, y sólo las que esta factura
          necesita. Un formulario con los 31 conceptos obliga a decidir
          treinta cosas para mandar una factura; así se carga la que falta, en
          el momento en que hace falta, y queda para las próximas. */}
      {cuentasQueFaltan.length > 0 && imputacion && (
        <CuentasQueFaltan
          conceptos={cuentasQueFaltan}
          onGuardada={(nueva) => onImputacion(nueva)}
        />
      )}

      {/* QUE SE VA A MANDAR. En una operación que escribe en la contabilidad,
          poder mirar el cuerpo antes vale más que el mensaje de éxito. */}
      {armado.cuerpo && (
        <details className="mt-3">
          <summary className="text-muted cursor-pointer text-xs">
            Ver lo que se va a mandar
          </summary>
          <pre className="bg-panel-2 mt-2 max-h-64 overflow-auto rounded-lg p-3 text-[11px]">
            {JSON.stringify(armado.cuerpo, null, 2)}
          </pre>
        </details>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {!confirmando ? (
          <button
            className={listo ? BOTON_ACTIVO : BOTON}
            disabled={!listo}
            onClick={() => {
              setResultado(null);
              setConfirmando(true);
            }}
          >
            Enviar a Sigma
          </button>
        ) : (
          <>
            {/* CON NOMBRE Y NO CON CODIGO. "0001" no se lee; "Quo MKT" sí,
                y es lo último que se mira antes de escribir en los libros
                de esa sociedad. */}
            <span className="text-ink text-xs">
              Se va a cargar en <strong>{nombreDeEmpresa(b.empresa)}</strong>,
              sucursal <strong>{nombreDeSucursal(b.sucursal)}</strong>, por{" "}
              <strong>{fmtMoneda(armado.cuerpo?.total ?? 0)}</strong>. No se
              puede deshacer desde acá.
            </span>
            <button className={BOTON_ACTIVO} onClick={() => void mandar()} disabled={enviando}>
              {enviando ? "Mandando…" : "Confirmo, cargarla"}
            </button>
            <button className={BOTON} onClick={() => setConfirmando(false)} disabled={enviando}>
              Cancelar
            </button>
          </>
        )}
      </div>

      {resultado && (
        <div className="mt-3">
          {resultado.ok ? (
            <Aviso tono="info">
              <p className="font-medium">La factura se cargó en Sigma.</p>
              <p className="mt-1 text-xs">
                {resultado.respuesta || "Entra pendiente y se procesa del otro lado."}
              </p>
            </Aviso>
          ) : (
            <Aviso tono={resultado.mandado ? "alerta" : "error"}>
              <p className="font-medium">
                {resultado.yaEnviada
                  ? "Esta factura ya se había cargado."
                  : resultado.mandado
                    ? "No sabemos si entró."
                    : "No se cargó."}
              </p>
              <p className="mt-1 text-xs">{resultado.error}</p>
              {!resultado.mandado && !resultado.yaEnviada && (
                <p className="text-muted mt-1 text-xs">
                  Sigma la rechazó antes de guardarla, así que se puede corregir
                  y volver a mandar sin riesgo de duplicarla.
                </p>
              )}
            </Aviso>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Carga las cuentas que esta factura necesita y todavía no están.
 *
 * NO INVENTA NINGUNA. Una cuenta equivocada manda plata al lugar equivocado en
 * la contabilidad y no se nota en ninguna pantalla: se descubre cerrando el
 * mes. Por eso los campos arrancan vacíos y no se puede mandar la factura
 * hasta que estén.
 */
function CuentasQueFaltan({
  conceptos,
  onGuardada,
}: {
  conceptos: string[];
  onGuardada: (imputacion: Record<string, Imputacion>) => void;
}) {
  const [filas, setFilas] = useState<Record<string, Imputacion>>({});
  const [guardando, setGuardando] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const guardar = async (concepto: string) => {
    const f = filas[concepto];
    if (!f?.cuenta || !f?.tipoImpuesto) return;
    setGuardando(concepto);
    setError(null);
    try {
      const r = await fetch("/api/compras/facturas/imputacion", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fila: { concepto, ...f } }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `Error ${r.status}`);
      onGuardada(j.imputacion as Record<string, Imputacion>);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar.");
    } finally {
      setGuardando(null);
    }
  };

  const editar = (concepto: string, parche: Partial<Imputacion>) =>
    setFilas((x) => ({
      ...x,
      // El orden importa: los vacíos son el piso, lo guardado va encima y el
      // parche último. Al revés, escribir un campo borraría los otros.
      [concepto]: {
        ...{ cuenta: "", tipoImpuesto: "" },
        ...x[concepto],
        ...parche,
      },
    }));

  return (
    <div className="border-line mt-3 rounded-lg border p-3">
      <p className="text-ink text-xs font-medium">
        Cargá las cuentas que faltan. Quedan guardadas para las próximas facturas.
      </p>
      <p className="text-muted mt-1 mb-2 text-[11px]">
        Son las de tu plan de cuentas: la misma cuenta y el mismo tipo de
        impuesto que usa la planilla. Las 24 percepciones de IIBB ya vienen
        cargadas (cuenta 8013, tipo PIB, subcuenta por provincia).
      </p>
      {conceptos.map((c) => (
        <div key={c} className="mb-2 flex flex-wrap items-end gap-2">
          <span className="text-ink w-48 text-xs">{c}</span>
          <input
            className={`${CAMPO} w-28 text-xs`}
            placeholder="Cuenta"
            value={filas[c]?.cuenta ?? ""}
            onChange={(e) => editar(c, { cuenta: e.target.value })}
          />
          <input
            className={`${CAMPO} w-24 text-xs`}
            placeholder="Subcuenta"
            value={filas[c]?.subcuenta ?? ""}
            onChange={(e) => editar(c, { subcuenta: e.target.value })}
          />
          <input
            className={`${CAMPO} w-28 text-xs`}
            placeholder="Centro de costo"
            value={filas[c]?.centroCosto ?? ""}
            onChange={(e) => editar(c, { centroCosto: e.target.value })}
          />
          <input
            className={`${CAMPO} w-24 text-xs`}
            placeholder="Tipo imp."
            value={filas[c]?.tipoImpuesto ?? ""}
            onChange={(e) => editar(c, { tipoImpuesto: e.target.value })}
          />
          <button
            className={BOTON}
            onClick={() => void guardar(c)}
            disabled={guardando === c || !filas[c]?.cuenta || !filas[c]?.tipoImpuesto}
          >
            {guardando === c ? "Guardando…" : "Guardar"}
          </button>
        </div>
      ))}
      {error && <p className="text-negativo mt-1 text-xs">{error}</p>}
    </div>
  );
}
