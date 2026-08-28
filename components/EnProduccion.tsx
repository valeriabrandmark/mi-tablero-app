/**
 * Lo que se ve en una página que todavía se está construyendo.
 *
 * Existe para que nadie mire una pantalla a medio hacer y saque conclusiones de
 * un número que todavía no cierra. Un panel vacío no se lee como "esto no está
 * terminado" sino como "no hubo movimiento", que es exactamente la lectura
 * equivocada — y la que más caro sale.
 *
 * NO ES UNA PANTALLA DE ERROR, y por eso no usa el tono de aviso: acá no falló
 * nada, simplemente todavía no está.
 *
 * Dice eso y nada más. La explicación de qué va a mostrar cuando esté se
 * conversa, no se deja escrita en una pantalla que además va a durar poco.
 */
export default function EnProduccion({ titulo }: { titulo: string }) {
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold tracking-tight">{titulo}</h1>

      <div className="border-line bg-panel rounded-xl border p-8 text-center">
        <span className="border-c3/30 bg-c3/15 text-c3 inline-block rounded-full border px-3 py-1 text-xs font-medium">
          En producción
        </span>
      </div>
    </div>
  );
}
