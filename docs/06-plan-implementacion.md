# 06 — Plan de implementación (hardening de seguridad, fiabilidad, QA y a11y)

Fecha: 2026-11-17. Fuente de hallazgos: `docs/security-report.md` (IDs F-xx y los IDs de origen SA/PT/SE/AC/SR/DB/ER/QA/BUG/A11Y/DOC).

## 0. Reglas para builders

- Cada ítem `W-xx` es un PR independiente (Conventional Commits, una tarea por commit). Los ítems de la misma ola tocan **conjuntos de archivos disjuntos** y pueden construirse en paralelo.
- Si un ítem necesita tocar un archivo que no está en su lista, **para y escala**: probablemente lo posee otro ítem de la ola.
- Quedan fuera del plan **SA-1 (F-01) y SA-5 (F-03)**, que están **en curso** en el worktree `.claude/worktrees/agent-aefd05fd67daa856c`.
  - Ese trabajo puede añadir migraciones y cambiar `src/lib/db/schema.ts`.
  - **W-06 debe rebasarse sobre él y renumerar** si ya ocupó `0013`.
  - Las olas 3 y siguientes se rebasan sobre `main` con SA-1 y SA-5 ya fusionados.
- Normas del proyecto (CLAUDE.md):
  - Zod en el servidor.
  - Errores genéricos al cliente con request id; el detalle va al log.
  - Sin N+1.
  - Cambios quirúrgicos.
  - Solo pnpm.
  - Nunca `drizzle-kit push`.
  - Nunca desactivar tests ni checks.
  - Preguntar antes de borrar datos.
  - Leer `node_modules/next/dist/docs/` antes de escribir código Next (AGENTS.md).
- Migraciones:
  - Van en `src/lib/db/migrations/NNNN_*.sql`.
  - `scripts/migrate.mjs` aplica cada archivo en **una transacción**: nada de `CONCURRENTLY`.
  - Deben ser idempotentes (`IF NOT EXISTS`) y aditivas. Sin `DROP` ni `DELETE`.
  - Se reflejan en `schema.ts`.
- Lint: cada ítem deja sus archivos sin errores ni warnings (`pnpm exec eslint <archivos> --max-warnings=0`).
- Verificación estándar por ítem (en "Verificación" se lista solo lo específico):
  ```
  pnpm typecheck
  pnpm exec vitest run <tests del ítem> --config vitest.config.ts
  pnpm exec eslint <archivos tocados> --max-warnings=0
  ```
- Gate de ola (lo corre el orquestador tras fusionar todos los ítems de la ola):
  ```
  pnpm exec eslint src && pnpm typecheck && pnpm test && pnpm build
  ```
- Entorno: el store global de pnpm está dañado (ver `docs/security-report.md` §3.2). Hasta que el dueño lo limpie, instalar con `pnpm install --frozen-lockfile --store-dir <scratchpad>/pnpm-store`.

## 1. Helpers compartidos (dueño único)

| Helper | Archivo | Ítem dueño | Consumidores |
|---|---|---|---|
| `AuthContext.profileId` | `src/lib/auth/guards.ts` | W-04 | Todos los ítems AC-2 (W-22 … W-34, W-52) |
| `getTenantForSession` | `src/lib/auth/tenant-session.ts` | W-04 | W-24, W-25, W-26, W-27, W-29 … W-34 |
| `makeAuthContext` (tests) | `tests/helpers/auth-context.ts` | W-04 | Todos los tests nuevos de acciones y rutas |
| `requireCronAuth` | `src/lib/auth/cron.ts` | W-07 | 7 rutas cron (W-07), `airtable-sync` (W-41) |
| `getRequestId` / `REQUEST_ID_HEADER` | `src/lib/request-id.ts` | W-10 | W-11, W-18, W-19, W-23, W-41 |
| `safeInternalPath` / `siteUrl` | `src/lib/auth/safe-path.ts` | W-12 | W-12; uso futuro en redirecciones |
| `Modal` | `src/components/ui/Modal.tsx` | W-13 | W-35, W-36 |
| `getClientIpFromHeaders` | `src/lib/ratelimit.ts` | W-18 | W-18, W-47 |
| `consumeRateLimit` / `peekRateLimit` | `src/lib/ratelimit-db.ts` | W-18 (la tabla es de W-06) | W-18, W-45, W-47 |
| `transitionPayment` | `src/lib/payments/transition.ts` | W-22 | Rutas approve/reject y `actions/payments.ts` |
| `insertImportedPayments` | `src/lib/payments/import-rows.ts` | W-23 | Las 2 rutas de importación de pagos |
| `isRetryableDbError` | `src/lib/db/retry.ts` | W-20 | `withDbRetry` y crons |
| `purgeFinishedJobs` / `purgeExpiredRateLimits` | `src/lib/maintenance/purge.ts` | W-20 | Cron `agent-dispatch` |
| `getAnthropicClient` (con timeout) | `src/lib/ai/client.ts` | W-08 | W-08, W-19, W-27, W-28 (sustituyen `new Anthropic`) |
| `ingestInboundMessage` | `src/lib/whatsapp/ingest.ts` | W-19 | Webhook de WhatsApp |
| Claves i18n `errorBoundary.*`, `a11y.skipToContent`, `a11y.closeDialog` | `src/messages/{en,es,pt}.json` | W-11 (único ítem de la ola 2 que toca i18n) | W-11, W-13 (por props), W-40 |

## 2. Olas y dependencias

```
Ola 1: W-01, W-02, W-03                              (sin dependencias; orden de merge W-01, W-03, W-02)
Ola 2: W-04 … W-17                                   (dependen de Ola 1)
Ola 3: W-18 … W-40                                   (dependen de W-04 y W-06; W-35/W-36 de W-13; W-40 de W-11)
Ola 4: W-41 … W-51                                   (W-41 depende de la fusión de SA-1/SA-5; W-47 de W-18; W-45 de W-18)
Ola 5: W-52 (solo)                                   (barrido final AC-2 + guard estático)
Ola 6: W-53 (solo)                                   (warnings de lint + `pnpm lint` bloqueante)
Ola 7: W-54 (solo)                                   (codemod de contraste, toca ~111 archivos)
```

Dependencias reales (el resto es concurrente):
- W-02 hace bloqueantes el audit y el lint. Se fusiona después de W-01 (audit limpio) y de W-03 (0 errores de lint); si no, CI queda en rojo.
- Toda la ola 3 usa `ctx.profileId` y `getTenantForSession` (W-04). W-18, W-21 y W-22 usan tablas, columnas o índices de W-06.
- W-41 usa `requireCronAuth` (W-07) y `getRequestId` (W-10). Además va después de SA-1/SA-5.
- W-52 va después de todos los ítems que tocan sitios AC-2.

---

## Ola 1 — Dependencias y CI (sola)

### W-01 — Actualizar dependencias vulnerables
- **Cubre:** F-02 (SA-2 = SE-1); transitivos de SE-1 (sharp, postcss, nanoid, browserslist, source-map-js).
- **Archivos:** `package.json`, `pnpm-lock.yaml`. Además `next.config.ts` solo si el upgrade exige un cambio de configuración (documentarlo en el PR).
- **Contrato:**
  - `next` y `eslint-config-next` `^16.4.1`.
  - `next-auth` `5.0.0-beta.32` (o superior) y `@auth/drizzle-adapter` en la versión compatible con `@auth/core` >= 0.41.3.
  - `pnpm.overrides` solo para transitivos que no se resuelvan con el upgrade: `sharp>=0.35.5`, `postcss>=8.5.18`, `nanoid>=3.3.18`, `browserslist>=4.28.7`, `source-map-js>=1.2.2`.
  - Sin cambios de código de la app salvo los que exija la API nueva. Leer `node_modules/next/dist/docs/` (notas de upgrade 16.3/16.4).
  - Objetivo: `pnpm audit --prod --audit-level=high` termina con 0 avisos.
- **Bloqueo potencial:** `zod` (GHSA-mrhx-c7xc-m3w5) llega por `@anthropic-ai/sdk`, que pide zod >= 4.6.6, mientras la app usa zod 3.
  - Probar primero con override acotado (`"@anthropic-ai/sdk>zod"`). La app sigue en zod 3.
  - Si eso no basta, **no migrar la app a zod 4 dentro de este ítem**: escalar al dueño (W-01b, migración zod 4, o excepción temporal documentada).
- **Tests:** ninguno nuevo; deben pasar los existentes.
- **Verificación:**
  ```
  pnpm install --frozen-lockfile && pnpm audit --prod --audit-level=high && pnpm typecheck && pnpm test && pnpm build
  ```
- **Dependencias:** ninguna. El builder necesita red para el registry. Las actualizaciones a hacer son exactamente las de este ítem.

### W-02 — CI y supply chain bloqueantes
- **Cubre:** F-02 (gate SE-1), F-10 (SE-2), F-27 (SE-5, SE-6, SE-18), F-28 (parte workflow de SE-7), F-29 (SE-8), F-71 (SE-17), F-72 (SE-19, opcional), F-12 (`dependabot.yml`).
- **Archivos:** `.github/workflows/ci.yml`, `.github/workflows/cron-dispatch.yml`, `.github/dependabot.yml` (nuevo), `.dockerignore`, `Dockerfile` (solo el digest de `FROM`).
- **Contrato:**
  - Fijar todas las `uses:` por SHA completo con comentario `# vX.Y.Z`. Incluye `pnpm/action-setup` (líneas 48/113/217/283), `github/codeql-action/*` (170/175/178) y `superfly/flyctl-actions/setup-flyctl` (331, hoy `@master`).
  - El job de deploy declara `environment: Production` y `permissions: contents: read`.
  - Sustituir `npx --yes <tool>` (78/92/121/247) por versiones fijadas (`pnpm dlx <tool>@<versión>` o devDependency).
  - Quitar `continue-on-error` (60/67/74/87/153) de:
    - el audit: `pnpm audit --prod --audit-level=high` pasa a bloquear;
    - CodeQL: bloquea;
    - el lint: `pnpm exec eslint src` bloquea con errores. El gate `--max-warnings=0` (`pnpm lint`) llega en W-53.
  - Si un paso no puede bloquear todavía (por ejemplo el gate de cobertura en 74.66 %), dejarlo como está y anotarlo en el PR. No se debilita ningún umbral.
  - `cron-dispatch.yml`:
    - el secreto pasa por `env:` (sin interpolar `${{ secrets.* }}` dentro de `run:`);
    - matriz de endpoints;
    - no imprimir el cuerpo de la respuesta: solo el código HTTP; fallar si es >= 400.
  - Job e2e: `if: github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository`. Sin secretos para forks.
  - `dependabot.yml`: ecosistemas `npm` (pnpm), `github-actions` y `docker`, semanal, agrupando minors y patches.
  - `.dockerignore`: añadir `.env*` (con `!.env.example` si existe), `.git`, `.claude`, `coverage`, `playwright-report`, `test-results`, `*.log`.
