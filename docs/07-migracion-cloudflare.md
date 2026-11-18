# 07 — Migración a Cloudflare (Workers + D1 + R2) y salida de Airtable

Estado: plan aprobado por el owner a nivel de decisiones; pendiente de ejecución.
Rama de trabajo: `chore/crear-app-hardening`.
Documentos relacionados: `docs/06-plan-implementacion.md` (plan W-01..W-54), `docs/security-report.md` (F-01..F-xx), `~/.claude/skills/crear-app/cloudflare-cuotas.md` (reglas de cuota, obligatorias).

Convención de este documento: la prosa está en español; el código, los paths y los comandos están en inglés.
Todo límite de Cloudflare que no figura en el archivo de cuotas lleva la marca **(verificar)**. No se debe asumir ese valor hasta confirmarlo en developers.cloudflare.com o con una medición.

---

## 0. Resumen ejecutivo

Decisiones fijas del owner:

1. **Salir de Airtable por completo.** Primero se hace una copia final de los datos y de los adjuntos a nuestra DB y a nuestro storage. Después se borra todo el código de integración: sync, cron, write-back, proxy de adjuntos, escritura desde `tenant/register` y las env vars.
2. **Salir de Fly.io hacia Cloudflare.**
   - App: Workers vía `@opennextjs/cloudflare`.
   - DB: D1. El schema Drizzle se reescribe de `pg-core` a `sqlite-core`.
   - Storage: R2.
   - Crons: Cron Triggers de Cloudflare (decisión tomada en §4.4).
   - Fly se apaga más tarde, con aprobación separada del owner.
3. **Probar primero Workers Free.** Límites: 3 MB comprimido, 10 ms de CPU por invocación y 100.000 requests/día compartidas por toda la cuenta.

Veredicto anticipado (detalle en §12): **probablemente necesita Workers Paid**. Hay tres razones: el bundle de una app Next 16 de este tamaño, el CPU de SSR + sesión por request y la verificación de hashes bcrypt heredados. La decisión final depende de dos mediciones de la Ola 0 (W-CF-00) y vuelve al owner, porque cuesta dinero.

Orden recomendado (detalle en §10):

1. Ola 1 de seguridad de `06` (W-01 upgrade de next/next-auth, W-03).
2. W-CF-00 (spike y gate).
3. Ola P en Fly (password nuevo, copia final de Airtable, remoción de Airtable).
4. Olas 1–4 de migración.
5. Cutover.
6. El resto de `06` re-targeteado a D1.

---

## 1. Alcance, supuestos y bloqueadores

### 1.1 Supuestos (declarados, no confirmados)

- S1. Se usa una sola DB D1 (`propflow-db`), un solo bucket R2 (`propflow-files`) y un solo Worker (`propflow-app`). Así se cumple la regla 9 de cuotas ("un Worker por app, con prefijo").
- S2. El hostname inicial es `propflow-app.<account-subdomain>.workers.dev`. Se recomienda un dominio propio, porque evita volver a cambiar las URLs en Meta, Google y Vapi. Un dominio propio requiere la aprobación del owner (CLAUDE.md: "custom domains" = preguntar primero).
- S3. El volumen de datos es chico: del orden de decenas de properties, ~80 units, ~70 tenants y miles de payments/mensajes. Los conteos reales salen de W-CF-07 y pueden cambiar decisiones (ver R5 sobre la cuota de escritura en la importación).
- S4. Las sesiones de NextAuth **no se migran**. El dominio cambia, así que las cookies viejas no sirven y todos vuelven a iniciar sesión. Las `accounts` (vínculos OAuth de Google) **sí se migran**.
- S5. `ENCRYPTION`: los tokens cifrados con `TOKEN_ENCRYPTION_KEY` (AES-256-GCM, `src/lib/crypto/encrypt.ts`) se migran tal cual. Por eso la clave debe ser la misma en Cloudflare.
- S6. El ORM sigue siendo Drizzle 0.45, con driver `drizzle-orm/d1` y `drizzle-orm/sqlite-core`. No se cambia de ORM, por convención del codebase.

### 1.2 Bloqueadores explícitos (no adivinar)

- **B1 — Compatibilidad de OpenNext con Next 16.** No está verificado que `@opennextjs/cloudflare` soporte Next 16.x y en particular `src/proxy.ts`, que en Next 16 es un middleware con runtime Node. Tampoco está verificada la versión mínima de Next que OpenNext exige. **(verificar)** W-CF-00 es el gate: si no compila o no corre en workerd, el plan se detiene y vuelve al owner.
- **B2 — Acceso a Fly.** Solo el owner puede hacer `flyctl auth login` con la cuenta correcta. Sin eso no hay inventario (W-CF-07) ni export (W-CF-51).
- **B3 — Cuenta de Cloudflare.** El owner crea el API token y lo guarda como secret de GitHub (`CLOUDFLARE_API_TOKEN`). Nosotros nunca vemos su valor. Crear la D1, el bucket R2 y el token S3 de R2 crea recursos; aunque sean gratis, se pide aprobación.
- **B4 — Borrado de filas cross-org de Airtable.** `security-report.md` §3 ítem 6 exige aprobación y backup antes de excluir o borrar esos datos.

---

## 2. Inventario de dependencias específicas de Node / Postgres / Fly

Los conteos salen de grep sobre `src/` en la rama actual. Se marcan como "~" cuando el patrón tiene falsos positivos menores.

### 2.1 Driver y acceso a DB

| Hoy | Dónde | Reemplazo en Workers |
|---|---|---|
| `postgres` (postgres.js), pool max 5, idle_timeout 20, max_lifetime 1800 | `src/lib/db/index.ts` | `drizzle-orm/d1` sobre el binding `env.DB`, que se resuelve por request con `getCloudflareContext()` |
| Singleton en `globalThis` + URL dummy en build | `src/lib/db/index.ts` | Proxy lazy: `db` se resuelve en cada acceso. No hay pool ni conexión persistente |
| `withDbRetry` (reintento por `CONNECTION_CLOSED` de Fly) | `src/lib/db/retry.ts`, `src/lib/auth/config.ts`, 3 rutas cron | Se elimina el wrapper. D1 no tiene sockets stale. Se conservan los reintentos de negocio si los hay |
| `scripts/migrate.mjs` (advisory lock 727001, `schema_migrations`, una transacción por archivo) | release_command de Fly | `wrangler d1 migrations apply propflow-db --remote` en CI, antes del deploy |
| `drizzle.config.ts` `dialect: 'postgresql'` | raíz | `dialect: 'sqlite'`, `driver: 'd1-http'` solo para introspección; `out: './src/lib/db/migrations-d1'` |
| `db.execute(sql)` devuelve filas | 39 llamadas en 19 archivos | `db.all(sql)` de drizzle-d1. Durante la transición el proxy expone `execute` como alias de `all` (contrato §8, W-CF-11) |

### 2.2 Features de Postgres usadas (conteos)

| Feature | Conteo | Reemplazo SQLite / D1 |
|---|---|---|
| `uuid(` + `defaultRandom()` | 299 columnas | `text('id').primaryKey().$defaultFn(() => crypto.randomUUID())`. El UUID se genera en JS y no en la DB, así que los INSERT por SQL crudo deben pasar el id |
| `timestamp(..., { withTimezone: true })` + `defaultNow()` | 234 | `integer(..., { mode: 'timestamp_ms' })` + `$defaultFn(() => new Date())`. Se guarda epoch en ms (UTC). La conversión de zona horaria (America/Lima) pasa a JS |
| `jsonb(` | 27 | `text(..., { mode: 'json' }).$type<T>()`. Los operadores `->>` pasan a `json_extract`/`->>` de SQLite (SQLite ≥ 3.38 soporta `->>`; D1 **(verificar)** la versión) |
| `numeric(` | 35 | Dinero como `text` decimal (`numeric` de sqlite-core en modo string si drizzle 0.45 lo soporta **(verificar)**). Nunca REAL para dinero. Las sumas se hacen en SQL con `CAST(... AS REAL)` solo para KPIs de display, o en JS con decimal en centavos |
| `date(` | ~30 | `text` `YYYY-MM-DD`. Compara bien de forma lexicográfica |
| `boolean(` | ~30 | `integer(..., { mode: 'boolean' })` |
| `inet` | 1 (`signature_requests`, schema.ts:666) | `text` |
| `.array()` | 1 (`calendar_connections.scopes`, schema.ts:1791) | `text(..., { mode: 'json' }).$type<string[]>()` |
| Enums | No hay `pgEnum`; los "enums" son CHECK en SQL (~160 CHECK en las migraciones 0000–0012) | `check()` de sqlite-core **dentro de la definición de la tabla**. SQLite no permite agregar un CHECK con ALTER, así que tienen que estar desde el CREATE |
| `uniqueIndex` / `index` | ~55 / ~150 | Iguales en sqlite-core |
| Índices parciales `.where(sql...)` | 11 (schema.ts:816, 837, 840, 999–1001, 1027, 1053, 1268, 2002, 2048) | SQLite soporta índices parciales. Se portan tal cual, reescribiendo predicados Postgres (`IS TRUE`, casts) |
| `onConflictDoUpdate/DoNothing` | 26 en 21 archivos | SQLite soporta `ON CONFLICT (cols) [WHERE pred] DO UPDATE`. Con índice parcial hay que repetir el predicado en `target`/`where` (drizzle: `targetWhere`) |
| `.returning(` | 76 en 42 archivos | SQLite ≥ 3.35 soporta `RETURNING`. Sin cambios de API |
| `.transaction(` | 14 en 10 archivos | D1 **no tiene transacciones interactivas**. Se usa `db.batch([...])`, que es atómico, o una sola sentencia condicional. Una lógica del tipo "leer, decidir, escribir" dentro de una transacción se reescribe como `UPDATE ... WHERE <condición> RETURNING` y se decide sobre el resultado |
| `pg_advisory_xact_lock` | 3 (`agent/tools/send-listing-photos.ts:71`, `agent/visits/service.ts:144`, `leads/routing.ts:136`) | D1 es single-writer: una sola sentencia es serializable. Se reemplaza por una sentencia atómica (INSERT con índice único como mutex, o `UPDATE ... RETURNING` condicional) |
| `FOR UPDATE SKIP LOCKED` | 1 (`agent/jobs.ts:95`) | `UPDATE agent_jobs SET status='processing', locked_until=? WHERE id IN (SELECT id FROM agent_jobs WHERE status='pending' AND run_at<=? ORDER BY run_at LIMIT ?) RETURNING *` |
| `EXCLUDE USING gist` (`property_visits_no_overlap`, migración 0006:126–136, error 23P01) | 1 | Trigger `BEFORE INSERT` y `BEFORE UPDATE` con `SELECT RAISE(ABORT, 'visit_overlap') WHERE EXISTS (...)`. El solapamiento `[starts_at, blocked_until)` se compara con enteros ms |
| Trigger plpgsql `listings_set_published_at` (0008:189–199) | 1 | Trigger SQLite `AFTER UPDATE OF status` |
| Vista `tenant_statement` (0002), usa `FILTER` y `CURRENT_DATE` | 1 | Vista SQLite con `SUM(CASE WHEN ...)` y `date('now')`. `FILTER` existe en SQLite ≥ 3.30 **(verificar en D1)**; `CASE` es portable y se prefiere |
| Extensiones `pgcrypto`, `btree_gist` | 2 | Se eliminan |
| `ILIKE` / `ilike(` | 9 en 6 archivos | `LIKE` (en SQLite es case-insensitive solo para ASCII) o `lower(col) LIKE lower(?)`. Escapar `%`/`_` con `ESCAPE '\'` (alinea con W-42) |
| Casts `::int`, `::uuid`, `::jsonb`, `::boolean` | ~30 en raw SQL | Se eliminan o pasan a `CAST(x AS INTEGER)` |
| `now()`, `make_interval`, `EXTRACT(EPOCH ...)`, `date_trunc`, `to_char(... AT TIME ZONE ...)` | ~25, concentrados en `agent/metrics.ts` (21 coincidencias) y `app/dashboard/page.tsx` (7) | Valores de tiempo calculados en JS y pasados como parámetro. Los buckets por día en zona Lima se calculan en JS o con `strftime('%Y-%m-%d', (ts/1000) - 18000, 'unixepoch')` (Lima = UTC-5 fijo, sin DST) |
| `DISTINCT ON` | 1 vivo (`metrics.ts`) + cron Airtable (se borra) | Subquery con `ROW_NUMBER() OVER (PARTITION BY ...)`. SQLite soporta window functions |
| `percentile_cont` | `metrics.ts` | Se calcula en JS sobre las filas ya filtradas (volumen bajo) |
| `jsonb_set` | 2 (`agent/web-handoff-redeem.ts:94`, `agent/tools/continue-on-whatsapp.ts:57`) | `json_set(col, '$.key', json(?))` |
| `= ANY(array)` | 2 (`agent/voice/scanners.ts:76,159`) | `inArray()` de drizzle, que genera `IN (?, ?, ...)`. Límite de parámetros por sentencia en D1 **(verificar, ~100)**: hacer chunking |
| `sql\`` fragmentos crudos | 111 líneas en 43 archivos (11 en schema, 10 en metrics, 14 en `airtable/sync-entities.ts`, que se borra) | Se revisan uno por uno en la Ola 3 |
| Códigos de error `23505` (unique) / `23P01` (exclusion) | ~9 sitios: `events/handlers/whatsapp-receipt.ts` ×4, `widget/handoff-codes.ts`, `agent/voice/calls.ts`, `api/cron/weekly-summary`, `actions/agent-setup.ts`, `actions/contractDoc.ts`/`finance.ts` por mensaje | Helper `isUniqueViolation(err)` / `isConstraintError(err, 'visit_overlap')` en `src/lib/db/errors.ts` que detecta `UNIQUE constraint failed` / `SQLITE_CONSTRAINT` en el mensaje de D1 |

