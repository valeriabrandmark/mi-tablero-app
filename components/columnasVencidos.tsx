import { nombreVendedor } from "@/lib/constantes";
import { sumar, type Columna } from "@/components/Tabla";
import { fmtFechaCortaConAnio, fmtMoneda, fmtNumero } from "@/lib/format";
import { TEMA } from "@/lib/paleta";
import type { ComprobanteVencido } from "@/lib/types";

/**
 * Las columnas de la tabla de comprobantes vencidos.
 *
 * ---------------------------------------------------------------------------
 * POR QUE VIVE ACA Y NO EN CADA PANTALLA
 *
 * La usan dos: la página de un vendedor (Objetivos) y Cuentas Corrientes. Es la
 * MISMA tabla contestando la misma pregunta —de quién es cada deuda y desde
 * cuándo—, así que escrita dos veces serían dos lugares donde el día de mañana
 * "Adeuda" puede significar cosas distintas.
 *
 * ---------------------------------------------------------------------------
 * POR QUE UNA FILA POR COMPROBANTE Y NO POR CLIENTE
 *
 * Porque agrupar por cliente miente. Sumar los comprobantes de alguien y
 * ponerle al total la antigüedad del más viejo dice "debe todo esto desde hace
 * tanto", y casi nunca es así: al 18/09/2026, JESUS GUILLERMO TORRES debía
 * $ 751.451 en cuatro comprobantes con atrasos de 14 a 246 días. Leído por
 * cliente, parecía que los $ 751.451 estaban vencidos hace ocho meses.
 *
 * `conVendedor` agrega la columna del vendedor: en Cuentas Corrientes se ven
 * los de todos y hace falta distinguirlos; en la página de un vendedor sería
 * una columna con un solo valor repetido.
 */
export function columnasVencidos(
  filas: ComprobanteVencido[],
  { conVendedor = false }: { conVendedor?: boolean } = {},
): Columna<ComprobanteVencido>[] {
  const columnas: Columna<ComprobanteVencido>[] = [
    {
      titulo: "Comprobante",
      ayuda: "Número del comprobante impago, tal como está en Sigma.",
      celda: (f) => <span className="font-mono">{f.comprobante ?? "—"}</span>,
      orden: (f) => f.comprobante,
    },
    {
      titulo: "Fecha",
      ayuda: "Cuándo se emitió el comprobante, no cuándo venció.",
      celda: (f) => (f.fecha ? fmtFechaCortaConAnio(f.fecha) : "—"),
      orden: (f) => f.fecha,
    },
    {
      titulo: "Venció el",
      ayuda: "La fecha de vencimiento, que ya pasó.",
      celda: (f) => (f.vencimiento ? fmtFechaCortaConAnio(f.vencimiento) : "—"),
      orden: (f) => f.vencimiento,
    },
    {
      titulo: "Cliente",
      celda: (f) => (
        <span className="block max-w-[180px] truncate sm:max-w-[280px]">
          {f.cliente ?? "—"}
        </span>
      ),
      orden: (f) => f.cliente,
    },
    {
      titulo: "Total del comprobante",
      ayuda: "Lo que decía el comprobante cuando se emitió.",
      celda: (f) => fmtMoneda(f.total),
      numerica: true,
      orden: (f) => f.total,
      total: fmtMoneda(sumar(filas, (f) => f.total)),
    },
    {
      titulo: "Adeuda",
      ayuda:
        "Lo que queda debiendo hoy: el total menos lo que se haya pagado a cuenta. Es el número con el que se va a cobrar.",
      celda: (f) => (
        <strong style={{ color: TEMA.negativo }}>{fmtMoneda(f.adeuda)}</strong>
      ),
      numerica: true,
      orden: (f) => f.adeuda,
      total: fmtMoneda(sumar(filas, (f) => f.adeuda)),
    },
    {
      titulo: "Días vencido",
      ayuda:
        "Días desde el vencimiento. Lo calcula el orquestador, así que cuenta igual que en Cuentas Corrientes.",
      celda: (f) => (
        <span style={{ color: f.diasVencido > 90 ? TEMA.negativo : undefined }}>
          {fmtNumero(f.diasVencido)}
        </span>
      ),
      numerica: true,
      orden: (f) => f.diasVencido,
    },
  ];

  if (!conVendedor) return columnas;

  // Después del cliente, que es con quien se lo asocia al leer.
  const i = columnas.findIndex((c) => c.titulo === "Cliente");
  columnas.splice(i + 1, 0, {
    titulo: "Vendedor",
    ayuda:
      "Quién tiene la cuenta. SIGMA lo guarda como código (006, 007…) y acá se traduce al nombre.",
    celda: (f) => nombreVendedor(f.vendedor) ?? "—",
    orden: (f) => nombreVendedor(f.vendedor),
  });
  return columnas;
}