- **Tests:** no aplica.
- **Verificación:**
  ```
  pnpm dlx @action-validator/cli .github/workflows/ci.yml
  ```
  Además: `rg "uses: [^ ]+@(v\d|master|main)" .github/workflows` no devuelve nada; `rg "continue-on-error" .github/workflows/ci.yml` solo devuelve pasos justificados en el PR. Validación final en el run de CI del PR.
- **Dependencias:** fusionar después de W-01 y W-03. Resolver los SHAs requiere red (`gh api repos/<owner>/<repo>/git/ref/tags/<tag>`).

### W-03 — Los 10 errores de lint
- **Cubre:** baseline (10 errores).
- **Archivos:**
  - `src/app/dashboard/admin/imports/ImportsClient.tsx` (74)
  - `src/app/dashboard/admin/integrations/airtable/page.tsx` (67)
  - `src/app/dashboard/admin/tenants/page.tsx` (79, 82, 95)
  - `src/app/dashboard/admin/tenants/[tenantId]/page.tsx` (98)
  - `src/app/invite/accept/page.tsx` (53)
  - `src/app/portal/payments/PaymentsClient.tsx` (127, 128)
  - `src/app/actions/incidents.ts` (167)
- **Contrato:**
  - `react-hooks/set-state-in-effect`: derivar el estado durante el render, usar un inicializador perezoso de `useState`, o mover el `setState` al callback del fetch o del evento.
  - No se permite `eslint-disable`.
  - Sin cambio de comportamiento visible.
  - `no-html-link-for-pages` (`tenants/page.tsx:95`): el `<a href="/api/admin/tenants/import/template/">` es una descarga de ruta API. Usar `<a ... download>` con `// eslint-disable-next-line @next/next/no-html-link-for-pages` **no** está permitido. Usar `<Link href=... prefetch={false}>`, o mover el href a una constante que no empiece con una página (la regla solo dispara con rutas de página). Elegir la opción que mantenga la descarga.
  - `no-explicit-any` (`incidents.ts:167`): tipar con el tipo inferido de Drizzle o con `unknown` y un narrowing.
- **Tests:** los existentes. Añadir uno solo si se cambia lógica.
- **Verificación:**
  ```
  pnpm exec eslint src
  ```
  0 errores, y el número de warnings no sube de 31.
- **Dependencias:** ninguna (concurrente con W-01 y W-02).

---

## Ola 2 — Fundamentos (14 ítems en paralelo)

### W-04 — Identidad de perfil (AC-2) y helper de tenant
- **Cubre:** F-06 (AC-2 = SA-19 = AC-27), escritura de `invite/accept` (`route.ts:138`), F-61 parcial (rate limit por IP en `invite/peek` y `invite/accept`, PT-14 / SA-15).
- **Archivos:**
  - `src/lib/auth/guards.ts`
  - `src/lib/auth/tenant-session.ts` (nuevo)
  - `src/app/api/invite/accept/route.ts`
  - `src/app/api/invite/peek/route.ts`
  - `scripts/diag/profile-identity.sql` (nuevo)
  - Tests: `tests/helpers/auth-context.ts` (nuevo), `tests/unit/auth/tenant-session.test.ts`, `tests/unit/api/invite-accept.test.ts`
- **Semántica establecida (desde el esquema):**
  - Todas las columnas de perfil son FK a `profiles.id`:
    - `tenants.profile_id` (`0000_baseline.sql:171`)
    - `esign_signatures.signer_profile_id` (596)
    - `notification_inbox.profile_id` (645)
    - `ai_chat_messages.profile_id` (693)
    - `payments.approved_by`, `tenant_tasks.created_by`, `import_logs.imported_by` (`schema.ts`)
  - `provisionOrgAndProfile` crea `profiles.id = gen_random_uuid()`.
  - **Valor correcto: `profiles.id`.** `users.id` solo se usa para sesiones, cuentas y claves de rate limit.
- **Contrato:**
  ```ts
  // guards.ts
  export interface AuthContext {
    userId: string;     // users.id — sessions, rate-limit keys only
    profileId: string;  // profiles.id — every FK/compare against profile columns
    orgId: string;
    role: Role;
    profile: Profile;
  }
  // tenant-session.ts
  export type SessionTenant = { id: string; orgId: string; unitId: string | null; fullName: string; email: string | null };
  export const getTenantForSession: (ctx: Pick<AuthContext, 'profileId' | 'orgId'>) => Promise<SessionTenant | null>;
  ```
  - `getTenantForSession` está envuelto en `cache()` de React y hace una sola query: `WHERE tenants.profile_id = ctx.profileId AND tenants.org_id = ctx.orgId LIMIT 1`. Selecciona solo las columnas del tipo.
  - `requireAuth`, `requireAdmin` y `requireTenant` rellenan `profileId = profile.id`.
  - No se toca `getProfile` ni `getProfileFast`; AC-28 queda en backlog.
  - `invite/accept`:
    - escribe `profileId: profile.id` (nunca `user.id`) y filtra el tenant por `org_id` de la invitación;
    - es idempotente si el tenant ya está vinculado al mismo perfil (200);
    - si está vinculado a otro perfil devuelve 409 `TENANT_ALREADY_LINKED`;
    - mantiene 409 `ALREADY_IN_ORG` solo cuando el perfil está en **otra** org (el caso de usuario nuevo lo resuelve W-05);
    - tiene rate limit por IP con `checkRateLimit` (síncrono existente): 10/min (`invite:accept:<ip>`), 30/min en peek, y devuelve 429 `RATE_LIMITED` con `Retry-After`.
  - La IP sale de `getClientIp(request)` actual. W-18 la cambia de forma global.
  - `scripts/diag/profile-identity.sql`: **solo lectura**, para que el dueño lo ejecute en prod. Consultas:
    1. FK reales: `SELECT conrelid::regclass, conname, confrelid::regclass FROM pg_constraint WHERE contype='f' AND confrelid='profiles'::regclass;`
    2. `SELECT count(*) FROM profiles WHERE id <> user_id;`
    3. Vínculos entre orgs: `SELECT t.id, t.org_id, p.org_id FROM tenants t JOIN profiles p ON p.id=t.profile_id WHERE p.org_id<>t.org_id;`
    4. Huérfanos: `profile_id` sin `profiles.id`, por cada columna listada.
- **Ruta de datos segura (sin borrados):**
  - Si (1) muestra todas las FK presentes, no hace falta migración de datos. Las filas legacy cumplen `id = user_id`, que es válido en ambas lecturas.
  - Si faltan FK y (4) devuelve huérfanos, el dueño aprueba una migración aditiva e idempotente (siguiente número libre). Plantilla por columna:
    ```sql
    UPDATE tenants t SET profile_id = p.id
    FROM profiles p
    WHERE t.profile_id = p.user_id AND p.id <> p.user_id AND p.org_id = t.org_id
      AND NOT EXISTS (SELECT 1 FROM profiles p2 WHERE p2.id = t.profile_id);
    ```
  - Desvincular los vínculos entre orgs de (3) **solo con aprobación del dueño**.
- **Tests:**
  - `makeAuthContext(overrides)` usa por defecto `userId !== profileId`, de modo que cualquier confusión salta en los tests.
  - `tenant-session.test.ts`: encuentra el tenant por `profileId` y org; devuelve null en otra org; devuelve null con `userId`.
  - `invite-accept.test.ts`: escribe `profile.id`; 409 `ALREADY_IN_ORG`; idempotencia; 429; 404 `INVALID_TOKEN`.
- **Verificación:**
  ```
  pnpm exec vitest run tests/unit/auth/tenant-session.test.ts tests/unit/api/invite-accept.test.ts
  ```
- **Dependencias:** ola 1.

### W-05 — Eventos de auth: sesiones, auto-link e invitados nuevos
- **Cubre:** F-05 (SA-3), F-07 (DOC-a), F-08 (DOC-b), F-69 parte de código (SE-14).
- **Archivos:** `src/lib/auth/config.ts`, `src/lib/auth/provision.ts`, `tests/unit/auth/provision-invite.test.ts`, `tests/unit/auth/link-account.test.ts`.
- **Contrato:**
  - `events.linkAccount`: además de anular `passwordHash`, ejecuta `db.delete(sessions).where(eq(sessions.userId, user.id))`. Borra **sesiones**, no datos de negocio; es la corrección pedida por SA-3. Envolverlo en `withDbRetry`.
  - Quitar `access_type: 'offline'` del provider Google (SE-14). Anular los tokens existentes queda a cargo del dueño.
  - Eliminar `attemptAutoLink` y su llamada en `events.createUser` (DOC-a). Para usuarios nuevos nunca funcionó: el perfil admin propio ya existía. La vinculación de tenants ocurre solo por `invite/accept` con token.
  - Nuevo en `provision.ts`:
    ```ts
    export async function provisionFromPendingInvitation(userId: string, email: string): Promise<{ orgId: string; profileId: string } | null>;
    ```
    - Busca invitaciones `status='pending' AND expires_at > now()` cuyo email coincide (minúsculas).
    - Si hay **exactamente una**, inserta un perfil `role='tenant'` en la org de esa invitación (`onConflictDoNothing` sobre `user_id`) y lo devuelve.
    - Si hay 0, o más de 1 (ambiguo), devuelve null y registra `log.warn('invite.ambiguous', { count })` sin el email.
    - No modifica la invitación: la consume `invite/accept`.
  - `events.createUser` sigue este orden: `getExistingProfile`, luego allowlist (`attachToPrimaryOrgAsAdmin`), luego `provisionFromPendingInvitation` (solo si el email viene verificado por Google), y por último `provisionOrgAndProfile`.
