
import { CORTE, MARCAS, type ClaveMarca, type Marca } from "@/lib/marketing-demo";
import type { CampanaMeta, DiaMeta, MetaAds, MetaAdsMarca } from "@/lib/meta-ads-tipos";
import type { DatosInstagram, InstagramMarca } from "@/lib/marketing-fuentes";

export type { MetaAds, MetaAdsMarca } from "@/lib/meta-ads-tipos";

/**
 * META ADS: la pauta de Instagram y Facebook de cada marca, leída de la API de
 * Marketing de Meta (endpoint Insights).
 *
 * ---------------------------------------------------------------------------
 * POR QUÉ ESTO Y NO LA PLANILLA
 *
 * El acuerdo de rol pide que Agatina cargue a mano "inversión, clics y
 * conversiones" desde el panel de cada cuenta. Con acceso a Meta Ads eso sale
 * solo, todos los días, y además da algo que la planilla no puede: el gasto
 * DÍA POR DÍA. Con eso la meta "pauta activa todos los días, sin cortes" se
 * mide sola — un día con gasto cero es un corte, sin discusión.
 *
 * ---------------------------------------------------------------------------
 * CONFIGURACIÓN (Vercel → Settings → Environment Variables)
 *
 *   META_ADS_TOKEN                 Token de un USUARIO DEL SISTEMA del Business
 *                                  Manager, con permiso `ads_read` sobre las
 *                                  cuentas. No uno personal: esos vencen a los
 *                                  60 días y el tablero se cae solo.
 *   META_ADS_CUENTA_DIAPER_GENIE   act_XXXXXXXX
 *   META_ADS_CUENTA_HOLA_TOYS      act_XXXXXXXX
 *   META_ADS_CUENTA_UNIBRANDCO     act_XXXXXXXX
 *   META_ADS_CUENTA_LITTER_GENIE   act_XXXXXXXX
 *   META_ADS_FILTRO_<MARCA>        (opcional) texto que tiene que aparecer en
 *                                  el NOMBRE de la campaña. Hace falta sólo si
 *                                  dos marcas comparten la misma cuenta
 *                                  publicitaria: ahí la marca se separa por el
 *                                  nombre, así que conviene una convención
 *                                  fija ("DG - ...", "HT - ...").
 *   META_ADS_API_VERSION           (opcional) por defecto v23.0.
 *
 * NINGUNA LLEVA NEXT_PUBLIC_: el token NUNCA sale del servidor. Este archivo
 * sólo se importa desde la página (server component); al navegador le llega
 * el resultado ya calculado, nunca el token.
 *
 * SIN TOKEN, o con una marca sin cuenta, esa marca muestra DATOS DE EJEMPLO y
 * la pantalla lo dice. Nunca se mezcla un número real con uno inventado sin
 * avisar.
 */

// ---------------------------------------------------------------------------
// Lectura de la API
// ---------------------------------------------------------------------------

type Accion = { action_type: string; value: string };
type FilaInsights = {
  date_start?: string;
  campaign_name?: string;
  ad_name?: string;
  objective?: string;
  publisher_platform?: string;
  age?: string;
  spend?: string;
  impressions?: string;
  reach?: string;
  frequency?: string;
  inline_link_clicks?: string;
  actions?: Accion[];
  action_values?: Accion[];
};

/**
 * La compra aparece con varios nombres según cómo esté armado el píxel. Se
 * toma el PRIMERO que exista, en este orden, y no la suma: son el mismo evento
 * contado por distintas vías, sumarlos lo duplica.
 */
const TIPOS_COMPRA = ["omni_purchase", "purchase", "offsite_conversion.fb_pixel_purchase"];
const TIPO_CONVERSACION = "onsite_conversion.messaging_conversation_started_7d";

function accion(lista: Accion[] | undefined, tipos: string[]): number {
  for (const t of tipos) {
    const a = lista?.find((x) => x.action_type === t);
    if (a) return Number(a.value) || 0;
  }
  return 0;
}

const num = (v: string | undefined) => Number(v ?? 0) || 0;

