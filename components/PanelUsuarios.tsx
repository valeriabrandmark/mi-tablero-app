"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { CLASE_INPUT, Mensaje } from "@/components/CamposContrasena";
import { Aviso } from "@/components/ui";
import { MODULOS, nombreModulo, type ClaveModulo } from "@/lib/modulos";

/**
 * Alta de usuarios y reparto de permisos. Sólo lo ve el `superadmin`.
 *
 * ---------------------------------------------------------------------------
 * POR QUÉ ESTÁ ACÁ Y NO EN UNA PANTALLA PROPIA
 *
 * Es algo que se usa cinco veces por año: cuando entra alguien. Una entrada
 * fija en el menú, visible todos los días para una sola persona, ocupa lugar
 * permanente para un trabajo ocasional.
 *
 * ---------------------------------------------------------------------------
 * LO QUE LA PANTALLA TIENE QUE DEJAR CLARO
 *
 * Que VER y EDITAR son dos cosas. Antes cada rol traía las dos juntas y no
 * había forma de dar una sin la otra; ahora "Tienda Nube" puede significar
 * mirar el tablero, o además aprobar cambios de precio, y la diferencia tiene
 * que verse antes de guardar y no descubrirse después.
 */

type Usuario = {
  id: string;
  email: string;
  rol: string | null;
  vendedor: string | null;
  modulos: ClaveModulo[];
  editar: ClaveModulo[];
  sigma: number | null;
  ultimoIngreso: string | null;
};

/** Los roles de antes no se tocan desde acá: se muestran y se explican. */
const ROLES_VIEJOS: Record<string, string> = {
  superadmin: "Superadministrador — ve y edita todo",
  admin: "Administrador — ve todo",
  supervisor: "Supervisor — objetivos de los vendedores",
  vendedor: "Vendedor — sólo sus objetivos",
  responsable_meli: "Responsable Mercado Libre",
  admin_tn: "Administrador Tienda Nube",
};