- **Tests:**
  - `linkAccount` borra las sesiones del usuario y anula el hash.
  - Usuario Google nuevo con 1 invitación queda como perfil tenant en la org de la invitación, y después accept devuelve 200 (mock de DB).
  - Con 2 invitaciones se crea org propia.
  - Ya no existe `attemptAutoLink`.
- **Verificación:**
  ```
  pnpm exec vitest run tests/unit/auth/provision-invite.test.ts tests/unit/auth/link-account.test.ts
  ```
- **Dependencias:** ola 1. No depende de W-04 en código; el contrato de accept está fijado arriba.

### W-06 — Migraciones: índices, dedupe de recordatorios, rate limits y motivo de rechazo
- **Cubre:** F-39 (DB-1), F-16 parte de esquema (SR-4), F-24 parte de esquema (tabla `rate_limits`), F-32 parte de esquema (`payments.rejection_reason`).
- **Archivos:**
  - `src/lib/db/schema.ts`
  - `src/lib/db/migrations/0013_perf_indexes.sql`
  - `src/lib/db/migrations/0014_reminders_dedupe.sql`
  - `src/lib/db/migrations/0015_rate_limits.sql`
  - `src/lib/db/migrations/0016_payments_rejection_reason.sql`
  - `tests/integration/sql-smoke/migrations-0013-0016.test.ts`
- **Contrato:**
  - `0013`: copiar los 9 `CREATE INDEX IF NOT EXISTS` de DB-1 (`sec-db-sre.md`) **sin** `CONCURRENTLY`.
  - `0014`: primero, verificar que el CHECK de `reminders.status` en `0000_baseline.sql` admite `'skipped'`. Si no lo admite, escalar.
    ```sql
    WITH ranked AS (
      SELECT id, row_number() OVER (
        PARTITION BY org_id, type, target_type, target_id, scheduled_for
        ORDER BY (status = 'sent') DESC, created_at, id) AS rn
      FROM reminders WHERE status IN ('scheduled','sent'))
    UPDATE reminders r SET status = 'skipped', error = coalesce(r.error, 'dedupe:0014'), updated_at = now()
    FROM ranked WHERE r.id = ranked.id AND ranked.rn > 1;
    CREATE UNIQUE INDEX IF NOT EXISTS reminders_dedupe_uidx
      ON reminders (org_id, type, target_type, target_id, scheduled_for)
      WHERE status IN ('scheduled','sent');
    ```
  - `0015`:
    ```sql
    CREATE TABLE IF NOT EXISTS rate_limits (
      key text NOT NULL,
      window_start timestamptz NOT NULL,
      count integer NOT NULL DEFAULT 0,
      expires_at timestamptz NOT NULL,
      PRIMARY KEY (key, window_start));
    CREATE INDEX IF NOT EXISTS rate_limits_expires_idx ON rate_limits (expires_at);
    ```
  - `0016`: `ALTER TABLE payments ADD COLUMN IF NOT EXISTS rejection_reason text;`
  - `schema.ts`:
    - Refleja los índices, `rateLimits` y `rejectionReason`.
    - Corrige la declaración de `payments_org_external_id_uidx` para que coincida con el índice parcial real (añadir `.where(...)` según la migración, SR / ER-1).
    - No borra nada.
- **Tests (PGlite, `tests/integration/sql-smoke/setup.ts`):**
  - Aplicar 0000…0016 dos veces: debe ser idempotente.
  - Duplicados `scheduled` quedan un `scheduled` y el resto `skipped`.
  - Un segundo INSERT `scheduled` con la misma clave viola el índice.
  - Upsert en `rate_limits`.
  - Existe `rejection_reason`.
- **Verificación:**
  ```
  pnpm exec vitest run tests/integration/sql-smoke/migrations-0013-0016.test.ts && pnpm build
  ```
- **Dependencias:** ola 1. Coordinar la numeración con el worktree de SA-1.

### W-07 — `requireCronAuth`
- **Cubre:** F-74 (SE-23 = AC-26), QA-11.
- **Archivos:**
  - `src/lib/auth/cron.ts` (nuevo)
  - `src/app/api/cron/{reminders,task-reminders,weekly-summary,agent-dispatch,lead-alerts,qa-export,voice-reactivation}/route.ts`
  - `tests/unit/auth/cron-auth.test.ts`
  - Nota: 9 archivos, pero el cambio en cada ruta es de 2 líneas.
- **Contrato:**
  ```ts
  export function requireCronAuth(request: Request): NextResponse | null;
  ```
  - Devuelve null si el bearer es válido.
  - Devuelve 503 `{error:{code:'CRON_DISABLED'}}` si `CRON_SECRET` no está definido.
  - Devuelve 401 `{error:{code:'UNAUTHORIZED'}}` si el bearer falta o no coincide.
  - Compara `sha256(provided)` con `sha256(secret)` usando `timingSafeEqual`, para que la longitud no filtre información.
  - Cada ruta empieza con `const denied = requireCronAuth(request); if (denied) return denied;`.
  - `airtable-sync` no se toca aquí (lo posee el worktree de SA-1; ver W-41).
- **Tests:** 503 sin secreto, 401 si falta, 401 si es incorrecto (también con distinta longitud), null si es correcto. Una prueba por ruta de que 401 corta antes de tocar la DB (QA-11).
- **Verificación:**
  ```
  pnpm exec vitest run tests/unit/auth/cron-auth.test.ts tests/unit/api/cron
  ```
- **Dependencias:** ola 1.

### W-08 — Timeout en el cliente Anthropic
- **Cubre:** F-14 (SR-2, AC-31) en 4 sitios.
- **Archivos:**
  - `src/lib/ai/client.ts`
  - `src/app/api/ai/executive-brief/route.ts` (o la ruta real del `new Anthropic` en la línea 237)
  - `src/lib/receipts/run-ocr.ts` (ruta real del `run-ocr.ts:34`)
  - `src/lib/tasks/task-proof.ts` (ruta real del `task-proof.ts:91`)
  - `tests/unit/ai/client.test.ts`
- **Contrato:**
  - `getAnthropicClient()` conserva el nombre y la firma y construye el cliente con `{ timeout: 30_000, maxRetries: 2 }`. `resetAnthropicClient()` no cambia.
  - Los 3 sitios dejan `new Anthropic(...)` y usan `getAnthropicClient()`.
  - Los otros 3 sitios (`classify.ts`, `ai/chat`, `receipts/ocr`) los migran W-19, W-28 y W-27.
- **Tests:** opciones del constructor (mock de `@anthropic-ai/sdk`); el singleton se reutiliza.
- **Verificación:**
  ```
  pnpm exec vitest run tests/unit/ai/client.test.ts
  ```
  Y `rg "new Anthropic\(" src` solo devuelve `client.ts`, `classify.ts`, `ai/chat/route.ts` y `receipts/ocr/route.ts`.
- **Dependencias:** ola 1.

### W-09 — Timeouts en S3, Resend y OG
- **Cubre:** F-51 (SR-7), F-14 parcial.
- **Archivos:** `src/lib/storage/index.ts`, `src/lib/notifications/email.ts`, `src/app/opengraph-image.tsx` (fetch externo, si existe), `tests/unit/storage/timeouts.test.ts`.
- **Contrato:**
  - `S3Client` con `requestHandler: new NodeHttpHandler({ connectionTimeout: 5_000, requestTimeout: 30_000 })` y `maxAttempts: 3`.
  - Resend: `AbortSignal.timeout(10_000)` si el SDK lo admite; si no, `Promise.race` con un error `EMAIL_TIMEOUT`.
  - Todo `fetch` en `opengraph-image.tsx` lleva `signal: AbortSignal.timeout(5_000)` y un fallback estático.
  - Las firmas públicas no cambian.
- **Tests:** la configuración del handler; email con timeout lanza o registra el error sin colgarse.
- **Verificación:**
  ```
  pnpm exec vitest run tests/unit/storage/timeouts.test.ts
  ```
- **Dependencias:** ola 1.

### W-10 — Endurecer el proxy y añadir request id
- **Cubre:** F-26 (PT-3), F-65 parte de código (SE-16: `x-nonce` en la respuesta, `img-src https:`), F-73 (SE-22 = DOC-d), F-47 (ER-4).
- **Archivos:** `src/proxy.ts`, `src/lib/request-id.ts` (nuevo), `src/lib/log.ts` (solo añade el campo `requestId` opcional), `tests/unit/proxy.test.ts`.
- **Contrato:**
  - Guard de host: si `x-forwarded-host` está presente y no pertenece al conjunto permitido, devolver 400 `{error:{code:'BAD_HOST'}}`.
    - Conjunto permitido: host de `NEXT_PUBLIC_SITE_URL`, más el host de `AUTH_URL` si existe, más `localhost:3000` fuera de producción.
  - `x-nonce` se pasa solo en las **cabeceras de la request** reenviadas, nunca en la respuesta.
  - `img-src 'self' data: blob:` más los orígenes concretos que realmente se usan (bucket Tigris, `lh3.googleusercontent.com`). Hacer `rg "https://" src --glob "*.tsx"` antes de cerrar la lista.
  - Eliminar el bloque de rol muerto (`proxy.ts:133-153`) y `user = { app_metadata: {} }` (79), sin cambiar las redirecciones vigentes.
  - `request-id.ts`:
    ```ts
    export const REQUEST_ID_HEADER = 'x-request-id';
    export function getRequestId(h: Headers): string; // fly-request-id || x-request-id || crypto.randomUUID()
    ```
    El proxy fija `x-request-id` en la request y en la respuesta.
- **Tests:** host extraño devuelve 400; host permitido pasa; la respuesta no lleva `x-nonce`; la CSP no contiene `img-src https:`; `x-request-id` existe y se propaga desde `fly-request-id`.
- **Verificación:**
  ```
  pnpm exec vitest run tests/unit/proxy.test.ts
  ```
  Y `pnpm build && pnpm start`: `curl -I -H "X-Forwarded-Host: evil.example" http://localhost:3000/` devuelve 400.
- **Dependencias:** ola 1.

