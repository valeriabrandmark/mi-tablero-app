
import { CORTE, MARCAS, type ClaveMarca, type Marca } from "@/lib/marketing-demo";
import type { DiaMeta, MetaAds, MetaAdsMarca } from "@/lib/meta-ads-tipos";

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

  const [total, dias, campanas] = await Promise.all([
    insights(cuenta, token, { level: "account", fields: `${base},reach,frequency`, ...filtering }),
    insights(cuenta, token, { level: "account", fields: base, time_increment: "1", ...filtering }),
    insights(cuenta, token, { level: "campaign", fields: `campaign_name,${base}`, ...filtering }),
  ]);

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
    campanas: campanas
      .map((c) => ({
        nombre: c.campaign_name ?? "(sin nombre)",
        gasto: num(c.spend),
        impresiones: num(c.impressions),
        clics: num(c.inline_link_clicks),
        compras: accion(c.actions, TIPOS_COMPRA),
        valorCompras: accion(c.action_values, TIPOS_COMPRA),
      }))
      .sort((a, b) => b.gasto - a.gasto),
  };
}

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
      const cuenta = variable("META_ADS_CUENTA", m.clave);
      if (!token) return [m.clave, demoMeta(m, "Falta META_ADS_TOKEN")];
      if (!cuenta) return [m.clave, demoMeta(m, `Falta META_ADS_CUENTA_${m.clave.toUpperCase()}`)];
      try {
        return [m.clave, await leerMarca(m, token, cuenta)];
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
  const cortes = CORTE.dia - m.diasPautaActiva;
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
      fecha: `${String(i + 1).padStart(2, "0")}/11`,
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
  };
}