function variable(prefijo: string, marca: ClaveMarca): string | undefined {
  const v = process.env[`${prefijo}_${marca.toUpperCase()}`]?.trim();
  return v ? v : undefined;
}

async function insights(
  cuenta: string,
  token: string,
  params: Record<string, string>,
): Promise<FilaInsights[]> {
  const version = process.env.META_ADS_API_VERSION?.trim() || "v23.0";
  const id = cuenta.startsWith("act_") ? cuenta : `act_${cuenta}`;
  const url = new URL(`https://graph.facebook.com/${version}/${id}/insights`);
  url.searchParams.set("date_preset", "this_month");
  url.searchParams.set("limit", "500");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  // El token va en el header y no en la URL: las URLs terminan en logs.
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    // 15 minutos: Meta actualiza Insights con demora de todos modos, y así
    // abrir el tablero varias veces seguidas no gasta cuota de la API.
    next: { revalidate: 900 },
  });
  const cuerpo = (await res.json()) as { data?: FilaInsights[]; error?: { message?: string } };
  if (!res.ok || cuerpo.error) {
    throw new Error(cuerpo.error?.message ?? `Meta respondió ${res.status}`);
  }
  return cuerpo.data ?? [];
}

async function leerMarca(marca: Marca, token: string, cuenta: string): Promise<MetaAdsMarca> {
  const filtro = variable("META_ADS_FILTRO", marca.clave);
  const filtering: Record<string, string> = filtro
    ? { filtering: JSON.stringify([{ field: "campaign.name", operator: "CONTAIN", value: filtro }]) }
    : {};
  const base = "spend,impressions,inline_link_clicks,actions,action_values";

  const [total, dias, campanas, anuncios, plataformas, edades] = await Promise.all([
    insights(cuenta, token, { level: "account", fields: `${base},reach,frequency`, ...filtering }),
    insights(cuenta, token, { level: "account", fields: base, time_increment: "1", ...filtering }),
    insights(cuenta, token, { level: "campaign", fields: `campaign_name,objective,${base}`, ...filtering }),
    insights(cuenta, token, { level: "ad", fields: `ad_name,${base}`, sort: "spend_descending", ...filtering }),
    insights(cuenta, token, { level: "account", fields: base, breakdowns: "publisher_platform", ...filtering }),
    insights(cuenta, token, { level: "account", fields: base, breakdowns: "age", ...filtering }),
  ]);

  const fila = (nombre: string, c: FilaInsights): CampanaMeta => ({
    nombre,
    objetivo: c.objective ?? null,
    gasto: num(c.spend),
    impresiones: num(c.impressions),
    clics: num(c.inline_link_clicks),
    compras: accion(c.actions, TIPOS_COMPRA),
    valorCompras: accion(c.action_values, TIPOS_COMPRA),
  });
  const porGasto = (a: CampanaMeta, b: CampanaMeta) => b.gasto - a.gasto;

  const t = total[0] ?? {};
  return {
    fuente: "meta",
    totales: {
      gasto: num(t.spend),
      impresiones: num(t.impressions),
      alcance: num(t.reach),
      frecuencia: num(t.frequency),
      clics: num(t.inline_link_clicks),
      compras: accion(t.actions, TIPOS_COMPRA),
      valorCompras: accion(t.action_values, TIPOS_COMPRA),
      conversaciones: accion(t.actions, [TIPO_CONVERSACION]),
    },
    diario: completarDias(
      dias.map((d) => ({
        fecha: ddmm(d.date_start ?? ""),
        gasto: num(d.spend),
        impresiones: num(d.impressions),
        clics: num(d.inline_link_clicks),
        compras: accion(d.actions, TIPOS_COMPRA),
        valorCompras: accion(d.action_values, TIPOS_COMPRA),
      })),
    ),
    campanas: campanas.map((c) => fila(c.campaign_name ?? "(sin nombre)", c)).sort(porGasto),
    anuncios: anuncios.map((c) => fila(c.ad_name ?? "(sin nombre)", c)).sort(porGasto).slice(0, 10),
    plataformas: plataformas
      .map((c) => fila(NOMBRE_PLATAFORMA[c.publisher_platform ?? ""] ?? c.publisher_platform ?? "Otra", c))
      .sort(porGasto),
    edades: edades.map((c) => fila(c.age ?? "?", c)).sort((a, b) => a.nombre.localeCompare(b.nombre)),
  };
}