### W-11 — Error boundaries
- **Cubre:** F-52 (DOC-e). Única fuente de claves i18n de la ola 2.
- **Archivos:** `src/app/error.tsx`, `src/app/global-error.tsx`, `src/app/dashboard/error.tsx`, `src/app/portal/error.tsx`, `src/messages/{en,es,pt}.json`.
- **Contrato:**
  - Leer primero la guía de error handling en `node_modules/next/dist/docs/` (en Next 16 la prop de reintento puede llamarse `unstable_retry` o `reset`; usar la documentada).
  - Componentes `'use client'`. Muestran un mensaje genérico i18n y `error.digest` como "código de referencia". Nunca muestran `error.message`.
  - Tienen un botón de reintento y un enlace al inicio de su sección.
  - `global-error.tsx` incluye `<html><body>` y no depende de providers.
  - Claves nuevas (en, es, pt): `errorBoundary.title`, `errorBoundary.description`, `errorBoundary.reference`, `errorBoundary.retry`, `errorBoundary.home`, `a11y.skipToContent`, `a11y.closeDialog`.
- **Tests:** render de `error.tsx` con un error de mensaje sensible: no aparece el mensaje y sí el digest. Test de paridad de claves en los 3 JSON, si no existe ya.
- **Verificación:**
  ```
  pnpm exec vitest run tests/unit/app/error-boundary.test.tsx && pnpm build
  ```
- **Dependencias:** ola 1.

### W-12 — Redirecciones seguras
- **Cubre:** F-57 (PT-8 = DOC-c), F-55 (PT-6).
- **Archivos:** `src/lib/auth/safe-path.ts` (nuevo), `src/app/auth/callback/page.tsx`, `src/app/api/calendar/google/connect/route.ts`, `src/app/api/calendar/google/callback/route.ts`, `tests/unit/auth/safe-path.test.ts`.
- **Contrato:**
  ```ts
  export function safeInternalPath(value: string | null | undefined, fallback?: string): string; // default '/dashboard'
  export function siteUrl(path: string): URL; // new URL(safeInternalPath(path), env NEXT_PUBLIC_SITE_URL)
  ```
  - `safeInternalPath` rechaza (devuelve el fallback):
    - lo que no empiece por `/`;
    - `//`;
    - `/\`;
    - cualquier `\`;
    - caracteres de control (`\x00-\x1f`, `\x7f`);
    - lo que, resuelto contra un origen ficticio, cambie de origen.
  - El callback de auth usa este helper. Las rutas de calendario construyen las redirecciones con `siteUrl()`, nunca con `request.url`.
- **Tests:** tabla de casos: `/\evil.example`, `//evil`, `/%5Cevil`, `javascript:`, `/ok?x=1`, tab y CR.
- **Verificación:**
  ```
  pnpm exec vitest run tests/unit/auth/safe-path.test.ts
  ```
- **Dependencias:** ola 1.

### W-13 — Primitivas de UI accesibles
- **Cubre:** A11Y-1, A11Y-3, A11Y-9 (input base), A11Y-13, A11Y-15, A11Y-18. Crea `Modal` para W-35 y W-36.
- **Archivos:** `src/components/ui/Input.tsx`, `src/components/ui/Button.tsx`, `src/components/ui/Tabs.tsx`, `src/components/ui/Badge.tsx`, `src/app/globals.css`, `src/components/ui/Modal.tsx` (nuevo). Tests en `tests/unit/components/ui/`.
- **Contrato:**
  - Input, Textarea y Select reenvían `required` y `aria-required`. El id de respaldo usa `useId()`. El borde es al menos de 3:1 (`border-slate-500`).
  - Badge y tokens de `globals.css` (líneas 18, 20, 24): contraste de al menos 4.5:1 sobre su propio `-bg`, con los valores de A11Y-1.
  - Button: `ring-brand-500` en todas las variantes. Tabs: quitar `focus-visible:outline-none` del panel.
  - Modal:
    ```ts
    export function Modal(props: { open: boolean; onClose: () => void; title: string; titleId?: string; closeLabel: string; initialFocusRef?: React.RefObject<HTMLElement | null>; children: React.ReactNode }): JSX.Element;
    ```
    - Usa `<dialog>` nativo con `showModal()` y `aria-labelledby`.
    - Escape (evento `cancel`) llama a `onClose`.
    - Al cerrar, devuelve el foco al elemento que lo abrió.
    - Sigue el patrón existente de `NewVisitDialog` y `AgentModal`.
    - Los textos llegan por props; no toca i18n.
- **Tests (Testing Library):** `required` llega al DOM; ids únicos con labels iguales; Modal recibe el foco, Escape cierra y el foco vuelve al opener.
- **Verificación:**
  ```
  pnpm exec vitest run tests/unit/components/ui
  ```
- **Dependencias:** ola 1.

### W-14 — Recibos de WhatsApp sin auto-aprobación
- **Cubre:** F-09 (AC-1), F-77 parcial (AC-16 en este handler).
- **Archivos:** `src/lib/events/handlers/whatsapp-receipt.ts`, `tests/unit/events/whatsapp-receipt.test.ts`.
- **Contrato:**
  - El recibo se inserta con estado de revisión (`pending_review` o el valor equivalente que admita el enum de `receipts`; verificar en `schema.ts`).
  - El pago se inserta con `status: 'under_review'`. **Nunca** `approved` ni `approvedBy`, sea cual sea la confianza del OCR.
  - Recibo y pago se insertan en una sola `db.transaction`.
  - Dedupe por `(org_id, message_id)` con `ON CONFLICT DO NOTHING`, usando un índice existente. Si no hay ninguno, deduplicar por un SELECT dentro de la transacción y escalar para crear el índice en una migración futura.
  - Todos los `UPDATE`/`SELECT` por PK incluyen `org_id`.
  - Se registra un evento de auditoría con el log existente (`log.info('receipt.whatsapp.queued', {orgId, paymentId})`).
- **Tests:** con confianza 0.99 queda `under_review`; la falta del org filter se detecta; un reintento no duplica.
- **Verificación:**
  ```
  pnpm exec vitest run tests/unit/events/whatsapp-receipt.test.ts
  ```
- **Dependencias:** ola 1.

### W-15 — Recuperar jobs con lock vencido
- **Cubre:** F-13 (SR-1).
- **Archivos:** `src/lib/agent/jobs.ts`, `src/lib/whatsapp/whatsapp-dispatch.ts`, `src/lib/calendar/sync.ts`, `tests/unit/agent/jobs-reclaim.test.ts`.
- **Contrato:**
  - `claimJobs` selecciona `status='queued' OR (status='processing' AND locked_until < now())`, con `FOR UPDATE SKIP LOCKED`. Fija `locked_until = now() + interval '5 minutes'` e incrementa `attempts`.
  - Con `attempts >= MAX_ATTEMPTS` (5) el job pasa a `failed` con `error='max_attempts'` y no se reclama más.
  - Se exporta `openJobCondition()` (SQL de Drizzle), que reutilizan los dos consumidores en lugar de filtrar solo por `queued`.
  - Sin cambios de esquema (verificar que `attempts` y `locked_until` existen; si falta alguno, escalar a una migración posterior).
- **Tests:** un job `processing` vencido se reclama; uno vigente no; al llegar a `MAX_ATTEMPTS` pasa a `failed`.
- **Verificación:**
  ```
  pnpm exec vitest run tests/unit/agent/jobs-reclaim.test.ts
  ```
- **Dependencias:** ola 1.

### W-16 — Validación del entorno al arrancar
- **Cubre:** F-22 (SA-10 = SE-11), F-48 (ER-5), F-81 parcial (SR-8, guard de solapamiento).
- **Archivos:** `src/lib/env.ts`, `src/instrumentation.ts`, `tests/unit/env.test.ts`.
- **Contrato:**
  - Esquema Zod del entorno de servidor:
    - **requeridos en producción:** `DATABASE_URL`, `AUTH_SECRET`, `NEXT_PUBLIC_SITE_URL`, `ENCRYPTION_KEY` (o el nombre real), `CRON_SECRET`;
    - **opcionales:** Resend, Meta, Anthropic, Airtable, Vapi, Tigris.
  - `export function validateServerEnv(): void` se llama una vez en `register()` de `instrumentation.ts` (solo en runtime nodejs).
    - En producción, si falta un requerido, lanza un error con **solo los nombres** de las variables, nunca valores.
    - En dev y test solo avisa.
  - Los getters perezosos actuales se mantienen (sin cambio de API).
  - `process.on('unhandledRejection'|'uncaughtException')` registra en el log con stack, sin salir del proceso.
  - Los `setInterval` de `instrumentation.ts` llevan un flag `running` para no solaparse.
  - **Antes de desplegar:** el dueño compara `fly secrets list` (solo nombres) con la lista de requeridos.
- **Tests:** un requerido ausente en `production` lanza y el mensaje no incluye valores; en `development` no lanza.
- **Verificación:**
  ```
  pnpm exec vitest run tests/unit/env.test.ts && pnpm build
  ```
- **Dependencias:** ola 1. El despliegue depende de la comprobación de secretos del dueño.

### W-17 — Health profundo, checks de Fly y HSTS del widget
- **Cubre:** F-50 (SR-6), F-58 (PT-9).
- **Archivos:** `src/app/api/health/route.ts`, `fly.toml`, `next.config.ts`, `tests/unit/api/health.test.ts`.
- **Contrato:**
  - `GET /api/health` responde `200 {status:'ok'}` sin tocar la DB.
  - `GET /api/health?deep=1`:
    - ejecuta `SELECT 1` con timeout de 2 s;
    - responde `200 {status:'ok', db:'ok'}` o `503 {status:'degraded', db:'down'}`;
    - no expone detalles del error.
  - `fly.toml`: `[[http_service.checks]]` sobre `/api/health` (no `deep`, para que una DB caída no reinicie la app), `interval = "30s"`, `timeout = "5s"`.
  - `next.config.ts`: `Strict-Transport-Security` también en las rutas del widget.
- **Tests:** deep con DB OK y deep con DB caída (mock).
- **Verificación:**
  ```
  pnpm exec vitest run tests/unit/api/health.test.ts && pnpm build
  ```
- **Dependencias:** ola 1 (W-01 puede haber tocado `next.config.ts`; está en otra ola).

---

## Ola 3 — Correcciones por dominio (requiere W-04 y W-06 fusionados)

Regla de la ola: cada ítem cambia en **sus** archivos `ctx.userId` por `ctx.profileId` cuando el valor va contra una columna de perfil, y usa `getTenantForSession(ctx)` en lugar de buscar el tenant por `profileId = ctx.userId`. `ctx.userId` se mantiene en las claves de rate limit.