### 2.3 APIs de Node y del runtime

| Hoy | Conteo / dónde | Reemplazo |
|---|---|---|
| `node:crypto` (`randomUUID`, `randomBytes`, `createHash`, `createHmac`, `timingSafeEqual`) | ~33 archivos | `compatibility_flags: ["nodejs_compat"]` cubre estas APIs en workerd **(verificar cobertura exacta en el spike)**. Lo que falle se pasa a WebCrypto (`crypto.getRandomValues`, `crypto.subtle.digest/sign`) |
| AES-256-GCM con `createCipheriv` | `src/lib/crypto/encrypt.ts` | `nodejs_compat` **(verificar)**. Fallback: WebCrypto AES-GCM. WebCrypto concatena el tag al final del ciphertext, así que hay que reproducir el layout actual (iv, tag, ciphertext) para descifrar los datos existentes. Test de compatibilidad obligatorio con un vector generado en Node |
| `Buffer.` | 36 archivos | `nodejs_compat` provee `Buffer` **(verificar)**. Sin cambios salvo falla |
| `bcryptjs.hashSync(..., 12)` al cargar el módulo (`DUMMY_PASSWORD_HASH`) | `src/app/actions/auth.ts` | Se elimina. Quema cientos de ms de CPU en cada isolate nuevo. Ver §6 (PBKDF2) |
| `bcryptjs` cost 12 para verificar/hashear | `src/app/actions/auth.ts` | `src/lib/auth/password.ts` con PBKDF2-SHA256 de WebCrypto + rehash transparente (§6) |
| `sharp` (optimización de `next/image`) | build/runtime de Next | No existe en Workers. `images.unoptimized: true`. Cloudflare Images es opcional y tiene costo/cuota (pregunta al owner) |
| `next/og` `ImageResponse` (resvg/satori wasm) | `src/app/p/[orgSlug]/[listingSlug]/opengraph-image.tsx` | Riesgo de bundle. Se reemplaza por `og:image` = la primera foto del listing (URL firmada o pública), sin render server-side |
| `@react-pdf/renderer` | `src/lib/contracts/pdf.tsx`, usado por `src/app/actions/contractDoc.ts` | Riesgo de bundle y de CPU. Se mueve a generación en el navegador (dynamic import en un client component); el server recibe el PDF, valida mime/tamaño y guarda el sha256. Decisión condicionada a la medición de W-CF-00 |
| `src/instrumentation.ts` (`setInterval` cada 30 s + `.unref()`, drain de jobs y scanners) | 1 | No hay procesos de larga vida en Workers. Se reemplaza por Cron Trigger `* * * * *` + `ctx.waitUntil` después del webhook (§4.4) |
| `export const runtime = 'nodejs'` | `widget.js/route.ts`, `widget/[publicKey]/route.ts`, `whatsapp/webhook/route.ts`, `airtable-attachment` | En OpenNext todo corre en el Worker con `nodejs_compat`. La línea se puede mantener **(verificar que OpenNext no la rechace)** |
| `proxy.ts`: `Buffer.from(crypto.randomUUID()).toString('base64')` para el nonce CSP; CSP con `TIGRIS_ENDPOINT` | `src/proxy.ts:15,21-22` | Nonce con `btoa(crypto.randomUUID())`. CSP `img-src` con el host de R2 en lugar de Tigris |
| IP del cliente: `fly-client-ip`, después XFF y después `x-real-ip` | `src/lib/ratelimit.ts` (`getClientIp`), `src/app/actions/auth.ts` (usa el primer XFF, inconsistente) | `cf-connecting-ip`, que pone Cloudflare y el cliente no puede falsificar. Un solo helper |
| Request id `fly-request-id` (W-10) | logs | `cf-ray` |
| Rate limit en memoria (`Map` por proceso) | `src/lib/ratelimit.ts`: 15 funciones exportadas, ~106 llamadas en 42 archivos, todas **síncronas** | En Workers cada isolate tiene su propio `Map`, así que el límite es débil. Capa nueva: binding de Rate Limiting (por IP, en `proxy.ts`) + tabla D1 `rate_limits` (por cuenta, ventanas largas; re-target de W-18). Las funciones síncronas actuales se mantienen como capa secundaria best-effort para no tocar 42 archivos (§8, W-CF-13) |
| `output: 'standalone'` | `next.config.ts` | Se elimina. OpenNext genera `.open-next/` |
| Dockerfile, `fly.toml`, release_command | raíz | Se eliminan al apagar Fly (W-CF-55, requiere aprobación) |

### 2.4 Storage

| Hoy | Reemplazo |
|---|---|
| `@aws-sdk/client-s3` `S3Client` contra Tigris (`TIGRIS_*`/`STORAGE_*`) en `src/lib/storage/index.ts` | Binding R2 `env.FILES` para `put`/`get`/`delete` |
| `@aws-sdk/s3-request-presigner` para `getSignedUrl` (TTL máx. 3600 s) | `aws4fetch` (`AwsClient.sign` con `signQuery: true`) contra el endpoint S3 de R2 (`https://<account_id>.r2.cloudflarestorage.com`). Requiere un token S3 de R2 (access key/secret) creado por el owner. Se elige presign en lugar de stream por el Worker para no gastar requests del Worker en cada imagen |
| Buckets lógicos (`unit-images`, `tenant-avatars`, `receipts`, `incident-photos`, `task-proofs`, `contracts`) mapeados con `TIGRIS_BUCKET_*` | Un bucket R2 (`propflow-files`). La key R2 es `<logicalBucket>/<path>`, armada **dentro** del módulo. Los paths guardados en la DB no cambian |
| `images.remotePatterns`: `*.fly.storage.tigris.dev`, `dl.airtable.com`, `v5.airtableusercontent.com` | Solo el host de R2 (y el dominio público de R2 si se habilita; no recomendado para archivos privados) |
| Referencias a Fly/Tigris en 39 archivos (p. ej. `Avatar.tsx`, `privacidad/page.tsx`, `agent/setup/page.tsx`, `whatsapp/attachments.ts`, `storage/path.ts`) | Se revisan en W-CF-12 (código) y W-CF-54 (textos legales: la lista de subprocesadores en `privacidad` pasa a nombrar a Cloudflare) |

### 2.5 Auth

| Hoy | Reemplazo |
|---|---|
| `@auth/drizzle-adapter` con tablas pg (`users`, `accounts`, `sessions`, `verification_tokens`) | Mismo adapter con tablas sqlite-core. El adapter detecta el dialecto por el tipo de `db` **(verificar con drizzle-orm 0.45 + adapter actual)**. Las columnas `emailVerified`/`expires` pasan a `timestamp_ms` |
| `getSessionAndUser` envuelto en `withDbRetry` | Sin wrapper |
| Estrategia `database`: 1 lectura de sesión + 1 de profile en el callback `session` por request | Se mantiene. Cuesta ~2–3 filas leídas de D1 por request autenticado (aceptable) |
| `trustHost: true` | Se mantiene, con `AUTH_URL` explícito al host nuevo |

### 2.6 Tests

| Hoy | Reemplazo |
|---|---|
| `@electric-sql/pglite` con extensiones pgcrypto y btree_gist en `tests/integration/sql-smoke/setup.ts` (+ `metrics.test.ts`) | `getPlatformProxy()` de `wrangler`, que da un binding D1 local (miniflare/workerd) con semántica real de D1, incluido `batch`. Las migraciones se aplican desde `src/lib/db/migrations-d1/`. Fallback si falla en vitest 5 beta: `better-sqlite3` + `drizzle-orm/better-sqlite3`; en ese caso `batch` no existe y se emula con una transacción síncrona **(verificar)** |
| 97 archivos de test con `vi.mock('@/lib/db')` | Sin cambios. Solo cambian los que asertan SQL Postgres literal |
| E2E Playwright contra `pnpm start` | Contra `pnpm cf:preview` (`wrangler dev` sobre el build de OpenNext, con D1 local) |

---

## 3. Clasificación de `package.json` → `dependencies`

| Paquete | Clasificación | Nota |
|---|---|---|
| `@anthropic-ai/sdk` | **keeps** | Usa `fetch`. Medir su peso en el bundle |
| `@auth/drizzle-adapter` | **keeps** | Tablas sqlite-core |
| `@aws-sdk/client-s3` | **removed** | Pasa al binding R2 |
| `@aws-sdk/s3-request-presigner` | **replaced** | Por `aws4fetch` (dependencia nueva) |
| `@react-pdf/renderer` | **keeps** | Pasa al bundle del navegador, fuera del Worker (condicionado a W-CF-00) |
| `@types/papaparse` | **keeps** | Debe moverse a `devDependencies` (solo tipos) |
| `bcryptjs` | **replaced** | Por PBKDF2 de WebCrypto. Se mantiene temporalmente solo detrás de `LEGACY_BCRYPT_VERIFY`; se elimina cuando `COUNT(password_hash LIKE '$2%') = 0` |
| `drizzle-orm` | **keeps** | Pasa a `drizzle-orm/d1` + `sqlite-core` |
| `next` | **keeps** | Upgrade según W-01 (≥ versión que pida OpenNext, **verificar**) |
| `next-auth` | **keeps** | Upgrade según W-01 |
| `next-intl` | **keeps** | Medir su peso y su CPU en SSR |
| `papaparse` | **keeps** | — |
| `postgres` | **removed** | Pasa a `devDependencies` temporalmente para los scripts de export (W-CF-51); se elimina en W-CF-55 |
| `react` | **keeps** | — |
| `react-dom` | **keeps** | — |
| `react-markdown` | **keeps** | — |
| `rehype-sanitize` | **keeps** | — |
| `resend` | **keeps** | SDK basado en `fetch` **(verificar en workerd)**. Fallback: llamada `fetch` directa a la API |
| `zod` | **keeps** | — |

Cambios en `devDependencies`:

- Se agregan `@opennextjs/cloudflare` y `wrangler`.
- Se quita `@electric-sql/pglite`.
- `postgres` y `@aws-sdk/client-s3` quedan temporalmente para los scripts de migración y se quitan en W-CF-55.
- `drizzle-kit` se mantiene.
- `better-sqlite3` solo entra si el fallback de tests es necesario.

Dependencia nueva en `dependencies`: `aws4fetch`.
`pnpm.onlyBuiltDependencies`: se quita `sharp` si aparece.

---

## 4. Plataforma destino