function fecha(iso: string | null): string {
  if (!iso) return "nunca entró";
  return new Date(iso).toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export default function PanelUsuarios() {
  const [usuarios, setUsuarios] = useState<Usuario[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editando, setEditando] = useState<string | null>(null);
  const [recargas, setRecargas] = useState(0);

  // Se pide adentro del efecto y el estado se toca recién en el `.then`, igual
  // que en useDatosTablero: una función que hace setState llamada derecho desde
  // el efecto es justo lo que marca react-hooks/set-state-in-effect.
  useEffect(() => {
    let vivo = true;

    fetch("/api/usuarios", { cache: "no-store" })
      .then(async (res) => {
        const cuerpo = await res.json().catch(() => null);
        if (!res.ok) throw new Error(cuerpo?.error ?? `Error ${res.status}`);
        return (cuerpo?.usuarios ?? []) as Usuario[];
      })
      .then((lista) => {
        if (!vivo) return;
        setUsuarios(lista);
        setError(null);
      })
      .catch((e: unknown) => {
        if (!vivo) return;
        setError(e instanceof Error ? e.message : "No se pudo leer la lista");
        setUsuarios([]);
      });

    return () => {
      vivo = false;
    };
  }, [recargas]);

  /** Vuelve a pedir la lista. Lo usan el alta y el cambio de permisos. */
  const cargar = useCallback(() => setRecargas((n) => n + 1), []);

  return (
    <div className="space-y-5">
      {error && <Aviso tono="alerta">{error}</Aviso>}

      <div className="space-y-2">
        {usuarios === null && <p className="text-muted text-sm">Cargando…</p>}
        {usuarios?.length === 0 && !error && (
          <p className="text-muted text-sm">Todavía no hay usuarios.</p>
        )}
        {usuarios?.map((u) => (
          <FilaUsuario
            key={u.id}
            usuario={u}
            abierto={editando === u.id}
            onAbrir={() => setEditando(editando === u.id ? null : u.id)}
            onGuardado={() => {
              setEditando(null);
              cargar();
            }}
          />
        ))}
      </div>

      <FormularioAlta onCreado={cargar} />
    </div>
  );
}

/**
 * El enlace para poner la contraseña, con su advertencia.
 *
 * Se muestra igual al crear a alguien y al pedirle uno nuevo: es la misma cosa
 * y tiene los mismos cuidados, así que se escribe una sola vez.
 */
function EnlaceAcceso({ enlace }: { enlace: string }) {
  return (
    <div className="border-line mt-3 rounded-lg border p-3">
      {/* EL ENLACE ES UNA LLAVE: quien lo tenga entra a esa cuenta. Por eso se
          manda por privado y no se deja anotado — vence y se usa una sola vez. */}
      <p className="text-muted text-xs">
        Sirve una sola vez y vence —por defecto, en una hora—. Mandáselo por
        privado: quien lo tenga entra a esa cuenta.
      </p>
      <div className="mt-2 flex items-center gap-2">
        <input
          readOnly
          value={enlace}
          className={`${CLASE_INPUT} font-mono text-xs`}
        />
        <button
          type="button"
          onClick={() => void navigator.clipboard?.writeText(enlace)}
          className="border-line shrink-0 rounded-lg border px-3 py-2 text-xs"
        >
          Copiar
        </button>
      </div>
    </div>
  );
}

/** Una persona: qué ve, qué edita, y el formulario para cambiarlo. */
function FilaUsuario({
  usuario,
  abierto,
  onAbrir,
  onGuardado,
}: {
  usuario: Usuario;
  abierto: boolean;
  onAbrir: () => void;
  onGuardado: () => void;
}) {
  const aMedida = usuario.rol === "personalizado";
  const sinAcceso = aMedida && usuario.modulos.length === 0;
  const [enlace, setEnlace] = useState<string | null>(null);
  const [pidiendo, setPidiendo] = useState(false);
  const [fallo, setFallo] = useState<string | null>(null);

  async function pedirEnlace() {
    setPidiendo(true);
    setFallo(null);
    try {
      const res = await fetch("/api/usuarios/enlace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: usuario.email }),
      });
      const cuerpo = await res.json().catch(() => null);
      if (!res.ok) throw new Error(cuerpo?.error ?? `Error ${res.status}`);
      setEnlace(`${window.location.origin}${cuerpo.ruta}`);
    } catch (e) {
      setFallo(e instanceof Error ? e.message : "No se pudo generar el enlace");
    } finally {
      setPidiendo(false);
    }
  }

  return (
    <div className="border-line rounded-lg border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{usuario.email}</p>
          <p className="text-muted mt-0.5 text-xs">
            {aMedida
              ? sinAcceso
                ? "Sin acceso"
                : usuario.modulos.map(nombreModulo).join(" · ")
              : (ROLES_VIEJOS[usuario.rol ?? ""] ?? "Sin permisos cargados")}
            {usuario.vendedor ? ` (${usuario.vendedor})` : ""}
            {" — "}
            {fecha(usuario.ultimoIngreso)}
          </p>
          {aMedida && usuario.editar.length > 0 && (
            <p className="text-c2 mt-0.5 text-xs">
              Edita: {usuario.editar.map(nombreModulo).join(" · ")}
              {usuario.sigma ? ` · Sigma ${usuario.sigma}` : ""}
            </p>
          )}
        </div>
        <div className="flex shrink-0 gap-2">
          {/* El enlace de acceso sirve para las dos cosas que pasan de verdad:
              la persona que no llegó a usar el primero, y la que se olvidó la
              contraseña cuando el mail del proyecto no está configurado. */}
          <button
            type="button"
            onClick={() => void pedirEnlace()}
            disabled={pidiendo}
            className="border-line rounded-lg border px-3 py-1.5 text-xs disabled:opacity-60"
          >
            {pidiendo ? "Generando…" : "Enlace de acceso"}
          </button>
          <button
            type="button"
            onClick={onAbrir}
            className="border-line rounded-lg border px-3 py-1.5 text-xs"
          >
            {abierto ? "Cerrar" : "Permisos"}
          </button>
        </div>
      </div>

      {fallo && <p className="mt-2 text-xs text-rose-400">{fallo}</p>}
      {enlace && <EnlaceAcceso enlace={enlace} />}

      {abierto && (
        <div className="border-line mt-3 border-t pt-3">
          {!aMedida && (
            <p className="text-muted mb-3 text-xs">
              Este usuario tiene un rol de los viejos. Si guardás, pasa a tener
              permisos por módulo y el rol anterior deja de aplicarse.
            </p>
          )}
          <FormularioPermisos
            inicial={usuario}
            textoBoton="Guardar permisos"
            onEnviar={async (datos) => {
              const res = await fetch("/api/usuarios", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id: usuario.id, ...datos }),
              });
              const cuerpo = await res.json().catch(() => null);
              if (!res.ok)
                throw new Error(cuerpo?.error ?? `Error ${res.status}`);
              onGuardado();
              return null;
            }}
          />
        </div>
      )}
    </div>
  );
}

