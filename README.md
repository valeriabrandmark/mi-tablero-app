# Tablero Brandmark / NOA

Tablero de negocio en Next.js (App Router, TypeScript) que lee en vivo de
Supabase Postgres (schemas `bronze` y `gold`). Proyecto independiente: no
depende de `frontend-unibrandco`, `backend-unibrandco` ni de AWS.

Páginas: **Ventas Mayoristas**, **Logística** y **Cuentas Corrientes**, portadas
desde el tablero de Power BI (`Tablero_AnaV1.2.pbit`), más **Objetivos**, que
no viene de Power BI sino de la planilla de objetivos por vendedor.

**Producción:** https://brandmark-business.vercel.app/

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

El proyecto ya está desplegado en **https://brandmark-business.vercel.app/**.

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
    ventas-mayoristas/page.tsx
    logistica/page.tsx
    cuentas-corrientes/page.tsx
    objetivos/page.tsx            redirige al primer vendedor
    objetivos/[vendedor]/page.tsx una página por vendedor
  api/
    ventas-mayoristas/route.ts     KPIs + datos de los 3 gráficos
    filtros/route.ts               opciones de los selectores
    logistica/route.ts
    cuentas-corrientes/route.ts
    objetivos/route.ts
  login/page.tsx
  auth-no-configurada/page.tsx
components/
  DashboardVentasMayoristas.tsx    orquesta filtros + fetch + render
  Filtros.tsx, ui.tsx, FormularioLogin.tsx, BotonSalir.tsx
  BarraAvance.tsx                  barra de avance contra objetivo
  charts/                          recharts: líneas, torta, barras, área
lib/
  db.ts                            pool de `pg` (credenciales por env)
  queries.ts                       las 6 consultas SQL
  queries-objetivos.ts             avance contra objetivo
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

## Definición de la página "Objetivos"

Hay **una página por vendedor** (`/objetivos/silvio`, `/objetivos/ramon`,
`/objetivos/pablo`, `/objetivos/ricardo`): el vendedor lo fija la ruta y no un
selector, para poder dar permiso sobre una sola página y que cada vendedor entre
directo a la suya. Un slug que no esté en `VENDEDORES_OBJETIVOS` da 404, y la
ruta de API valida el vendedor contra esa misma lista.

RICARDO tiene página aunque todavía no tenga ninguna venta: aparece con su
objetivo y 0 de avance, que es la fila que hay que mirar.

Los objetivos son de la fuerza de venta mayorista, así que la página filtra
`canal = 'Mayorista'`.

La pieza no obvia es que **el objetivo no cuelga del SKU sino de un GRUPO**,
porque así lo pensó la comercial. Cada grupo declara dos cosas:

`criterio` — contra qué se matchean sus items:

| Caso | `criterio` | Cómo se mide |
|---|---|---|
| SKU suelto | `sku` | Un grupo con un solo item |
| MIX de varios SKUs | `sku` | Sobre la **suma** del grupo, no SKU por SKU |
| Marca entera | `marca` | Todo lo que tenga esa marca (caso AVENO, que en la planilla no tiene SKU) |
| Empresa | `empresa` | Todas las ventas de esas empresas |

Los grupos de producto (`sku` y `marca`) **no filtran por empresa**: cuentan
tanto lo de Quo como lo de NOA. Es una decisión tomada, no un descuido — si
mañana entra una venta de esos SKUs por NOA, suma al objetivo. En la práctica
hoy no cambia nada, porque esos SKUs son de Quo: en los cuatro meses cargados
no hay ni una línea de ellos por NOA.

`metrica` — cómo se mide el avance:

| `metrica` | Cálculo |
|---|---|
| `unidades` | `sum(cantidad)` |
| `facturacion` | `sum(precio_neto * cantidad)` |
| `clientes` | `count(distinct cliente)` |