### 4.1 `wrangler.jsonc` (contrato; los valores `<...>` los provee el owner)

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "propflow-app",
  "main": "worker.ts",
  "compatibility_date": "<fecha del spike>",
  "compatibility_flags": ["nodejs_compat", "global_fetch_strictly_public"],
  "assets": {
    "directory": ".open-next/assets",
    "binding": "ASSETS",
    "run_worker_first": false
  },
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "propflow-db",
      "database_id": "<owner>",
      "migrations_dir": "src/lib/db/migrations-d1"
    }
  ],
  "r2_buckets": [{ "binding": "FILES", "bucket_name": "propflow-files" }],
  "ratelimits": [
    { "name": "RL_IP_API",  "namespace_id": "1001", "simple": { "limit": 120, "period": 60 } },
    { "name": "RL_IP_AUTH", "namespace_id": "1002", "simple": { "limit": 10,  "period": 60 } }
  ],
  "triggers": { "crons": ["* * * * *", "0 * * * *"] },
  "observability": { "enabled": true },
  "vars": {
    "NEXT_PUBLIC_SITE_URL": "https://<host>",
    "AUTH_URL": "https://<host>",
    "WHATSAPP_PROVIDER": "meta",
    "R2_S3_ENDPOINT": "https://<account_id>.r2.cloudflarestorage.com",
    "R2_BUCKET": "propflow-files"
  }
}
```

Notas:

- `ratelimits`: la disponibilidad en Free, la sintaxis exacta y los `period` permitidos (10/60 s) llevan **(verificar)**. Si no está disponible, todo el rate limit va a D1 (§4.5).
- Los secrets **no** van en `vars`. Se cargan con `pnpm exec wrangler secret put <NAME>` y los ejecuta el owner (lista en §13).
- `NEXT_PUBLIC_SITE_URL` se inlinea en el build. También tiene que estar en el entorno del build de CI, no solo en `vars`.
- OpenNext puede requerir bindings extra para su cache incremental (`WORKER_SELF_REFERENCE`, KV/R2 de cache) **(verificar)**. **No usar KV para la cache incremental** (regla 4: máximo 1.000 escrituras/día). Casi todas las páginas son dinámicas y autenticadas, así que la cache incremental se deja desactivada (`defineCloudflareConfig({})`).

### 4.2 Build, dev y deploy

| Script (`package.json`) | Comando |
|---|---|
| `cf:build` | `opennextjs-cloudflare build` |
| `cf:preview` | `pnpm cf:build && wrangler dev` (workerd local, D1/R2 locales, sin cuota) |
| `cf:size` | `wrangler deploy --dry-run --outdir .wrangler/dist && node scripts/check-worker-size.mjs .wrangler/dist` |
| `cf:deploy` | solo en CI: `wrangler d1 migrations apply propflow-db --remote && wrangler deploy` |
| `db:generate` | `drizzle-kit generate` (nunca `drizzle-kit push`) |
| `db:migrate:local` | `wrangler d1 migrations apply propflow-db --local` |

`scripts/check-worker-size.mjs`:

- Suma el tamaño gzip (nivel 9) de los `.js`/`.wasm` del outdir.
- Falla con exit 1 si supera `3 * 1024 * 1024` bytes. La definición exacta de "3 MB" (MB o MiB, gzip o brotli) lleva **(verificar)**; se usa el valor más estricto.
- También imprime el top-10 de módulos por tamaño, usando el metafile si OpenNext lo emite.

### 4.3 Worker entry (`worker.ts`)

OpenNext genera `.open-next/worker.js` con un handler `fetch`. Se envuelve así:

```ts
// worker.ts — contrato
import openNext from './.open-next/worker.js';
import { runScheduled } from './src/lib/cron/scheduled';