/**
 * Suma varias cuentas publicitarias de una misma marca.
 *
 * TODO SE SUMA EXACTO menos el ALCANCE: Meta deduplica personas dentro de una
 * cuenta, no entre cuentas, así que una persona que vio anuncios de las dos
 * cuentas cuenta dos veces. Es una cota de arriba; la frecuencia se recalcula
 * con ese alcance y queda, por lo mismo, una cota de abajo.
 */
function combinar(partes: MetaAdsMarca[]): MetaAdsMarca {
  if (partes.length === 1) return partes[0];
  const conversion = partes.find((p) => p.conversion)?.conversion;
  const sumar = (a: CampanaMeta, b: CampanaMeta): CampanaMeta => ({
    ...a,
    gasto: a.gasto + b.gasto,
    impresiones: a.impresiones + b.impresiones,
    clics: a.clics + b.clics,
    compras: a.compras + b.compras,
    valorCompras: a.valorCompras + b.valorCompras,
  });
  const porNombre = (listas: CampanaMeta[][]) => {
    const m = new Map<string, CampanaMeta>();
    for (const f of listas.flat()) m.set(f.nombre, m.has(f.nombre) ? sumar(m.get(f.nombre)!, f) : f);
    return [...m.values()];
  };
  const porGasto = (a: CampanaMeta, b: CampanaMeta) => b.gasto - a.gasto;
  const t = partes.map((p) => p.totales);
  const suma = (k: keyof MetaAdsMarca["totales"]) => t.reduce((s, x) => s + x[k], 0);
  const impresiones = suma("impresiones");
  const alcance = suma("alcance");
  return {
    fuente: "meta",
    conversion,
    totales: {
      gasto: suma("gasto"),
      impresiones,
      alcance,
      frecuencia: alcance ? impresiones / alcance : 0,
      clics: suma("clics"),
      compras: suma("compras"),
      valorCompras: suma("valorCompras"),
      conversaciones: suma("conversaciones"),
    },
    diario: partes[0].diario.map((d, i) =>
      partes.slice(1).reduce(
        (acc, p) => {
          const o = p.diario[i];
          return o
            ? {
                ...acc,
                gasto: acc.gasto + o.gasto,
                impresiones: acc.impresiones + o.impresiones,
                clics: acc.clics + o.clics,
                compras: acc.compras + o.compras,
                valorCompras: acc.valorCompras + o.valorCompras,
              }
            : acc;
        },
        { ...d },
      ),
    ),
    campanas: partes.flatMap((p) => p.campanas).sort(porGasto),
    anuncios: partes.flatMap((p) => p.anuncios).sort(porGasto).slice(0, 10),
    plataformas: porNombre(partes.map((p) => p.plataformas)).sort(porGasto),
    edades: porNombre(partes.map((p) => p.edades)).sort((a, b) => a.nombre.localeCompare(b.nombre)),
  };
}

// ---------------------------------------------------------------------------
// Moneda: cuentas publicitarias en dólares
// ---------------------------------------------------------------------------
//
// Meta informa cada cuenta EN SU MONEDA, sin aviso: "spend": "101.44" en una
// cuenta en USD son USD 101, no $101. Hola Toys 2 está en dólares, así que
// sin esto la inversión de Hola Toys se leía unas mil veces más chica y el
// retorno daba fantasía.
//
// Se convierte a pesos TODO lo que es plata (gasto y valor de compras), nunca
// cantidades (impresiones, clics, compras).
//
// POR AHORA NO SE CONVIERTE (pedido de Ana, 12/11/2026): sin la variable
// META_ADS_TIPO_CAMBIO cada cuenta queda en su moneda y la pantalla avisa
// "importes en USD, sin convertir". Para convertir, cargar la variable:
//   "tarjeta"                dólar tarjeta de dolarapi.com: es lo que se paga
//                            de verdad cuando Meta cobra en USD a una tarjeta
//                            argentina, con los impuestos incluidos.
//   "oficial" | "blue" | "mep" | "cripto"  otra cotización de dolarapi.com.
//   un número, ej. "1450"    valor fijo que definan Ana y Alejandro.

