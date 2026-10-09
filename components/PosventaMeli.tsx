import PreguntasPorPublicacion from "@/components/charts/PreguntasPorPublicacion";
import ResultadoReclamos from "@/components/charts/ResultadoReclamos";
import { Columna, Tabla } from "@/components/Tabla";
import { Panel, TarjetaKpi } from "@/components/ui";
import {
  enlaceMensajes,
  enlacePregunta,
  enlaceReclamo,
} from "@/lib/enlaces-meli";
import type {
  Pregunta,
  PuntoPublicacion,
  PuntoResultado,
  Reclamo,
  ResumenCrm,
} from "@/lib/queries-crm";

/**
 * Pantalla de Posventa: reclamos, mediaciones y preguntas de Mercado Libre.
 *
 * TODO LO QUE SE VE SE PUEDE ABRIR EN MERCADO LIBRE, y es la mitad del punto
 * de esta pantalla: saber que hay un reclamo abierto no sirve si después hay
 * que buscarlo a mano entre cientos. Cada fila lleva al lugar donde se
 * contesta.
 *
 * Los links salen de `lib/enlaces-meli.ts`, que devuelve `null` cuando no
 * puede armar uno válido. En ese caso se muestra el texto pelado: un enlace
 * que lleva a una página en blanco es peor que no ofrecerlo, porque la
 * persona hace clic, pierde el contexto y no se entera de por qué.
 */

/** Las etapas en castellano. `dispute` es la que la gente llama mediación. */
const ETAPAS: Record<string, string> = {
  claim: "Reclamo",
  dispute: "Mediación",
  recontact: "Reabierto",
  none: "Sin etapa",
};

const TIPOS: Record<string, string> = {
  mediations: "Mediación",
  cancel_purchase: "Cancela el comprador",
  cancel_sale: "Cancelamos nosotros",
  fulfillment: "Logística",
  return: "Devolución",
};

const RESULTADOS: Record<string, { texto: string; clase: string }> = {
  nosotros: { texto: "A favor nuestro", clase: "text-sky-400 border-sky-500/40" },
  "la otra parte": {
    texto: "A favor del cliente",
    clase: "text-rose-400 border-rose-500/40",
  },
  "los dos": { texto: "Partido", clase: "text-muted border-line" },
};

