/**
 * Reglas de FIXY, el depósito de Buenos Aires.
 *
 * ---------------------------------------------------------------------------
 * QUÉ ES Y POR QUÉ ESTÁ
 *
 * Desde 11/2026 la mercadería que se vende por las Tiendas Nube (UniBrandCo,
 * Diaper Genie, Hola Toys, Litter Genie) y por Mercado Libre Flex sale de FIXY,
 * en Buenos Aires, y no de Tucumán: la venta está concentrada en Capital y
 * mandarla desde acá salía caro y lento. FIXY se conecta SOLO a Tienda Nube y a
 * Mercado Libre: los pedidos le llegan sin pasar por nosotros.
 *
 * Lo que entra a FIXY tiene dos orígenes:
 *   - lo que mandamos desde Tucumán (un pedido de Digip con despacho a FIXY);
 *   - las importaciones, que van directo del puerto.
 *
 * EL STOCK ES UNO PARA TODOS LOS CANALES. El mismo SKU publicado en Flex y en
 * dos Tiendas Nube descuenta del mismo pozo. Por eso todo control es por SKU
 * contra la suma de los canales, nunca canal por canal.
 *
 * ---------------------------------------------------------------------------
 * EL CONTROL
 *
 *   stock FIXY ayer + lo que entró − lo vendido por todos los canales
 *     = stock FIXY hoy
 *
 * Lo que no cierra es mercadería que falta (o que sobra) sin explicación. Es la
 * misma cuenta que la trazabilidad de Full (lib/trazabilidad-full.ts).
 *
 * Acá viven las reglas PURAS --sin base ni red-- para poder probarlas con node
 * (pruebas/fixy.mts). La llamada a la API está en lib/fixy-api.ts.
 */

/**
 * Las sucursales de FIXY: una por empresa. No las piden ni el stock ni las
 * recepciones; sí la cotización y la generación de guías (`codigo_sucursal`).
 */
export const SUCURSALES_FIXY = {
  quo: { nombre: "QUO MARKETING SRL", codigo: "1794836565" },
  diaperGenie: { nombre: "DIAPERGENIE", codigo: "1794837681" },
  holaToys: { nombre: "HOLA TOYS", codigo: "1794837810" },
  litterGenie: { nombre: "LITTER GENIE", codigo: "1794837890" },
} as const;

/** Los servicios de envío contratados (`codigo_servicio` en guías y cotización). */
export const SERVICIOS_FIXY = {
  estandar: { nombre: "Estándar", codigo: "004" },
  sameday: { nombre: "Same day", codigo: "SDB" },
} as const;

/** Cuántos días puede tardar un envío de Tucumán en aparecer en el stock de FIXY. */
export const DIAS_PARA_LLEGAR_A_FIXY = 7;

/** A partir de cuántas unidades una diferencia vale la pena revisarla. */
export const UMBRAL_DIFERENCIA_UNIDADES = 2;

/** Un renglón de una recepción. */
export type RenglonRecepcion = {
  sku: string;
  descripcion: string;
  cantidad: number;
  cajas: number;
};

/** Quién manda la mercadería: lo pide FIXY en cada recepción. */
export type ContactoFixy = {
  nombre: string;
  calle: string;
  cp: string;
  localidad: string;
  provincia: string;
  email: string;
  telefono: string;
};

/**
 * Los datos del remitente, de las variables de entorno.
 *
 * Van en variables y no en el código porque son los del depósito de Tucumán y
 * pueden cambiar (otra persona de contacto, otro teléfono) sin que eso sea un
 * cambio de programa. No son secretos.
 */
export const VARIABLES_CONTACTO: Record<keyof ContactoFixy, string> = {
  nombre: "FIXY_CONTACTO_NOMBRE",
  calle: "FIXY_CONTACTO_CALLE",
  cp: "FIXY_CONTACTO_CP",
  localidad: "FIXY_CONTACTO_LOCALIDAD",
  provincia: "FIXY_CONTACTO_PROVINCIA",
  email: "FIXY_CONTACTO_EMAIL",
  telefono: "FIXY_CONTACTO_TELEFONO",
};

export function contactoDesdeEntorno(
  env: Record<string, string | undefined>,
): { contacto: ContactoFixy | null; faltantes: string[] } {
  const faltantes: string[] = [];
  const contacto = {} as ContactoFixy;
  for (const [campo, variable] of Object.entries(VARIABLES_CONTACTO)) {
    const v = env[variable]?.trim();
    if (!v) faltantes.push(variable);
    else contacto[campo as keyof ContactoFixy] = v;
  }
  return { contacto: faltantes.length ? null : contacto, faltantes };
}

/**
 * Cuántas cajas son, a partir de las unidades por bulto de Sigma.
 *
 * FIXY pide cajas además de unidades, y Digip no las da. Sin dato de bulto (o
 * con un dato absurdo) se toma una caja por renglón: es lo que menos miente --
 * siempre hay al menos una caja-- y FIXY cuenta unidades de todos modos.
 */
export function cajasPara(cantidad: number, unidadesPorBulto: number | null | undefined): number {
  if (cantidad <= 0) return 0;
  const porBulto = unidadesPorBulto && unidadesPorBulto > 0 ? unidadesPorBulto : null;
  if (!porBulto) return 1;
  return Math.max(1, Math.ceil(cantidad / porBulto));
}