async function monedaDe(cuenta: string, token: string): Promise<string> {
  const id = cuenta.startsWith("act_") ? cuenta : `act_${cuenta}`;
  const r = await graph<{ currency?: string }>(id, token, { fields: "currency" });
  return (r.currency ?? "ARS").toUpperCase();
}

async function tipoDeCambio(moneda: string): Promise<{ valor: number; fuente: string }> {
  if (moneda !== "USD") {
    throw new Error(`La cuenta está en ${moneda} y sólo se sabe convertir USD`);
  }
  const conf = (process.env.META_ADS_TIPO_CAMBIO ?? "").trim().toLowerCase();
  const fijo = Number(conf.replace(",", "."));
  if (Number.isFinite(fijo) && fijo > 0) return { valor: fijo, fuente: "valor fijo" };
  const res = await fetch(`https://dolarapi.com/v1/dolares/${encodeURIComponent(conf)}`, {
    next: { revalidate: 3600 },
  });
  const j = (await res.json().catch(() => null)) as { venta?: number } | null;
  if (!res.ok || !j?.venta) throw new Error(`No se pudo leer el dólar ${conf} de dolarapi.com`);
  return { valor: j.venta, fuente: `dólar ${conf}` };
}

async function enPesos(d: MetaAdsMarca, moneda: string): Promise<MetaAdsMarca> {
  if (moneda === "ARS") return d;
  if (!process.env.META_ADS_TIPO_CAMBIO?.trim()) {
    return { ...d, conversion: { moneda, tipoCambio: 1, fuente: "sin convertir" } };
  }
  const { valor: tc, fuente } = await tipoDeCambio(moneda);
  const plata = <T extends { gasto: number; valorCompras: number }>(x: T): T => ({
    ...x,
    gasto: x.gasto * tc,
    valorCompras: x.valorCompras * tc,
  });
  return {
    ...d,
    conversion: { moneda, tipoCambio: tc, fuente },
    totales: plata(d.totales),
    diario: d.diario.map(plata),
    campanas: d.campanas.map(plata),
    anuncios: d.anuncios.map(plata),
    plataformas: d.plataformas.map(plata),
    edades: d.edades.map(plata),
  };
}

const NOMBRE_PLATAFORMA: Record<string, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  messenger: "Messenger",
  audience_network: "Audience Network",
  threads: "Threads",
};

function ddmm(iso: string): string {
  const [, m, d] = iso.split("-");
  return d && m ? `${d}/${m}` : iso;
}

/**
 * MUY IMPORTANTE PARA "PAUTA TODOS LOS DÍAS": Meta NO devuelve fila para un
 * día sin gasto, simplemente lo saltea. Sin rellenar, un corte de pauta no se
 * vería nunca — el gráfico quedaría continuo y el conteo de días daría
 * perfecto. Por eso se arma el mes entero hasta hoy y lo que falta va en cero.
 */
function completarDias(dias: DiaMeta[]): DiaMeta[] {
  const hoy = new Date();
  const mes = String(hoy.getMonth() + 1).padStart(2, "0");
  const porFecha = new Map(dias.map((d) => [d.fecha, d]));
  return Array.from({ length: hoy.getDate() }, (_, i) => {
    const fecha = `${String(i + 1).padStart(2, "0")}/${mes}`;
    return (
      porFecha.get(fecha) ?? { fecha, gasto: 0, impresiones: 0, clics: 0, compras: 0, valorCompras: 0 }
    );
  });
}