function Etiqueta({ texto, clase }: { texto: string; clase: string }) {
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[10px] whitespace-nowrap ${clase}`}
    >
      {texto}
    </span>
  );
}

/**
 * Un link a Mercado Libre, o el texto solo si no se pudo armar.
 *
 * `rel="noreferrer"` además de `noopener`: el tablero es interno y no tiene
 * por qué contarle a Mercado Libre desde qué URL se entró.
 */
function Enlace({ href, children }: { href: string | null; children: React.ReactNode }) {
  if (!href) return <>{children}</>;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-sky-400 underline decoration-dotted underline-offset-2 hover:text-sky-300"
    >
      {children}
    </a>
  );
}

/** "hace 3 días" en vez de una fecha ISO: lo que importa es cuánto esperó. */
function haceCuanto(iso: string | null): string {
  if (!iso) return "—";
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return "—";
  const minutos = Math.floor((Date.now() - fecha.getTime()) / 60000);
  if (minutos < 1) return "recién";
  if (minutos < 60) return `hace ${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `hace ${horas} h`;
  const dias = Math.floor(horas / 24);
  return `hace ${dias} d`;
}

function columnasReclamos(cerrados: boolean): Columna<Reclamo>[] {
  const base: Columna<Reclamo>[] = [
    {
      titulo: "Orden",
      ayuda:
        "Lleva al detalle de la venta en Mercado Libre, que es desde donde se " +
        "entra al reclamo.",
      celda: (f) => (
        <span className="font-mono text-[11px]">
          <Enlace href={enlaceReclamo(f.orden, f.sitio)}>{f.orden ?? "—"}</Enlace>
        </span>
      ),
    },
    {
      titulo: "Etapa",
      ayuda:
        "Mercado Libre no tiene una entidad aparte para las mediaciones: es el " +
        "mismo reclamo cuando pasa a etapa `dispute`, o sea cuando ML entra a mediar.",
      celda: (f) => (
        <Etiqueta
          texto={ETAPAS[f.etapa ?? ""] ?? f.etapa ?? "—"}
          clase={
            f.etapa === "dispute"
              ? "text-amber-400 border-amber-500/40"
              : "text-muted border-line"
          }
        />
      ),
    },
    {
      titulo: "Tipo",
      celda: (f) => (
        <span className="block max-w-[150px] truncate">
          {TIPOS[f.tipo ?? ""] ?? f.tipo ?? "—"}
        </span>
      ),
    },
  ];

  if (cerrados) {
    return [
      ...base,
      {
        titulo: "Resultado",
        ayuda:
          "Sale de cruzar a quién benefició la resolución con el rol que tuvimos " +
          "nosotros en ESE reclamo: no es fijo. En una cancelación de venta el " +
          "que reclama es el vendedor.",
        celda: (f) => {
          const r = RESULTADOS[f.quien_gano ?? ""];
          return r ? (
            <Etiqueta texto={r.texto} clase={r.clase} />
          ) : (
            <span className="text-muted text-xs">Sin resolución</span>
          );
        },
      },
      {
        titulo: "Cubrió ML",
        ayuda: "Si Mercado Libre se hizo cargo del costo de la resolución.",
        celda: (f) => (f.cobertura_ml ? "Sí" : f.cobertura_ml === false ? "No" : "—"),
      },
      {
        titulo: "Cerrado",
        celda: (f) => (
          <span className="whitespace-nowrap">
            {f.fecha_resolucion?.slice(0, 10) ?? f.fecha_creado?.slice(0, 10) ?? "—"}
          </span>
        ),
        orden: (f) => f.fecha_resolucion ?? f.fecha_creado,
      },
    ];
  }

  return [
    ...base,
    {
      titulo: "Último mensaje",
      ayuda:
        "Hace cuánto que nadie escribe. El listado va ordenado por esto y no por " +
        "fecha de apertura: lo urgente es lo que lleva más tiempo quieto.",
      celda: (f) => (
        <span className="whitespace-nowrap">
          {haceCuanto(f.ultimo_mensaje ?? f.fecha_creado)}
          {f.ultimo_de && <span className="text-muted ml-1 text-[10px]">({f.ultimo_de})</span>}
        </span>
      ),
      orden: (f) => f.ultimo_mensaje ?? f.fecha_creado,
    },
    {
      titulo: "Mensajes",
      numerica: true,
      celda: (f) => (
        <Enlace href={enlaceMensajes(f.orden, f.sitio)}>{f.mensajes}</Enlace>
      ),
      orden: (f) => f.mensajes,
    },
  ];
}

const COLUMNAS_PREGUNTAS: Columna<Pregunta>[] = [
  {
    titulo: "Publicación",
    ayuda: "Lleva a la publicación, que es donde está el cuadro para responder.",
    celda: (f) => (
      <span className="font-mono text-[11px]">
        <Enlace href={enlacePregunta(f.publicacion)}>{f.publicacion ?? "—"}</Enlace>
      </span>
    ),
  },
  {
    titulo: "Pregunta",
    celda: (f) => (
      <span className="block max-w-[260px] truncate sm:max-w-[420px]">
        {f.texto ?? "—"}
      </span>
    ),
  },
  {
    titulo: "Esperando",
    celda: (f) => <span className="whitespace-nowrap">{haceCuanto(f.fecha)}</span>,
    orden: (f) => f.fecha,
  },
];

export default function PosventaMeli({
  resumen,
  abiertos,
  cerrados,
  porMes,
  porPublicacion,
  sinContestar,
}: {
  resumen: ResumenCrm;
  abiertos: Reclamo[];
  cerrados: Reclamo[];
  porMes: PuntoResultado[];
  porPublicacion: PuntoPublicacion[];
  sinContestar: Pregunta[];
}) {
  // El porcentaje se calcula sobre los RESUELTOS y no sobre todos los
  // cerrados: la mayoría de los cerrados no trae resolución, y dividir por
  // ellos daría un número que parece malísimo y no significa nada.
  const porcentaje =
    resumen.resueltos > 0
      ? `${Math.round((resumen.ganados / resumen.resueltos) * 100)}%`
      : "—";

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <TarjetaKpi titulo="Reclamos abiertos" valor={String(resumen.abiertos)} />
        <TarjetaKpi
          titulo="En mediación"
          valor={String(resumen.en_mediacion)}
          detalle="Mercado Libre ya está interviniendo"
          acento={resumen.en_mediacion > 0 ? "#f59e0b" : undefined}
        />
        <TarjetaKpi
          titulo="Preguntas sin contestar"
          valor={String(resumen.preguntas_sin_contestar)}
          acento={resumen.preguntas_sin_contestar > 0 ? "#f43f5e" : undefined}
        />
        <TarjetaKpi
          titulo="Resueltos a favor nuestro"
          valor={porcentaje}
          detalle={`${resumen.ganados} de ${resumen.resueltos} con resolución`}
          acento="#3b82f6"
        />
      </div>

      <Panel
        titulo="Reclamos abiertos"
        nota="El que más tiempo lleva sin movimiento, primero"
      >
        <Tabla
          columnas={columnasReclamos(false)}
          filas={abiertos}
          clave={(f) => f.id}
          vacio="Ningún reclamo abierto. Nada que atender ahora mismo."
        />
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel
          titulo="A favor de quién se resolvieron"
          nota="Solo los que tienen resolución"
        >
          <ResultadoReclamos datos={porMes} />
        </Panel>

        <Panel titulo="Preguntas por publicación" nota="Las diez que más reciben">
          <PreguntasPorPublicacion datos={porPublicacion} />
        </Panel>
      </div>

      {sinContestar.length > 0 && (
        <Panel titulo="Preguntas sin contestar" nota="La más vieja primero">
          <Tabla
            columnas={COLUMNAS_PREGUNTAS}
            filas={sinContestar}
            clave={(f) => f.id}
          />
        </Panel>
      )}

      <Panel titulo="Reclamos cerrados" nota="Los últimos 300 del período">
        <Tabla
          columnas={columnasReclamos(true)}
          filas={cerrados}
          clave={(f) => f.id}
          vacio="Todavía no hay reclamos cerrados cargados. El histórico se llena con `ml_crm.py --historico`."
        />
      </Panel>
    </div>
  );
}