export default {
  fetch: openNext.fetch,
  async scheduled(controller: ScheduledController, env: CloudflareEnv, ctx: ExecutionContext) {
    ctx.waitUntil(runScheduled(controller.cron, new Date(controller.scheduledTime), env, ctx));
  },
} satisfies ExportedHandler<CloudflareEnv>;
```

`runScheduled` invoca las rutas `/api/cron/*` existentes **en el mismo proceso**. Construye un `Request` interno con `Authorization: Bearer ${env.CRON_SECRET}` y llama `openNext.fetch(request, env, ctx)`. No hace un fetch de red al propio host, así que no consume requests extra **(verificar que una invocación interna no se cuente como request)**. Las rutas cron siguen protegidas igual que hoy (W-07 `requireCronAuth`).

Si OpenNext exporta otros símbolos (p. ej. Durable Objects de cache), `worker.ts` también los re-exporta **(verificar)**.

### 4.4 Crons: decisión

**Decisión: Cron Triggers de Cloudflare, consolidados en 2 expresiones.** `cron-dispatch.yml` queda solo con `workflow_dispatch` (disparo manual) durante la transición y después se elimina.

Razones:

1. El backstop del agente necesita correr cada minuto: reemplaza el `setInterval` de 30 s de `instrumentation.ts`. Los schedules de GitHub Actions no garantizan esa frecuencia: tienen retrasos de varios minutos y GitHub los desactiva en repos inactivos.
2. Cada POST desde GitHub es una request externa al Worker, que suma a la cuota diaria. 1.440 corridas/día de un cron por minuto vía GitHub serían 1.440 requests. Un Cron Trigger no pasa por la red.
3. Se usan 2 expresiones porque el límite de cantidad de cron triggers por Worker en Free lleva **(verificar)**. Con 2 hay margen.

| Expresión | Qué hace `runScheduled` |
|---|---|
| `* * * * *` | `POST /api/cron/agent-dispatch` (drain de `agent_jobs`). Cada 5 minutos (`minute % 5 === 0`) también corre el sweep: `sweepStalePendingInbound`, `ensureCalendarSyncJobs`, `scanSpeedToLead`, `scanVisitConfirmationCalls`. Hoy esos 4 corren cada 2 minutos, así que la latencia sube de 2 a 5 minutos (aceptable; si no lo es, `minute % 2`) |
| `0 * * * *` | Dispatcher por hora/día UTC: 07 lunes `weekly-summary`; 08 diario `reminders`; 09 diario `task-reminders`; 12 lunes `qa-export`; 14 diario `lead-alerts`; 15 lunes a sábado `voice-reactivation` |

`airtable-sync` (04 UTC) desaparece con la salida de Airtable.

El mapeo vive en `src/lib/cron/schedule.ts` como función pura (`jobsDue(cron, date)`), con tests unitarios. Así se pueden agregar jobs sin tocar `wrangler.jsonc`.

Límites a verificar: CPU y duración máxima de un `scheduled` en Free **(verificar)**. `qa-export` y `lead-alerts` hoy tienen `--max-time 240` en GitHub. Si exceden el límite, se parten en lotes con cursor o pasan a Paid.

Agente (latencia): el webhook de WhatsApp encola el job con el debounce actual (`AGENT_DEBOUNCE_MS = 4000`) y llama `after()` (Next) / `ctx.waitUntil` para drenar. Que OpenNext mapee `after()` a `waitUntil` lleva **(verificar)**. El cron por minuto es el backstop. La duración permitida de `waitUntil` después de responder lleva **(verificar)**. Un turno de Anthropic con tool-use puede tardar decenas de segundos (R4).

### 4.5 Rate limiting en Workers

- Capa 1, en `src/proxy.ts`: binding `RL_IP_API` por `cf-connecting-ip` para todo `/api/*`, y `RL_IP_AUTH` para `/login`, `/register`, `/api/auth/*` y la server action de login. Así se cumple la regla 5 desde el primer deploy.
- Capa 2, D1: tabla `rate_limits(key TEXT PRIMARY KEY, count INTEGER, window_start INTEGER)` con un solo `INSERT ... ON CONFLICT(key) DO UPDATE ... RETURNING count`. Sirve para límites por cuenta (login por email), por usuario y con ventanas largas (p. ej. OCR/AI por día). Es el re-target de W-18. Cada uso cuesta 1 fila escrita; solo se aplica a acciones caras, nunca a lecturas.
- Capa 3: las funciones síncronas actuales de `src/lib/ratelimit.ts` se mantienen (por isolate, best-effort). No se tocan los 42 archivos que las llaman en esta migración.
- `robots.txt` bloquea `/api/`. Con dominio propio se activa Bot Fight Mode (acción del owner).

---

## 5. Salida de Airtable (Ola P, en Fly, antes del cutover)

Esta etapa se hace **en Fly**, con el código y la DB actuales, porque ahí existen el cliente Airtable, el módulo de storage S3 y los datos vivos.

Orden obligatorio:

1. **Sync final.** Disparar `airtable-sync` manualmente con `workflow_dispatch` y guardar su `airtable_sync_logs` final. Verificar que el status es `ok`.
2. **Copia de adjuntos (W-CF-02).** Las URLs del CDN de Airtable expiran, así que el script pide URLs frescas a la API de Airtable (`AIRTABLE_PAT` local del owner) y copia cada archivo a Tigris con el módulo de storage existente. Después reescribe las columnas de URL a paths de storage:
   - `responsables.photo_url` → bucket `tenant-avatars`
   - `tenants.photo_url` → `tenant-avatars`
   - `contracts.document_url` → `contracts`
   - `payments.receipt_url` → `receipts`
   - `account_statements.pdf_url` → `contracts` (o `receipts`; decidir en W-CF-02)
   - `tax_receipts.file_url` → `receipts`
   - `trash_compliance.foto_url` → `task-proofs`
   - Fotos de ambientes en `airtable_snapshots.data`: si mapean a una unit (`units.airtable_id`), pasan a filas `unit_images`; si no, van al prefijo `airtable-archive/<table>/<recordId>/<field>/<filename>` con un `manifest.json`.
   El script es idempotente: salta lo que ya es path de storage. También es reanudable: guarda un log local de lo copiado.
3. **Verificación.** Cero valores con dominio `airtable` en esas columnas (query de W-CF-02). Una muestra de 10 archivos se abre por URL firmada.
4. **Remoción de código (W-CF-03..06).** Borrar sync, cron, write-back, proxy de adjuntos, la escritura en `tenant/register`, la UI de integración, las claves i18n y las env vars `AIRTABLE_*`. Esto cierra F-01 y F-03 de `security-report.md` y deja obsoleto W-41 de `06`.
5. **Deploy en Fly** y smoke de las páginas afectadas (tenants, payments, portfolio, dashboard).
6. El owner puede revocar el PAT de Airtable. No se borra la base de Airtable: es el backup histórico y borrarla requiere decisión explícita del owner.

Qué datos de Airtable se conservan en la DB:

- Las columnas de procedencia `airtable_external_id` / `airtable_id` se mantienen (y sus índices únicos `*_airtable_uniq`, como procedencia). Sirven para auditar y para filtrar en la migración.
- `airtable_snapshots` se migra a D1 como archivo de solo lectura. Si su tamaño en filas presiona la cuota de escritura de la importación (R5), se exporta a R2 como JSONL (`airtable-archive/snapshots.jsonl`) y no se migra la tabla.
- `airtable_sync_logs` **no** se migra.

---

## 6. Contraseñas: PBKDF2 en WebCrypto con rehash transparente

Problema: verificar bcrypt cost 12 en JS puro cuesta del orden de cientos de ms de CPU, y Free da 10 ms por invocación. Además, `DUMMY_PASSWORD_HASH = bcryptjs.hashSync(..., 12)` se ejecuta al cargar el módulo en cada isolate nuevo.

Formato nuevo, autodescriptivo y con iteraciones dentro del string para poder subirlas después:

```
pbkdf2-sha256$<iterations>$<saltB64>$<hashB64>
```

El salt es de 16 bytes y el hash de 32 bytes. Se calcula con `crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256)` y se compara en tiempo constante.

Iteraciones:

- Se fijan por **medición** en W-CF-00: el mayor valor cuyo login completo (verificación + creación de sesión + SSR del redirect) quede bajo 10 ms de CPU en p99.
- workerd tiene un tope de iteraciones de PBKDF2 (se cita 100.000) **(verificar)**.
- OWASP recomienda 600.000 para PBKDF2-SHA256. Cualquier valor que entre en 10 ms queda muy por debajo. **Esto es una reducción de seguridad frente a bcrypt 12 y se le informa al owner.** Mitigaciones: rate limit por IP y por cuenta (§4.5), Google sign-in como camino principal y subir iteraciones al pasar a Paid (el rehash es automático porque `needsRehash` compara contra `PBKDF2_ITERATIONS`).

Plan sin dejar usuarios afuera:

1. **Antes del cutover, en Fly (W-CF-01).** Se despliega `src/lib/auth/password.ts`, que entiende ambos formatos. En Fly (Node, sin límite de 10 ms):
   - Cada login correcto con hash `$2...` re-hashea a PBKDF2 y hace UPDATE de `users.password_hash`.
   - Los registros nuevos ya usan PBKDF2.
   Cuantas más semanas corra esto antes del cutover, menos hashes legacy quedan.
2. **Antes del cutover**, el owner cuenta los que quedan: `SELECT COUNT(*) FROM users WHERE password_hash LIKE '$2%'` (incluido en W-CF-07).
3. **En Cloudflare**, para cada hash `$2` restante:
   - Si `LEGACY_BCRYPT_VERIFY=1` (solo con Workers Paid, p. ej. un mes): se verifica con bcryptjs, se re-hashea y se guarda. Transparente.
   - Si no (Free): `verifyPassword` devuelve `legacy_unsupported` y el login responde `PASSWORD_RESET_REQUIRED` con un mensaje claro. El usuario entra con Google (si su email coincide; el linking ya existe) o pide al admin un link de un solo uso "definir contraseña". Ese link reutiliza el mecanismo de invitación con token hasheado y no depende de Resend, que está bloqueado por dominio no verificado: el admin copia el link y lo envía por WhatsApp. Nadie queda bloqueado sin salida.
4. Cuando el conteo de `$2` llegue a 0, se elimina `bcryptjs` (W-CF-55).

Igualación de tiempos para emails inexistentes: se reemplaza el hash dummy de bcrypt por una derivación PBKDF2 con un salt fijo y las mismas iteraciones (`dummyVerify`), calculada en el momento y no al cargar el módulo.

---

## 7. Plan de migración de datos (Postgres en Fly → D1; Tigris → R2)

### 7.1 Pre-requisitos

- Ola P terminada: Airtable fuera, adjuntos en Tigris, password nuevo desplegado.
- El owner hizo `flyctl auth login` con la cuenta correcta. Desde ahí, nosotros solo usamos acceso de **lectura**: `flyctl proxy 15432:5432 -a propflow-db2` y una conexión con un usuario de solo lectura si existe; si no, con `DATABASE_URL` en modo `default_transaction_read_only=on`.
- La D1 `propflow-db` existe y las migraciones de D1 están aplicadas (`wrangler d1 migrations apply propflow-db --remote`).
- W-04 de `06` (`scripts/diag/profile-identity.sql`, que usa `pg_constraint`) se corre **en Fly, antes del export**, porque depende de catálogos Postgres.

### 7.2 Filtro de orgs legítimas

- Org dueña = `SELECT org_id FROM profiles WHERE lower(email) = lower($PRIMARY_OWNER_EMAIL)`. El valor sale de la env var; no se escribe en el repo ni en este documento.
- Orgs legítimas: la del owner más cualquier otra org con usuarios reales que no sea solo receptora de copias de Airtable. W-CF-07 las lista con sus conteos y el owner confirma la lista.
- Filas excluidas (copias cross-org de F-01): `airtable_external_id IS NOT NULL OR airtable_id IS NOT NULL` **y** `org_id <> owner_org`, en cada tabla que tenga esas columnas. También se excluyen sus hijos por FK (payments, charges, contracts, service_payments, incidents, etc. que apunten a esos tenants, units o properties) y los `airtable_snapshots` de otras orgs.
- Antes de importar, `inventory.mjs` produce un informe con, por tabla: total, a migrar y excluidas con su motivo. **El owner aprueba ese informe (B4).** Las filas excluidas no se borran de Fly: quedan en el backup (`pg_dump` completo antes del export, guardado localmente por el owner).

### 7.3 Export y transformación

`scripts/migrate-to-d1/export.mjs`:

- Lee cada tabla con `SELECT ... WHERE <filtro>` ordenado por PK.
- Escribe un JSONL por tabla en `./.migration/export/` (gitignored).

`scripts/migrate-to-d1/transform.mjs` convierte por tipo de columna, usando el schema sqlite-core como fuente de verdad:

| Postgres | D1 |
|---|---|
| uuid | text (sin cambio) |
| timestamptz | integer ms epoch |
| date | text `YYYY-MM-DD` |
| boolean | 0/1 |
| numeric | text decimal sin pérdida |
| jsonb | `JSON.stringify` |
| text[] | JSON text |
| inet | text |

Además:

- Genera archivos `.sql` con `INSERT INTO ... VALUES (...)`, en lotes de N filas por sentencia. N se ajusta a los límites de D1 (parámetros y tamaño por sentencia **(verificar)**). Los literales van escapados; no se interpolan strings crudos.
- Ordena las tablas topológicamente por FK: orgs → profiles/users → properties → units → tenants → contracts → charges/payments → ... → agent_*.
- Se omiten `sessions`, `verification_tokens`, `airtable_sync_logs` y `schema_migrations`.

### 7.4 Importación

```
pnpm exec wrangler d1 execute propflow-db --remote --file=.migration/sql/0001_orgs.sql
...
```

- Un archivo por tabla o lote, en orden. Si D1 lo soporta **(verificar)**, cada archivo empieza con `PRAGMA defer_foreign_keys = ON;`. Si no, el orden topológico alcanza, porque no hay ciclos de FK, o los que hay se insertan con NULL y se actualizan después.
- **Ensayo previo** contra una D1 local (`--local`) y contra una D1 remota de staging (`propflow-db-staging`, recurso nuevo: pedir aprobación). Así se mide el tiempo real y las filas escritas.
- **Cuota de escritura (R5):** 100.000 filas escritas/día en Free. Si el total a importar supera ~80.000 filas, la importación no entra en un día. Opciones: (a) excluir histórico prescindible (`agent_events` viejos, `airtable_snapshots` a R2), (b) importar el histórico frío el día anterior y solo el delta el día del cutover, (c) Workers Paid el mes de la migración. Se decide con el informe de W-CF-07. Que la importación por `wrangler d1 execute --file` cuente contra esa cuota igual que las escrituras de runtime lleva **(verificar)**; se asume que sí.

### 7.5 Storage: Tigris → R2

`scripts/migrate-to-r2/copy-objects.mjs`:

- Lista cada bucket de Tigris con la API S3.
- Copia cada objeto a R2 con la API S3 de R2 (`aws4fetch`) usando la key `<logicalBucket>/<path>`.
- Conserva `Content-Type`. Es idempotente: HEAD antes de PUT y compara tamaño/ETag.
- Incluye el prefijo `airtable-archive/` que generó la Ola P.

Costo en operaciones: un PUT de clase A por objeto + un HEAD de clase B. Con miles de objetos queda muy lejos de 1 M/mes.

Se corre dos veces: una completa días antes y otra incremental (por `LastModified` > fecha de la primera corrida) durante la ventana de corte.

### 7.6 Verificación

`scripts/migrate-to-d1/verify.mjs`:

- Por tabla compara `COUNT(*)` en Postgres (con el filtro) contra `COUNT(*)` en D1 (`wrangler d1 execute --remote --command "SELECT COUNT(*) ..." --json`). Debe ser igual.
- Por tabla compara un hash del conjunto de ids: `sha256` de los ids ordenados, calculado en JS de ambos lados. Debe ser igual.
- Muestra campos: para 20 filas al azar por tabla, compara campo a campo después de normalizar tipos.
- Invariantes de negocio: suma de `payments.amount` por org y estado (debe coincidir con los KPIs de Fly, ver PR #50), cantidad de contracts activos, cantidad de users con `password_hash`.
- R2: cantidad de objetos y bytes totales por bucket lógico iguales a Tigris, y todo path referenciado en la DB existe en R2 (HEAD).
- Las consultas de verificación a D1 remota se cuentan en filas leídas: una pasada completa ≈ total de filas. Es aceptable una o dos veces, pero no en loop.

El resultado va a `docs/test-report.md` (consumo de filas leídas/escritas incluido, por la regla de cuotas).

---

## 8. Work items W-CF

Reglas comunes:

- Cada item lista sus archivos. Dentro de una ola, **los conjuntos de archivos son disjuntos**.
- Cada item corre `pnpm typecheck && pnpm lint && pnpm test:unit` antes del commit (Conventional Commits, un commit por item).
- Ningún item usa `drizzle-kit push`.
- Ningún item crea recursos en Cloudflare o Fly ni borra datos sin aprobación del owner.

### Ola 0 — Gate (secuencial; depende de W-01 de `06` mergeado)

**W-CF-00 — Spike OpenNext + medición**

- Archivos: `wrangler.jsonc`, `open-next.config.ts`, `package.json` (scripts `cf:*`, devDeps `@opennextjs/cloudflare`, `wrangler`), `scripts/check-worker-size.mjs`, `.gitignore` (`.open-next/`, `.wrangler/`, `.migration/`).
- Contrato: los scripts y el `wrangler.jsonc` de §4.1–4.2. `check-worker-size.mjs <outdir>` imprime `{ gzipBytes, limitBytes, topModules[] }` en JSON y sale con 1 si `gzipBytes > limitBytes`.
- Trabajo:
  - Build con OpenNext usando el código **sin migrar** (DB stub: el proxy de `db` lanza si se usa).
  - Medir el tamaño.
  - Correr `wrangler dev` y cargar `/login`, `/`, `/p/<org>/<listing>` y `GET /api/health`.
  - Con aprobación del owner, desplegar un preview a `workers.dev` y leer en Workers Logs el CPU time por ruta.
  - Medir PBKDF2: tiempo de CPU de `deriveBits` con 10k/25k/50k/100k iteraciones.
- Verificación: `pnpm cf:build && pnpm cf:size` y `pnpm cf:preview` responde 200 en `/login`.
- Salida: tabla de mediciones en `docs/test-report.md`. **Decisión del owner: Free o Paid (§12).** Si B1 falla, STOP.

### Ola P — En Fly, antes del cutover (puede correr en paralelo con la Ola 1)

**W-CF-01 — Módulo de password con rehash (se despliega en Fly)**

- Archivos: `src/lib/auth/password.ts` (nuevo), `src/lib/auth/password.test.ts` (nuevo), `src/app/actions/auth.ts`.
- Contrato:
  ```ts
  export const PBKDF2_ITERATIONS: number;
  export type VerifyResult =
    | { ok: true; needsRehash: boolean }
    | { ok: false; reason: 'mismatch' | 'legacy_unsupported' };
  export async function hashPassword(plain: string): Promise<string>;
  export async function verifyPassword(plain: string, stored: string): Promise<VerifyResult>;
  export async function dummyVerify(plain: string): Promise<void>;
  export function isLegacyHash(stored: string): boolean;
  ```
  `verifyPassword` acepta `$2*` solo si `process.env.LEGACY_BCRYPT_VERIFY === '1'`. En Fly el flag está en `1`; en Cloudflare depende del plan. `auth.ts` elimina `DUMMY_PASSWORD_HASH` y `BCRYPT_COST`, re-hashea cuando `needsRehash` y mapea `legacy_unsupported` a `PASSWORD_RESET_REQUIRED`.
- Tests: hash y verify round-trip; mismatch; legacy con flag on/off; `needsRehash` cuando las iteraciones guardadas son menores; formato inválido devuelve mismatch sin throw; tiempo constante en la comparación (sin early return por byte).
- Verificación: `pnpm vitest run src/lib/auth/password.test.ts`.

**W-CF-02 — Copia final de adjuntos de Airtable**

- Archivos: `scripts/airtable-final/copy-attachments.ts`, `scripts/airtable-final/fields.ts` (mapa tabla/campo Airtable → columna DB/bucket), `scripts/airtable-final/copy-attachments.test.ts`.
- Contrato: `pnpm tsx scripts/airtable-final/copy-attachments.ts --dry-run|--apply`. Lee `AIRTABLE_PAT`, `AIRTABLE_BASE_ID`, `DATABASE_URL` y `TIGRIS_*` del entorno local del owner. Escribe `.migration/airtable-copy-log.jsonl`. Termina con un resumen `{ copied, skipped, failed }`. `failed > 0` produce exit 1.
- Tests: mapeo de campos; idempotencia (un valor que ya es path se salta); construcción de paths con `buildStoragePath`.
- Verificación: `--dry-run` lista N archivos. Después de `--apply`, `SELECT COUNT(*) ... WHERE photo_url LIKE '%airtable%'` (y equivalentes) = 0.

**W-CF-03 — Remover el núcleo de Airtable (lib)**

- Archivos (borrar): `src/lib/airtable/**`, `src/app/actions/airtable.ts`, `src/lib/schemas/airtable.ts`.
- Depende de W-CF-02 aplicado. Contrato: ningún import a `@/lib/airtable` fuera de los archivos que borran W-CF-04..06.
- Verificación: `pnpm typecheck` (junto con 04..06, que van en el mismo PR); `rg -l "lib/airtable" src` vacío.

**W-CF-04 — Remover rutas y cron de Airtable**

- Archivos (borrar): `src/app/api/cron/airtable-sync/route.ts`, `src/app/api/airtable-attachment/route.ts`, `src/app/api/admin/integrations/airtable/route.ts`, `.../status/route.ts`, `.../sync/route.ts`. Además, en `.github/workflows/cron-dispatch.yml` se quita el job `airtable-sync`.
- Tests: se borran los tests de esas rutas.
- Verificación: `rg -n "airtable-sync|airtable-attachment" src .github` vacío.

**W-CF-05 — Remover UI y textos de Airtable**

- Archivos: `src/app/dashboard/admin/integrations/airtable/page.tsx` (borrar), `src/components/portfolio/AirtableOccupancyDelta.tsx` (borrar), el componente `AdminSidebar` (quitar la entrada), `src/app/dashboard/page.tsx` (quitar el uso del delta), `messages/*.json` (claves `airtable.*`).
- Verificación: `pnpm test:unit` (incluye el check de i18n) y `pnpm build`.

**W-CF-06 — Remover escrituras a Airtable en tenants**

- Archivos: `src/app/api/tenant/register/route.ts`, `src/app/api/admin/tenants/**` (solo las partes de write-back), `src/components/**/TenantOnboardingForm.tsx` (campos Airtable), `src/lib/env.ts` y `.env.example` (sin `AIRTABLE_*`).
- Tests: el registro de tenant no llama a ningún cliente externo (mock sin llamadas).
- Verificación: `rg -n "AIRTABLE_" src .env.example .github` vacío. CI: también se quitan los stubs `AIRTABLE_*` de `ci.yml`, coordinado con W-CF-50 (mismo archivo, ola distinta).

**W-CF-07 — Inventario de datos (solo lectura, en Fly)**

- Archivos: `scripts/migrate-to-d1/inventory.mjs`, `scripts/migrate-to-d1/tables.mjs` (lista ordenada de tablas, columnas de procedencia y FKs; la comparten W-CF-51/52).
- Contrato: `node scripts/migrate-to-d1/inventory.mjs` con `DATABASE_URL` (por `flyctl proxy`) y `PRIMARY_OWNER_EMAIL`. Emite a stdout un JSON con:
  - `ownerOrgId`
  - `orgs[] { id, name, users, rows }`
  - `tables[] { name, total, toMigrate, excludedCrossOrg, excludedChildren }`
  - `legacyBcryptUsers`
  - `totalRowsToMigrate`
  - `storageRefs { column, count }`
  Solo ejecuta SELECT, dentro de `BEGIN READ ONLY`.
- Verificación: el owner revisa y aprueba el informe (B4, R5).

### Ola 1 — Fundaciones (paralela; depende de W-CF-00)

**W-CF-10 — Helpers de columnas y errores**

- Archivos: `src/lib/db/schema/columns.ts`, `src/lib/db/errors.ts`, `src/lib/db/columns.test.ts`, `src/lib/db/errors.test.ts`.
- Contrato:
  ```ts
  // columns.ts
  export const id: () => SQLiteTextBuilder;                        // text('id').primaryKey().$defaultFn(crypto.randomUUID)
  export const fk: (name: string) => SQLiteTextBuilder;            // text(name)
  export const ts: (name: string) => SQLiteTimestampBuilder;       // integer(name, { mode: 'timestamp_ms' })
  export const createdAt: () => ...;                               // ts('created_at').notNull().$defaultFn(() => new Date())
  export const updatedAt: () => ...;                               // idem + $onUpdateFn
  export const json: <T>(name: string) => ...;                     // text(name, { mode: 'json' }).$type<T>()
  export const money: (name: string) => ...;                       // text decimal (string mode)
  export const dateStr: (name: string) => ...;                     // text YYYY-MM-DD
  export const bool: (name: string) => ...;                        // integer(name, { mode: 'boolean' })
  // errors.ts
  export function isUniqueViolation(err: unknown, indexOrColumn?: string): boolean;
  export function isConstraintError(err: unknown, marker: string): boolean; // p. ej. 'visit_overlap'
  ```
  Los tipos exactos de retorno los define drizzle; el contrato es el nombre de la función y la columna SQL resultante.
- Tests: `errors.ts` con mensajes reales de D1 (`D1_ERROR: UNIQUE constraint failed: table.col: SQLITE_CONSTRAINT`), capturados en W-CF-14.
- Verificación: `pnpm vitest run src/lib/db`.

**W-CF-11 — Cliente D1**

- Archivos: `src/lib/db/index.ts`, `src/lib/db/retry.ts` (reducido a pass-through, se elimina en la Ola 3), `drizzle.config.ts`, `cloudflare-env.d.ts` (tipos `CloudflareEnv`: `DB`, `FILES`, `RL_IP_API`, `RL_IP_AUTH`, `ASSETS`, vars y secrets).
- Contrato:
  ```ts
  export type DB = DrizzleD1Database<typeof schema>;
  export function getDb(): DB;   // getCloudflareContext().env.DB, cacheado por request
  export const db: DB & { execute<T = Record<string, unknown>>(q: SQL): Promise<T[]> }; // proxy lazy; execute = all (transitorio)
  ```
  En tests (`NODE_ENV=test`), `getDb` acepta una inyección: `export function __setTestDb(d: DB | null): void`.
- Verificación: `pnpm typecheck`; test que verifica que `db.select` delega a `getDb()`.

**W-CF-12 — Storage en R2**

- Archivos: `src/lib/storage/index.ts`, `src/lib/storage/r2-presign.ts` (nuevo), `src/lib/storage/index.test.ts`, `next.config.ts` (solo `images`), `src/proxy.ts` (solo el host CSP `img-src`).
- Contrato: **se mantienen exactas** las firmas públicas actuales: `uploadImage(bucket, path, buffer, ...)`, `uploadFile(bucket, path, body, ...)`, `getSignedUrl(bucket, path, ttl = 3600)` (con tope de 3600), `deleteImage(bucket, path)`, `validateImageFile`, `buildStoragePath` y las constantes exportadas. Internamente usa `objectKey(bucket, path) = path` (producción en Tigris ya usa un solo bucket `STORAGE_BUCKET` con esas keys, así la copia a R2 es 1:1), el binding `FILES` y presign con `aws4fetch` (`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_S3_ENDPOINT`, `R2_BUCKET`).
  ```ts
  export async function presignGet(key: string, ttlSeconds: number): Promise<string>; // r2-presign.ts
  ```
  `next.config.ts`: `images: { unoptimized: true, remotePatterns: [{ protocol: 'https', hostname: '*.r2.cloudflarestorage.com' }] }`.
- Tests: mock del binding (`put/get/delete`); la URL presignada contiene `X-Amz-Expires=<ttl>` y una firma; TTL > 3600 se recorta.
- Verificación: `pnpm vitest run src/lib/storage`; en `wrangler dev`, subir una imagen y abrir la URL firmada.

**W-CF-13 — Rate limit en el edge**

- Archivos: `src/lib/ratelimit-edge.ts` (nuevo), `src/lib/ratelimit-edge.test.ts`, `src/lib/ratelimit.ts` (solo `getClientIp`: `cf-connecting-ip` primero; se quita `fly-client-ip`).
- Contrato:
  ```ts
  export type LimitResult = { success: boolean; retryAfterMs: number };
  export async function limitIp(binding: 'RL_IP_API' | 'RL_IP_AUTH', ip: string): Promise<LimitResult>;
  export async function limitKeyD1(key: string, limit: number, windowMs: number): Promise<LimitResult>;
  ```
  La tabla `rate_limits` la define W-CF-22 (schema ops). El cableado en `proxy.ts` lo hace W-CF-16.
- Tests: ventana fija en D1 (con el harness de W-CF-14); binding mockeado.
- Verificación: `pnpm vitest run src/lib/ratelimit-edge.test.ts`.

**W-CF-14 — Harness de tests SQL sobre D1 local**

- Archivos: `tests/integration/sql-smoke/setup.ts`, `vitest.config.ts` (proyecto `sql`), `package.json` (quitar `@electric-sql/pglite`; script `test:sql`), `tests/integration/sql-smoke/d1-errors.fixture.ts`.
- Contrato: se mantiene `createSmokeDb(): Promise<SmokeDb>` y los seeds (`seedOrg`, `seedProfile`, `seedAgentConfig`, `seedLead`, `seedSession`, `seedMessage`, `seedEvent`, `seedVisit`, `seedCall`, `seedProperty`, `seedListing`, `seedAdvisorSettings`). `SmokeDb.execute` devuelve filas. `assertMigrated` usa `sqlite_master` en lugar de `to_regclass`. Implementación: `getPlatformProxy()` de wrangler, con las migraciones de `src/lib/db/migrations-d1/` aplicadas en orden.
- Depende de W-CF-25 para tener migraciones. Hasta entonces el harness se prueba con una migración mínima de fixture.
- Verificación: `pnpm test:sql`.

**W-CF-15 — Scheduler de crons y worker entry**

- Archivos: `worker.ts` (nuevo), `src/lib/cron/schedule.ts` (nuevo), `src/lib/cron/scheduled.ts` (nuevo), `src/lib/cron/schedule.test.ts`, `src/instrumentation.ts` (borrar).
- Contrato:
  ```ts
  export type CronJob = 'agent-dispatch' | 'agent-sweep' | 'weekly-summary' | 'reminders'
    | 'task-reminders' | 'qa-export' | 'lead-alerts' | 'voice-reactivation';
  export function jobsDue(cron: string, at: Date): CronJob[];           // schedule.ts, puro
  export async function runScheduled(cron: string, at: Date, env: CloudflareEnv, ctx: ExecutionContext): Promise<void>;
  ```
  `agent-sweep` es una ruta nueva o un flag de `agent-dispatch`: `POST /api/cron/agent-dispatch?sweep=1`. La ruta acepta el query y ejecuta los 4 scanners que hoy corren en `instrumentation.ts`. Ese cambio en la ruta lo hace W-CF-30. Los jobs se ejecutan **en serie**, y un fallo se loguea pero no corta el resto.
- Tests: tabla de casos de `jobsDue` (lunes 07:00, lunes 15:00, domingo 15:00 sin voice, minuto 05 con sweep, minuto 03 sin sweep).
- Verificación: `pnpm vitest run src/lib/cron`; `wrangler dev --test-scheduled` + `curl "http://localhost:8787/__scheduled?cron=0+*+*+*+*"` **(verificar el flag en la versión de wrangler)**.

**W-CF-16 — Proxy y headers para Workers**

- Archivos: `src/proxy.ts` (excepto la línea CSP de imágenes, que es de W-CF-12; coordinar por orden de merge), `src/lib/request-id.ts` (o el helper equivalente de W-10), `public/robots.txt`.
- Contrato: el nonce usa `btoa(crypto.randomUUID())`; el request id usa `cf-ray`; `limitIp('RL_IP_API')` para `/api/*` excepto `/api/whatsapp/webhook` (Meta reintenta; tiene su propio límite) y `/api/cron/*`; `limitIp('RL_IP_AUTH')` para las rutas de auth; la respuesta 429 lleva `Retry-After`. `robots.txt` contiene `Disallow: /api/`.
- Nota: W-CF-12 y W-CF-16 tocan `src/proxy.ts`. **Excepción a la regla de disjuntos:** se mergea W-CF-16 primero y W-CF-12 rebasea; el cambio de W-CF-12 es una línea.
- Verificación: test de `proxy.ts` (unit, headers y 429); `pnpm cf:preview` + `curl -I`.

### Ola 2 — Schema sqlite-core por dominio (paralela; depende de W-CF-10)

El schema se divide en `src/lib/db/schema/` y `src/lib/db/schema.ts` queda como barrel (`export * from './schema/core'`, etc.), así que los imports `@/lib/db/schema` no cambian.

Regla de dependencias entre archivos: `core` no importa a nadie; `finance`, `ops` y `agent` importan solo de `core`; `agent-ext` importa de `core` y `agent`. Si una FK rompe esta regla, la tabla se mueve al archivo que la referencia y se avisa en el PR.

Cada item:

- porta sus tablas con los helpers de W-CF-10;
- porta los **CHECK** de las migraciones SQL 0000–0012 de sus tablas como `check()`;
- porta los índices parciales;
- conserva nombres de tabla, columnas e índices **idénticos** (el export de W-CF-51 depende de eso).

Las `relations(...)` van todas a `schema/relations.ts` (W-CF-24) para evitar ciclos.

| Item | Archivo | Tablas (anclas en el `schema.ts` actual) |
|---|---|---|
| **W-CF-20** | `src/lib/db/schema/core.ts` | Líneas 35–~290: `users`, `accounts`, `sessions`, `verification_tokens`, orgs, profiles, properties, units, responsables, tenants, contracts |
| **W-CF-21** | `src/lib/db/schema/finance.ts` | `charges` (269), `import_logs` (291), `payments` (315), `payment_receipts` (1079), `service_payments` (1275), `account_statements` (~1466), `tax_receipts` (~1499) y demás tablas financieras entre 1275 y 1636 |
| **W-CF-22** | `src/lib/db/schema/ops.ts` | `incidents` (350) … `ai_chat_messages` (751); `airtable_snapshots` (1108); `csv_imports` (1143) …; `tenant_invitations` (1295) … `absences` (1636), excepto las financieras; más la tabla nueva `rate_limits` |
| **W-CF-23** | `src/lib/db/schema/agent.ts` | `whatsapp_conversations` (769) … `agent_events` (1063) |
| **W-CF-24** | `src/lib/db/schema/agent-ext.ts`, `src/lib/db/schema/relations.ts`, `src/lib/db/schema.ts` (barrel) | `agent_advisor_settings` (1682) … `agent_session_listings` (2078), incluidos `calendar_connections` (`scopes` en JSON) y `signature_requests` (`inet` en text) si caen en este rango; si no, en el archivo del rango que corresponda |

Notas:

- `airtable_sync_logs` (1125) no se porta.
- La asignación exacta de las tablas entre 1143 y 1636 la cierra W-CF-21 al empezar, publicando la lista en el PR. W-CF-22 toma el resto. Es la única coordinación necesaria.
- Contrato común: `export const <tabla> = sqliteTable('<nombre_sql>', {...}, (t) => [...])`, con los mismos nombres de export TypeScript que hoy. Los tipos inferidos (`$inferSelect`) cambian: timestamps a `Date` (igual que hoy), numeric a `string` (igual que hoy), booleans a `boolean`.
- Verificación por item: `pnpm typecheck` del archivo + test `schema/<dominio>.test.ts`, que verifica que `getTableConfig(t).name` y los nombres de columnas coinciden con la lista de `scripts/migrate-to-d1/tables.mjs` (W-CF-07).

**W-CF-25 — Migraciones D1** (depende de W-CF-20..24)

- Archivos:
  - `src/lib/db/migrations-d1/0000_init.sql` (generado con `pnpm db:generate`)
  - `src/lib/db/migrations-d1/0001_triggers_views.sql` (a mano: trigger `property_visits_no_overlap` con `RAISE(ABORT, 'visit_overlap')`, trigger `listings_set_published_at`, vista `tenant_statement`)
  - `src/lib/db/migrations-d1/meta/**`
  - `tests/integration/sql-smoke/constraints.test.ts`
- Tests: el solapamiento de visitas en estado scheduled/confirmed falla con `visit_overlap` y uno cancelado no falla; `published_at` se setea; `tenant_statement` devuelve los mismos saldos que un caso calculado a mano; un CHECK de estado inválido falla; un `ON CONFLICT` con índice parcial funciona.
- Verificación: `pnpm db:migrate:local && pnpm test:sql`.

### Ola 3 — Reescritura de queries (paralela; depende de W-CF-11, W-CF-14 y W-CF-25)

Los grupos son disjuntos por archivo. Cada item agrega o ajusta tests SQL en `tests/integration/sql-smoke/<item>.test.ts`.

| Item | Archivos | Cambio |
|---|---|---|
| **W-CF-30** Cola del agente | `src/lib/agent/jobs.ts`, `src/app/api/cron/agent-dispatch/route.ts`, `tests/integration/sql-smoke/jobs.test.ts` | `claimDueJobs` como `UPDATE ... WHERE id IN (SELECT ... LIMIT ?) RETURNING`; `?sweep=1` corre los 4 scanners; sin `withDbRetry`. Contrato sin cambios: `enqueueJob`, `drainAgentJobs`, `registerAgentJobHandler` |
| **W-CF-31** Locks de visitas y routing | `src/lib/agent/visits/service.ts`, `src/lib/leads/routing.ts`, `src/lib/agent/tools/send-listing-photos.ts`, `src/app/actions/visit-availability.ts` | Sin `pg_advisory_xact_lock`. Visitas: el INSERT confía en el trigger `visit_overlap` y mapea el error con `isConstraintError`. Routing round-robin: `UPDATE ... SET cursor = cursor + 1 ... RETURNING`. Fotos: idempotencia con índice único + `ON CONFLICT DO NOTHING RETURNING` |
| **W-CF-32** Transacciones varias | `src/app/actions/leads-pipeline.ts`, `src/app/actions/agent-setup.ts`, `src/lib/agent/suggestions.ts`, `src/lib/leads/followups.ts`, `src/lib/auth/provision.ts` | `db.transaction` pasa a `db.batch([...])`. Si hay lectura intermedia, se usa una sentencia condicional. El contrato de cada función se mantiene |
| **W-CF-33** Violaciones únicas | `src/lib/events/handlers/whatsapp-receipt.ts`, `src/lib/widget/handoff-codes.ts`, `src/lib/agent/voice/calls.ts`, `src/app/api/cron/weekly-summary/route.ts`, `src/app/actions/contractDoc.ts` (solo el catch 23505) | `code === '23505'` pasa a `isUniqueViolation(err)` |
| **W-CF-34** Métricas y analítica | `src/lib/agent/metrics.ts`, `src/lib/analyst/top-underperformers.ts`, `src/lib/ai/assistant.ts`, `src/app/api/ai/executive-brief/route.ts`, `src/app/dashboard/executive-brief/page.tsx` | Sin `percentile_cont`, `DISTINCT ON`, `date_trunc`, `to_char`, `make_interval` ni `EXTRACT`. Tiempos como parámetros; buckets Lima en JS. Test: mismos resultados que el fixture actual de `metrics.test.ts` |
| **W-CF-35** Agente: SQL crudo | `src/lib/agent/voice/scanners.ts`, `src/lib/agent/voice/dnc.ts`, `src/lib/agent/listings.ts`, `src/lib/agent/web-handoff-redeem.ts`, `src/lib/agent/tools/continue-on-whatsapp.ts` | `jsonb_set` pasa a `json_set`; `->>`/`::boolean` pasan a `json_extract`; `= ANY` pasa a `inArray` con chunking; ILIKE pasa a LIKE ESCAPE |
| **W-CF-36** Importaciones y finanzas | `src/app/api/tenant/payments/import/route.ts`, `src/app/api/admin/payments/import/route.ts`, `src/app/api/admin/tenants/route.ts`, `src/app/actions/finance.ts` | Casts, ILIKE y transacciones. Inserts masivos en lotes según el límite de parámetros de D1 **(verificar)** |
| **W-CF-37** Dashboard admin | `src/app/dashboard/page.tsx`, `src/app/dashboard/leads/page.tsx`, `src/app/dashboard/tenants/page.tsx`, `src/app/dashboard/tenants/[id]/page.tsx`, `src/app/dashboard/admin/import/logs/page.tsx` | Raw SQL a SQLite. **KPIs: ver R3.** Cada agregado tiene índice compuesto `(org_id, status, ...)` y el número de queries por página queda medido |
| **W-CF-38** Portal del inquilino | `src/app/portal/page.tsx`, `src/app/dashboard/tenants/[id]/_tabs/PortalHomeSection.tsx`, `src/app/dashboard/tenants/[id]/_tabs/PaymentsTab.tsx` | Consumidores de `tenant_statement` y fechas |
| **W-CF-39** Auth en Workers | `src/lib/auth/config.ts`, `src/lib/auth/session.ts`, `src/lib/db/retry.ts` (borrar y quitar los usos restantes en las 3 rutas cron que no tocan otros items: `reminders`, `task-reminders`, `lead-alerts`) | Sin `withDbRetry`; `AUTH_URL`; el adapter verifica tipos sqlite. Test: login con Google mockeado crea user + account + session en D1 local |
| **W-CF-40** APIs de Node | `src/lib/crypto/encrypt.ts`, `src/lib/crypto/encrypt.test.ts` + los archivos que el spike W-CF-00 marque como incompatibles (máximo 3; si son más, se parte el item) | Test de compatibilidad: un vector cifrado en Node se descifra en workerd |
| **W-CF-41** PDF de contratos en el cliente | `src/lib/contracts/pdf.tsx` (pasa a módulo cliente), `src/app/actions/contractDoc.ts` (excepto el catch de W-CF-33; coordinar por orden de merge), un client component nuevo `src/components/contracts/GenerateContractPdf.tsx`, `src/app/dashboard/contracts/templates/page.tsx` (`ALLOWED_VARIABLES` pasa a `src/lib/contracts/variables.ts`, archivo nuevo) | La server action recibe el PDF (máximo 6 MB, mime `application/pdf`, magic bytes `%PDF`) y guarda el sha256. **Condicionado:** si W-CF-00 muestra que el bundle entra con react-pdf en server (o se elige Paid con margen), este item se cancela |
| **W-CF-42** OG image | `src/app/p/[orgSlug]/[listingSlug]/opengraph-image.tsx` (borrar), `src/app/p/[orgSlug]/[listingSlug]/page.tsx` (`generateMetadata` con `openGraph.images` = la foto principal) | Sin wasm en el bundle |
| **W-CF-43** Configuración de Next | `next.config.ts` (excepto `images`, que es de W-CF-12), `src/lib/env.ts` (validación de env por request; textos "Fly secrets" pasan a "wrangler secrets") | Se quita `output: 'standalone'`. `serverActions.bodySizeLimit` se mantiene en 6 MB (el límite de body de Workers Free lleva **(verificar)**) |

`contractDoc.ts` aparece en W-CF-33 y W-CF-41. **Excepción declarada:** W-CF-33 mergea primero (un catch); W-CF-41 rebasea.

### Ola 4 — Entrega y datos (paralela; depende de la Ola 3)

**W-CF-50 — CI con deploy a Cloudflare**

- Archivos: `.github/workflows/ci.yml`, `.github/workflows/cron-dispatch.yml`.
- Contrato `ci.yml`:
  - En el job `quality` se agrega el paso `pnpm cf:build && pnpm cf:size`, que falla si el bundle supera 3 MB comprimido (mientras se esté en Free; con Paid el límite pasa a la variable `vars.WORKER_SIZE_LIMIT_BYTES`).
  - Se quitan los stubs `DATABASE_URL` y `AIRTABLE_*`.
  - El job `deploy` reemplaza a flyctl: `pnpm exec wrangler d1 migrations apply propflow-db --remote` y después `pnpm exec wrangler deploy`, con `env: CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}` y `CLOUDFLARE_ACCOUNT_ID: ${{ vars.CLOUDFLARE_ACCOUNT_ID }}`. Solo en push a `main`. Las acciones van pinneadas por SHA (alinea con W-02).
  - El job `e2e` corre contra `pnpm cf:preview`.
  - Durante la transición, el deploy a Fly queda detrás de `vars.DEPLOY_TARGET == 'fly'` y el de Cloudflare detrás de `'cloudflare'`. Así el cutover es un cambio de variable y el rollback otro.
- `cron-dispatch.yml`: se quitan los `schedule` y queda `workflow_dispatch` contra `vars.APP_URL`, para disparos manuales de emergencia. Cada disparo cuesta 1 request.
- Verificación: un PR muestra el paso de tamaño en verde/rojo; el primer deploy a un Worker de staging con aprobación.

**W-CF-51 — Export y transformación**

- Archivos: `scripts/migrate-to-d1/export.mjs`, `scripts/migrate-to-d1/transform.mjs`, `scripts/migrate-to-d1/transform.test.mjs` (usa `tables.mjs` de W-CF-07).
- Contrato:
  - `node export.mjs --out .migration/export` escribe `<tabla>.jsonl`.
  - `node transform.mjs --in .migration/export --out .migration/sql --batch 50` escribe `NNNN_<tabla>.sql` en orden topológico, más `manifest.json { table, rows, files[] }`.
- Tests: conversión por tipo (timestamptz con offset, numeric con decimales, jsonb con comillas y unicode, NULLs); escape de `'`; orden topológico.
- Verificación: `node --test scripts/migrate-to-d1/transform.test.mjs`; ensayo con `wrangler d1 execute propflow-db --local --file=...` para todos los archivos sin error.

**W-CF-52 — Importación y verificación**

- Archivos: `scripts/migrate-to-d1/import.mjs` (aplica `manifest.json` en orden con `wrangler d1 execute --remote|--local --file`, reanudable con `.migration/import-state.json`), `scripts/migrate-to-d1/verify.mjs` (§7.6).
- Contrato: `verify.mjs` sale con 0 solo si todos los conteos, los hashes de ids y los invariantes coinciden. Imprime una tabla por tabla.
- Verificación: en local, export, transform, import `--local` y verify en verde.

**W-CF-53 — Copia de Tigris a R2**

- Archivos: `scripts/migrate-to-r2/copy-objects.mjs`, `scripts/migrate-to-r2/copy-objects.test.mjs`.
- Contrato: `node copy-objects.mjs [--since <ISO>] [--dry-run]`. Mapea cada bucket Tigris a su `logicalBucket` (mismo mapa que `resolveBucket`). Termina con `{ copied, skipped, failed, bytes }`.
- Verificación: `--dry-run` y después una corrida contra el bucket R2 (primero de staging) y un HEAD de muestra.

**W-CF-54 — Documentación y textos**

- Archivos: `CLAUDE.md` (sección Project: stack, comandos, deploy), `docs/ESTADO.md`, `src/app/privacidad/page.tsx` (subprocesadores: Cloudflare en lugar de Fly/Tigris; sin Airtable), `.env.example`, `docs/ENTREGA.md` (consumo estimado por usuario activo, por la regla de cuotas).
- Verificación: revisión manual; `pnpm build`.

### Ola 5 — Cutover y limpieza

**W-CF-60 — Ejecución del cutover**: runbook de §9. Lo ejecutan el owner y un agente. No tiene archivos de código.

**W-CF-55 — Remover artefactos de Fly y Postgres** (solo después de que el owner apruebe el decommission de Fly)

- Archivos: `Dockerfile`, `fly.toml`, `scripts/migrate.mjs`, `src/lib/db/migrations/` (Postgres; se archiva en un tag git antes de borrar), `package.json` (sin `postgres`, `@aws-sdk/*`, `bcryptjs` si ya no hay hashes legacy).
- Verificación: `pnpm build && pnpm cf:build && pnpm test:unit`; `rg -n "fly\.dev|flyctl|tigris" src .github` vacío.

---

## 9. Cutover y rollback

Principio: **Fly sigue arriba y sin cambios hasta que Cloudflare esté verificado.** La DB de Fly no se toca después del freeze, y eso es el seguro del rollback.

### 9.1 Antes (T-14 a T-1 días)

1. Ola P desplegada en Fly. El rehash de passwords corre al menos 1–2 semanas.
2. Olas 0–4 mergeadas. Con `DEPLOY_TARGET=fly`, CI sigue desplegando a Fly.
3. El owner crea los recursos de Cloudflare y carga los secrets (§13).
4. Ensayo general completo:
   - export de Fly, import a `propflow-db-staging`, verify;
   - copia de R2 completa;
   - deploy del Worker a staging;
   - smoke manual: login con Google, login con password, dashboard, portal de inquilino, subir imagen, ver recibo, crear visita, widget web.
   - Se anotan los tiempos de cada paso.
5. Primera pasada completa de `copy-objects.mjs` al bucket de producción.
6. Se comunica una ventana de mantenimiento en horario de bajo uso (noche de Lima) a los usuarios activos.

### 9.2 Ventana de corte (T0; duración estimada = la medida en el ensayo)

1. **Freeze en Fly.** El owner detiene las máquinas de la app: `flyctl machine stop -a propflow-app` para cada máquina. Es reversible y no borra nada. La DB `propflow-db2` sigue arriba para el export. Desde aquí no hay escrituras.
   - Mientras tanto, los webhooks de Meta fallan. Meta reintenta durante un tiempo **(verificar la ventana de reintentos de Meta)**. Los mensajes que lleguen en esa ventana se procesan cuando el webhook apunte al Worker, si caen dentro de esa ventana.
2. `pg_dump` completo de Fly, guardado localmente por el owner (backup de rollback y de B4).
3. Export, transform, import a `propflow-db` (producción) y `verify.mjs` en verde. **Si verify falla, se aborta y se va a rollback (§9.4).**
4. `copy-objects.mjs --since <fecha del paso 9.1.5>`.
5. Deploy del Worker de producción (`DEPLOY_TARGET=cloudflare`).
6. Smoke en `https://<host>`, con el mismo checklist del ensayo.
7. El owner actualiza las URLs externas (§9.3).
8. Mensaje de prueba real de WhatsApp al número del negocio; se verifica que el agente responde. Hace falta permiso explícito del owner, porque es un mensaje real.
9. Se abre a los usuarios. Fly queda **detenido pero intacto**.

### 9.3 Lugares exactos donde el owner cambia la URL

`<host>` es el hostname nuevo (`propflow-app.<subdomain>.workers.dev` o el dominio propio). En cada lugar, **se agrega** la URL nueva y se mantiene la de Fly hasta el decommission. Así el rollback no exige volver a editar nada.

| Lugar | Qué cambiar |
|---|---|
| Google Cloud Console → APIs & Services → Credentials → el OAuth 2.0 Client de `AUTH_GOOGLE_ID` | **Authorized redirect URIs**: agregar `https://<host>/api/auth/callback/google` y `https://<host>/api/calendar/google/callback` (o el valor de `GOOGLE_CALENDAR_REDIRECT_URI`, si está seteado). **Authorized JavaScript origins**: agregar `https://<host>` |
| Meta for Developers → la app de WhatsApp → WhatsApp → Configuration → Webhook | **Callback URL**: `https://<host>/api/whatsapp/webhook`. **Verify token**: el mismo valor de `WHATSAPP_WEBHOOK_VERIFY_TOKEN`. Las suscripciones de campos (`messages`) no cambian. Meta admite una sola callback URL por app, así que acá se reemplaza (no se agrega) y el rollback exige volver a editarla |
| Vapi | Env `VAPI_WEBHOOK_URL` = `https://<host>/api/agent/voice/vapi` (secret o var del Worker). Si hay assistants o números guardados en el dashboard de Vapi con la URL de Fly, se cambian ahí también **(verificar en el dashboard de Vapi)** |
| Variables del Worker | `NEXT_PUBLIC_SITE_URL` (también en el entorno de build de CI), `AUTH_URL` (y `NEXTAUTH_URL` mientras el código lo lea: `src/lib/auth/session.ts`, `src/lib/widget/origins.ts`), `GOOGLE_CALENDAR_REDIRECT_URI` si se usa |
| GitHub → Settings → Variables | `APP_URL` = `https://<host>` (lo usa `cron-dispatch.yml` manual); `DEPLOY_TARGET` = `cloudflare`; `CLOUDFLARE_ACCOUNT_ID` |
| Sitios externos con el widget | Snippet `<script src="https://<host>/widget.js" ...>`. Lo actualiza cada org en su sitio. Mientras Fly esté detenido, el widget viejo no carga |
| Links ya enviados | Invitaciones y links de firma enviados con `propflow-app.fly.dev` dejan de funcionar. Hay que reenviar las invitaciones pendientes (listado en W-CF-07: `tenant_invitations` y `signature_requests` pendientes) |

Recomendación: con dominio propio desde el cutover, estos cambios no se repiten nunca más. Requiere aprobación del owner (y puede tener costo si se compra un dominio).

### 9.4 Rollback

- **Durante la ventana**, antes de abrir a usuarios: el owner arranca las máquinas de Fly (`flyctl machine start`), restaura la callback URL de Meta y pone `DEPLOY_TARGET=fly`. No se pierde nada, porque Fly no recibió escrituras desde el freeze.
- **Después de abrir** (hasta 72 h): las escrituras hechas en D1 no existen en Fly. Para volver a Fly hay que (a) aceptar perder esas escrituras o (b) exportarlas de D1 por `updated_at > T0` y re-aplicarlas a mano en Postgres. No se construye una herramienta automática para (b); se decide caso por caso con el owner. Por eso el smoke del paso 9.2.6 debe ser completo **antes** de abrir.
- **Después de 72 h sin incidentes**, el owner decide cuándo aprobar el decommission de Fly (`propflow-app` y `propflow-db2`) y el borrado de los buckets de Tigris. Es un borrado irreversible: se hace con aprobación explícita y después de verificar que el backup `pg_dump` y la copia R2 están completos.

---

## 10. Reconciliación con `docs/06-plan-implementacion.md` y orden recomendado

### 10.1 Estado de cada W-xx

| W-xx | Estado | Nota |
|---|---|---|
| W-01 upgrade next/next-auth | **Se mantiene; prerequisito** | Cierra F-02 (RCE). OpenNext probablemente exige una versión reciente de Next **(verificar)** |
| W-02 pinning de CI | **Re-target** | `superfly/flyctl-actions` desaparece; se pinnean las acciones de deploy de Cloudflare. El digest del Dockerfile queda obsoleto. `cron-dispatch.yml` cambia (W-CF-50) |
| W-03 | Se mantiene | — |
| W-04 diag de identidad de profiles | Se mantiene, **en Fly antes del export** | Usa `pg_constraint` |
| W-05 | Se mantiene | Sin el wrapping `withDbRetry` |
| W-06 migraciones | **Re-target a D1** | SQL SQLite; sin notas de `CONCURRENTLY`; `date_bin` pasa a aritmética entera; los índices únicos parciales funcionan igual. Si W-06 no se mergeó antes del cutover, se escribe directo en `migrations-d1` |
| W-07 `requireCronAuth` | Se mantiene | `timingSafeEqual` con `nodejs_compat` o una comparación constante propia |
| W-08 | Se mantiene | — |
| W-09 timeouts externos | **Parcial** | Los timeouts de S3 `NodeHttpHandler` quedan obsoletos (binding R2). Los de Resend, Anthropic y Meta se mantienen con `AbortSignal.timeout` |
| W-10 request id / host guard | **Re-target** | `fly-request-id` pasa a `cf-ray`; el host guard se mantiene |
| W-11..W-13 | Se mantienen | — |
| W-14 | Se mantiene, adaptado | `db.transaction` pasa a `db.batch` |
| W-15 cola de jobs | **Re-target** | `FOR UPDATE SKIP LOCKED` pasa a `UPDATE ... RETURNING` atómico (lo resuelve W-CF-30) |
| W-16 env/proceso | **Re-target** | `instrumentation`, `process.on` y `setInterval` quedan obsoletos. La validación de env pasa a ser por request. `fly secrets list` pasa a `wrangler secret list` |
| W-17 health | Parcial | Los health checks de Fly quedan obsoletos; el endpoint de health y HSTS se mantienen |
| W-18 rate limit persistente | **Re-target** | D1 UPSERT + `cf-connecting-ip` + binding de Rate Limiting (W-CF-13/16) |
| W-19 | Se mantiene | `after()` pasa a `waitUntil` **(verificar el mapeo de OpenNext)** |
| W-20 | Parcial | `isRetryableDbError` para errores de postgres queda obsoleto; la purga se mantiene en D1 |
| W-21 | **Re-target** | `ON CONFLICT` con índice parcial funciona en SQLite (repetir el predicado) |
| W-22..W-40 | Se mantienen en su mayoría | W-23: transacción pasa a batch. W-27: storage sobre R2 (firmas iguales). W-38/W-39 son independientes de plataforma |
| W-41 Airtable | **Obsoleto** | La integración se elimina (Ola P) |
| W-42 escape de ILIKE | **Re-target** | `LIKE ... ESCAPE '\'` |
| W-43 | Se mantiene sobre D1 | — |
| W-44, W-45 | Se mantienen | W-45: el tope atómico se hace con un `UPDATE ... WHERE count < cap RETURNING` de SQLite |
| W-46 | **Re-target** | `FILTER` y `UPDATE ... FROM (VALUES ...)` a SQLite. `UPDATE FROM` existe en SQLite ≥ 3.33 **(verificar en D1)**; si no, se usa `CASE` o batch |
| W-47 | Sobre D1 | — |
| W-50 secrets | **Re-target** | Fly secrets pasan a `wrangler secret` |
| W-51..W-54 | Se mantienen | — |

### 10.2 Orden recomendado

1. **Ola 1 de seguridad de `06` primero** (W-01, W-03). W-01 es prerequisito técnico de OpenNext y cierra un RCE. Además, sin W-01 el spike mediría una versión de Next que no se va a desplegar.
2. **W-CF-00** (gate). Si falla, STOP y vuelve al owner.
3. **Ola P en Fly**, en paralelo con la **Ola 1 de migración**. La Ola P cierra F-01/F-03 sin esperar a Cloudflare.
4. **Olas 2, 3 y 4.**
5. **Cutover (W-CF-60).**
6. **El resto de `06` re-targeteado a D1** (W-06, W-15, W-18, W-21, W-46, ...). No conviene implementarlos dos veces (Postgres y D1): los items de `06` que tocan SQL y no son de seguridad crítica se congelan hasta después del cutover. Los de seguridad crítica que sean independientes de la DB (headers, authz, IDOR) siguen en paralelo.

El worktree en curso de SA-1/SA-5 (`.claude/worktrees/agent-aefd05fd67daa856c`) debe mergearse o pausarse **antes** de la Ola 2, porque la Ola 2 reescribe `schema.ts` completo.

---

## 11. Riesgos

| ID | Riesgo | Severidad | Mitigación / medición |
|---|---|---|---|
| R1 | **CPU de 10 ms en Free.** SSR de React 19 + next-intl + la sesión NextAuth (2–3 queries, cuyo I/O no cuenta como CPU) + el render de dashboards con tablas probablemente supera 10 ms en p99 en páginas pesadas | **Alta** | W-CF-00 mide el CPU time por ruta en Workers Logs. Si p99 > 10 ms en `/dashboard`, `/dashboard/payments` o `/portal`, hace falta Paid. Mitigaciones parciales: menos datos por página, paginar, client components con fetch diferido (pero sin polling) |
| R2 | **Bundle > 3 MB comprimido.** Next 16 + NextAuth + Anthropic SDK + next-intl + Drizzle + react-pdf + og/wasm | **Alta** | `cf:size` en CI. Se quitan `@aws-sdk`, `postgres`, Airtable, react-pdf y og. Si aun así supera el límite, hace falta Paid (límite mayor **(verificar)**) |
| R3 | **Filas leídas de D1 en los KPIs.** PR #50 hizo que los totales de dashboard agreguen sobre **todas** las filas. Cada carga lee la tabla de payments completa (miles de filas) varias veces. Ejemplo: 5.000 payments × 6 agregados = 30.000 filas por carga, y 5 M/día da ~160 cargas/día para toda la cuenta | **Alta** | Tabla `org_kpis` mantenida en cada escritura de payments/charges (mismo `batch`) o recalculada por el cron horario, más Cache API por org con TTL de 60 s. Medir `meta.rows_read` de D1 por página en W-CF-37 y loguearlo. Regla de cuotas: nunca `COUNT(*)` por request sobre tablas grandes |
| R4 | **Duración del turno del agente.** Una conversación de Anthropic con tool-use puede tardar 10–60 s de reloj. El I/O no cuenta como CPU, pero el parseo de JSON y el armado de prompts sí. El límite de duración de `waitUntil` y de `scheduled` lleva **(verificar)** | **Alta** | El drain post-webhook procesa 1 job; el cron por minuto es el backstop; `CLAIM_LOCK_MS` (2 min) re-encola si el isolate muere. Si los turnos se cortan, hay dos alternativas: Queues (disponibilidad en Free **(verificar)**, con `max_retries` acotado + DLQ por la regla 8) o Durable Objects con alarmas (Free **(verificar)**) |
| R5 | **Cuota de escritura en la importación.** 100.000 filas escritas/día | **Media/Alta** | El informe de W-CF-07 da el total. Opciones en §7.4. Si supera el límite, se elige entre partir la importación en días o pagar Paid 1 mes |
| R6 | **Seguridad de PBKDF2 con pocas iteraciones** frente a bcrypt 12 | **Media** | Rate limit por IP y por cuenta; Google como camino principal; iteraciones subibles al pasar a Paid (rehash automático); se informa al owner |
| R7 | **Usuarios con hash bcrypt legacy en Free** | **Media** | Rehash en Fly antes del cutover; conteo; link de "definir contraseña" vía admin; flag `LEGACY_BCRYPT_VERIFY` con Paid (§6) |
| R8 | **OpenNext + Next 16 `proxy.ts`** no soportado (B1) | **Alta (bloqueante)** | Gate W-CF-00. Alternativas si falla: esperar soporte de OpenNext o mover la lógica de `proxy.ts` a `worker.ts` (antes de `openNext.fetch`). La segunda es viable para headers, CSP y rate limit, pero no para el chequeo de sesión que hoy hace el proxy |
| R9 | **Cuota de 100k requests/día compartida** con las otras apps de la cuenta. Un Next.js navegado hace varias requests al Worker por página (RSC, prefetch de `<Link>`, server actions) | **Media** | `prefetch={false}` en listas largas de links; assets fuera del Worker (`run_worker_first: false`); robots; rate limit. El webhook de WhatsApp y el cron interno no generan requests extra. Medir requests por sesión típica en el ensayo y anotarlo en `docs/ENTREGA.md`. Si la estimación supera el 50% del free tier: STOP y hablar con el owner |
| R10 | **Corrección de la reescritura SQL** (14 transacciones, 3 advisory locks, 160 CHECK, triggers, vista, 111 fragmentos crudos) | **Media** | Tests SQL contra D1 local (W-CF-14) por item; verify de datos; ensayo de cutover completo |
| R11 | **Compatibilidad de AES-GCM** de los tokens cifrados existentes | **Media** | Test de vector cruzado Node/workerd (W-CF-40) antes del cutover |
| R12 | **Pérdida de webhooks de Meta durante la ventana** | **Baja/Media** | Ventana corta; reintentos de Meta **(verificar)**; horario de bajo uso |
| R13 | **Body de requests** (subidas de 5–6 MB por server action) y límites de tamaño de request en Workers **(verificar)** | **Baja** | Probar en el ensayo; si falla, subida directa a R2 con URL PUT presignada |
| R14 | **D1: límites por consulta** (parámetros por sentencia, tamaño de SQL, duración) **(verificar)** | **Baja/Media** | Chunking en inserts masivos e `inArray` |

---

## 12. Veredicto sobre el plan Free

**Probablemente necesita Workers Paid.** Las razones, en orden de probabilidad:

1. **CPU (R1):** el SSR de páginas de dashboard con sesión de base de datos es difícil de mantener bajo 10 ms en p99. Además, cualquier login con password queda acotado por las iteraciones de PBKDF2 que entren en ese presupuesto (R6).
2. **Bundle (R2):** una app Next 16 con este conjunto de dependencias tiende a superar 3 MB comprimido incluso después de quitar AWS SDK, postgres, Airtable, react-pdf y og.
3. **Legacy bcrypt (R7):** sin Paid, los usuarios que no hagan login en Fly antes del cutover necesitan Google o un link de admin.

Mediciones que deciden (todas en W-CF-00 o en el ensayo de §9.1):

| Medición | Cómo | Umbral que fuerza Paid |
|---|---|---|
| Tamaño del Worker | `pnpm cf:size` (gzip del dry-run) | > 3 MB comprimido |
| CPU por ruta | Workers Logs / observability del preview: CPU time p50/p99 en `/login` (POST), `/dashboard`, `/dashboard/payments`, `/portal`, `/api/whatsapp/webhook` y `/api/cron/agent-dispatch` | p99 > 10 ms en cualquiera de esas rutas de forma sostenida |
| Duración del agente | Wall time de un turno real en el preview | Si los turnos se cortan por el límite de `waitUntil` o de `scheduled` **(verificar)** |
| Filas escritas de la importación | Informe de W-CF-07 | > ~80.000 filas y la importación no se puede partir |
| Requests por día | Estimación por usuario activo × usuarios esperados + 1.440 invocaciones de cron (si cuentan, **verificar**) | > 50% de 100.000 en uso real, considerando las otras apps de la cuenta |

Workers Paid cuesta USD 5/mes base. Sus límites y excedentes (CPU, tamaño, requests) **(verificar)** en la página de precios. **La decisión vuelve al owner**: no se cambia de plan sin su aprobación.

---

## 13. Acciones del owner (lista exacta)

Antes de empezar:

1. Aprobar este plan y el orden de §10.2.
2. Confirmar si se usa un dominio propio o `workers.dev` (S2). Si es propio, hay que agregarlo a Cloudflare.

Ola P y migración:

3. `flyctl auth login` con la cuenta correcta de Fly. Habilita el acceso de lectura a `propflow-db2` y el freeze del cutover.
4. Tener `AIRTABLE_PAT` y `AIRTABLE_BASE_ID` en el `.env.local` propio para correr W-CF-02. El valor no se comparte en el chat.
5. Aprobar el informe de W-CF-07: la lista de orgs legítimas y la exclusión de filas cross-org de Airtable (B4). Guardar el backup `pg_dump`.
6. Revisar `legacyBcryptUsers` y decidir entre un mes de Paid con `LEGACY_BCRYPT_VERIFY=1` o el camino Google / link de admin.

Cloudflare (crea recursos; gratis en Free, pero se piden igual):

7. Crear un API token de Cloudflare con permisos de edición para Workers Scripts, D1 y R2 (y Workers Routes si hay dominio). Guardarlo como secret de GitHub `CLOUDFLARE_API_TOKEN`. Nosotros nunca vemos el valor. Agregar la variable de GitHub `CLOUDFLARE_ACCOUNT_ID`.
8. Crear o aprobar que creemos: D1 `propflow-db` (y `propflow-db-staging` para el ensayo) y el bucket R2 `propflow-files` (y uno de staging). Pegar el `database_id` en `wrangler.jsonc`; no es un secreto.
9. Crear un token S3 de R2 (Access Key ID + Secret) con acceso al bucket, para las URLs firmadas y para la copia desde Tigris.
10. Cargar los secrets del Worker con `pnpm exec wrangler secret put <NAME>`, uno por uno. Nombres:
    - `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`
    - `CRON_SECRET`
    - `RESEND_API_KEY`, `RESEND_FROM_EMAIL`
    - `ANTHROPIC_API_KEY` (y `AGENT_MODEL` / `AGENT_VOICE_MODEL` si se usan)
    - `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_BUSINESS_ACCOUNT_ID`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN`, `WHATSAPP_WEBHOOK_SECRET`, `META_APP_SECRET`
    - `VAPI_API_KEY`, `VAPI_WEBHOOK_SECRET`, `VAPI_WEBHOOK_URL`
    - `TOKEN_ENCRYPTION_KEY` (**el mismo valor que en Fly**, si no los tokens de Calendar no se descifran)
    - `PRIMARY_OWNER_EMAIL`, `ADMIN_ALLOWLIST`
    - `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`
    - `GOOGLE_CALENDAR_REDIRECT_URI` (opcional), `CSP_REPORT_URI` (opcional), `SENTRY_DSN` (opcional)
11. Decidir Free o Paid con las mediciones de §12.
12. Activar notificaciones de uso en el dashboard de Cloudflare (Notifications → Workers / usage). No cambiamos configuración de la cuenta sin preguntar.
13. Con dominio propio: activar Bot Fight Mode.

Cutover:

14. Aprobar la fecha y la ventana; comunicar a los usuarios.
15. Durante la ventana: detener las máquinas de Fly, guardar el `pg_dump` y actualizar las URLs de §9.3 (Google OAuth, Meta webhook, Vapi, GitHub vars `APP_URL`/`DEPLOY_TARGET`).
16. Autorizar un mensaje real de prueba de WhatsApp.
17. Avisar a las orgs con el widget embebido que actualicen el snippet. Reenviar las invitaciones y los links de firma pendientes.

Después:

18. Tras ≥ 72 h estables, aprobar por separado el decommission de Fly (`propflow-app`, `propflow-db2`) y el borrado de los buckets de Tigris. Revocar el PAT de Airtable. **No borrar la base de Airtable** sin una decisión explícita.

---

## 14. Límites marcados "verificar" (checklist para W-CF-00)

- Cantidad de Cron Triggers por Worker en Free; CPU y duración máxima de `scheduled`.
- Si las invocaciones `scheduled` y los fetch internos al handler cuentan contra las 100k requests/día.
- Duración máxima de `ctx.waitUntil` después de la respuesta.
- Si el binding de Rate Limiting está disponible en Free y qué `period` permite.
- Disponibilidad y cupos de Queues y Durable Objects en Free.
- Tope de iteraciones de PBKDF2 en workerd (se cita 100.000).
- Soporte de `@opennextjs/cloudflare` para Next 16 y `proxy.ts`; mapeo de `after()` a `waitUntil`; versión mínima de Next.
- Cobertura de `nodejs_compat` para `node:crypto` (createCipheriv GCM, createHmac, timingSafeEqual) y `Buffer`.
- Unidad exacta del límite de 3 MB (MB o MiB; gzip o brotli) y el límite de tamaño en Paid.
- Límites de D1: parámetros por sentencia, tamaño de SQL, duración de query, versión de SQLite (`->>`, `FILTER`, `UPDATE FROM`), `PRAGMA defer_foreign_keys`, y si las importaciones por archivo cuentan contra la cuota de escritura.
- Tamaño máximo del body de request en Workers Free.
- Ventana de reintentos de webhooks de Meta.
- Si drizzle 0.45 sqlite-core soporta `numeric` en modo string y si `@auth/drizzle-adapter` detecta SQLite con el driver D1.
- Compatibilidad del SDK de `resend` con workerd.
- Si los assistants de Vapi guardan la server URL en el dashboard.