/** Lee las cuatro marcas. Una que falla no tira abajo a las otras. */
export async function leerMetaAds(): Promise<MetaAds> {
  const token = process.env.META_ADS_TOKEN?.trim();
  const pares = await Promise.all(
    MARCAS.map(async (m): Promise<[ClaveMarca, MetaAdsMarca]> => {
      // Puede haber MÁS DE UNA cuenta por marca, separadas por coma: Hola Toys
      // tiene "Hola Toys Argentina" y "Hola Toys 2". Se leen todas y se suman.
      const cuentas = (variable("META_ADS_CUENTA", m.clave) ?? "")
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean);
      if (!token) return [m.clave, demoMeta(m, "Falta META_ADS_TOKEN")];
      if (!cuentas.length) return [m.clave, demoMeta(m, `Falta META_ADS_CUENTA_${m.clave.toUpperCase()}`)];
      try {
        const porCuenta = await Promise.all(
          cuentas.map(async (c) => enPesos(await leerMarca(m, token, c), await monedaDe(c, token))),
        );
        return [m.clave, combinar(porCuenta)];
      } catch (e) {
        const motivo = e instanceof Error ? e.message : String(e);
        console.error(`Meta Ads ${m.nombre}:`, motivo);
        return [m.clave, demoMeta(m, `Meta devolvió un error: ${motivo}`)];
      }
    }),
  );
  return Object.fromEntries(pares) as MetaAds;
}

// ---------------------------------------------------------------------------
// Datos de ejemplo (sin token)
// ---------------------------------------------------------------------------

const CAMPANAS_DEMO: Record<ClaveMarca, [string, number, number][]> = {
  // [nombre, parte del gasto, ROAS]
  diaper_genie: [
    ["DG - CyberMonday - Ventas", 0.35, 5.8],
    ["DG - Navidad - Catálogo", 0.3, 4.6],
    ["DG - Remarketing tienda", 0.2, 7.9],
    ["DG - Alcance mamás 25-40", 0.15, 0.9],
  ],
  hola_toys: [
    ["HT - Navidad - Catálogo", 0.4, 4.2],
    ["HT - Boost post influencer", 0.3, 6.5],
    ["HT - CyberMonday - Ventas", 0.2, 3.9],
    ["HT - Mensajes mayoristas", 0.1, 0.4],
  ],
  unibrandco: [["UB - Remarketing tienda", 1, 5.1]],
  litter_genie: [
    ["LG - Ventas gatos", 0.7, 3.4],
    ["LG - Alcance", 0.3, 0.6],
  ],
};

