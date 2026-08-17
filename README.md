# Tablero Brandmark / NOA

Tablero de negocio en Next.js (App Router, TypeScript) que lee en vivo de
Supabase Postgres (schemas `bronze` y `gold`). Proyecto independiente: no
depende de `frontend-unibrandco`, `backend-unibrandco` ni de AWS.

Primera entrega: página **Ventas Mayoristas** con 10 KPIs y 3 gráficos.

---

## Correr en local

```bash
npm install
```

Copiá `.env.example` a `.env.local` y completá los valores (ese archivo está
en `.gitignore`, nunca se commitea):

```bash
cp .env.example .env.local
```

```bash
npm run dev
```

Queda en http://localhost:3000 → redirige a `/ventas-mayoristas`.

Si todavía no cargaste las variables de Supabase Auth, en desarrollo el
tablero se abre igual (con un cartel amarillo avisando). En producción no:
sin esas variables la app muestra una pantalla de "falta configurar el login"
y no sirve datos.

---

## Variables de entorno

| Variable | Para qué |
|---|---|
| `DB_HOST` `DB_PORT` `DB_USER` `DB_PASS` `DB_NAME` | Conexión SQL a Supabase Postgres |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase Auth (login) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase Auth (login) |

### ⚠️ Si la contraseña tiene un `$`

En `.env.local` hay que escaparlo como `\$` — Next pasa los archivos `.env` por
dotenv-expand, que interpreta `$algo` como una variable y lo reemplaza por
vacío. Si no lo escapás, el error que ves es
`password authentication failed for user "postgres"`, aunque la contraseña esté
bien.

```
contraseña real  ab$cd12   ->   DB_PASS=ab\$cd12
```

**En Vercel es al revés**: ahí no hay parseo de `.env`, así que la contraseña se
pega tal cual, sin escapar.

### ⚠️ Importante para Vercel: usá el *pooler*, no la conexión directa

En Supabase → Project Settings → Database → Connection string, elegí
**"Transaction pooler"**, no "Direct connection":

- `DB_HOST` queda tipo `aws-1-sa-east-1.pooler.supabase.com`
- `DB_PORT` queda `6543`
- `DB_USER` queda tipo `postgres.<project-ref>`

La conexión directa (`db.<ref>.supabase.co:5432`) resuelve solo por IPv6 y las
funciones de Vercel no la alcanzan de forma confiable. En local cualquiera de
las dos anda.

---

## Desplegar en Vercel (cuenta personal, plan gratis)

1. Subí el repo a GitHub (cuenta tuya).
2. En Vercel → **Add New → Project** → importá ese repo. Vercel detecta
   Next.js solo, no hay que tocar build settings.
3. Antes del primer deploy, **Settings → Environment Variables**: cargá las 7
   variables de arriba en los 3 entornos (Production / Preview / Development).
4. Deploy. Cada `git push` a `main` redespliega solo.

No hace falta ningún servidor aparte: las rutas de `app/api/*` se despliegan
como funciones serverless dentro del mismo proyecto.

---

## Crear el usuario del login

Supabase → **Authentication → Users → Add user** → email + contraseña, con
"Auto Confirm User" activado. No hay pantalla de registro en la app a
propósito: los usuarios se dan de alta a mano desde Supabase.

---

## Estructura

```
app/
  (tablero)/
    layout.tsx                     header, nav y botón de salir
    ventas-mayoristas/page.tsx     página 1
  api/
    ventas-mayoristas/route.ts     KPIs + datos de los 3 gráficos
    filtros/route.ts               opciones de los selectores
  login/page.tsx
  auth-no-configurada/page.tsx
components/
  DashboardVentasMayoristas.tsx    orquesta filtros + fetch + render
  Filtros.tsx, ui.tsx, FormularioLogin.tsx, BotonSalir.tsx
  charts/                          recharts: líneas, torta, barras
lib/
  db.ts                            pool de `pg` (credenciales por env)
  queries.ts                       las 6 consultas SQL
  constantes.ts                    reglas de negocio (exclusiones, mínimos)
  types.ts, format.ts, paleta.ts
  supabase/                        clientes de auth (browser / server)
proxy.ts                           protege todas las rutas (ex `middleware.ts`)
```

Las consultas SQL están todas en [lib/queries.ts](lib/queries.ts), una función
por consulta, con el nombre del gráfico o KPI al que alimentan. Los filtros
opcionales se arman en un solo lugar (`whereBase`), así que agregar o cambiar
un filtro impacta en las 6 consultas de una.

---

## Definición de la página "Ventas Mayoristas"

Filtro fijo (no es un selector, es parte de la definición):
`canal = 'Mayorista'` y `vendedor <> 'AGENCIA'`.

Filtros opcionales: vendedor, empresa, mes comercial.

Margen % siempre ponderado por volumen —
`sum(margen_total) / sum(precio_neto * cantidad)`— nunca promedio simple de
porcentajes por línea.

El "margen ajustado" descuenta el flete de entrada por proveedor
(`gold.fletes_proveedores_pct_mensual`, con el corrimiento de un mes ya
aplicado). El join es siempre `LEFT JOIN` con `coalesce(pct_flete, 0)`: hoy la
vista está vacía para la mayoría de los proveedores y no se puede asumir dato.

---

## Pendientes / decisiones abiertas

- **Vendedores a excluir** — hoy solo se excluye `AGENCIA`. Falta definir si
  `BTL`, `PROYECTOS ESPECIALES` y `TRADE` también quedan afuera del reporte
  comercial. Cuando se decida, se agregan a `VENDEDORES_EXCLUIDOS` en
  [lib/constantes.ts](lib/constantes.ts) y aplica a todo el tablero de una.
- **Filtro por provincia** — no implementado a propósito. `fact_ventas.cliente`
  es texto libre y no cruza con `gold.clientes_clasificados.cliente_id` (match
  menor al 1% probando por nombre normalizado). Hace falta una columna de cruce
  real antes de intentarlo.
- **Cobertura de flete a clientes** — el join con `gold.fact_ventas_flete` cubre
  ~89% de las líneas; los pedidos recientes todavía no tienen flete calculado.
- **Fase 2: Cuentas Corrientes** — no arrancada (aging, scoring y cancelaciones
  desde `bronze`).