La métrica obliga a que **todo lo que agrega objetivos agrupe por ella**: sumar
un objetivo de $45.000.000 con uno de 480 unidades no significa nada. Por eso
los totales de la página son una tarjeta por métrica y no un número solo.

Vive en tres tablas (migraciones `objetivos_vendedor` y `objetivos_metrica`):

```
gold.objetivos_grupo        grupo -> criterio, metrica, orden
gold.objetivos_grupo_item   los SKUs / la marca / las empresas del grupo
gold.objetivos              (mes_comercial, vendedor, grupo) -> cantidad
```

`mes_comercial` usa el mismo formato `YYYY-MM` que `gold.fact_ventas`, así que
cruza directo. Los filtros se aplican **sobre la tabla de objetivos**, no sobre
las ventas: si no, un vendedor sin ninguna venta del mes desaparecería de la
tabla en vez de aparecer con 0 de avance, que es justo la fila a mirar.

Para cambiar un objetivo o sumar un grupo se toca solo la base, no el código.

### % de facturación vencida

La cuarta tarjeta no es un objetivo sino una alerta, y tiene dos diferencias
importantes con el resto de la página:

- **Es una foto, no un acumulado del mes.** Sale de
  `bronze.cuentas_corrientes_scoring`, que es el estado de la cartera al momento
  de la última carga. **No se mueve al cambiar el filtro de mes comercial**, por
  eso la tarjeta muestra la fecha de la foto.
- **El vendedor va por CÓDIGO de SIGMA** (`006`, `007`…) y no por nombre, porque
  así lo guardan las tablas de cuentas corrientes. El mapeo está en
  `CODIGO_SIGMA` de [lib/constantes.ts](lib/constantes.ts) y salió de cruzar
  `bronze.sigma_ventas` con `gold.fact_ventas` por comprobante y SKU.

Usa la misma fórmula que la página de Cuentas Corrientes
(`saldo_vencido / saldo_total`) para que el mismo número no dé distinto en dos
pantallas.

Hoy solo SILVIO (43 %) y RAMON (52 %) tienen cartera cargada; PABLO y RICARDO no
tienen ninguna cuenta corriente y la tarjeta muestra "Sin cuenta corriente".
**RICARDO además no tiene código de SIGMA** porque nunca facturó: cuando lo haga
hay que agregarlo a `CODIGO_SIGMA` o su deuda no va a aparecer nunca.

---

## Permisos por vendedor

Un usuario de Supabase Auth puede tener un vendedor asignado en su
`app_metadata`:

```json
{ "vendedor": "SILVIO" }
```

Se carga a mano en **Supabase → Authentication → el usuario → App Metadata**.
Va en `app_metadata` y **no** en `user_metadata`: esta última la puede editar el
propio usuario desde el navegador, así que si el permiso viviera ahí un vendedor
podría cambiarse el nombre y ver el tablero de otro.

| Usuario | Qué ve |
|---|---|
| Sin el claim | Todo el tablero (es el caso de los usuarios que ya existían) |
| Con `vendedor` válido | Únicamente `/objetivos/<el suyo>` |
| Con `vendedor` que no está en la lista | Nada: 403 |

El permiso se aplica en **tres lugares**, y los tres hacen falta:

1. [proxy.ts](proxy.ts) redirige a cada vendedor a su página y le corta las
   demás rutas de API.
2. [app/api/objetivos/route.ts](app/api/objetivos/route.ts) revalida que el
   `?vendedor=` pedido sea el suyo. **Sin esto el resto no sirve**: el proxy
   protege la página, no el dato, y un vendedor con sesión podría pedir
   `?vendedor=RAMON`.
3. La página vuelve a chequearlo y devuelve 404 si no coincide.

Sumar esto no le saca acceso a nadie: solo se limita a quien se le asigne un
vendedor explícitamente.

---

### Con qué mes abre

