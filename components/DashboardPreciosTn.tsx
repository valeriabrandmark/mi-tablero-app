"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fmtFechaCorta, fmtMoneda, fmtPct } from "@/lib/format";
import { imprimirPdf, libroDePrecios } from "@/lib/exportar-precios-tn";
import { aXlsx } from "@/lib/xlsx";
import { Tabla, type Columna } from "@/components/Tabla";
import { ALERTAS, nombreFuente, TANDA_ESCRITURA, type ClaveAlerta } from "@/lib/precios-tn";
import type {
  CambioPrecioTn,
  CatalogosPreciosTn,
  FilaPrecioTn,
  FiltrosPreciosTn,
  ResumenPreciosTn,
} from "@/lib/types";

/**
 * Precios TN — Comparador.
 *
 * LA COLA SE ORDENA POR DISTANCIA AL MERCADO. Lo que hay que priorizar es
 * cuánto nos separa de la competencia: un producto 60 % caro es más urgente que
 * uno 5 % caro, aunque el segundo sea más fácil de arreglar.
 *
 * CADA COMPETIDOR SE MUESTRA CON NOMBRE, PRECIO Y LINK. Aprobar un cambio de
 * precio sin poder abrir la ficha del otro y verla es aprobar a ciegas.
 *
 * LOS FILTROS VIVEN EN EL SERVIDOR, no en el navegador. La lista está limitada
 * a 200 filas: filtrar acá mostraría "las 3 de Chicco que había entre las
 * primeras 200" en vez de las de Chicco, y nadie se enteraría de la diferencia.
 */

const TONOS: Record<string, string> = {
  critico: "border-negativo/40 bg-negativo/10 text-negativo",
  aviso: "border-c3/40 bg-c3/15 text-c3",
  neutro: "border-line bg-panel-2 text-muted",
  // "En precio" no es un aviso: es lo que está bien. Va en verde y al final,
  // para que se lea como el saldo y no como un problema más de la fila.
  ok: "border-c1/40 bg-c1/10 text-c1",
};

/** Descarga un contenido como archivo. Texto o bytes: al Blob le da igual. */
function bajarArchivo(contenido: BlobPart, nombre: string, tipo: string) {
  const url = URL.createObjectURL(new Blob([contenido], { type: tipo }));
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * El filtro en palabras, para la carátula del archivo.
 *
 * Sin esto, dos Excel bajados con filtros distintos se ven idénticos por fuera
 * y no hay forma de saber cuál es cuál una semana después.
 */
function descripcionDelFiltro(f: FiltrosPreciosTn): string {
  const partes: string[] = [];
  if (f.grupo) partes.push(ALERTAS.find((a) => a.clave === f.grupo)?.titulo ?? f.grupo);
  if (f.marca) partes.push(`marca ${f.marca}`);
  if (f.proveedor) partes.push(`proveedor ${f.proveedor}`);
  if (f.competidor) partes.push(`comparados con ${nombreFuente(f.competidor)}`);
  if (f.busqueda) partes.push(`búsqueda "${f.busqueda}"`);
  return partes.join(" · ");
}

const SIN_FILTRO: FiltrosPreciosTn = {
  grupo: null,
  proveedor: null,
  marca: null,
  competidor: null,
  busqueda: null,
};

/** Los filtros como query string, en el único lugar donde se traducen. */
function aParams(f: FiltrosPreciosTn): Record<string, string> {
  const p: Record<string, string> = {};
  if (f.grupo) p.grupo = f.grupo;
  if (f.proveedor) p.proveedor = f.proveedor;
  if (f.marca) p.marca = f.marca;
  if (f.busqueda) p.q = f.busqueda;
  return p;
}

/** "hace 3 horas". El dato crudo importa; la distancia se lee de un vistazo. */
function haceCuanto(iso: string): string {
  const minutos = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutos < 2) return "recién";
  if (minutos < 60) return `hace ${minutos} min`;
  const horas = Math.round(minutos / 60);
  if (horas < 24) return `hace ${horas} h`;
  const dias = Math.round(horas / 24);
  return dias === 1 ? "hace 1 día" : `hace ${dias} días`;
}

function Diferencia({ valor }: { valor: number | null }) {
  if (valor === null) return <span className="text-muted">—</span>;
  const caro = valor > 0;
  return (
    <span className={caro ? "text-negativo" : "text-c1"}>
      {caro ? "+" : ""}
      {fmtPct(valor)}
    </span>
  );
}

/**
 * Un margen, como porcentaje de la venta sin IVA.
 *
 * LO CALCULA EL MOTOR Y NO ESTA PANTALLA. La cuenta —sacar el IVA, restar la
 * pasarela y los impuestos— vive en `dominio/margen.py` y es la misma con la que
 * se despeja el piso. Recalcularla acá sería una segunda implementación de la
 * misma fórmula, y el día que una cambie la pantalla mostraría un margen que el
 * motor no usó para decidir nada.
 *
 * `resalta` pinta en rojo lo que queda debajo del 15 % mínimo. Va sólo en el
 * propuesto: el margen de hoy es un hecho, el propuesto es lo que está por
 * decidirse, y es ahí donde "quedás debajo del piso" tiene que saltar a la vista.
 *
 * `null` en las propuestas anteriores a la corrida que empezó a guardarlos. Se
 * muestra "—" y se llena solo en la próxima comparación.
 */
/**
 * El precio propuesto, con la opción de escribir otro.
 *
 * POR QUÉ SE PUEDE ESCRIBIR A MANO. El motor sabe el costo, el piso y lo que
 * publican tres competidores. No sabe que ese proveedor sube la semana que
 * viene, que quedan dos unidades de una caja rota, ni que ese artículo es el
 * gancho de una promo. Sin esta casilla, el único camino para esos casos es
 * abrir Tienda Nube y tocarlo por afuera — y un precio cambiado por afuera no
 * queda registrado en ningún lado, que es justo lo que este sistema vino a
 * resolver.
 *
 * ESCRIBIR UN PRECIO NO SALTEA EL PISO. La validación de verdad está en el
 * servidor, dentro del `update` (ver `decidirPropuesta`): el navegador es de
 * quien escribe, así que acá abajo sólo se avisa antes de mandar. Si igual se
 * manda, la base lo rechaza.
 *
 * QUEDA FIRMADO COMO LO QUE ES: el motivo que se guarda dice quién lo escribió
 * y cuánto proponía el motor. Seis meses después, "por qué este quedó en
 * $12.000" tiene respuesta.
 */
function PrecioPropuesto({
  fila,
  onAutorizar,
}: {
  fila: FilaPrecioTn;
  onAutorizar: (id: number, decision: "aprobada", precio: number) => void;
}) {
  const [editando, setEditando] = useState(false);
  const [texto, setTexto] = useState("");

  // Ya decidida: es un numero, no una decision pendiente. Sin lapiz.
  if (fila.estado !== "pendiente") {
    return <span>{fila.precioPropuesto ? fmtMoneda(fila.precioPropuesto) : "—"}</span>;
  }

  if (!editando) {
    return (
      <button
        onClick={() => {
          setTexto(fila.precioPropuesto ? String(fila.precioPropuesto.toFixed(2)) : "");
          setEditando(true);
        }}
        className="group hover:text-c1 inline-flex items-center gap-1.5"
        title={
          fila.precioPropuesto
            ? "Click para escribir otro precio a mano"
            : "El motor no propone nada acá. Click para escribir un precio vos."
        }
      >
        {/* EL SUBRAYADO PUNTEADO Y EL LAPIZ ESTAN SIEMPRE, y esa es la
            correccion. Antes esto era un <button> sin estilo: se renderizaba
            IDENTICO al texto que habia antes --mismo color, sin borde-- y lo
            unico que lo delataba era un subrayado al pasar el mouse. Una
            funcion que solo existe para quien ya sabe que existe no existe. */}
        <span className="decoration-muted/50 underline decoration-dotted underline-offset-4">
          {fila.precioPropuesto ? fmtMoneda(fila.precioPropuesto) : "—"}
        </span>
        <span className="text-muted/70 group-hover:text-c1 text-[11px] leading-none">✎</span>
      </button>
    );
  }

  const valor = Number(texto.replace(",", "."));
  const valido = Number.isFinite(valor) && valor > 0;
  const bajoPiso = valido && fila.piso !== null && valor < fila.piso;

  return (
    <div className="flex flex-col items-end gap-1">
      <input
        autoFocus
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setEditando(false);
          if (e.key === "Enter" && valido && !bajoPiso) {
            onAutorizar(fila.id, "aprobada", valor);
            setEditando(false);
          }
        }}
        inputMode="decimal"
        className={`border-line bg-panel-2 w-24 rounded border px-1.5 py-0.5 text-right text-xs ${
          bajoPiso ? "border-negativo text-negativo" : ""
        }`}
      />
      {bajoPiso && (
        <span className="text-negativo text-[10px]">
          debajo del piso ({fmtMoneda(fila.piso)})
        </span>
      )}
      <div className="flex gap-1">
        <button
          disabled={!valido || bajoPiso}
          onClick={() => {
            onAutorizar(fila.id, "aprobada", valor);
            setEditando(false);
          }}
          className="border-c1/40 bg-c1/10 text-c1 rounded border px-1.5 py-0.5 text-[10px] disabled:opacity-40"
        >
          Autorizar
        </button>
        <button
          onClick={() => setEditando(false)}
          className="border-line text-muted rounded border px-1.5 py-0.5 text-[10px]"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}