/**
 * Lee los renglones de una recepción cargada a mano (las importaciones).
 *
 * Una línea por artículo: `SKU cantidad [cajas]`, separados por espacio, tab
 * o punto y coma --lo que sale de pegar desde una planilla--. Las cajas son
 * opcionales: si faltan, se calculan con el bulto de Sigma al mandar.
 *
 * LA COMA NO SEPARA, a propósito: acá es el decimal. Con la coma como
 * separador, "A1 1,5" se leía como 1 unidad y 5 cajas, sin ningún error. Así
 * queda "1,5" como cantidad, que no es entera, y se rechaza.
 *
 * Un SKU repetido SUMA: dos líneas del mismo artículo en un packing list son
 * dos pallets, no un error.
 */
export function leerRenglonesManual(texto: string): {
  renglones: { sku: string; cantidad: number; cajas: number | null }[];
  errores: string[];
} {
  const porSku = new Map<string, { sku: string; cantidad: number; cajas: number | null }>();
  const errores: string[] = [];

  texto.split(/\r?\n/).forEach((linea, i) => {
    const limpia = linea.trim();
    if (!limpia) return;
    const partes = limpia.split(/[\t; ]+/).filter(Boolean);
    const [sku, cant, cajas] = partes;
    const cantidad = Number(cant?.replace(/\./g, ""));
    if (!sku || !Number.isFinite(cantidad) || cantidad <= 0 || !Number.isInteger(cantidad)) {
      errores.push(`Línea ${i + 1}: "${limpia}" no es "SKU cantidad [cajas]".`);
      return;
    }
    const nCajas = cajas === undefined ? null : Number(cajas);
    if (nCajas !== null && (!Number.isInteger(nCajas) || nCajas < 0)) {
      errores.push(`Línea ${i + 1}: las cajas tienen que ser un número entero.`);
      return;
    }
    const clave = sku.toUpperCase();
    const previo = porSku.get(clave);
    if (previo) {
      previo.cantidad += cantidad;
      previo.cajas =
        previo.cajas === null || nCajas === null ? null : previo.cajas + nCajas;
    } else {
      porSku.set(clave, { sku: clave, cantidad, cajas: nCajas });
    }
  });

  return { renglones: [...porSku.values()], errores };
}

/**
 * El cuerpo de `generar-recepcion`, SIN el token (lo agrega lib/fixy-api.ts
 * al mandar: así lo que se guarda como constancia no lo lleva).
 *
 * `permite_parcial` va en true a propósito: si llega menos de lo avisado,
 * queremos que FIXY reciba lo que llegó y que la diferencia aparezca en el
 * control, no que rebote el camión entero.
 */
export function armarRecepcion(args: {
  remito: string;
  fechaPactada: string;
  contacto: ContactoFixy;
  renglones: RenglonRecepcion[];
}) {
  return {
    remito: args.remito,
    operacion: "RECEPCION",
    fecha_pactada: args.fechaPactada,
    permite_parcial: true,
    contacto: args.contacto,
    productos: args.renglones.map((r) => ({
      sku: r.sku,
      descripcion: r.descripcion.slice(0, 200),
      cajas: r.cajas,
      cantidad: r.cantidad,
      trazable: false,
    })),
  };
}

/** Lo que importa de un aviso de cambio de estado de FIXY. */
export type EventoFixy = {
  guia: string | null;
  remito: string | null;
  estado: string | null;
  codigoEstado: string | null;
  token: string | null;
};

/**
 * Lee el cuerpo del webhook. La doc de FIXY lo da así:
 *
 *   { "usuario": "...", "token": "...", "estado": "Entregada",
 *     "codigo_estado": "ENT", "remito": "255", "guia": 220 }
 *
 * `token` es el que le dimos al registrar el webhook: es nuestra forma de saber
 * que el aviso viene de FIXY.
 */
export function leerEvento(cuerpo: unknown): EventoFixy {
  const c = (cuerpo && typeof cuerpo === "object" ? cuerpo : {}) as Record<string, unknown>;
  const texto = (v: unknown) =>
    v === null || v === undefined || String(v).trim() === "" ? null : String(v).trim();
  return {
    guia: texto(c.guia),
    remito: texto(c.remito),
    estado: texto(c.estado),
    codigoEstado: texto(c.codigo_estado),
    token: texto(c.token),
  };
}

/**
 * Qué hacer con la diferencia de un SKU.
 *
 *   faltante   FIXY tiene menos de lo que debería, y no lo explica algo
 *              que todavía puede estar viajando.
 *   sobrante   tiene más: entró algo sin aviso, o una venta no se descontó.
 *   en_orden   cierra (o la diferencia es menor al umbral).
 */
export function estadoDeDiferencia(
  diferencia: number,
  enTransito: number,
): "faltante" | "sobrante" | "en_orden" {
  if (diferencia + enTransito <= -UMBRAL_DIFERENCIA_UNIDADES) return "faltante";
  if (diferencia >= UMBRAL_DIFERENCIA_UNIDADES) return "sobrante";
  return "en_orden";
}
