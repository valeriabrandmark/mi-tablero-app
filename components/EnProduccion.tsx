/**
 * Lo que se ve en una página que todavía se está construyendo.
 *
 * Existe para que nadie mire una pantalla a medio hacer y saque conclusiones de
 * un número que todavía no cierra. Un panel vacío no se lee como "esto no está
 * terminado" sino como "no hubo movimiento", que es exactamente la lectura
 * equivocada — y la que más caro sale.
 *
 * NO ES UNA PANTALLA DE ERROR, y por eso no usa el tono de aviso: acá no falló
 * nada, simplemente todavía no está. La diferencia importa para quien la abre
 * sin saber que estaba en curso.
 */
export default function EnProduccion({
  titulo,
  descripcion,
}: {
  titulo: string;
  /** Qué va a mostrar cuando esté. Concreto, no "próximamente". */
  descripcion: string;
}) {
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold tracking-tight">{titulo}</h1>

      <div className="border-line bg-panel rounded-xl border p-8 text-center">
        <span className="border-c3/30 bg-c3/15 text-c3 inline-block rounded-full border px-3 py-1 text-xs font-medium">
          En producción
        </span>

        <p className="mt-4 text-lg font-medium">Este tablero se está construyendo</p>

        {/* Decir QUÉ va a mostrar, y no un "próximamente" genérico: quien entra
            se va sabiendo si le va a servir, y si no, puede pedir otra cosa
            antes de que esté hecho y sea caro cambiarlo. */}
        <p className="text-muted mx-auto mt-2 max-w-prose text-sm">{descripcion}</p>

        <p className="text-muted mt-4 text-xs">
          Cuando esté listo aparece acá mismo, sin que haya que hacer nada.
        </p>
      </div>
    </div>
  );
}