function Margen({ valor, resalta = false }: { valor: number | null; resalta?: boolean }) {
  if (valor === null) return <span className="text-muted">—</span>;
  const tono = !resalta ? "text-ink" : valor < 0.15 ? "text-negativo" : "text-c1";
  return <span className={`font-medium ${tono}`}>{fmtPct(valor)}</span>;
}

/**
 * Los competidores de la fila, UNO POR TIENDA.
 *
 * Se veían "precios repetidos de la competencia" y no lo eran: la ventana de
 * comparación dura varios días, así que el mismo competidor aparecía una vez
 * por captura. Tres chips de Farmaonline no son tres competidores — son uno
 * que cambió de precio — y leerlos como tres es creer que hay más mercado del
 * que hay.
 *
 * El colapso a la más nueva lo hace el SQL, con el mismo desempate que el
 * motor. Acá se agrega LA FECHA, que antes no se mostraba y es justamente lo
 * que hacía que dos precios distintos del mismo negocio parecieran un error.
 */
function Competidores({ lista }: { lista: FilaPrecioTn["competidores"] }) {
  if (!lista?.length) return <span className="text-muted text-xs">sin datos</span>;

  // El más barato primero: es contra quien el cliente nos compara cuando abre
  // dos pestañas, y es el que define la referencia que usó el motor.
  const ordenados = [...lista].sort((a, b) => a.precio - b.precio);

  return (
    <div className="flex flex-wrap gap-1.5">
      {ordenados.map((c) => {
        const contenido = (
          <>
            <span className="opacity-70">{nombreFuente(c.fuente)}</span>{" "}
            <span className="font-mono">{fmtMoneda(c.precio)}</span>
            <span className="text-muted ml-1 text-[10px]">{fmtFechaCorta(c.dia)}</span>
            {c.anteriores > 0 && (
              <span className="text-muted ml-0.5 text-[10px]">+{c.anteriores}</span>
            )}
            {!c.disponible && <span className="text-muted ml-1 text-[10px]">(sin stock)</span>}
          </>
        );
        const historial =
          c.anteriores > 0
            ? ` — tiene ${c.anteriores} captura(s) anterior(es) en la ventana; se usa la del ${fmtFechaCorta(c.dia)}`
            : "";
        const clases =
          "border-line bg-panel-2 rounded-full border px-2 py-0.5 text-[11px] whitespace-nowrap";
        return c.url ? (
          <a
            key={c.fuente}
            href={c.url}
            target="_blank"
            rel="noopener noreferrer"
            className={`${clases} hover:border-c1/50 hover:text-c1`}
            title={`Abrir la ficha en ${nombreFuente(c.fuente)} para verificar el precio${historial}`}
          >
            {contenido} ↗
          </a>
        ) : (
          <span
            key={c.fuente}
            className={clases}
            title={`Sin link guardado${historial}`}
          >
            {contenido}
          </span>
        );
      })}
    </div>
  );
}

/**
 * En qué quedó una propuesta que ya no se puede tildar.
 *
 * Ocupa el lugar de la casilla, así la columna nunca queda hueca: con el
 * renglón a la vista se lee de un vistazo si el precio ya está en la tienda,
 * si todavía espera su turno de escritura, o si se descartó.
 *
 * "vencida" es la que más necesita explicarse: no la rechazó nadie, la vetó el
 * comando de escritura porque el precio de la tienda cambió entre que se
 * aprobó y le tocó escribirse. Escribirla habría pisado esa corrección.
 */
const MARCAS_DE_ESTADO: Record<string, { simbolo: string; texto: string; clase: string }> = {
  aplicada: { simbolo: "✓", texto: "Escrita en la tienda", clase: "text-emerald-600" },
  aprobada: { simbolo: "⏳", texto: "Autorizada, esperando escritura", clase: "text-amber-600" },
  rechazada: { simbolo: "✕", texto: "Rechazada", clase: "text-neutral-400" },
  vencida: {
    simbolo: "⌛",
    texto: "Vencida: el precio de la tienda cambió antes de escribirla",
    clase: "text-neutral-400",
  },
};

function MarcaDeEstado({ estado }: { estado: string }) {
  const marca = MARCAS_DE_ESTADO[estado];
  // Pendiente sin precio propuesto cae acá y no tiene marca: no se decidió
  // nada, simplemente no hay número que autorizar. Inventarle un símbolo sería
  // afirmar algo que no pasó.
  if (!marca) return null;
  return (
    <span className={`text-xs ${marca.clase}`} title={marca.texto} aria-label={marca.texto}>
      {marca.simbolo}
    </span>
  );
}

/**
 * Las columnas, con su ayuda.
 *
 * LOS TOOLTIPS NO ESTAN EN TODAS, y ese es el criterio que ya trae `Tabla`: si
 * el texto solo repite el titulo, estorba y ademas entrena a no leer los que si
 * dicen algo. Van donde el nombre no alcanza -- y en esta pantalla no alcanza
 * casi nunca, porque cada numero sale de una cuenta que nadie puede adivinar.
 */