/** Alta: el mail y las mismas casillas. */
function FormularioAlta({ onCreado }: { onCreado: () => void }) {
  const [email, setEmail] = useState("");
  const [enlace, setEnlace] = useState<string | null>(null);
  const [creado, setCreado] = useState<string | null>(null);

  return (
    <div className="border-line rounded-lg border border-dashed p-3">
      <p className="mb-3 text-sm font-medium">Agregar una persona</p>

      <label className="block text-xs">
        Mail
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="nombre@brandmark.com.ar"
          className={CLASE_INPUT}
        />
      </label>

      <div className="mt-3">
        <FormularioPermisos
          inicial={{ modulos: [], editar: [], sigma: null }}
          textoBoton="Crear usuario"
          onEnviar={async (datos) => {
            const res = await fetch("/api/usuarios", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ email, ...datos }),
            });
            const cuerpo = await res.json().catch(() => null);
            if (!res.ok)
              throw new Error(cuerpo?.error ?? `Error ${res.status}`);
            setCreado(email);
            // El origen lo pone el navegador: es el único que sabe con certeza
            // desde qué dirección se está usando el tablero. El servidor
            // tendría que adivinarlo entre proxys y encabezados reenviados.
            setEnlace(
              cuerpo.ruta ? `${window.location.origin}${cuerpo.ruta}` : null,
            );
            setEmail("");
            onCreado();
            return cuerpo.ruta
              ? null
              : "Usuario creado. No se pudo generar el enlace: decile que entre con «¿Olvidaste tu contraseña?».";
          }}
        />
      </div>

      {creado && enlace && (
        <div className="mt-3">
          <p className="text-sm">
            <span className="font-medium">{creado}</span> ya puede entrar.
            Mandale este enlace para que ponga su contraseña:
          </p>
          <EnlaceAcceso enlace={enlace} />
        </div>
      )}
    </div>
  );
}

type Datos = {
  modulos: ClaveModulo[];
  editar: ClaveModulo[];
  sigma: number | null;
  nombreSigma?: string | null;
};

/** Las casillas. Es el mismo formulario para crear y para editar. */
function FormularioPermisos({
  inicial,
  textoBoton,
  onEnviar,
}: {
  inicial: {
    modulos: ClaveModulo[];
    editar: ClaveModulo[];
    sigma: number | null;
  };
  textoBoton: string;
  onEnviar: (datos: Datos) => Promise<string | null>;
}) {
  const [ve, setVe] = useState<ClaveModulo[]>(inicial.modulos);
  const [edita, setEdita] = useState<ClaveModulo[]>(inicial.editar);
  const [sigma, setSigma] = useState(
    inicial.sigma ? String(inicial.sigma) : "",
  );
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  function alternar(clave: ClaveModulo) {
    setVe((antes) => {
      const ahora = antes.includes(clave)
        ? antes.filter((m) => m !== clave)
        : [...antes, clave];
      // Sacar el módulo saca también su permiso de editar: dejarlo marcado
      // mostraría "edita Compras" en alguien que ya no ve Compras.
      if (!ahora.includes(clave)) setEdita((e) => e.filter((m) => m !== clave));
      return ahora;
    });
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setOk(null);
    setEnviando(true);
    try {
      const aviso = await onEnviar({
        modulos: ve,
        editar: edita,
        sigma: sigma.trim() === "" ? null : Number(sigma),
      });
      setOk(aviso ?? "Listo.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div className="grid gap-1.5 sm:grid-cols-2">
        {MODULOS.map((m) => {
          const visible = ve.includes(m.clave);
          return (
            <div key={m.clave} className="text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={visible}
                  onChange={() => alternar(m.clave)}
                />
                {m.nombre}
              </label>
              {m.queEdita && visible && (
                <label className="text-muted ml-6 flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={edita.includes(m.clave)}
                    onChange={() =>
                      setEdita((antes) =>
                        antes.includes(m.clave)
                          ? antes.filter((x) => x !== m.clave)
                          : [...antes, m.clave],
                      )
                    }
                  />
                  puede {m.queEdita}
                </label>
              )}
            </div>
          );
        })}
      </div>

      {edita.includes("compras") && (
        <label className="block text-xs">
          Número de usuario de Sigma
          <input
            type="number"
            min={1}
            value={sigma}
            onChange={(e) => setSigma(e.target.value)}
            className={CLASE_INPUT}
          />
          {/* No se puede deducir: sale de Sigma y la orden queda firmada con él. */}
          <span className="text-muted mt-1 block">
            Sale de Sigma. La orden de compra queda firmada con ese número, así
            que sin él no se puede mandar.
          </span>
        </label>
      )}

      {error && <Mensaje tono="error">{error}</Mensaje>}
      {ok && <Mensaje tono="ok">{ok}</Mensaje>}

      <button
        type="submit"
        disabled={enviando}
        className="bg-c1 rounded-lg px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
      >
        {enviando ? "Guardando…" : textoBoton}
      </button>
    </form>
  );
}