### W-18 — Rate limiting de auth persistente y IP fiable
- **Cubre:** F-04 (SA-4 = PT-1, PT-4, SA-13 `signedIp`), F-54 (PT-5), F-63 parcial (SA-17: mínimo 8 en el registro), QA-7, F-24 parcial.
- **Archivos:** `src/lib/ratelimit.ts`, `src/lib/ratelimit-db.ts` (nuevo), `src/app/actions/auth.ts`, `src/app/actions/onboarding.ts`, `src/app/api/sign/[token]/route.ts`. Tests: `tests/unit/ratelimit-db.test.ts`, `tests/unit/actions/auth-ratelimit.test.ts`.
- **Contrato:**
  ```ts
  // ratelimit.ts
  export function getClientIpFromHeaders(h: Headers): string; // fly-client-ip → LAST x-forwarded-for entry → 'unknown'
  // getClientIp(request) se reimplementa como getClientIpFromHeaders(request.headers)
  // ratelimit-db.ts
  export async function consumeRateLimit(key: string, limit: number, windowMs: number): Promise<{ success: boolean; retryAfterMs: number }>;
  export async function peekRateLimit(key: string, limit: number, windowMs: number): Promise<{ success: boolean; retryAfterMs: number }>;
  ```
  - `consumeRateLimit` es una sola sentencia:
    `INSERT ... (key, date_bin(window, now(), epoch), 1, window_start+window) ON CONFLICT (key, window_start) DO UPDATE SET count = rate_limits.count+1 RETURNING count`.
    `success = count <= limit`.
  - Si la DB falla, recurre a `checkRateLimit` en memoria (fail-safe; nunca fail-open sin límite) y lo registra en el log.
  - Login con contraseña:
    - antes de verificar: `consumeRateLimit('auth:ip:'+ip, 10, 60_000)` y `peekRateLimit('auth:email:'+normalizedEmail, 5, 15*60_000)`;
    - si la contraseña falla: `consumeRateLimit('auth:email:'+email, 5, 15*60_000)`;
    - si se excede, el error es genérico `RATE_LIMITED` (el mismo texto haya o no cuenta);
    - `normalizedEmail = email.trim().toLowerCase()`.
  - Registro: `password` con `min(8).max(128)`. Login: `min(1).max(128)`, para no bloquear a usuarios legacy con 6-7 caracteres.
  - Las 6 lecturas de `x-forwarded-for` (`auth.ts:56,101,144,205`, `onboarding.ts:40`, `sign/[token]/route.ts:113`) pasan a `getClientIpFromHeaders(await headers())` o `getClientIp(request)`. El `signedIp` de la firma usa el mismo helper.
  - `sign/[token]`: el token se valida con `z.string().uuid()`. Si no es válido devuelve 404 `{error:{code:'NOT_FOUND'}}`, no 500 (PT-5).
- **Tests:**
  - XFF falsificado (`1.2.3.4, <real>`) produce la IP `<real>`.
  - 11 intentos por IP dan `RATE_LIMITED`.
  - 6 fallos por email bloquean aunque la IP cambie.
  - Fallback a memoria cuando la DB lanza.
  - El registro con 7 caracteres falla y el login con 7 caracteres llega a la verificación.
  - Un token no UUID devuelve 404.
- **Verificación:**
  ```
  pnpm exec vitest run tests/unit/ratelimit-db.test.ts tests/unit/actions/auth-ratelimit.test.ts tests/unit/api/sign
  ```
- **Dependencias:** W-06 (tabla `rate_limits`).

### W-19 — Webhook de WhatsApp: dedupe primero, sin rama mock en prod
- **Cubre:** F-15 (SR-3 = AC-6), F-31 (SE-10 = AC-3 + AC-23), F-56 (PT-7), AC-32, F-14 parcial (`classify.ts`).
- **Archivos:** `src/app/api/whatsapp/webhook/route.ts`, `src/lib/whatsapp/ingest.ts` (nuevo), `src/lib/whatsapp/db.ts`, `src/lib/whatsapp/classify.ts`, `src/lib/whatsapp/index.ts`. Tests: `tests/unit/whatsapp/ingest.test.ts`, `tests/unit/api/whatsapp-webhook.test.ts`.
- **Contrato:**
  ```ts
  export async function ingestInboundMessage(msg: NormalizedInbound): Promise<'duplicate' | 'queued'>;
  ```
  - Pasos:
    1. `INSERT` del mensaje con `ON CONFLICT (provider_message_id) DO NOTHING RETURNING id`. Si no devuelve fila, termina con `'duplicate'`.
    2. Descarga de media, clasificación y turno del agente, vía `after()` de Next o encolando un job (lo que ya use el código). Nunca dentro del request síncrono.
  - El webhook itera los mensajes con `try/catch` por mensaje y responde 200 aunque uno falle (lo registra con request id).
  - Sin `META_APP_SECRET` en producción responde `404` (no 503, PT-7).
  - La rama mock solo existe si `NODE_ENV !== 'production'` **o** `WHATSAPP_MOCK_ENABLED === 'true'`; si no, 404.
  - La rama mock exige `orgId` explícito; se quita "primera org".
  - `classify.ts` usa `getAnthropicClient()`.
  - `index.ts` añade el proveedor `'disabled'`, que se usa cuando faltan las credenciales Meta y no hace llamadas.
- **Tests:**
  - Un reintento con el mismo `message_id` no llama ni a la descarga ni al LLM.
  - Un mensaje que lanza no tumba el lote.
  - En producción el mock da 404.
  - Sin `META_APP_SECRET` da 404.
  - La firma inválida da 401.
- **Verificación:**
  ```
  pnpm exec vitest run tests/unit/whatsapp/ingest.test.ts tests/unit/api/whatsapp-webhook.test.ts
  ```
- **Dependencias:** W-04 (contexto) y W-08 (`getAnthropicClient` con timeout).

### W-20 — Reintentos de DB solo en errores transitorios y purga de jobs
- **Cubre:** F-18 (SR-5), F-42 (DB-4).
- **Archivos:** `src/lib/db/retry.ts`, `src/lib/maintenance/purge.ts` (nuevo), y las rutas `src/app/api/cron/{agent-dispatch,lead-alerts,voice-reactivation,qa-export}/route.ts`. Test: `tests/unit/db/retry.test.ts`.
- **Contrato:**
  ```ts
  export function isRetryableDbError(err: unknown): boolean; // CONNECTION_CLOSED, ECONNRESET, ETIMEDOUT, 57P01, SQLSTATE class '08', /no active leader/i
  ```
  - `withDbRetry` solo reintenta si `isRetryableDbError(err)` es true.
  - En los 4 crons, `withDbRetry` envuelve **solo** las lecturas y los claims de DB, nunca el bucle que envía WhatsApp o llama a Vapi.
  - Purga:
    ```ts
    export async function purgeFinishedJobs(olderThanDays = 30): Promise<number>;
    export async function purgeExpiredRateLimits(): Promise<number>;
    ```
    - `purgeFinishedJobs` borra `agent_jobs` con `status IN ('done','failed')` y `updated_at < now() - N días`, en lotes de 1000.
    - `purgeExpiredRateLimits` borra `rate_limits WHERE expires_at < now()`.
    - Las llama `agent-dispatch` una vez por ejecución, con un fallo aislado.
  - Purgar jobs terminados de más de 30 días **borra filas**. Es retención operativa propuesta por DB-4, no datos de negocio, pero el dueño debe aprobar el umbral antes del deploy (se anota en el PR).
- **Tests:** tabla de errores retryable y no retryable; un error de negocio no se reintenta; la purga respeta el umbral.
- **Verificación:**
  ```
  pnpm exec vitest run tests/unit/db/retry.test.ts tests/unit/maintenance
  ```
- **Dependencias:** W-06 (tabla `rate_limits`) y W-07 (ya tocó estas rutas).

### W-21 — Recordatorios: reclamar antes de enviar
- **Cubre:** F-16 (SR-4), F-40 (DB-2), F-49 (ER-6).
- **Archivos:** `src/lib/notifications/reminder-engine.ts`, `src/app/api/cron/task-reminders/route.ts`. Tests: `tests/unit/notifications/reminder-claim.test.ts`, `tests/unit/api/task-reminders.test.ts`.
- **Contrato:**
  - Recordatorios: `INSERT INTO reminders (... status='scheduled') ON CONFLICT (org_id,type,target_type,target_id,scheduled_for) WHERE status IN ('scheduled','sent') DO NOTHING RETURNING id`.
    - Solo se envía si devolvió fila.
    - Después se hace `UPDATE status='sent'`, o `status='failed', error=<code>` (el `failed` sale del índice y permite reintentar).
  - Los candidatos se cargan en lote: una query con joins y `inArray`, sin query por candidato (DB-2).
  - `task-reminders`: `UPDATE tenant_tasks SET reminder_sent_at = now() WHERE id = $1 AND reminder_sent_at IS NULL RETURNING id`. Solo se envía si devolvió fila. Si el envío falla, `reminder_sent_at` vuelve a NULL.
  - Los `.catch(() => null)` pasan a `.catch((e) => { log.error(...); return null; })`.
  - La cadencia no cambia (decisión del dueño; ver el informe §3.11).
- **Tests:** dos ejecuciones concurrentes (Promise.all) producen un solo envío; un fallo deja `failed` y permite reintentar; el número de queries no crece con N candidatos.
- **Verificación:**
  ```
  pnpm exec vitest run tests/unit/notifications/reminder-claim.test.ts tests/unit/api/task-reminders.test.ts
  ```
- **Dependencias:** W-06 (índice `reminders_dedupe_uidx`) y W-07.