function columnas(
  decidir: (id: number, decision: "aprobada" | "rechazada") => void,
  seleccion: Set<number>,
  alternar: (id: number) => void,
): Columna<FilaPrecioTn>[] {
  return [
    {
      // EL TITULO ES UN STRING Y NO UNA CASILLA, aunque una casilla de "tildar
      // todo" en el encabezado seria lo natural: `Tabla` declara `titulo:
      // string` y lo usa como key de React y como identidad del orden. Cambiar
      // ese tipo tocaria todos los tableros que comparten el componente por una
      // comodidad de esta pantalla. El "tildar todo" vive en la barra de
      // acciones, que ademas es donde esta el boton que lo usa.
      titulo: "✓",
      ayuda:
        "Tildá varias y autorizalas juntas con el botón de arriba. Sólo tienen casilla las " +
        "que están pendientes y tienen precio propuesto. Las ya decididas muestran en qué " +
        "estado quedaron: ✓ escrita en la tienda, ⏳ autorizada esperando su turno, ✕ " +
        "rechazada, y ⌛ vencida porque el precio cambió antes de escribirla.",
      celda: (f) =>
        f.estado === "pendiente" && f.precioPropuesto !== null ? (
          <input
            type="checkbox"
            checked={seleccion.has(f.id)}
            onChange={() => alternar(f.id)}
            className="accent-c1 h-3.5 w-3.5 cursor-pointer"
          />
        ) : (
          // UNA CELDA VACÍA NO DICE "YA ESTÁ", DICE "FALTA ALGO". Era la
          // pregunta que llegaba: "los de esta tarjeta no tienen casilla para
          // seleccionar". No estaba rota — no había nada que autorizar, porque
          // la propuesta ya se había decidido— pero el hueco no lo contaba.
          <MarcaDeEstado estado={f.estado} />
        ),
    },
    {
      titulo: "Producto",
      ayuda:
        "El nombre abre la ficha en NUESTRA tienda: la foto, la variante y la promo que tenga " +
        "puesta, que es lo que no se ve en el renglón. Debajo, SKU, marca y proveedor según " +
        "Sigma, las unidades en Digip, y los motivos que escribió el motor.",
      celda: (f) => (
        <div>
          {/* EL NOMBRE ES EL LINK, y no un ícono al costado: lo que uno quiere
              abrir es el producto, y el producto ES el nombre. Sin `url` queda
              texto plano — nunca un link inventado, que es peor que ninguno. */}
          {f.url ? (
            <a
              href={f.url}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-c1 block max-w-[260px] truncate font-medium"
              title={`${f.descripcion} — abrir la ficha en unibrandco.com.ar`}
            >
              {f.descripcion} ↗
            </a>
          ) : (
            <span className="block max-w-[260px] truncate font-medium" title={f.descripcion}>
              {f.descripcion}
            </span>
          )}
          <span className="text-muted font-mono text-[10px]">
            {f.sku}
            {f.marca ? ` · ${f.marca}` : ""}
            {f.proveedor ? ` · ${f.proveedor}` : ""}
            {f.stock !== null ? ` · ${f.stock} u.` : ""}
          </span>
          {f.motivos?.length > 0 && (
            <ul className="text-muted mt-1 space-y-0.5 text-[10px]">
              {f.motivos.map((m, i) => (
                <li key={i}>· {m}</li>
              ))}
            </ul>
          )}
        </div>
      ),
      orden: (f) => f.descripcion,
    },
    {
      titulo: "Hoy",
      ayuda:
        "El precio que ve el cliente ahora mismo en la tienda, leído de la API de Tienda Nube " +
        "en la última corrida. Si el producto tiene promoción activa, es el promocional y no el de lista.",
      celda: (f) => fmtMoneda(f.precioActual),
      numerica: true,
      orden: (f) => f.precioActual,
    },
    {
      titulo: "Propuesto ✎",
      ayuda:
        "A dónde llevaría el precio el motor: iguala al competidor más barato, y si eso " +
        "quedaba por debajo del piso, lo sube al piso. NO HAY TOPE DE SUBA — el único límite " +
        "es hacia abajo, y es el piso. Cuando el movimiento pasa del 50 % el motor lo avisa en " +
        "los motivos, para que abras la ficha del competidor antes de autorizar. " +
        "«—» = el motor no propone nada (sin stock, sin costo o sin competencia). " +
        "SE PUEDE ESCRIBIR OTRO PRECIO: click en el número (o en el «—») y autorizás ese en " +
        "vez del propuesto. Queda firmado con tu mail y con lo que proponía el motor, y no " +
        "puede perforar el piso.",
      celda: (f) => <PrecioPropuesto fila={f} onAutorizar={decidir} />,
      numerica: true,
      orden: (f) => f.precioPropuesto,
    },
    {
      titulo: "Costo",
      ayuda:
        "El costo NETO del artículo: sin IVA y con el descuento del proveedor ya aplicado. " +
        "Sale de la misma lista con la que el tablero calcula la rentabilidad de Mercado Libre " +
        "y la distribuidora, así que los tres márgenes hablan del mismo número. " +
        "Cuando un mes tiene varias listas se usa la que rige hoy.",
      celda: (f) =>
        f.costo !== null ? (
          <span className="text-muted">{fmtMoneda(f.costo)}</span>
        ) : (
          <span className="text-muted">—</span>
        ),
      numerica: true,
      orden: (f) => f.costo,
    },
    // DOS COLUMNAS Y NO UNA APILADA. Estaban los dos margenes en la misma celda,
    // uno arriba del otro, y eso obliga a acordarse de cual es cual cada vez que
    // se mira una fila. Separados, cada uno tiene su titulo y se puede ordenar
    // por el que interese: por el de hoy para ver que estamos resignando, por el
    // propuesto para encontrar lo que quedaria mas flaco.
    {
      titulo: "Margen actual",
      ayuda:
        "Cuánto queda de cada venta al precio de HOY, después de sacar el IVA, el arancel de la " +
        "pasarela más cara y el 7,4 % de IIBB, cheque y municipal — como porcentaje de la venta " +
        "SIN IVA. Lo calcula el motor con la misma cuenta que usa para el piso; esta pantalla no " +
        "lo recalcula.",
      celda: (f) => <Margen valor={f.margenActual} />,
      numerica: true,
      orden: (f) => f.margenActual,
    },
    {
      titulo: "Margen propuesto",
      ayuda:
        "El margen que dejaría el precio propuesto. Es la pregunta que falta para decidir: " +
        "bajar a $19.107 no dice nada solo; bajar a $19.107 y quedar en 15 % en vez de 31 % sí. " +
        "En rojo cuando queda por debajo del 15 % mínimo.",
      celda: (f) => <Margen valor={f.margenPropuesto} resalta />,
      numerica: true,
      orden: (f) => f.margenPropuesto,
    },
    {
      titulo: "Piso",
      ayuda:
        "El precio final más bajo que todavía deja 15 % de margen de contribución. " +
        "Parte del costo de compra con el descuento del proveedor ya aplicado, y le descuenta " +
        "el IVA del artículo, el arancel de la pasarela más cara (3,62 % sobre el total cobrado) " +
        "y el 7,4 % de IIBB, cheque y municipal sobre la venta sin IVA. " +
        "No es costo × 1,15: a ese precio se perdería plata, porque el IVA solo ya se lleva 21 %.",
      celda: (f) => <span className="text-muted">{fmtMoneda(f.piso)}</span>,
      numerica: true,
      orden: (f) => f.piso,
    },
    {
      titulo: "vs mercado",
      ayuda:
        "Cuánto nos separa del competidor más barato: positivo = estamos más caros. " +
        "Es lo que ordena la cola, porque lo que hay que priorizar es la distancia al mercado, " +
        "no cuánto alcanzó a corregir el motor dentro de su banda.",
      celda: (f) => <Diferencia valor={f.difMercado} />,
      numerica: true,
      orden: (f) => f.difMercado,
    },
    {
      titulo: "Competencia",
      ayuda:
        "Las tiendas que tienen este mismo código de barras, de la más barata a la más cara. " +
        "Cada una abre su ficha en el sitio del competidor para verificarlo con tus propios ojos. " +
        "Las marcadas sin stock no cuentan para la referencia: su precio es una ficción.",
      celda: (f) => <Competidores lista={f.competidores} />,
      orden: (f) => f.mejorCompetencia,
    },
    {
      titulo: "",
      ayuda:
        "Autorizar NO cambia el precio en Tienda Nube: marca la propuesta como aprobada, " +
        "firmada con tu mail. La escritura la hace el proyecto `precios` desde su workflow.",
      celda: (f) =>
        f.estado !== "pendiente" ? (
          <span className="text-muted text-xs">{f.estado}</span>
        ) : f.precioPropuesto === null ? (
          <span className="text-muted text-xs">sin propuesta</span>
        ) : (
          <div className="flex justify-end gap-1.5">
            <button
              onClick={() => decidir(f.id, "aprobada")}
              className="border-c1/40 bg-c1/10 text-c1 hover:bg-c1/20 rounded-lg border px-2.5 py-1 text-xs"
            >
              Autorizar
            </button>
            <button
              onClick={() => decidir(f.id, "rechazada")}
              className="border-line hover:bg-panel-2 text-muted hover:text-ink rounded-lg border px-2.5 py-1 text-xs"
            >
              No
            </button>
          </div>
        ),
    },
  ];
}

/**
 * Las columnas de "Cambios aplicados".
 *
 * ESTA TABLA ES EL CONTROL, y por eso muestra el precio anterior aunque ya no
 * exista en ningún lado más que acá: `precios.cambio` lo guarda justamente para
 * poder volver atrás sin depender de que Tienda Nube recuerde nada. La tabla es
 * append-only por trigger — un registro de auditoría que se puede editar no es
 * un registro de auditoría.
 */