Abre en el **mes comercial vigente**. Si ese mes todavía no tiene objetivos
cargados, cae al último que sí los tenga (`getMesInicialObjetivos`), así al
pasar de mes la página no abre vacía. El selector muestra cuál quedó elegido y
se puede cambiar a cualquier otro mes.

Se resuelve en el servidor y la página va `force-dynamic`: si se prerenderizara,
el mes quedaría congelado en el del build. La fecha se lee en hora argentina,
porque el servidor de Vercel corre en UTC y en el cambio de mes comercial eso
daría el mes equivocado.

### Dos cosas que hay que saber para que los números cierren

- **El mes comercial va del 6 al 5**, no del 1 al 31. Una factura del 05/08
  tiene `mes_comercial = '2026-07'`. Salió de comparar contra el tablero de
  Data Studio, donde las dos puntas coinciden.
- **Los presupuestos cuentan.** Las empresas de `fact_ventas` son cuatro y van
  de a pares: Brandmark = `Quo Marketing SRL` + `Presupuesto QUO`, NOA =
  `Noa Comercial SRL` + `Presupuesto Noa`. Medir solo lo fiscal deja afuera
  parte del avance.

Verificado contra el Data Studio "Objetivos Vendedores Agosto 2026" (pestaña de
Silvio): los cinco grupos de producto, la facturación de las dos empresas
($9.645.218,53 y $413.238,16) y los clientes con compra (13 y 2) dan idénticos.

---

## Pendientes / decisiones abiertas

- **Vendedores** — la página usa la lista blanca `PABLO`, `RAMON`, `SILVIO`,
  igual que el filtro de página del `.pbit`. Se cambia en
  `VENDEDORES_INCLUIDOS` de [lib/constantes.ts](lib/constantes.ts) y aplica a
  todas las consultas y selectores de una.
- **Filtro por provincia** — sale del envío (`reporte_logistica`, cruzando por
  `clave_fila`), no del cliente. Funciona, pero al usarlo quedan solo las
  líneas con logística cargada, que hoy son 512 envíos.
- **Cobertura de flete a clientes** — el join con `gold.fact_ventas_flete` cubre
  ~89% de las líneas; los pedidos recientes todavía no tienen flete calculado.
## Diferencias con el tablero de Power BI

Al portar las páginas de Logística y Cuentas Corrientes aparecieron cosas que
en Power BI están mal o no significan nada con los datos reales. Están resueltas
acá, pero conviene arreglarlas también allá:

- **La relación `fact_ventas[comprobante] → aging[comprobante]` no matchea nada.**
  `fact_ventas` guarda el comprobante con un prefijo de tipo (`F-B93-00001281`
  contra `B93-00001281`). Sacando el prefijo cruzan 209 de 252 (83%).
- **Los clientes SÍ se pueden cruzar.** `scoring.razon_social` contra
  `fact_ventas.cliente` normalizado da 118 de 129 clientes, el 96% de la deuda.
  (Lo que no cruza es `clientes_clasificados`, que es otra tabla.)
- **`Clientes Activos (60d)` cuenta sobre toda la tabla de ventas**, incluidos
  los minoristas de Mercado Libre y Tienda Nube: da más de 30.000. Acá se cuenta
  solo sobre los clientes con cuenta corriente.
- **`% Rentabilidad` mezcla bases**: numerador con facturación neta, denominador
  con `total_linea`. Acá se usa la neta en ambos lados.
- **`Ticket Promedio`** usa `DISTINCTCOUNT(comprobante)` en Power BI y
  `count(distinct nro_orden)` acá, según decía el brief.
- **`Margen Ajustado`** significa dos cosas distintas: en Ventas descuenta el
  flete de PROVEEDOR (entrada); en Power BI descuenta el flete a CLIENTES
  (salida), con el parámetro `ParamFlete`. La página de Logística replica el
  parámetro con el selector "Flete a descontar del margen".
- El bucket **"Sin dato"** del aging da negativo: son notas de crédito o pagos
  sin aplicar, con `atraso` nulo.