### W-22 — `transitionPayment`
- **Cubre:** F-32 (AC-4 = AC-36), QA-4, QA-5, AC-2 en `actions/payments.ts`, F-61 parcial (rate limit de mutación).
- **Archivos:** `src/lib/payments/transition.ts` (nuevo), `src/app/api/admin/payments/[paymentId]/approve/route.ts`, `src/app/api/admin/payments/[paymentId]/reject/route.ts`, `src/app/actions/payments.ts`, `tests/unit/payments/transition.test.ts`.
- **Contrato:**
  ```ts
  export type TransitionResult = { ok: true; id: string } | { ok: false; code: 'NOT_FOUND' | 'INVALID_STATE' };
  export async function transitionPayment(input: { orgId: string; paymentId: string; to: 'approved' | 'rejected'; actorProfileId: string; reason?: string }): Promise<TransitionResult>;
  ```
  - Es un solo `UPDATE payments SET status=$to, approved_by=$actor (si approved), approved_at=now() (si existe), rejection_reason=$reason (si rejected) WHERE id=$id AND org_id=$org AND status IN ('pending','under_review') RETURNING id`.
  - Si no devuelve fila, un `SELECT` de existencia decide entre `NOT_FOUND` e `INVALID_STATE`.
  - **No** sobrescribe `reference`.
  - Rutas: `requireAdmin` y Zod. Para reject, `reason` es `z.string().trim().min(1).max(500)`.
  - Mapeo de respuestas:
    - éxito: 200 `{id}`;
    - `NOT_FOUND`: 404;
    - `INVALID_STATE`: 409 `{error:{code:'INVALID_STATE'}}`;
    - Zod: 400 `{error:{code:'VALIDATION_ERROR'}}` (sin `flatten`).
  - `actorProfileId = ctx.profileId`.
  - `mutationRateLimit` por `ctx.userId`.
- **Tests:**
  - Transiciones válidas.
  - Aprobar algo `rejected` da 409; aprobar dos veces da 409 la segunda.
  - Otra org da 404.
  - `approved_by` es `profileId`, no `userId`.
  - `reference` queda intacto.
  - Tenant da 403 y anónimo da 401 (QA-4, QA-5).
- **Verificación:**
  ```
  pnpm exec vitest run tests/unit/payments/transition.test.ts tests/unit/api/admin-payments
  ```
- **Dependencias:** W-04 y W-06 (`rejection_reason`).

### W-23 — Importación de pagos
- **Cubre:** F-17 (ER-1), F-41 parcial (DB-3, pagos), AC-2 en `tenant/payments/import`.
- **Archivos:** `src/lib/payments/import-rows.ts` (nuevo), `src/app/api/admin/payments/import/route.ts`, `src/app/api/tenant/payments/import/route.ts`, `tests/unit/payments/import-rows.test.ts`.
- **Contrato:**
  ```ts
  export async function insertImportedPayments(input: { orgId: string; importLogId: string; actorProfileId: string; rows: ImportPaymentRow[] }): Promise<{ inserted: number; skipped: number; errors: { row: number; code: string }[] }>;
  ```
  - Usa solo columnas que existen en `schema.ts`.
  - Resuelve `contract_id` de todas las filas en una query (`inArray` por unidad o tenant); una fila sin contrato va a `errors` con `NO_CONTRACT`.
  - Inserta en lote dentro de `db.transaction`, con `ON CONFLICT (org_id, external_id) WHERE <predicado real del índice> DO NOTHING`.
  - `import_logs.status` se fija en un `finally` (`completed`, `partial` o `failed`).
  - No hay `catch` vacíos: los errores se registran con el request id y al cliente le llega un `code`.
  - Las dos rutas solo parsean (Zod), llaman al helper y responden.
- **Tests:** columnas válidas (PGlite o mock tipado); sin contrato; reimportación idempotente; un fallo deja el log en `failed`.
- **Verificación:**
  ```
  pnpm exec vitest run tests/unit/payments/import-rows.test.ts
  ```
- **Dependencias:** W-04, W-06 (índice parcial reflejado) y W-10 (`getRequestId`).

### W-24 — Lectura de pagos del tenant
- **Cubre:** F-36 (AC-11), QA-15, AC-2.
- **Archivos:** `src/app/api/tenant/payments/route.ts`, `tests/unit/api/tenant-payments.test.ts`.
- **Contrato:**
  - Tenant vía `getTenantForSession`.
  - Join correcto `units.property_id = properties.id`.
  - `status` se valida con `z.enum([...])`.
  - El DTO no incluye `orgId`.
  - Paginación con `limit` máximo de 100.
  - Errores: 400 `VALIDATION_ERROR` sin detalle; 404 si no hay tenant.
- **Tests:** solo ve sus pagos; status inválido da 400; el DTO no tiene `orgId`; 401 y 403.
- **Verificación:**
  ```
  pnpm exec vitest run tests/unit/api/tenant-payments.test.ts
  ```
- **Dependencias:** W-04.

### W-25 — Visitas: propiedad del registro
- **Cubre:** F-19 (SA-7 = AC-8 = BUG-1), QA-1, F-75 parcial (AC-14 en `visitors.ts:113`), AC-2.
- **Archivos:** `src/app/actions/visitors.ts`, `tests/unit/actions/visitors.test.ts`.
- **Contrato:**
  - Para un tenant, el update y el delete exigen `WHERE id AND org_id AND tenant_id = sessionTenant.id`; los admins solo filtran por org.
  - Sin filas devuelve `{ error: 'NOT_FOUND' }`.
  - `.set()` recibe un objeto camelCase explícito validado con Zod, sin spread.
- **Tests:** tenant A editando la visita de B da `NOT_FOUND` y la fila queda intacta (QA-1); el admin puede editar.
- **Verificación:**
  ```
  pnpm exec vitest run tests/unit/actions/visitors.test.ts
  ```
- **Dependencias:** W-04.

### W-26 — Incidencias: comentarios y creación
- **Cubre:** F-20 parte (SA-8 comentario = BUG-3), F-60 (SA-14), QA-3, F-61 parcial, AC-2.
- **Archivos:** `src/app/actions/incidents.ts`, `tests/unit/actions/incidents.test.ts`.
- **Contrato:**
  - Para comentar, un tenant necesita que `incident.tenant_id = sessionTenant.id`. Si no se cumple, `NOT_FOUND`.
  - `createIncident` verifica en una query que `unitId`, `propertyId` y `tenantId` pertenecen a `ctx.orgId` (y, si es tenant, a su unidad).
  - `authorId` y `createdBy` usan `ctx.profileId`.
  - `mutationRateLimit` en crear y comentar.
- **Tests:** comentario cruzado da `NOT_FOUND` (QA-3); ids de otra org son rechazados; `authorId` es `profileId`.
- **Verificación:**
  ```
  pnpm exec vitest run tests/unit/actions/incidents.test.ts
  ```
- **Dependencias:** W-04.

### W-27 — Fotos, avatares y OCR de recibos
- **Cubre:** F-20 parte (BUG-2), QA-2, QA-9, F-14 parcial (`receipts/ocr`).
- **Archivos:** `src/app/api/incident-photo/route.ts`, `src/app/api/tenant-avatar/route.ts`, `src/app/api/receipts/ocr/route.ts`, `tests/unit/api/tenant-assets.test.ts`.
- **Contrato:**
  - Para un tenant, la foto solo es accesible si la incidencia es suya.
  - Un tenant solo ve su propio avatar; los admins ven los de su org.
  - OCR: el recibo debe pertenecer al tenant (admin: a su org) **antes** de llamar al LLM.
  - Todo caso no autorizado da 404 (no 403, para no confirmar existencia).
  - OCR usa `getAnthropicClient()`.
- **Tests:** acceso cruzado da 404 en las 3 rutas; el LLM no se llama en el caso cruzado (QA-2, QA-9).
- **Verificación:**
  ```
  pnpm exec vitest run tests/unit/api/tenant-assets.test.ts
  ```
- **Dependencias:** W-04 y W-08.

### W-28 — Asistente IA solo para admins
- **Cubre:** F-21 (SA-9), AC-2 en `ai/chat`, F-14 parcial.
- **Archivos:** `src/app/api/ai/chat/route.ts`, `src/lib/ai/assistant.ts`, `tests/unit/api/ai-chat.test.ts`.
- **Contrato:**
  - `requireAdmin()`. Verificado que solo lo usan `AnalystChat` y `AiAssistantClient` del dashboard.
  - Un tenant recibe 403 `FORBIDDEN`.
  - `ai_chat_messages.profile_id = ctx.profileId`.
  - Usa `getAnthropicClient()`.
  - El contexto financiero se arma solo con `ctx.orgId`.
- **Tests:** tenant da 403; admin da 200; `profile_id` es `profileId`.
- **Verificación:**
  ```
  pnpm exec vitest run tests/unit/api/ai-chat.test.ts
  ```
- **Dependencias:** W-04 y W-08.

### W-29 — PDF de contratos e imagen de unidad
- **Cubre:** QA-6 y AC-2.
- **Archivos:** `src/app/api/contracts/[id]/pdf/route.ts`, `src/app/api/unit-image/route.ts`, `tests/unit/api/contract-pdf.test.ts`.
- **Contrato:** un tenant solo accede al PDF de su contrato y a las imágenes de su unidad, vía `getTenantForSession`. El acceso cruzado da 404.
- **Tests:** propio da 200; ajeno da 404; anónimo da 401 (QA-6).
- **Verificación:**
  ```
  pnpm exec vitest run tests/unit/api/contract-pdf.test.ts
  ```
- **Dependencias:** W-04.

### W-30 — Portal (A): AC-2 en páginas
- **Cubre:** AC-2 (lecturas del portal).
- **Archivos:** `src/app/portal/page.tsx`, `src/app/portal/tasks/page.tsx`, `src/app/portal/contract/page.tsx`, `src/app/portal/incidents/page.tsx`, `src/app/portal/announcements/page.tsx`, `src/app/api/portal/notifications/unread-count/route.ts`.
- **Contrato:** el tenant sale de `getTenantForSession(ctx)`; `notification_inbox.profile_id = ctx.profileId`. Sin otros cambios.
- **Tests:** `tests/unit/api/unread-count.test.ts` con `makeAuthContext` (`userId !== profileId`).
- **Verificación:**
  ```
  pnpm exec vitest run tests/unit/api/unread-count.test.ts && pnpm build
  ```
- **Dependencias:** W-04.

### W-31 — Portal (B): AC-2 en páginas y resúmenes
- **Cubre:** AC-2.
- **Archivos:** `src/app/portal/profile/page.tsx`, `src/app/portal/notifications/page.tsx`, `src/app/api/tenant/payments/summary/route.ts`, `src/app/api/tenant/payments/movements/route.ts`, `tests/unit/api/tenant-payments-summary.test.ts`.
- **Contrato:** igual que W-30. Las rutas de summary y movements validan sus query params con Zod, sin detalle en la respuesta.
- **Verificación:**
  ```
  pnpm exec vitest run tests/unit/api/tenant-payments-summary.test.ts
  ```
- **Dependencias:** W-04.