function columnasCambios(
  deshacer: (id: number) => void,
): Columna<CambioPrecioTn>[] {
  return [
    {
      titulo: "Cuándo",
      ayuda:
        "Cuándo se escribió el precio en Tienda Nube de verdad. No es cuándo lo autorizaste: " +
        "entre una cosa y la otra corrió `precios aplicar`, que vuelve a verificar cada precio " +
        "contra la tienda antes de tocarlo.",
      celda: (c) => (
        <div>
          <span className="block text-xs">
            {new Date(c.aplicadoEn).toLocaleString("es-AR")}
          </span>
          <span className="text-muted text-[10px]">{haceCuanto(c.aplicadoEn)}</span>
        </div>
      ),
      orden: (c) => c.aplicadoEn,
    },
    {
      titulo: "Producto",
      ayuda: "Abre la ficha en NUESTRA tienda para verificar que el precio quedó como esperabas.",
      celda: (c) => (
        <div>
          {c.url ? (
            <a
              href={c.url}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-c1 block max-w-[260px] truncate font-medium"
              title="Abrir la ficha en unibrandco.com.ar"
            >
              {c.descripcion} ↗
            </a>
          ) : (
            <span className="block max-w-[260px] truncate font-medium">{c.descripcion}</span>
          )}
          <span className="text-muted font-mono text-[10px]">
            {c.sku}
            {c.marca ? ` · ${c.marca}` : ""}
          </span>
        </div>
      ),
      orden: (c) => c.descripcion,
    },
    {
      titulo: "Antes",
      ayuda:
        "El precio que tenía la tienda justo antes de que lo escribiéramos. Está guardado en " +
        "`precios.cambio`: es lo que hace posible volver atrás.",
      celda: (c) => <span className="text-muted line-through">{fmtMoneda(c.precioAnterior)}</span>,
      numerica: true,
      orden: (c) => c.precioAnterior,
    },
    {
      titulo: "Ahora",
      ayuda: "El precio que escribimos.",
      celda: (c) => <span className="font-medium">{fmtMoneda(c.precioNuevo)}</span>,
      numerica: true,
      orden: (c) => c.precioNuevo,
    },
    {
      titulo: "Cambio",
      celda: (c) => <Diferencia valor={c.variacion} />,
      numerica: true,
      orden: (c) => c.variacion,
    },
    {
      titulo: "Rentabilidad",
      ayuda:
        "Con qué margen quedó el artículo a ese precio, después de sacar el IVA y restar " +
        "pasarela e impuestos. Es la misma cuenta con la que el motor despeja el piso, no una " +
        "hecha en la pantalla. Aparece “—” cuando el precio escrito no es el que el motor " +
        "propuso —un precio puesto a mano, o un deshacer—: ahí ese margen se calculó para otro " +
        "número y mostrarlo sería engañoso.",
      // `resalta` para que un margen por debajo del mínimo se vea rojo. En el
      // historial importa más que en la cola: acá el precio YA está puesto, así
      // que un margen flaco no es una propuesta a rechazar, es plata corriendo.
      celda: (c) => <Margen valor={c.margen} resalta />,
      numerica: true,
      orden: (c) => c.margen,
    },
    {
      titulo: "Autorizó",
      ayuda: "Quién aprobó la propuesta que produjo este cambio.",
      celda: (c) => (
        <span className="text-muted text-[11px]">{c.autorizadoPor ?? "—"}</span>
      ),
      orden: (c) => c.autorizadoPor,
    },
    {
      titulo: "",
      ayuda:
        "Deshacer NO escribe en Tienda Nube desde acá: deja pedida una propuesta de vuelta al " +
        "precio anterior, que escribe `precios aplicar` en la próxima corrida. Eso la hace pasar " +
        "por los mismos controles, incluido el que impide pisar una corrección que alguien haya " +
        "hecho a mano en el medio.",
      celda: (c) =>
        c.yaSeDeshizo ? (
          <span className="text-muted text-xs">vuelta pedida</span>
        ) : (
          <div className="flex justify-end">
            <button
              onClick={() => deshacer(c.id)}
              className="border-line hover:bg-panel-2 text-muted hover:text-ink rounded-lg border px-2.5 py-1 text-xs"
            >
              ↩ Deshacer
            </button>
          </div>
        ),
    },
  ];
}

type Aprobables = { total: number; bajan: number; suben: number };
type EstadoCorrida = {
  disponible?: boolean;
  estado: "en_cola" | "corriendo" | "termino" | "fallo" | "sin_datos";
  log?: string | null;
  arrancada?: string | null;
  /** Pasos terminados sobre pasos totales del job, y qué está haciendo ahora. */
  paso?: number;
  pasos?: number;
  haciendo?: string | null;
};

/**
 * La barra de avance de una corrida.
 *
 * NO ES UN CRONÓMETRO DISFRAZADO. La tentación era llenarla contra una duración
 * estimada, y no sirve: las corridas tardan entre 6 y 18 minutos según cuántas
 * fuentes haya y cuánto tarden en contestar. Una barra que llega al 100 % y se
 * queda ahí es peor que ninguna, porque enseña a no creerle.
 *
 * Así que avanza por PASOS REALES del job y dice en qué anda. Cuando dice
 * "bajando precios de la competencia" es porque lo está haciendo.
 *
 * LA FRANJA QUE SE MUEVE ES LO QUE FALTA, y tiene una razón: el paso de bajar
 * competencia dura más que los otros tres juntos. Sin ella, la barra se queda
 * quieta diez minutos y parece colgada. La franja no promete avance —no crece—,
 * dice "sigo trabajando", que es lo único cierto que se puede decir ahí.
 */
function Avance({ estado }: { estado: EstadoCorrida }) {
  const total = estado.pasos ?? 0;
  const hechos = estado.paso ?? 0;
  const enCola = estado.estado === "en_cola";
  // Sin pasos todavía —recién encolada— la barra no miente con un número: se
  // muestra vacía y moviéndose.
  const proporcion = total > 0 ? hechos / total : 0;

  return (
    <div className="w-56">
      <div className="text-muted mb-1 flex items-baseline justify-between text-[11px]">
        <span className="text-ink">
          {enCola
            ? "En cola en GitHub…"
            : (estado.haciendo ?? "Arrancando…")}
        </span>
        {total > 0 && (
          <span className="tabular-nums">
            {hechos}/{total}
          </span>
        )}
      </div>
      <div className="bg-panel-2 border-line h-1.5 overflow-hidden rounded-full border">
        <div
          className="bg-c1/70 relative h-full rounded-full transition-[width] duration-700 ease-out"
          style={{ width: `${Math.max(proporcion * 100, 4)}%` }}
        >
          <span className="absolute inset-0 animate-pulse rounded-full bg-white/25" />
        </div>
      </div>
      {estado.arrancada && (
        <p className="text-muted mt-1 text-[10px]">Arrancó {haceCuanto(estado.arrancada)}</p>
      )}
    </div>
  );
}

const CLASE_SELECT =
  "border-line bg-panel-2 text-ink rounded-lg border px-2.5 py-1.5 text-xs focus:border-c1/50 focus:outline-none";