function demoMeta(m: Marca, motivo: string): MetaAdsMarca {
  const gastoMes = m.gastoPorCanal["Meta Ads"];
  // Los días sin pauta del ejemplo salen de `diasPautaActiva`, repartidos
  // hacia el final para que se vea cómo se marca un corte.
  const cortes = Math.max(0, Math.min(CORTE.dia - 1, 11 - m.diasPautaActiva));
  const sinPauta = new Set(Array.from({ length: cortes }, (_, i) => CORTE.dia - 1 - i * 2));
  const pesos = Array.from({ length: CORTE.dia }, (_, i) =>
    sinPauta.has(i) ? 0 : 1 + ((i * 7) % 5) / 10 + (i < 4 ? 0.4 : 0),
  );
  const sumaPesos = pesos.reduce((s, p) => s + p, 0);
  const roasMedio = CAMPANAS_DEMO[m.clave].reduce((s, [, parte, r]) => s + parte * r, 0);
  const ticket = m.pedidosTienda ? m.ventaTiendas / m.pedidosTienda : 15_000;

  const diario = pesos.map((p, i) => {
    const gasto = Math.round((gastoMes * p) / sumaPesos);
    const impresiones = Math.round(gasto / 4.2);
    const valorCompras = Math.round(gasto * roasMedio * (0.8 + ((i * 3) % 5) / 10));
    return {
      fecha: `${String(i + 1).padStart(2, "0")}/${CORTE.mm}`,
      gasto,
      impresiones,
      clics: Math.round(impresiones * 0.013),
      compras: Math.round(valorCompras / ticket),
      valorCompras,
    };
  });

  const suma = (k: keyof Omit<DiaMeta, "fecha">) => diario.reduce((s, d) => s + d[k], 0);
  const impresiones = suma("impresiones");
  const alcance = Math.round(impresiones / 2.6);

  return {
    fuente: "demo",
    motivo,
    diario,
    totales: {
      gasto: suma("gasto"),
      impresiones,
      alcance,
      frecuencia: impresiones / alcance,
      clics: suma("clics"),
      compras: suma("compras"),
      valorCompras: suma("valorCompras"),
      conversaciones: Math.round(m.mensajes30d * 0.35),
    },
    campanas: CAMPANAS_DEMO[m.clave].map(([nombre, parte, r]) => {
      const gasto = Math.round(gastoMes * parte);
      const imp = Math.round(gasto / 4.2);
      return {
        nombre,
        gasto,
        impresiones: imp,
        clics: Math.round(imp * 0.013),
        compras: Math.round((gasto * r) / ticket),
        valorCompras: Math.round(gasto * r),
      };
    }),
    anuncios: CAMPANAS_DEMO[m.clave].flatMap(([nombre, parte, r], k) =>
      ["Reel", "Carrusel"].map((tipo, n) => {
        const gasto = Math.round(gastoMes * parte * (n ? 0.4 : 0.6));
        const imp = Math.round(gasto / 4.2);
        const rr = r * (n ? 0.8 : 1.15);
        return {
          nombre: `${nombre.split(" - ").slice(1).join(" - ")} · ${tipo} ${k + 1}`,
          gasto,
          impresiones: imp,
          clics: Math.round(imp * (n ? 0.011 : 0.016)),
          compras: Math.round((gasto * rr) / ticket),
          valorCompras: Math.round(gasto * rr),
        };
      }),
    ).sort((a, b) => b.gasto - a.gasto).slice(0, 10),
    plataformas: repartir(gastoMes, roasMedio, ticket, [
      ["Instagram", 0.68, 1.1],
      ["Facebook", 0.27, 0.8],
      ["Messenger", 0.03, 0.5],
      ["Audience Network", 0.02, 0.2],
    ]),
    edades: repartir(gastoMes, roasMedio, ticket, [
      ["18-24", 0.08, 0.5],
      ["25-34", 0.42, 1.2],
      ["35-44", 0.33, 1.0],
      ["45-54", 0.12, 0.8],
      ["55-64", 0.05, 0.6],
    ]),
  };
}

function repartir(
  gastoMes: number,
  roasMedio: number,
  ticket: number,
  partes: [string, number, number][],
): CampanaMeta[] {
  return partes.map(([nombre, parte, factor]) => {
    const gasto = Math.round(gastoMes * parte);
    const imp = Math.round(gasto / 4.2);
    const valor = Math.round(gasto * roasMedio * factor);
    return {
      nombre,
      gasto,
      impresiones: imp,
      clics: Math.round(imp * 0.013),
      compras: Math.round(valor / ticket),
      valorCompras: valor,
    };
  });
}

// ===========================================================================
// INSTAGRAM ORGÁNICO (Graph API de Instagram, mismo token)
// ===========================================================================
//
// Con el mismo acceso de Meta salen los KPIs del NIVEL 1 del acuerdo de rol,
// que hasta ahora eran "captura mensual del panel": seguidores, alcance,
// interacciones, y además la meta de CONTENIDO --3 publicaciones por semana
// por marca-- se cuenta sola a partir de lo publicado.
//
// Variables: META_IG_CUENTA_<MARCA> = el ID de la cuenta profesional de
// Instagram (no el @usuario). Se ve en Business Manager → Cuentas de
// Instagram, o con /me/accounts?fields=instagram_business_account.
// El usuario del sistema necesita además instagram_basic,
// instagram_manage_insights y pages_read_engagement.

type RespuestaGraph<T> = T & { error?: { message?: string } };