### W-32 — Sanciones
- **Cubre:** QA-8 y AC-2.
- **Archivos:** `src/app/actions/sanctions.ts`, `src/app/portal/sanctions/page.tsx`, `tests/unit/actions/sanctions.test.ts`.
- **Contrato:** crear y anular sanciones es solo para admins. Un tenant solo ve las suyas (`getTenantForSession`). `createdBy = ctx.profileId`.
- **Tests:** tenant que crea da 403; ve solo las suyas; otra org da `NOT_FOUND`.
- **Verificación:**
  ```
  pnpm exec vitest run tests/unit/actions/sanctions.test.ts
  ```
- **Dependencias:** W-04.

### W-33 — Acciones de tenants, imágenes de unidad y tareas
- **Cubre:** AC-2 (`tenants.ts` ×4, `unit-images.ts`, `tasks.ts`).
- **Archivos:** `src/app/actions/tenants.ts`, `src/app/actions/unit-images.ts`, `src/app/actions/tasks.ts`, `tests/unit/actions/tasks-profile.test.ts`.
- **Contrato:**
  - `createdBy`, `uploadedBy` y `profileId` pasan a `ctx.profileId`.
  - El vínculo tenant↔perfil desde admin usa el `profiles.id` del usuario destino, resuelto por `user_id` y `org_id`.
- **Tests:** `tenant_tasks.created_by` es `profileId` (con la FK `restrict`, que hoy falla para usuarios nuevos).
- **Verificación:**
  ```
  pnpm exec vitest run tests/unit/actions/tasks-profile.test.ts
  ```
- **Dependencias:** W-04.

### W-34 — Comunidad, ops, bandeja del agente y finanzas
- **Cubre:** AC-2 (`community.ts` ×2, `ops.ts` ×2, `agent-inbox.ts` ×2, `finance.ts`).
- **Archivos:** `src/app/actions/community.ts`, `src/app/actions/ops.ts`, `src/app/actions/agent-inbox.ts`, `src/app/actions/finance.ts`, `tests/unit/actions/profile-fk-writes.test.ts`.
- **Contrato:** las escrituras de autor y creador usan `ctx.profileId`, y las lecturas del tenant usan `getTenantForSession`. AC-14 (spread de updates) queda fuera, salvo en las líneas que ya se tocan.
- **Verificación:**
  ```
  pnpm exec vitest run tests/unit/actions/profile-fk-writes.test.ts
  ```
- **Dependencias:** W-04.

### W-35 — A11Y-5: formularios de creación como diálogo
- **Archivos:** `src/app/dashboard/contracts/CreateContractForm.tsx`, `src/app/dashboard/payments/CreateChargeForm.tsx`, `src/app/dashboard/tenants/CreateTenantForm.tsx`, `src/app/dashboard/units/CreateUnitForm.tsx`, `tests/unit/components/create-forms-dialog.test.tsx`.
- **Contrato:**
  - Reemplazar el `div role="dialog"` por `<Modal>` (W-13): foco inicial en el primer campo, Escape cierra y el foco se restaura.
  - `closeLabel` reutiliza una clave i18n existente o `a11y.closeDialog`.
- **Verificación:**
  ```
  pnpm exec vitest run tests/unit/components/create-forms-dialog.test.tsx
  ```
- **Dependencias:** W-13 y W-11.

### W-36 — A11Y-6, A11Y-12 y A11Y-17: overlays
- **Archivos:** `src/app/dashboard/admin/tenants/TenantCsvImportModal.tsx`, `src/app/portal/payments/CsvImportModal.tsx`, `src/app/dashboard/properties/CreatePropertyFormWrapper.tsx`, `src/components/images/ImagePreviewModal.tsx`, `src/components/i18n/LanguageDropdown.tsx`.
- **Contrato:**
  - Los 3 modales usan `<Modal>` con `aria-labelledby`.
  - `ImagePreviewModal`: foco en el botón de cerrar, trap y restauración del foco (o migrar a `<Modal>`).
  - `LanguageDropdown`: Escape cierra el popup.
  - Limpiar los warnings de lint de `TenantCsvImportModal` y `CsvImportModal`.
- **Tests:** `tests/unit/components/overlays-a11y.test.tsx`.
- **Verificación:**
  ```
  pnpm exec vitest run tests/unit/components/overlays-a11y.test.tsx
  ```
- **Dependencias:** W-13.

### W-37 — A11Y-4 y A11Y-7: admin de tenants y pagos del portal
- **Archivos:** `src/app/dashboard/admin/tenants/page.tsx`, `src/app/dashboard/admin/tenants/[tenantId]/page.tsx`, `src/app/portal/payments/PaymentsClient.tsx`.
- **Contrato:**
  - Labels con `htmlFor`/`id` o `aria-label` en los controles listados en A11Y-4.
  - La fila de la lista de tenants pasa a `ClickableRow` o a un `<Link>` en la celda del nombre.
- **Tests:** `tests/unit/components/admin-tenants-a11y.test.tsx`: todos los controles tienen nombre accesible y la fila es alcanzable por teclado.
- **Verificación:**
  ```
  pnpm exec vitest run tests/unit/components/admin-tenants-a11y.test.tsx
  ```
- **Dependencias:** W-03 (ya fusionado).

### W-38 — A11Y-4 y A11Y-11: mensajería, visitas y ajustes del agente
- **Archivos:** `src/app/dashboard/agent/inbox/_components/ManualReplyForm.tsx`, `src/app/dashboard/whatsapp/_components/SendMessageForm.tsx`, `src/app/dashboard/visits/NewVisitDialog.tsx`, `src/app/dashboard/agent/settings/_components/HoursTab.tsx`, `src/app/dashboard/agent/settings/_components/VoiceTab.tsx`.
- **Contrato:** nombre accesible en cada control. Los errores de server action llevan `<p role="alert">`.
- **Tests:** `tests/unit/components/forms-a11y.test.tsx`.
- **Verificación:**
  ```
  pnpm exec vitest run tests/unit/components/forms-a11y.test.tsx
  ```
- **Dependencias:** ninguna más allá de la ola 2.

### W-39 — A11Y-4: disponibilidad y etapas
- **Archivos:** `src/app/dashboard/visits/availability/AvailabilityClient.tsx`, `src/app/dashboard/leads/StageSettingsDialog.tsx`.
- **Contrato:** los controles de A11Y-4 (`AvailabilityClient.tsx:336-400`, `StageSettingsDialog.tsx:84-133`) tienen nombre accesible.
- **Tests:** `tests/unit/components/availability-a11y.test.tsx`.
- **Verificación:**
  ```
  pnpm exec vitest run tests/unit/components/availability-a11y.test.tsx
  ```
- **Dependencias:** ninguna.

### W-40 — A11Y-10: enlace "saltar al contenido"
- **Archivos:** `src/app/dashboard/layout.tsx`, `src/app/portal/layout.tsx`, `src/components/shell/AdminShellClient.tsx`.
- **Contrato:** el primer hijo enfocable es `<a href="#main-content" className="sr-only focus:not-sr-only ...">{t('a11y.skipToContent')}</a>`.
- **Tests:** `tests/unit/components/skip-link.test.tsx`.
- **Verificación:**
  ```
  pnpm exec vitest run tests/unit/components/skip-link.test.tsx
  ```
- **Dependencias:** W-11 (clave i18n).

Comprobación de disjunción en la ola 3:
- `tenants/page.tsx` y `[tenantId]/page.tsx` solo están en W-37.
- `PaymentsClient.tsx` solo está en W-37; `CsvImportModal.tsx` solo en W-36.
- `tenant/payments/route.ts` (W-24), `summary`/`movements` (W-31) e `import` (W-23) son archivos distintos.
- Las rutas cron de W-20 y W-21 son distintas.
- `ratelimit.ts` solo está en W-18.

---

## Ola 4 — Agente, Airtable y deuda media

### W-41 — Seguimiento de Airtable (tras fusionar SA-1 y SA-5)
- **Cubre:** F-45 (ER-2), F-46 (ER-3), F-28 parte de respuesta (SE-7, ER-8), F-41 parcial (DB-3, tenants), F-74 (`airtable-sync`), F-14 parcial (timeouts de Airtable), F-66 parcial. QA-10 como respaldo, si el worktree no lo cubrió.
- **Archivos:** `src/app/api/admin/integrations/airtable/sync/route.ts`, `src/app/api/cron/airtable-sync/route.ts`, `src/app/api/admin/tenants/import/route.ts`, `src/lib/airtable/client.ts`, `src/lib/airtable/write.ts`.
- **Contrato:**
  - Las respuestas devuelven `{ status, counts, requestId }`, sin errores crudos ni UUIDs de otras orgs.
  - El detalle va al log con el request id.
  - `import_logs` guarda un `code`, no `e.message`.
  - El cron usa `requireCronAuth`.
  - El `fetch` de Airtable lleva `AbortSignal.timeout(15_000)` y respeta el 429 con backoff acotado.
  - La importación de tenants inserta en lote dentro de una transacción.
- **Tests:** `tests/unit/airtable/sync-response.test.ts` (sin fuga de errores) y `tests/unit/airtable/client-timeout.test.ts`.
- **Verificación:**
  ```
  pnpm exec vitest run tests/unit/airtable
  ```
- **Dependencias:** SA-1 y SA-5 fusionados, W-07 y W-10. Revisar el diff de SA-1 antes de empezar; si ya cubre algún punto, eliminarlo del ítem.