export default function DashboardPreciosTn() {
  const [resumen, setResumen] = useState<ResumenPreciosTn | null>(null);
  const [filas, setFilas] = useState<FilaPrecioTn[]>([]);
  const [catalogos, setCatalogos] = useState<CatalogosPreciosTn>({
    proveedores: [],
    marcas: [],
    competidores: [],
  });
  const [aprobables, setAprobables] = useState<Aprobables>({ total: 0, bajan: 0, suben: 0 });
  const [filtros, setFiltros] = useState<FiltrosPreciosTn>(SIN_FILTRO);
  // El texto del buscador va aparte del filtro: se escribe letra por letra y
  // consultar la base en cada tecla sería una consulta por pulsación.
  const [texto, setTexto] = useState("");
  const [cargando, setCargando] = useState(true);
  const [aviso, setAviso] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [corrida, setCorrida] = useState<EstadoCorrida | null>(null);
  const [escritura, setEscritura] = useState<EstadoCorrida | null>(null);
  const [confirmandoEscritura, setConfirmandoEscritura] = useState(false);
  const [bajando, setBajando] = useState<"xlsx" | "pdf" | null>(null);
  const [recarga, setRecarga] = useState(0);
  // Dos vistas: la cola de lo que falta decidir, y el registro de lo que ya se
  // escribió. Separadas porque se usan en momentos distintos: una es trabajo
  // pendiente y la otra es control de lo hecho.
  const [vista, setVista] = useState<"cola" | "cambios">("cola");
  // Lo que la persona tildó a mano. Se guarda por id y no por índice: la lista
  // se reordena al cambiar de filtro, y un índice apuntaría a otra fila.
  const [seleccion, setSeleccion] = useState<Set<number>>(new Set());
  const [cambios, setCambios] = useState<CambioPrecioTn[]>([]);

  // Medio segundo de quietud antes de consultar. Es el mínimo que se siente
  // instantáneo y el máximo que evita una consulta por letra.
  useEffect(() => {
    const t = setTimeout(() => {
      setFiltros((f) => (f.busqueda === (texto.trim() || null) ? f : { ...f, busqueda: texto.trim() || null }));
    }, 500);
    return () => clearTimeout(t);
  }, [texto]);

  // El efecto NO toca el estado antes del await, y por eso `cargando` arranca
  // en true y lo vuelve a poner en true quien cambia de filtro (que es un
  // manejador de evento, no un efecto). Escribir estado sincronicamente dentro
  // de un efecto es lo que marca react-hooks/set-state-in-effect, y con razon:
  // provoca un render de mas en cada montaje.
  //
  // `vigente` evita la carrera clasica: si alguien clickea dos filtros rapido,
  // la respuesta lenta de la primera no puede pisar a la segunda.
  useEffect(() => {
    let vigente = true;
    (async () => {
      try {
        const qs = new URLSearchParams(aParams(filtros)).toString();
        const r = await fetch(`/api/precios-tn${qs ? `?${qs}` : ""}`, { cache: "no-store" });
        if (!r.ok) {
          throw new Error((await r.json().catch(() => null))?.error ?? `HTTP ${r.status}`);
        }
        const datos = await r.json();
        if (!vigente) return;
        setResumen(datos.resumen);
        setFilas(datos.filas);
        setCatalogos(datos.catalogos);
        setAprobables(datos.aprobables);
        setAviso(null);
      } catch (e) {
        if (vigente) setAviso(e instanceof Error ? e.message : "No se pudieron traer los datos");
      } finally {
        if (vigente) setCargando(false);
      }
    })();
    return () => {
      vigente = false;
    };
  }, [filtros, recarga]);

  // El estado de los DOS workflows. Se consulta al entrar y, MIENTRAS ALGUNO
  // ESTÁ CORRIENDO, cada 15 segundos.
  //
  // POR QUÉ SE MIRA SEGUIDO. Una bajada tarda entre 6 y 18 minutos según
  // cuántas fuentes haya y cuánto tarden en contestar, y un botón que no cuenta
  // nada durante ese rato se clickea de nuevo. Cada consulta trae también el
  // paso en que va, que es lo que llena la barra.
  useEffect(() => {
    let vigente = true;
    const mirar = async () => {
      const [c, e] = await Promise.all([
        fetch("/api/precios-tn/correr?que=comparar", { cache: "no-store" }).catch(() => null),
        fetch("/api/precios-tn/correr?que=escribir", { cache: "no-store" }).catch(() => null),
      ]);
      if (!vigente) return;
      if (c?.ok) setCorrida(await c.json());
      if (e?.ok) setEscritura(await e.json());
    };
    void mirar();
    const enMarcha = [corrida?.estado, escritura?.estado].some(
      (s) => s === "corriendo" || s === "en_cola",
    );
    const t = enMarcha ? setInterval(mirar, 15000) : null;
    return () => {
      vigente = false;
      if (t) clearInterval(t);
    };
  }, [corrida?.estado, escritura?.estado, recarga]);


  // El historial se trae siempre, no sólo al abrir la solapa: el contador del
  // título tiene que ser cierto desde el primer render, y son pocas filas.
  useEffect(() => {
    let vigente = true;
    (async () => {
      const r = await fetch("/api/precios-tn/cambios", { cache: "no-store" }).catch(() => null);
      if (!r?.ok || !vigente) return;
      const datos = await r.json();
      if (vigente) setCambios(datos.cambios ?? []);
    })();
    return () => {
      vigente = false;
    };
  }, [recarga]);

  const recargar = useCallback(() => {
    setCargando(true);
    setRecarga((n) => n + 1);
  }, []);

  /**
   * CUANDO LA ESCRITURA TERMINA, DECIR QUÉ PASÓ.
   *
   * Con 200 autorizadas se escriben 50 y quedan 150. Eso está bien —el tope es
   * el freno ante una corrida con datos rotos— pero la pantalla no lo decía:
   * el botón se apagaba, la barra desaparecía, y quedaban 150 esperando sin
   * ninguna explicación. La conclusión razonable era que algo había fallado.
   *
   * Se mira la TRANSICIÓN, no el estado: "terminó" es cierto todo el tiempo
   * hasta la próxima corrida, y avisar en cada render sería un cartel pegado.
   */
  const estadoEscrituraPrevio = useRef<string | null>(null);
  useEffect(() => {
    const antes = estadoEscrituraPrevio.current;
    const ahora = escritura?.estado ?? null;
    estadoEscrituraPrevio.current = ahora;

    if ((antes !== "corriendo" && antes !== "en_cola") || ahora !== "termino") return;

    // Los números de después de escribir: se vuelven a traer porque los que
    // hay en pantalla son de antes de la corrida.
    void (async () => {
      const r = await fetch("/api/precios-tn", { cache: "no-store" }).catch(() => null);
      const quedan = r?.ok ? ((await r.json())?.resumen?.aprobadasSinAplicar ?? 0) : 0;
      setAviso(
        quedan > 0
          ? `Escritura terminada. Quedan ${quedan} autorizadas esperando: el tope es de ` +
              `${TANDA_ESCRITURA} por corrida. Apretá «Escribir» otra vez para la próxima tanda.`
          : "Escritura terminada. No queda nada autorizado sin escribir; " +
              "lo que se escribió está en «Cambios aplicados».",
      );
      recargar();
    })();
  }, [escritura?.estado, recargar]);

  const cambiarFiltro = useCallback((cambio: Partial<FiltrosPreciosTn>) => {
    setCargando(true);
    setConfirmando(false);
    // LA SELECCION SE VACIA AL CAMBIAR DE FILTRO. Si sobreviviera, el botón
    // diría "autorizar 6" mientras en pantalla no hay ninguna tildada, y esas
    // 6 serían de una lista que la persona ya no está viendo.
    setSeleccion(new Set());
    setFiltros((f) => ({ ...f, ...cambio }));
  }, []);

  const limpiar = useCallback(() => {
    setCargando(true);
    setConfirmando(false);
    setSeleccion(new Set());
    setTexto("");
    setFiltros(SIN_FILTRO);
  }, []);

  /**
   * Las que se pueden tildar de lo que hay en pantalla.
   *
   * Es el universo del "tildar todo": lo VISIBLE con el filtro actual, no las
   * 845 de la cola. Tildar a ciegas cosas que no se ven es justo lo que el
   * botón de bloque ya hace --y ése al menos dice que lo hace-- así que acá
   * conviene lo contrario: lo que se tilda es lo que se está mirando.
   */
  const seleccionables = useMemo(
    () => filas.filter((f) => f.estado === "pendiente" && f.precioPropuesto !== null),
    [filas],
  );

  const alternar = useCallback((id: number) => {
    setSeleccion((previa) => {
      const proxima = new Set(previa);
      if (proxima.has(id)) proxima.delete(id);
      else proxima.add(id);
      return proxima;
    });
  }, []);

  const alternarTodas = useCallback(() => {
    setSeleccion((previa) =>
      previa.size >= seleccionables.length
        ? new Set()
        : new Set(seleccionables.map((f) => f.id)),
    );
  }, [seleccionables]);

  const hayFiltro = useMemo(
    () =>
      Boolean(
        filtros.grupo ||
          filtros.proveedor ||
          filtros.marca ||
          filtros.competidor ||
          filtros.busqueda,
      ),
    [filtros],
  );

  /**
   * Bajar lo que está filtrado, en Excel o en PDF.
   *
   * SE VUELVE A PEDIR AL SERVIDOR en vez de usar `filas`, que es lo que ya está
   * en memoria. La pantalla muestra 200 como máximo, y un archivo que dice
   * "800 artículos" con 200 adentro es peor que no tener el botón: se reenvía
   * por mail y en ningún lado dice que le falta el 75 %.
   */
  async function descargar(formato: "xlsx" | "pdf") {
    setBajando(formato);
    setAviso(null);
    try {
      const qs = new URLSearchParams({ ...aParams(filtros), todo: "1" }).toString();
      const r = await fetch(`/api/precios-tn?${qs}`, { cache: "no-store" });
      if (!r.ok) throw new Error("No se pudieron traer los datos para el archivo");
      const datos = await r.json();
      const todas: FilaPrecioTn[] = datos.filas ?? [];
      if (!todas.length) {
        setAviso("No hay filas para bajar con este filtro.");
        return;
      }

      const comparadoEn = datos.resumen?.comparadoEn ?? null;
      const descripcion = descripcionDelFiltro(filtros);
      const sello = new Date().toISOString().slice(0, 10);

      if (formato === "pdf") {
        imprimirPdf(todas, comparadoEn, descripcion);
      } else {
        bajarArchivo(
          aXlsx(libroDePrecios(todas, comparadoEn, descripcion)),
          `precios-tn-${sello}.xlsx`,
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        );
      }
    } catch (e) {
      setAviso(e instanceof Error ? e.message : "No se pudo armar el archivo");
    } finally {
      setBajando(null);
    }
  }

  async function decidir(
    id: number,
    decision: "aprobada" | "rechazada",
    precio?: number | null,
  ) {
    setAviso(null);
    const r = await fetch("/api/precios-tn/decidir", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, decision, precio: precio ?? null }),
    });
    if (!r.ok) {
      // El 409 es el caso de dos personas decidiendo lo mismo a la vez. Se
      // avisa y se recarga: fingir que funcionó sería peor.
      setAviso((await r.json().catch(() => null))?.error ?? "No se pudo guardar");
      recargar();
      return;
    }
    setFilas((previas) =>
      previas.map((f) =>
        f.id === id
          ? { ...f, estado: decision, precioPropuesto: precio ?? f.precioPropuesto }
          : f,
      ),
    );
    setAprobables((a) => ({ ...a, total: Math.max(0, a.total - 1) }));

    // EL CONTADOR DE ARRIBA TAMBIÉN, y no es cosmético: es el que habilita el
    // botón de escribir. Sin esto, autorizar dejaba el botón deshabilitado
    // hasta que alguien recargara la página — y como no había ninguna señal de
    // que hiciera falta recargar, la conclusión razonable era que el botón no
    // existía. Pasó exactamente eso.
    if (decision === "aprobada") {
      setResumen((r) =>
        r ? { ...r, aprobadasSinAplicar: r.aprobadasSinAplicar + 1, pendientes: Math.max(0, r.pendientes - 1) } : r,
      );
    } else {
      setResumen((r) => (r ? { ...r, pendientes: Math.max(0, r.pendientes - 1) } : r));
    }
  }

  async function autorizarSeleccionadas() {
    setAviso(null);
    const ids = [...seleccion];
    const r = await fetch("/api/precios-tn/decidir", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids }),
    });
    if (!r.ok) {
      setAviso((await r.json().catch(() => null))?.error ?? "No se pudo autorizar");
      return;
    }
    const { aprobadas, pedidas } = await r.json();
    // SI ALGUNA NO ENTRO, SE DICE. Otra persona pudo decidirla en el medio, y
    // "6 autorizadas" cuando entraron 4 es el tipo de mentira que despues
    // aparece como dos precios que nadie entiende.
    setAviso(
      aprobadas === pedidas
        ? `${aprobadas} propuestas autorizadas.`
        : `${aprobadas} de ${pedidas} autorizadas. El resto ya lo había decidido otra persona.`,
    );
    setSeleccion(new Set());
    recargar();
  }

  async function autorizarTodo() {
    setAviso(null);
    setConfirmando(false);
    const r = await fetch("/api/precios-tn/decidir", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ todas: true, filtros: aParams(filtros) }),
    });
    if (!r.ok) {
      setAviso((await r.json().catch(() => null))?.error ?? "No se pudo autorizar");
      return;
    }
    const { aprobadas } = await r.json();
    setAviso(`${aprobadas} propuestas autorizadas. Se escriben cuando corra \`precios aplicar\`.`);
    recargar();
  }

  async function deshacer(id: number) {
    setAviso(null);
    const r = await fetch("/api/precios-tn/cambios", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id }),
    });
    if (!r.ok) {
      setAviso((await r.json().catch(() => null))?.error ?? "No se pudo pedir la vuelta atrás");
      recargar();
      return;
    }
    setCambios((previos) => previos.map((c) => (c.id === id ? { ...c, yaSeDeshizo: true } : c)));
    setAviso(
      "Vuelta atrás pedida. El precio anterior se escribe en la próxima corrida de " +
        "`aplicar`, después de verificar que nadie lo haya tocado en el medio.",
    );
  }

  /**
   * Dispara un workflow. `que` es una llave, no el nombre de un archivo: la
   * ruta tiene un mapa cerrado y no acepta otra cosa (ver su comentario).
   */
  async function correrAhora(que: "comparar" | "escribir") {
    setAviso(null);
    setConfirmandoEscritura(false);
    const marcar = que === "comparar" ? setCorrida : setEscritura;
    marcar({ estado: "en_cola" });

    const r = await fetch("/api/precios-tn/correr", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ que }),
    });
    const datos = await r.json().catch(() => null);
    if (!r.ok) {
      marcar(null);
      setAviso(datos?.error ?? "No se pudo arrancar");
      return;
    }

    if (que === "comparar") {
      setAviso(
        datos?.yaCorria
          ? "Ya había una comparación en curso: no se encoló otra."
          : "Comparación arrancada. La barra dice en qué anda; la pantalla se actualiza sola.",
      );
      return;
    }
    setAviso(
      datos?.yaCorria
        ? "Ya había una escritura en curso: no se encoló otra."
        : "Escritura arrancada. Cada precio se vuelve a verificar contra la tienda antes " +
            "de tocarlo; lo que se escriba aparece en «Cambios aplicados».",
    );
  }

  const alertas = ALERTAS.filter((a) => (resumen?.grupos?.[a.clave] ?? 0) > 0);
  const corriendo = corrida?.estado === "corriendo" || corrida?.estado === "en_cola";
  const escribiendo = escritura?.estado === "corriendo" || escritura?.estado === "en_cola";
  const esperandoEscritura = resumen?.aprobadasSinAplicar ?? 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Precios TN — Comparador</h1>
          {/* CUÁNDO SE MIRÓ A LA COMPETENCIA, que no es cuándo corrió el motor.
              El motor puede correr hoy sobre precios de hace tres días sin
              avisarlo: para él son datos vigentes según la política. Esta línea
              es la que dice si la pantalla habla del mercado de hoy. */}
          <p className="text-muted mt-1 text-xs">
            {resumen?.comparadoEn ? (
              <>
                Última comparación:{" "}
                <span className="text-ink font-medium">
                  {new Date(resumen.comparadoEn).toLocaleString("es-AR")}
                </span>{" "}
                ({haceCuanto(resumen.comparadoEn)})
              </>
            ) : (
              "Todavía no hay ninguna bajada de competencia terminada."
            )}
          </p>
          {resumen && (
            <p className="text-muted mt-0.5 text-[11px]">
              {resumen.pendientes} pendientes · {resumen.decididas} decididas ·{" "}
              {resumen.aprobadasSinAplicar} autorizadas esperando escritura
            </p>
          )}
        </div>

        <div className="flex flex-col items-end gap-1.5">
          {/* LA BARRA VA ARRIBA DE LOS BOTONES Y SÓLO MIENTRAS CORRE. Ocupar
              lugar fijo para algo que se usa diez minutos cada dos días sería
              regalar media pantalla —el mismo error de las tarjetas de alerta—;
              y meterla dentro del botón la dejaría del ancho del texto. */}
          {corriendo && corrida && <Avance estado={corrida} />}
          {escribiendo && escritura && <Avance estado={escritura} />}
          <div className="flex gap-2">
            <button
              onClick={() => correrAhora("comparar")}
              disabled={corriendo || corrida?.disponible === false}
              className="border-line hover:bg-panel-2 text-muted hover:text-ink rounded-lg border px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-50"
              title={
                corrida?.disponible === false
                  ? "Falta configurar GITHUB_TOKEN_PRECIOS en el entorno"
                  : "Vuelve a leer los precios de la competencia y de nuestra tienda, y recalcula las propuestas"
              }
            >
              {corriendo ? "Comparando…" : "↻ Comparar ahora"}
            </button>

            {/* ESCRIBIR NO CORRE SOLO NUNCA. `aplicar.yml` no tiene cron y no
                va a tenerlo: la comparación es automática, la publicación de un
                precio se pide.

                EL BOTÓN SE MUESTRA SIEMPRE, aunque no haya nada que escribir.
                Antes se escondía con cero autorizadas —"si no hay nada que
                pedir, no hay botón"— y eso convirtió una pantalla vacía en un
                misterio: sin el botón a la vista no hay forma de distinguir
                "no hay nada autorizado" de "esto no se desplegó". Deshabilitado
                y diciendo por qué contesta las dos preguntas de una. */}
            <button
              onClick={() => setConfirmandoEscritura(true)}
              disabled={
                esperandoEscritura === 0 ||
                escribiendo ||
                escritura?.disponible === false ||
                confirmandoEscritura
              }
              className="border-c1/40 bg-c1/10 text-c1 hover:bg-c1/20 rounded-lg border px-3 py-1.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-40"
              title={
                escritura?.disponible === false
                  ? "Falta configurar GITHUB_TOKEN_PRECIOS en el entorno"
                  : esperandoEscritura === 0
                    ? "No hay nada autorizado esperando. Autorizá propuestas de la lista y el botón se habilita."
                    : "Escribe en Tienda Nube las propuestas que autorizaste"
              }
            >
              {/* EL BOTON DICE LO QUE VA A HACER, NO LO QUE HAY ESPERANDO.
                  Con 200 autorizadas decia "Escribir (200)" y escribia 50: una
                  promesa que no se cumple, y sin nada que avisara despues por
                  que quedaban 150. */}
              {escribiendo
                ? "Escribiendo…"
                : esperandoEscritura > TANDA_ESCRITURA
                  ? `Escribir ${TANDA_ESCRITURA} de ${esperandoEscritura}`
                  : `Escribir en Tienda Nube (${esperandoEscritura})`}
            </button>
          </div>

          {corrida?.log && (
            <a
              href={corrida.log}
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted hover:text-c1 text-[10px]"
            >
              {corrida.estado === "fallo"
                ? "⚠ la última comparación falló — ver log"
                : "ver el log de la comparación ↗"}
            </a>
          )}
          {escritura?.log && (
            <a
              href={escritura.log}
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted hover:text-c1 text-[10px]"
            >
              {escritura.estado === "fallo"
                ? "⚠ la última escritura falló — ver log"
                : "ver el log de la escritura ↗"}
            </a>
          )}
        </div>
      </div>

      {aviso && (
        <p className="border-c3/40 bg-c3/10 text-c3 rounded-lg border px-3 py-2 text-sm">{aviso}</p>
      )}

      {/* LA UNICA CONFIRMACION QUE PROTEGE ALGO IRREVERSIBLE.
          Autorizar se deshace cambiando un estado en una fila; un precio
          escrito en Tienda Nube ya lo vio un cliente. Por eso esta pantalla
          dice qué va a pasar en vez de preguntar "¿estás seguro?". */}
      {confirmandoEscritura && (
        <div className="border-c1/40 bg-c1/5 space-y-2 rounded-xl border p-4">
          <p className="text-sm font-medium">
            Vas a escribir {esperandoEscritura} precios en Tienda Nube.
          </p>
          <ul className="text-muted space-y-1 text-xs leading-relaxed">
            <li>
              · Cada uno se <b>vuelve a verificar</b> contra la tienda antes de tocarlo: si
              alguien lo cambió a mano desde que lo autorizaste, no se pisa, y si quedó debajo
              del piso de hoy tampoco se escribe.
            </li>
            <li>
              · Donde haya <b>oferta vigente, el precio tachado no se toca</b> y se ajusta la
              oferta. El porcentaje pasa a decir el descuento real. Si el precio nuevo alcanza
              al de lista, se saca la oferta y queda un precio solo.
            </li>
            <li>
              · Se escriben <b>{TANDA_ESCRITURA} como máximo</b> por corrida.
              {esperandoEscritura > TANDA_ESCRITURA && (
                <>
                  {" "}
                  Como autorizaste {esperandoEscritura}, van a quedar{" "}
                  <b>{esperandoEscritura - TANDA_ESCRITURA} para la próxima tanda</b>: siguen
                  autorizadas y el botón queda listo para volver a apretarlo.
                </>
              )}
            </li>
            <li>· Esto sí cambia lo que ve un cliente. Tarda menos de un minuto.</li>
          </ul>
          <div className="flex gap-2">
            <button
              onClick={() => correrAhora("escribir")}
              className="border-c1/40 bg-c1/15 text-c1 hover:bg-c1/25 rounded-lg border px-3 py-1.5 text-xs font-medium"
            >
              Sí, escribir en la tienda
            </button>
            <button
              onClick={() => setConfirmandoEscritura(false)}
              className="border-line hover:bg-panel-2 text-muted hover:text-ink rounded-lg border px-3 py-1.5 text-xs"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Dos momentos distintos: decidir lo que falta, y controlar lo hecho.
          Mezclarlos en una sola tabla haría que el trabajo pendiente quede
          sepultado bajo el historial apenas se apliquen unas semanas. */}
      <div className="border-line flex gap-1 border-b">
        {(
          [
            ["cola", "Para revisar", resumen?.pendientes ?? null],
            ["cambios", "Cambios aplicados", cambios.length],
          ] as const
        ).map(([clave, titulo, total]) => (
          <button
            key={clave}
            onClick={() => setVista(clave)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm transition ${
              vista === clave
                ? "border-c1 text-ink font-medium"
                : "text-muted hover:text-ink border-transparent"
            }`}
          >
            {titulo}
            {total !== null && <span className="text-muted ml-1.5 text-xs">{total}</span>}
          </button>
        ))}
      </div>

      {vista === "cola" && (
        <>
      {/* LAS ALERTAS, COMO CHIPS Y NO COMO TARJETAS.
          Eran cinco cuadros de tres líneas cada uno y empujaban la tabla media
          pantalla hacia abajo: para ver la primera propuesta había que hacer
          scroll, en una pantalla cuyo trabajo es revisar propuestas. El texto
          largo no se perdió — pasó al tooltip, que es donde se lee cuando hace
          falta y no cada vez que se abre la página.

          Siguen sin ser tramos de un mismo eje: son situaciones que se
          resuelven de formas distintas, por eso conservan su color y su orden. */}
      <div className="flex flex-wrap items-center gap-2">
        {alertas.map((a) => {
          const total = resumen?.grupos?.[a.clave] ?? 0;
          const activo = filtros.grupo === a.clave;
          return (
            <button
              key={a.clave}
              onClick={() => cambiarFiltro({ grupo: activo ? null : (a.clave as ClaveAlerta) })}
              title={a.detalle}
              className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition ${
                TONOS[a.tono]
              } ${activo ? "ring-c1/60 ring-2" : "hover:opacity-80"}`}
            >
              <span className="font-semibold">{total}</span>
              <span>{a.titulo}</span>
            </button>
          );
        })}
        {filtros.grupo && (
          <span className="text-muted text-[11px]">
            {ALERTAS.find((a) => a.clave === filtros.grupo)?.detalle}
          </span>
        )}
      </div>

      {/* Los filtros. Se resuelven en el servidor sobre las 845 filas, no sobre
          las 200 que bajaron: filtrar en el navegador mostraría "las de Chicco
          que había entre las primeras 200" y nadie notaría la diferencia. */}
      <div className="border-line bg-panel-2/40 flex flex-wrap items-center gap-2 rounded-xl border p-3">
        <input
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Buscar por SKU o descripción…"
          className={`${CLASE_SELECT} min-w-[220px] flex-1`}
        />
        <select
          value={filtros.proveedor ?? ""}
          onChange={(e) => cambiarFiltro({ proveedor: e.target.value || null })}
          className={CLASE_SELECT}
        >
          <option value="">Todos los proveedores</option>
          {catalogos.proveedores.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <select
          value={filtros.marca ?? ""}
          onChange={(e) => cambiarFiltro({ marca: e.target.value || null })}
          className={CLASE_SELECT}
        >
          <option value="">Todas las marcas</option>
          {catalogos.marcas.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        {/* LA LISTA SON LOS QUE CONTESTARON EN ESTA CORRIDA, no los que están
            configurados. Que una fuente activa falte de este desplegable es el
            dato: significa que esta corrida no le sacó un solo precio, y es la
            única parte de la pantalla donde eso se ve. */}
        <select
          value={filtros.competidor ?? ""}
          onChange={(e) => cambiarFiltro({ competidor: e.target.value || null })}
          className={CLASE_SELECT}
          title="Mostrar sólo los artículos que se compararon contra este competidor"
        >
          <option value="">Todos los competidores</option>
          {catalogos.competidores.map((c) => (
            <option key={c} value={c}>
              {nombreFuente(c)}
            </option>
          ))}
        </select>
        {hayFiltro && (
          <button
            onClick={limpiar}
            className="border-line hover:bg-panel-2 text-muted hover:text-ink rounded-lg border px-2.5 py-1.5 text-xs"
          >
            Limpiar filtros
          </button>
        )}

        <div className="ml-auto flex items-center gap-2">
          {/* BAJAR LO FILTRADO. Los dos botones piden la lista COMPLETA al
              servidor, no las 200 que muestra la pantalla: ver `descargar`. */}
          <button
            onClick={() => descargar("xlsx")}
            disabled={bajando !== null}
            className="border-line hover:bg-panel-2 text-muted hover:text-ink rounded-lg border px-2.5 py-1.5 text-xs disabled:opacity-50"
            title="Baja en Excel todo lo que cumple el filtro actual, no sólo lo que se ve"
          >
            {bajando === "xlsx" ? "Armando…" : "↓ Excel"}
          </button>
          <button
            onClick={() => descargar("pdf")}
            disabled={bajando !== null}
            className="border-line hover:bg-panel-2 text-muted hover:text-ink rounded-lg border px-2.5 py-1.5 text-xs disabled:opacity-50"
            title="Abre la vista de impresión: elegí «Guardar como PDF» en el diálogo"
          >
            {bajando === "pdf" ? "Armando…" : "↓ PDF"}
          </button>

          {/* TILDAR TODO LO VISIBLE. Vive acá y no en el encabezado de la tabla
              porque `Tabla` declara `titulo: string` y lo usa como key y como
              identidad del orden; cambiar ese tipo tocaría todos los tableros
              que comparten el componente por una comodidad de esta pantalla. */}
          {seleccionables.length > 0 && (
            <button
              onClick={alternarTodas}
              className="border-line hover:bg-panel-2 text-muted hover:text-ink rounded-lg border px-2.5 py-1.5 text-xs"
            >
              {seleccion.size >= seleccionables.length
                ? "Destildar todo"
                : `Tildar ${seleccionables.length}`}
            </button>
          )}

          {/* LO TILDADO A MANO tiene su propio botón y su propio camino: manda
              la lista de ids, no el filtro. "Estas seis que miré" es una lista;
              resolverla de nuevo contra un filtro aprobaría cosas que nadie
              vio. Sin confirmación, a propósito: tildar seis casillas ya es la
              confirmación, y una ventana más entrena a apretar Aceptar. */}
          {seleccion.size > 0 && (
            <button
              onClick={autorizarSeleccionadas}
              className="border-c1/40 bg-c1/15 text-c1 hover:bg-c1/25 rounded-lg border px-3 py-1.5 text-xs font-medium"
            >
              Autorizar {seleccion.size} seleccionada{seleccion.size === 1 ? "" : "s"}
            </button>
          )}

          {/* AUTORIZAR TODO LO FILTRADO, nunca "todo" a secas.
              Un botón que aprueba las 845 convierte una decisión en un reflejo:
              el día que una corrida salga rara --un costo mal cargado, una
              fuente que devolvió el precio de otro producto-- se aprueba la
              corrida rara entera de un click. Atado al filtro significa algo
              concreto: "todo lo de esta marca, que acabo de mirar". */}
          <button
            onClick={() => setConfirmando(true)}
            disabled={aprobables.total === 0 || confirmando}
            className="border-c1/40 bg-c1/10 text-c1 hover:bg-c1/20 rounded-lg border px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-40"
          >
            Autorizar {hayFiltro ? "lo filtrado" : "todo"} ({aprobables.total})
          </button>
        </div>
      </div>

      {confirmando && (
        <div className="border-c1/40 bg-c1/5 space-y-2 rounded-xl border p-4">
          <p className="text-sm font-medium">
            Vas a autorizar {aprobables.total} propuestas
            {hayFiltro ? " del filtro actual" : " (sin filtro: la cola entera)"}.
          </p>
          <p className="text-muted text-xs leading-relaxed">
            {aprobables.bajan} bajan de precio y {aprobables.suben} suben. Quedan{" "}
            <b>fuera</b> las de “no se puede competir sin perder”: ésas no son un precio a
            corregir sino una decisión de si seguir vendiendo el producto, y se aprueban de
            a una. Autorizar no cambia nada en Tienda Nube todavía — la escritura la hace{" "}
            <code>precios aplicar</code>, que vuelve a verificar cada precio contra la
            tienda y escribe como máximo 50 por corrida.
          </p>
          <div className="flex gap-2">
            <button
              onClick={autorizarTodo}
              className="border-c1/40 bg-c1/15 text-c1 hover:bg-c1/25 rounded-lg border px-3 py-1.5 text-xs font-medium"
            >
              Sí, autorizar {aprobables.total}
            </button>
            <button
              onClick={() => setConfirmando(false)}
              className="border-line hover:bg-panel-2 text-muted hover:text-ink rounded-lg border px-3 py-1.5 text-xs"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {cargando ? (
        <p className="text-muted text-sm">Cargando…</p>
      ) : (
        <Tabla
          filas={filas}
          columnas={columnas(decidir, seleccion, alternar)}
          clave={(f) => String(f.id)}
          vacio={hayFiltro ? "Nada coincide con el filtro." : "No hay propuestas para revisar."}
        />
      )}
        </>
      )}

      {vista === "cambios" && (
        <>
          {/* EL REGISTRO DE LO QUE SE ESCRIBIO DE VERDAD.
              No sale de las propuestas aprobadas --que son intenciones-- sino
              de precios.cambio, que escribe `aplicar` en la misma transaccion
              en la que cierra la propuesta. Si algo figura aca, se escribio. */}
          {cambios.length === 0 ? (
            <div className="border-line bg-panel-2/40 rounded-xl border p-6 text-center">
              <p className="text-sm font-medium">Todavía no se escribió ningún precio.</p>
              <p className="text-muted mx-auto mt-2 max-w-lg text-xs leading-relaxed">
                Acá va a aparecer cada precio que el proyecto <code>precios</code> escriba en
                Tienda Nube, con el valor anterior guardado para poder volver atrás. Autorizar
                una propuesta no alcanza: la escritura la hace el workflow{" "}
                <em>Aplicar precios en Tienda Nube</em>, con <code>confirmar</code> tildado.
              </p>
            </div>
          ) : (
            <Tabla
              filas={cambios}
              columnas={columnasCambios(deshacer)}
              clave={(c) => String(c.id)}
              vacio="Todavía no se escribió ningún precio."
            />
          )}
        </>
      )}

      <p className="text-muted text-[11px]">
        Ni autorizar ni deshacer cambian un precio en Tienda Nube desde acá: las dos
        cosas dejan una propuesta en la base. La escritura la hace el proyecto{" "}
        <code>precios</code> desde su workflow, con un token que este tablero no tiene
        y no debe tener.
      </p>
    </div>
  );
}