async function graph<T>(ruta: string, token: string, params: Record<string, string> = {}): Promise<T> {
  const version = process.env.META_ADS_API_VERSION?.trim() || "v23.0";
  const url = new URL(`https://graph.facebook.com/${version}/${ruta}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    next: { revalidate: 900 },
  });
  const cuerpo = (await res.json()) as RespuestaGraph<T>;
  if (!res.ok || cuerpo.error) throw new Error(cuerpo.error?.message ?? `Meta respondió ${res.status}`);
  return cuerpo;
}

/** Inicio del mes en curso, en hora argentina, como segundos Unix. */
function inicioMesUnix(): number {
  const ar = new Date(Date.now() - 3 * 3600_000);
  return Date.UTC(ar.getUTCFullYear(), ar.getUTCMonth(), 1, 3) / 1000;
}

async function leerIgMarca(id: string, token: string): Promise<DatosInstagram> {
  const desde = inicioMesUnix();
  const hasta = Math.floor(Date.now() / 1000);

  const perfil = await graph<{ username?: string; followers_count?: number }>(id, token, {
    fields: "username,followers_count",
  });
  const media = await graph<{ data: { timestamp: string; like_count?: number; comments_count?: number }[] }>(
    `${id}/media`,
    token,
    { fields: "timestamp,like_count,comments_count", since: String(desde), limit: "100" },
  );

  // Las métricas de Insights cambian de nombre seguido (impressions pasó a
  // views en 2025). Cada una se pide sola: si Meta da de baja una, se pierde
  // ese número y no la sección entera.
  async function total(metrica: string): Promise<number | null> {
    try {
      const r = await graph<{ data: { total_value?: { value?: number } }[] }>(`${id}/insights`, token, {
        metric: metrica,
        period: "day",
        metric_type: "total_value",
        since: String(desde),
        until: String(hasta),
      });
      return r.data[0]?.total_value?.value ?? null;
    } catch {
      return null;
    }
  }
  async function nuevosSeguidores(): Promise<number | null> {
    try {
      const r = await graph<{ data: { values?: { value?: number }[] }[] }>(`${id}/insights`, token, {
        metric: "follower_count",
        period: "day",
        since: String(desde),
        until: String(hasta),
      });
      return (r.data[0]?.values ?? []).reduce((s, v) => s + (v.value ?? 0), 0);
    } catch {
      return null;
    }
  }
  const [alcance, vistas, interaccionesApi, seguidoresNuevos] = await Promise.all([
    total("reach"),
    total("views"),
    total("total_interactions"),
    nuevosSeguidores(),
  ]);

  const publicadas = media.data.filter((p) => Date.parse(p.timestamp) / 1000 >= desde);
  const porSemana: number[] = [];
  for (const p of publicadas) {
    const dia = new Date(Date.parse(p.timestamp) - 3 * 3600_000).getUTCDate();
    const semana = Math.floor((dia - 1) / 7);
    porSemana[semana] = (porSemana[semana] ?? 0) + 1;
  }
  const hoy = new Date(Date.now() - 3 * 3600_000).getUTCDate();
  const semanas = Math.floor((hoy - 1) / 7) + 1;

  return {
    usuario: perfil.username ?? null,
    seguidores: perfil.followers_count ?? 0,
    seguidoresNuevos,
    alcance,
    vistas,
    interacciones:
      interaccionesApi ??
      publicadas.reduce((s, p) => s + (p.like_count ?? 0) + (p.comments_count ?? 0), 0),
    publicacionesMes: publicadas.length,
    publicacionesPorSemana: Array.from({ length: semanas }, (_, i) => porSemana[i] ?? 0),
  };
}

export async function leerInstagram(): Promise<Record<ClaveMarca, InstagramMarca>> {
  const token = process.env.META_ADS_TOKEN?.trim();
  const pares = await Promise.all(
    MARCAS.map(async (m): Promise<[ClaveMarca, InstagramMarca]> => {
      const id = variable("META_IG_CUENTA", m.clave);
      if (!token) return [m.clave, { fuente: "demo", motivo: "Falta META_ADS_TOKEN" }];
      if (!id) return [m.clave, { fuente: "demo", motivo: `Falta META_IG_CUENTA_${m.clave.toUpperCase()}` }];
      try {
        return [m.clave, { fuente: "meta", datos: await leerIgMarca(id, token) }];
      } catch (e) {
        const motivo = e instanceof Error ? e.message : String(e);
        console.error(`Instagram ${m.nombre}:`, motivo);
        return [m.clave, { fuente: "demo", motivo: `Instagram devolvió un error: ${motivo}` }];
      }
    }),
  );
  return Object.fromEntries(pares) as Record<ClaveMarca, InstagramMarca>;
}