### W-42 — Herramientas del agente
- **Cubre:** F-33 (AC-5, AC-24), F-78 (AC-17, AC-18).
- **Archivos:** `src/lib/agent/tools/register-owner-lead.ts`, `src/lib/agent/tools/search-listings.ts`, `src/lib/agent/tools/get-listing-details.ts`, `tests/unit/agent/tools.test.ts`.
- **Contrato:**
  - `register-owner-lead` usa siempre el teléfono del **remitente de la conversación**, nunca uno que venga del modelo.
  - Las búsquedas escapan `%`, `_` y `\` en el `ILIKE`.
  - Se aplica la allow-list de listings configurada.
- **Verificación:**
  ```
  pnpm exec vitest run tests/unit/agent/tools.test.ts
  ```
- **Dependencias:** ola 3.

### W-43 — Prompt del agente y presupuesto atómico
- **Cubre:** F-34 (AC-7), F-38 parte (presupuesto, AC-13).
- **Archivos:** `src/lib/agent/prompt.ts`, `src/lib/agent/run-turn.ts`, `tests/unit/agent/prompt.test.ts`.
- **Contrato:**
  - El contenido no confiable (anuncio, `pageContext`, `refCode`) va en un mensaje `user` delimitado, no en el system prompt.
  - Las notas internas no se envían al modelo.
  - El presupuesto diario se reserva con un `UPDATE ... SET used = used + 1 WHERE used < limit RETURNING` (o `consumeRateLimit` con la clave `agent:budget:<org>:<día>`) antes de llamar al LLM.
- **Verificación:**
  ```
  pnpm exec vitest run tests/unit/agent/prompt.test.ts
  ```
- **Dependencias:** W-18 (si usa `consumeRateLimit`).

### W-44 — Webhook de Vapi
- **Cubre:** F-35 (AC-9).
- **Archivos:** `src/app/api/agent/voice/vapi/route.ts`, `src/lib/agent/voice/webhook-handlers.ts`, `tests/unit/agent/vapi-webhook.test.ts`.
- **Contrato:**
  - El límite de tamaño se comprueba con `Content-Length` y una lectura en stream acotada **antes** de parsear.
  - `orgId` se resuelve desde la llamada guardada (`call_id`), nunca desde el body.
  - El secreto se compara con `timingSafeEqual`.
- **Verificación:**
  ```
  pnpm exec vitest run tests/unit/agent/vapi-webhook.test.ts
  ```
- **Dependencias:** ola 3.

### W-45 — Códigos de traspaso web
- **Cubre:** F-37 (AC-12), F-38 parte (tope de códigos), F-77 parcial (AC-16).
- **Archivos:** `src/lib/widget/web-handoff-redeem.ts`, `src/lib/agent/web-handoff-redeem.ts`, `src/lib/widget/handoff-codes.ts`, `src/lib/widget/web-session.ts`, `src/lib/agent/listings.ts`.
- **Contrato:**
  - Canje validado con Zod (sin casts).
  - `consumeRateLimit('handoff:fail:<ip>', 10, 15min)` en cada fallo.
  - El tope de códigos es atómico (`INSERT ... SELECT ... WHERE (SELECT count) < cap` o un claim por contador).
  - Los updates por PK incluyen `org_id`.
- **Tests:** `tests/unit/widget/handoff.test.ts`.
- **Verificación:**
  ```
  pnpm exec vitest run tests/unit/widget/handoff.test.ts
  ```
- **Dependencias:** W-18.

### W-46 — KPIs de pagos y reorden del pipeline
- **Cubre:** F-43 (DB-5), F-44 (DB-6).
- **Archivos:** `src/app/dashboard/payments/page.tsx`, `src/lib/leads-pipeline.ts`, `tests/unit/leads-pipeline-reorder.test.ts`.
- **Contrato:**
  - KPIs con `SUM`/`COUNT ... FILTER` en SQL, en una sola query. Es el mismo criterio que la corrección del PR #50: agregar sobre todas las filas.
  - La tabla está paginada.
  - El reorden es un único `UPDATE ... FROM (VALUES ...)` dentro de una transacción.
- **Verificación:**
  ```
  pnpm exec vitest run tests/unit/leads-pipeline-reorder.test.ts && pnpm build
  ```
- **Dependencias:** ola 3.

### W-47 — Cuotas persistentes de IA y OCR
- **Cubre:** F-24 resto (SA-12 = SE-20 = AC-10 = PT-15).
- **Archivos:** `src/app/api/ai/chat/route.ts`, `src/app/api/receipts/ocr/route.ts`, `src/app/api/ai/executive-brief/route.ts`, `src/lib/tasks/task-proof.ts`, `tests/unit/api/ai-quota.test.ts`.
- **Contrato:**
  - Cuotas de IA por org y por usuario con `consumeRateLimit` (clave `ai:<org>:<día>`, `ai:user:<userId>:<hora>`).
  - Se elimina el bucket `anonymous` compartido: la IA siempre exige sesión.
  - Al superar la cuota, 429 `{error:{code:'RATE_LIMITED'}}` con `Retry-After`.
- **Verificación:**
  ```
  pnpm exec vitest run tests/unit/api/ai-quota.test.ts
  ```
- **Dependencias:** W-18, W-27, W-28 y W-08 (mismos archivos, olas anteriores).

### W-48 — Tests: QA-12, QA-13 y suites tautológicas
- **Archivos:** `tests/integration/cross-tenant.test.ts` (líneas 378-400, 406-430, 501-523), y los archivos de test nuevos que pidan QA-12 y QA-13 según `qa-a11y.md`.
- **Contrato:**
  - Solo tests, sin código fuente.
  - Las suites tautológicas se reescriben para ejercitar la acción o la ruta real con dos orgs. Se reescriben, no se borran ni se marcan `skip`.
- **Verificación:**
  ```
  pnpm exec vitest run tests/integration/cross-tenant.test.ts
  ```
- **Dependencias:** ola 3.

### W-49 — Rate limit en acciones de WhatsApp
- **Cubre:** F-61 parcial (SA-15), QA-14.
- **Archivos:** `src/app/actions/whatsapp.ts`, `tests/unit/actions/whatsapp.test.ts`.
- **Contrato:** `mutationRateLimit` por `ctx.userId` en cada envío. Solo admins.
- **Verificación:**
  ```
  pnpm exec vitest run tests/unit/actions/whatsapp.test.ts
  ```
- **Dependencias:** ola 3.

### W-50 — Allow-list de admins en el entorno
- **Cubre:** F-64 (SA-18 = SE-13).
- **Archivos:** `src/lib/auth/admin-allowlist.ts`, `src/lib/env.ts`, `tests/unit/auth/admin-allowlist.test.ts`.
- **Contrato:**
  - `ADMIN_ALLOWLIST` (emails separados por coma, normalizados) y `PRIMARY_OWNER_EMAIL` vienen del entorno.
  - Sin fallback a "org más antigua": si no se encuentra la org del dueño, no se adjunta y se registra en el log.
  - Los emails se eliminan del código.
- **Verificación:**
  ```
  pnpm exec vitest run tests/unit/auth/admin-allowlist.test.ts
  ```
- **Dependencias:** **el dueño define los secretos en Fly antes del deploy**; si no, Kief pierde el acceso de admin en el primer login nuevo.

### W-51 — E2E de invitación y pagos (opcional)
- **Archivos:** `e2e/invite-accept.spec.ts`, `e2e/payments-approve.spec.ts`.
- **Contrato:** usan fixtures y una DB de test. Nunca prod ni emails o WhatsApp reales.
- **Verificación:**
  ```
  pnpm test:e2e -- e2e/invite-accept.spec.ts e2e/payments-approve.spec.ts
  ```
- **Dependencias:** W-04, W-05 y W-22.

---

## Ola 5 — W-52: barrido final de AC-2 y guard estático (solo)
- **Cubre:** el resto de F-06.
- **Archivos:** cualquier sitio que el grep aún encuentre, más `tests/unit/static/profile-identity-guard.test.ts` (nuevo).
- **Contrato:** el test lee `src/**/*.ts(x)` y falla si encuentra el patrón:
  ```
  eq\((tenants|notificationInbox|aiChatMessages)\.profileId, ctx\.userId\)|(approvedBy|authorId|createdBy|profileId|importedBy|uploadedBy): ctx\.userId
  ```
- **Verificación:**
  ```
  pnpm exec vitest run tests/unit/static/profile-identity-guard.test.ts
  ```
  Y `rg` con el mismo patrón no devuelve nada.
- **Dependencias:** olas 3 y 4.

## Ola 6 — W-53: warnings de lint y `pnpm lint` bloqueante (solo)
- **Cubre:** baseline (31 warnings) y F-27 (gate final).
- **Archivos:** los que sigan con warnings tras las olas anteriores (lista en el baseline), más `.github/workflows/ci.yml`.
- **Contrato:**
  - Eliminar variables e imports sin uso y los dos `eslint-disable` sobrantes de `src/lib/db/index.ts`.
  - `<img>` pasa a `next/image` o lleva una justificación tipada.
  - CI ejecuta `pnpm lint` (`--max-warnings=0`) como bloqueante.
- **Verificación:**
  ```
  pnpm lint
  ```
  Termina con exit 0.
- **Dependencias:** olas 1-5.

## Ola 7 — W-54: codemod de contraste (solo)
- **Cubre:** A11Y-2, A11Y-8 y el resto de A11Y-11 (unos 59 `{state.error && <p>}`).
- **Archivos:** unos 111 archivos con `text-slate-400` y las clases de A11Y-8, más los `<p>` de error.
- **Contrato:**
  - Texto: `text-slate-400` pasa a `text-slate-500`; se mantiene solo en elementos decorativos con `aria-hidden`.
  - `green-600` pasa a `green-700`, `amber-500/600` a `amber-700`, `yellow-600` a `yellow-700` y `red-500` (texto) a `red-600`.
  - Se añade `role="alert"` a los `<p>` de error.
  - Es un cambio de clases puro, sin lógica.
- **Verificación:**
  ```
  pnpm build && pnpm test
  ```
  Además, revisión visual de 5 pantallas clave y `rg "text-slate-400" src` solo en elementos con `aria-hidden`.
- **Dependencias:** todas las olas anteriores, porque toca muchos archivos.

---

## Anexo — Trazabilidad de críticos y altos

| Hallazgo | Ítem(s) o estado |
|---|---|
| F-01 SA-1 | En curso (worktree); seguimiento en W-41 |
| F-02 SA-2 = SE-1 | W-01, W-02 |
| F-03 SA-5 | En curso; QA-10 de respaldo en W-41 |
| F-04 SA-4 = PT-1 | W-18 |
| F-05 SA-3 | W-05 |
| F-06 AC-2 = SA-19 = AC-27 | W-04, W-22 … W-34, W-52 |
| F-08 DOC-b | W-05 |
| F-09 AC-1 | W-14 |
| F-10 SE-2 | W-02 |
| F-11 SE-3 | Dueño (informe §3.1) |
| F-12 SE-4 | Dueño (informe §3.1) + `dependabot.yml` en W-02 |
| F-13 SR-1 | W-15 |
| F-14 SR-2 | W-08, W-09, W-19, W-27, W-28, W-41 |
| F-15 SR-3 = AC-6 | W-19 |
| F-16 SR-4 | W-06, W-21 |
| F-17 ER-1 | W-23 |
| F-18 SR-5 | W-20 |
