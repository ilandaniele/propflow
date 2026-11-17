# Informe de seguridad consolidado — propflow

Fecha: 2026-11-17. Rama de referencia: `chore/crear-app-hardening`.

Fuentes (handoffs en `.claude/handoff/`, no versionados):
- `sec-auditor.md` (SA-*).
- `sec-pentest.md` (PT-*).
- `sec-engineer.md` (SE-*).
- `sec-arch-code.md` (AC-*).
- `sec-db-sre.md` (SR-*, DB-*, ER-*).
- `qa-a11y.md` (QA-*, BUG-*, A11Y-*).
- `baseline.md` (lint y cobertura).
- Revisión de documentación (DOC-a … DOC-e).

Plan de corrección: `docs/06-plan-implementacion.md` (los IDs `W-xx` remiten a ese documento).

## Resumen

| Severidad | Hallazgos deduplicados | En curso | Con plan (W-xx) | Solo acción del dueño / bloqueados |
|---|---|---|---|---|
| Crítica | 2 | 1 (F-01) | 1 | 0 |
| Alta | 16 | 1 (F-03) | 13 | 2 (F-11, F-12; F-12 con parte en W-02) |
| Media | 35 | 0 | 31 | 4 (F-23, F-25, F-30, parte de F-24) |
| Baja / Info | 33 | 0 | 17 | 16 en backlog o dueño |

Notas:
- Hay dos hallazgos críticos. El primero es la integración Airtable global (F-01, en curso). El segundo son las dependencias con RCE conocidas (F-02).
- El fallo funcional y de integridad más extendido es F-06: `users.id` frente a `profiles.id`. Rompe el portal y las escrituras con FK para cualquier cuenta creada después de la migración a NextAuth.
- Estados posibles: **Abierto**, **En curso**, **Dueño** (requiere al dueño), **Bloqueado** (depende de algo externo) y **Backlog** (bajo, sin plan inmediato).

## 1. Hallazgos deduplicados

Leyenda: "Fuentes" agrupa los IDs equivalentes con `=` y los relacionados con `+`. Los números de línea son los que reportan las fuentes.

### 1.1 Críticos y altos

| ID | Sev. | Fuentes | Archivo:línea | Descripción | Estado | Plan |
|---|---|---|---|---|---|---|
| F-01 | Crítica | SA-1 | `src/app/api/admin/integrations/airtable/sync/route.ts:39-56`; `src/app/api/cron/airtable-sync/route.ts:87-94,184-200`; `src/lib/airtable/env.ts` | La base Airtable es global: cualquier org recibe los datos del dueño y puede escribir en sus registros reales. | En curso | — (fuera del plan) |
| F-02 | Crítica | SA-2 = SE-1 (+ SE-18 gate) | `package.json:43-44`; `pnpm-lock.yaml`; `.github/workflows/ci.yml:72-74` | `next` 16.2.6 (RCE en Image Optimization, `next/og` y `use cache`; bypass de proxy) y `next-auth` beta.31 / `@auth/core` 0.41.2 (fail-open). El audit de CI no bloquea. | Abierto | W-01, W-02 |
| F-03 | Alta | SA-5 (+ QA-10, parte de SA-19 y SA-21) | `src/app/api/tenant/register/route.ts:25,49,98,138-148` | Cualquier usuario autenticado crea tenants y escribe en el Airtable del dueño. No hay rol ni rate limit. | En curso | — (fuera del plan) |
| F-04 | Alta | SA-4 = PT-1 (+ PT-4, SA-13 `signedIp`, parte de SA-17) | `src/app/actions/auth.ts:56,101,144,205`; `src/app/actions/onboarding.ts:40`; `src/app/api/sign/[token]/route.ts:113` | El rate limit usa la primera IP de `x-forwarded-for`, que el cliente controla (bypass confirmado en prod en `/api/sign`). No hay límite por cuenta. La IP de evidencia de la firma también es falsificable. | Abierto | W-18 |
| F-05 | Alta | SA-3 | `src/lib/auth/config.ts:71,141-144` | Al vincular Google no se revocan las sesiones del que ocupó antes el email con contraseña (account squatting persistente). | Abierto | W-05 |
| F-06 | Alta | AC-2 = SA-19 = AC-27 (+ DOC-a, lectura) | `src/lib/auth/guards.ts:76`; unas 30 llamadas (`tenants.profileId = ctx.userId`, `approvedBy/createdBy/authorId: ctx.userId`); `src/app/api/invite/accept/route.ts:138` | Las FK apuntan a `profiles.id` (`0000_baseline.sql:171,596,645,693`), pero el código compara y escribe `users.id`. Solo funciona con filas legacy donde ambos ids coinciden. Las cuentas nuevas no ven el portal y sus escrituras fallan con 23503. | Abierto | W-04 → W-22…W-34 → W-52 |
| F-07 | Media | DOC-a | `src/lib/auth/provision.ts:181-225`; `src/lib/auth/config.ts:179-180` | `attemptAutoLink` busca tenants por email sin filtrar por org y corre después de crear la org propia. Vincula el tenant de otra org al perfil admin del nuevo usuario. Hoy no se explota porque las lecturas usan `users.id`, pero deja datos inconsistentes entre orgs. | Abierto | W-05 |
| F-08 | Alta (funcional) | DOC-b | `src/lib/auth/config.ts:161-188`; `src/app/api/invite/accept/route.ts:111-119` | Un invitado nuevo que entra con Google recibe primero su propia org. Después `invite/accept` responde 409 `ALREADY_IN_ORG`, así que las invitaciones fallan para toda cuenta Google nueva. | Abierto | W-05 |
| F-09 | Alta | AC-1 | `src/lib/events/handlers/whatsapp-receipt.ts:91-123,183-242` | El OCR de una imagen enviada por WhatsApp aprueba pagos automáticamente según la confianza que reporta el LLM. Sin transacción, sin dedupe robusto y sin auditoría. | Abierto | W-14 |
| F-10 | Alta | SE-2 | `.github/workflows/ci.yml:331` | `superfly/flyctl-actions/setup-flyctl@master` (ref mutable) corre en el job que recibe `FLY_API_TOKEN`. | Abierto | W-02 |
| F-11 | Alta | SE-3 | Ajustes de GitHub (`main`) | Repo público sin protección de rama. `main` despliega a producción y ejecuta migraciones. | Dueño | Sección 3 |
| F-12 | Alta | SE-4 | Ajustes de GitHub | Secret scanning, push protection y Dependabot desactivados. | Dueño (+ W-02 crea `dependabot.yml`) | Sección 3 |
| F-13 | Alta | SR-1 | `src/lib/agent/jobs.ts:71-105,140-161`; `src/lib/whatsapp/whatsapp-dispatch.ts:316-323`; `src/lib/calendar/sync.ts:197-206` | Los jobs en `processing` con lock vencido nunca se recuperan y bloquean para siempre las respuestas del agente y la sincronización de calendario. | Abierto | W-15 |
| F-14 | Alta | SR-2 (+ SR-7, AC-31) | `src/lib/ai/client.ts:15`; 6 `new Anthropic(...)` sin timeout; `src/lib/airtable/client.ts:197-207`; varios `fetch` | No hay timeouts en Anthropic (600 s × 3 por defecto), Airtable, S3, Resend ni en varios fetch. | Abierto | W-08, W-09, W-19, W-27, W-28, W-41 |
| F-15 | Alta | SR-3 = AC-6 | `src/app/api/whatsapp/webhook/route.ts:131-294`; `src/lib/whatsapp/db.ts:92-130`; `src/lib/whatsapp/classify.ts` | La descarga de media y la clasificación con LLM ocurren antes del dedupe. Cada reintento de Meta repite el gasto. Un mensaje malo tumba el lote con 500. | Abierto | W-19 |
| F-16 | Alta | SR-4 | `src/lib/notifications/reminder-engine.ts:155-213,247-305`; `src/app/api/cron/task-reminders/route.ts:54-113` | Recordatorios con check-then-send-then-insert y sin índice único: los crons solapados o reintentados envían dos veces. | Abierto | W-06, W-21 |
| F-17 | Alta | ER-1 | `src/app/api/admin/payments/import/route.ts:80-123`; `src/app/api/tenant/payments/import/route.ts:85+` | El INSERT usa columnas inexistentes (`due_date`, `period_month`, `notes`; confirmado contra `schema.ts`), omite `contract_id` (NOT NULL), el `ON CONFLICT` no infiere el índice parcial y un `catch` vacío oculta el error. Toda importación falla en silencio. | Abierto | W-23 |
| F-18 | Alta | SR-5 | `src/lib/db/retry.ts:82-101` y crons `agent-dispatch`, `qa-export`, `lead-alerts`, `voice-reactivation` | `withDbRetry` reintenta cualquier error y envuelve jobs completos con efectos externos (WhatsApp, llamadas Vapi), lo que duplica mensajes y llamadas. | Abierto | W-20 |

### 1.2 Medios

| ID | Sev. | Fuentes | Archivo:línea | Descripción | Estado | Plan |
|---|---|---|---|---|---|---|
| F-19 | Media | SA-7 = AC-8 = BUG-1 (test QA-1, crítico) | `src/app/actions/visitors.ts:87-103` | Un tenant edita cualquier registro de visitas de su org. | Abierto | W-25 |
| F-20 | Media | SA-8 = BUG-2 = BUG-3 (tests QA-2, QA-3, QA-9) | `src/app/actions/incidents.ts:180-194`; `src/app/api/incident-photo/route.ts:45`; `src/app/api/tenant-avatar/route.ts:24`; `src/app/api/receipts/ocr/route.ts:44` | Un tenant comenta incidencias ajenas, ve fotos y avatares ajenos y lanza OCR (con gasto LLM) sobre recibos ajenos. | Abierto | W-26, W-27 |
| F-21 | Media | SA-9 | `src/app/api/ai/chat/route.ts:30,64`; `src/lib/ai/assistant.ts:34-64` | Un tenant obtiene el contexto financiero de toda la org a través del asistente IA. | Abierto | W-28 |
| F-22 | Media | SA-10 = SE-11 | `src/lib/env.ts:14-16,59-60` | El entorno no se valida al arrancar; los secretos se comprueban de forma perezosa. | Abierto | W-16 |
| F-23 | Media | SA-11 | `src/app/actions/auth.ts:205-225` | No hay reset de contraseña (`NOT_IMPLEMENTED`). | Bloqueado (dominio Resend) | Sección 3 |
| F-24 | Media | SA-12 = SE-20 = AC-10 = PT-15 | `src/lib/ratelimit.ts` | El rate limit vive en memoria por proceso: se pierde al suspender o desplegar y no se comparte entre máquinas. El bucket `anonymous` es compartido. | Abierto | W-06 (tabla), W-18 (auth), W-47 (cuotas IA) |
| F-25 | Media | SA-6 + PT-2 (+ parte de SA-17) | `src/app/actions/auth.ts:132-190,175` | Registro abierto sin verificación de email: cada cuenta es admin con su propia cuota IA. `EMAIL_TAKEN` permite enumerar emails. | Bloqueado (Resend). W-18 cierra el bypass del throttle | Sección 3 |
| F-26 | Media | PT-3 | `src/proxy.ts` | El chequeo de origen de Server Actions confía en `X-Forwarded-Host` del cliente (confirmado en prod). El CSRF desde navegador sigue bloqueado. | Abierto | W-10 |
| F-27 | Media | SE-5 + SE-6 + SE-18 | `.github/workflows/ci.yml:48,113,170-178,217,283`; `:78,92,121,247`; `:60,67,74,87,153` | Acciones con tags mutables, herramientas `npx --yes` sin versión fija y gates con `continue-on-error`. | Abierto | W-02, W-03, W-53 |
| F-28 | Media | SE-7 (+ ER-8) | `.github/workflows/cron-dispatch.yml:57-205`; `src/app/api/cron/airtable-sync/route.ts:176-181,316-322` | El secreto se interpola en el script y el cuerpo de la respuesta (UUIDs de org y errores) se imprime en logs públicos. | Abierto | W-02, W-41 |
| F-29 | Media | SE-8 | `.dockerignore:1-8` | `.env*` no está excluido del contexto Docker en despliegues locales. | Abierto | W-02 |
| F-30 | Media | SE-9 | `src/lib/storage/index.ts` | La privacidad del bucket Tigris no está verificada y hay un solo bucket para todas las clases de datos. | Dueño | Sección 3 |
| F-31 | Media | SE-10 = AC-3 (+ AC-23) | `src/app/api/whatsapp/webhook/route.ts:126,302-423` | La rama mock está viva en producción. Con `WHATSAPP_WEBHOOK_SECRET` escribe en "la primera org" sin orden y suplanta a cualquier tenant. | Abierto | W-19 |
| F-32 | Media | AC-4 = AC-36 (+ QA-5) | `src/app/api/admin/payments/[paymentId]/approve/route.ts`; `.../reject/route.ts`; `src/app/actions/payments.ts:~80-100` | Aprobar no comprueba el estado ni registra `approvedBy`. Rechazar sobrescribe `reference`. Hay una carrera select-then-update. | Abierto | W-06, W-22 |
| F-33 | Media | AC-5 (+ AC-24) | `src/lib/agent/tools/register-owner-lead.ts:8,27-41` | Un prompt injection crea leads con teléfonos de terceros, que luego reciben outbound. | Abierto | W-42 |
| F-34 | Media | AC-7 | `src/lib/agent/prompt.ts`; `src/lib/agent/run-turn.ts` | Contexto no confiable (anuncio, `pageContext`, `refCode`) dentro del system prompt; las notas internas son extraíbles. | Abierto | W-43 |
| F-35 | Media | AC-9 | `src/app/api/agent/voice/vapi/route.ts`; `src/lib/agent/voice/webhook-handlers.ts` | Secreto Vapi global; `orgId` tomado del body; límite de tamaño aplicado después de leer el body. | Abierto | W-44 |
| F-36 | Media | AC-11 | `src/app/api/tenant/payments/route.ts` | Join unit↔property incorrecto, `orgId` en el DTO, `status` sin validar y detalles de zod expuestos. | Abierto | W-24 |
| F-37 | Media | AC-12 | `src/lib/widget/web-handoff-redeem.ts`; `src/lib/agent/web-handoff-redeem.ts` | Casts sin validación al canjear códigos y sin límite de intentos fallidos. | Abierto | W-45 |
| F-38 | Media | AC-13 | `src/lib/agent/run-turn.ts`; `src/lib/widget/handoff-codes.ts` | El presupuesto diario y el tope de códigos son count-then-act (con carreras). | Abierto | W-43, W-45 |
| F-39 | Media | DB-1 | `schema.ts` / migraciones | Faltan índices (payments, charges, contracts, sessions, accounts, tenant_tasks, agent_jobs). | Abierto | W-06 |
| F-40 | Media | DB-2 | `src/lib/notifications/reminder-engine.ts` | N+1 por candidato. | Abierto | W-21 |
| F-41 | Media | DB-3 | `src/app/api/admin/tenants/import/route.ts`; `src/app/api/admin/payments/import/route.ts` | Inserts fila a fila y llamadas Airtable secuenciales sin transacción. | Abierto | W-23, W-41 |
| F-42 | Media | DB-4 | `src/lib/agent/jobs.ts` | `agent_jobs` terminados nunca se purgan. | Abierto | W-20 |
| F-43 | Media | DB-5 | `src/app/dashboard/payments/page.tsx:28-36` | Los KPIs se calculan en JS sobre todas las filas, sin límite. | Abierto | W-46 |
| F-44 | Media | DB-6 | `src/lib/leads-pipeline.ts:286` | El reorder hace un UPDATE por id sin transacción. | Abierto | W-46 |
| F-45 | Media | ER-2 (+ ER-8) | `src/app/api/admin/integrations/airtable/sync/route.ts:82-96` | Devuelve al cliente errores crudos (SQL, parámetros, cuerpo de Airtable). | Abierto | W-41 |
| F-46 | Media | ER-3 | `src/app/api/admin/tenants/import/route.ts:166,183` | `e.message` se guarda en `import_logs` y se sirve al cliente; un `catch` vacío lo oculta. | Abierto | W-41 |
| F-47 | Media | ER-4 | `src/lib/log.ts`; todas las rutas | No hay request id ni correlación entre errores y logs. | Abierto | W-10 (+ adopción en W-23, W-41) |
| F-48 | Media | ER-5 | `src/instrumentation.ts:153-188` | No hay handlers de `unhandledRejection` ni `uncaughtException`; los logs no llevan stack. | Abierto | W-16 |
| F-49 | Media | ER-6 | `src/lib/notifications/reminder-engine.ts:432-452` | `.catch(() => null)` silencioso. | Abierto | W-21 |
| F-50 | Media | SR-6 | `src/app/api/health/route.ts:1-8`; `fly.toml` | Health estático y sin checks en Fly. | Abierto | W-17 |
| F-51 | Media | SR-7 | `src/lib/storage/index.ts:117`; `src/lib/notifications/email.ts:18` | S3 y Resend sin timeouts. | Abierto | W-09 |
| F-52 | Media | DOC-e | `src/app/**` | No hay `error.tsx` ni `global-error.tsx`: un error de render muestra la página por defecto. | Abierto | W-11 |
| F-53 | Media | DOC-b (variante con contraseña) | `src/app/invite/accept/page.tsx` | Solo informativo: el flujo de invitación no ofrece registro con contraseña (solo Google o inicio de sesión), así que no hay ruta de contraseña afectada. | Sin acción | — |

### 1.3 Bajos e informativos

| ID | Sev. | Fuentes | Archivo:línea | Descripción | Estado | Plan |
|---|---|---|---|---|---|---|
| F-54 | Baja | PT-5 | `src/app/api/sign/[token]/route.ts` | Un token que no es UUID provoca 500. | Abierto | W-18 |
| F-55 | Baja | PT-6 | `src/app/api/calendar/google/connect/route.ts:48`; `callback/route.ts` | Las redirecciones construidas con `request.url` filtran `0.0.0.0:3000`. | Abierto | W-12 |
| F-56 | Baja | PT-7 | `src/app/api/whatsapp/webhook/route.ts` | Un 503 público revela que faltan secretos del webhook. | Abierto | W-19 |
| F-57 | Baja | PT-8 = DOC-c | `src/app/auth/callback/page.tsx:32-36` | `safeInternalPath` acepta `/\evil.example`: open redirect. | Abierto | W-12 |
| F-58 | Baja | PT-9 | `next.config.ts` | Las rutas del widget no envían HSTS. | Abierto | W-17 |
| F-59 | Baja | SA-13 | `src/lib/db/schema.ts:659`; `src/app/api/sign/[token]/route.ts:36,134` | El token de firma se guarda en claro (la parte de la IP está en F-04). | Backlog | — |
| F-60 | Baja | SA-14 | `src/app/actions/incidents.ts:65,77-78` | `createIncident` no verifica que los ids pertenezcan a la org. | Abierto | W-26 |
| F-61 | Baja | SA-15 (+ PT-14 peek) | Acciones `contracts`, `incidents`, `payments`, `properties`, `tenants`, `whatsapp`; `api/invite/{peek,accept}` | Faltan rate limits de mutación. | Abierto (parcial) | W-04, W-22, W-26, W-49; resto en backlog |
| F-62 | Baja | SA-16 | `src/app/actions/finance.ts:159-173`; `incidents.ts:46,97,103` | El MIME y la extensión de los uploads los decide el cliente. | Backlog | — |
| F-63 | Baja | SA-17 (resto) | `src/app/actions/auth.ts:27,175` | Mínimo de 6 caracteres; enumeración. | Abierto (parcial) | W-18 (mínimo en el registro); la enumeración queda bloqueada por Resend |
| F-64 | Baja | SA-18 = SE-13 | `src/lib/auth/admin-allowlist.ts:22-26` | Emails personales de admin en código público y fallback a la "org más antigua". | Abierto | W-50 |
| F-65 | Baja | SA-20 = SE-16 (+ PT-12 `x-nonce`) | `src/proxy.ts:20,22,58,84`; `src/lib/auth/config.ts:196` | `img-src https:` demasiado amplio, nonce expuesto en la respuesta y `trustHost: true`. | Abierto | W-10; `AUTH_URL` + `trustHost` a cargo del dueño |
| F-66 | Baja | SA-21 = AC-19 (+ PT-12) | 13 sitios `parsed.error.flatten()` | Detalles de validación expuestos al cliente. | Abierto (parcial) | W-18, W-19, W-24, W-41; resto en backlog |
| F-67 | Baja | SA-22 = SE-21 = AC-25 | Raíz del repo | Dos logs de build versionados (rutas locales). | Dueño (borrar requiere aprobación) | Sección 3 |
| F-68 | Baja | SE-12 | Historial de `fly.toml` / `fly.app.toml` | Clave anon de Supabase en el historial público. | Dueño | Sección 3 |
| F-69 | Baja | SE-14 | `src/lib/auth/config.ts:74` | `access_type: offline` guarda refresh tokens de Google sin uso y en claro. | Abierto | W-05; anular los tokens existentes requiere aprobación del dueño |
| F-70 | Baja | SE-15 | `src/lib/crypto/encrypt.ts:24-40` | AES-GCM sin AAD ni versionado de clave. | Backlog | — |
| F-71 | Baja | SE-17 | `.github/workflows/ci.yml:264-304` | El job e2e daría secretos de staging a PRs (hoy está desactivado). | Abierto | W-02 |
| F-72 | Baja | SE-19 | `Dockerfile:1` | Imagen base fijada por tag, sin digest ni escaneo. | Abierto (opcional) | W-02 |
| F-73 | Info | SE-22 = DOC-d | `src/proxy.ts:79,133-153` | Chequeo de rol muerto con un comentario obsoleto sobre RLS. | Abierto | W-10 |
| F-74 | Info | SE-23 = AC-26 | 8 `src/app/api/cron/*/route.ts` | Chequeo bearer duplicado 8 veces. | Abierto | W-07 (7 rutas), W-41 (airtable-sync) |
| F-75 | Baja | AC-14 | `community.ts:83`, `ops.ts:225,297`, `properties.ts:53`, `tasks.ts:83`, `tenants.ts:87`, `visitors.ts:113` | `.set({...updates})` con claves snake_case que se pierden en silencio. | Abierto (parcial) | W-25 (visitors); resto en backlog |
| F-76 | Baja | AC-15, AC-20, AC-21, AC-22 | `visits/service.ts`; updates de `properties`, `tenants` y `tasks`; `widget/web-turn.ts`; `widget/origins.ts` | Updates sin `org_id`/estado en el WHERE, éxito con 0 filas, crédito consumido en fallo, documentación. | Backlog | — |
| F-77 | Baja | AC-16 | `widget/web-session.ts`, `handoff-codes.ts`, `agent/listings.ts:82`, `whatsapp-receipt.ts:232-242` | Updates por PK sin `org_id`. | Abierto (parcial) | W-14, W-45; resto en backlog |
| F-78 | Baja | AC-17, AC-18 | `src/lib/agent/tools/search-listings.ts`; `get-listing-details.ts` | `ILIKE` sin escapar y allow-list de listings sin aplicar. | Abierto | W-42 |
| F-79 | Baja | DB-7, DB-8, DB-9 | Varias páginas y loops | Listas sin paginar y candidatos a N+1. | Backlog | — |
| F-80 | Baja | ER-7, ER-9 | `contractDoc.ts:57`, `finance.ts:40`; `agent/outbound.ts:75,149` | Detección de 23505 por texto; mensajes del proveedor devueltos sin filtrar. | Backlog | — |
| F-81 | Baja | SR-8 | `src/instrumentation.ts:153-188` | Intervalos sin guard de solapamiento, sin Sentry ni métricas. | Abierto (parcial) | W-16 (guard); Sentry en backlog |
| F-82 | Info | PT-10, PT-11, PT-13, PT-14 (404 voice), SE-24 | — | Shell del dashboard en el 307, TRACE con 500, `isSameAppOrigin` por diseño, 404 en lugar de 401, cabeceras verificadas. | Sin acción | — |
| F-83 | Calidad | AC-28 … AC-35 | Ver `sec-arch-code.md` | Duplicaciones, N+1 del agente, archivos de más de 600 líneas. | Parcial | AC-31 en W-08, AC-32 en W-19; resto en backlog |

### 1.4 Calidad, QA y accesibilidad (fuera del alcance de seguridad estricto)

| Grupo | Fuentes | Estado | Plan |
|---|---|---|---|
| Lint: 10 errores (8 `react-hooks/set-state-in-effect`, 1 `no-explicit-any` en `incidents.ts:167`, 1 `no-html-link-for-pages` en `dashboard/admin/tenants/page.tsx:95`) | baseline | Abierto | W-03 |
| Lint: 31 warnings (`--max-warnings=0` hace fallar `pnpm lint`) | baseline | Abierto | Cada W limpia sus archivos; el resto lo cubre W-53 |
| Gate de cobertura en rojo (líneas al 74.66 % < 80) | baseline | Abierto | Mejora con los tests de W-xx; no hay ítem dedicado |
| Tests faltantes QA-1 … QA-15 | qa-a11y | Abierto | QA-1 → W-25; QA-2 y QA-9 → W-27; QA-3 → W-26; QA-4 y QA-5 → W-22; QA-6 → W-29; QA-7 → W-18; QA-8 → W-32; QA-10 → en curso (SA-5), con respaldo en W-41; QA-11 → W-07; QA-12 y QA-13 → W-48; QA-14 → W-49; QA-15 → W-24 |
| Suites tautológicas en `tests/integration/cross-tenant.test.ts` (líneas 378-400, 406-430, 501-523) | qa-a11y | Abierto | W-48 |
| E2E faltantes (invite accept, pagos, portal) | qa-a11y | Abierto | W-51 |
| A11Y altos 1-7 | qa-a11y | Abierto | A11Y-1 y A11Y-3 → W-13; A11Y-2 → W-54; A11Y-4 → W-37, W-38, W-39; A11Y-5 → W-35; A11Y-6 → W-36; A11Y-7 → W-37 |
| A11Y medios 8-12 | qa-a11y | Abierto | A11Y-8 → W-54; A11Y-9 → W-13; A11Y-10 → W-40; A11Y-11 → W-38 y W-54; A11Y-12 → W-36 |
| A11Y bajos 13-18 | qa-a11y | Abierto (parcial) | A11Y-13, A11Y-15 y A11Y-18 → W-13; A11Y-17 → W-36; A11Y-14 y A11Y-16 en backlog |

## 2. Checklist de controles (20 puntos, base `sec-auditor.md` §1)

| # | Control | Estado | Hallazgos que lo determinan |
|---|---|---|---|
| 1 | CSRF | OK | Origin/Host de Server Actions, `SameSite=Lax`, OAuth con state + PKCE. El residual PT-3 (F-26) se corrige en W-10. |
| 2 | RLS / aislamiento de datos | FAIL | F-01 (en curso), F-07. No hay RLS en Postgres; el aislamiento depende de filtros `orgId`. |
| 3 | CORS | OK | Solo `widget.js` con `*`, sin credenciales. |
| 4 | Variables de entorno | FAIL | F-22. |
| 5 | Rate limiting | FAIL | F-04, F-24, F-61. |
| 6 | Sanitización de entrada | OK | Zod en servidor, sin `dangerouslySetInnerHTML`, markdown sanitizado. |
| 7 | Auth en servidor | OK | Todas las acciones y rutas usan un guard. El proxy solo mira la cookie (F-73). F-03 está en curso. |
| 8 | Validación en servidor | OK | Huecos menores: F-60, F-62. |
| 9 | Manejo de errores | FAIL (parcial) | El auditor lo marcó OK. Se rebaja por F-45, F-46, F-47, F-52 y F-66 (errores crudos al cliente, sin request id, sin error boundaries). |
| 10 | Sesiones y tokens | FAIL | F-05. Flags de cookie correctos. |
| 11 | Autorización (rol + propiedad) | FAIL | F-01, F-06, F-19, F-20, F-21. |
| 12 | Cifrado y hashing | OK | bcrypt 12, AES-256-GCM, invitaciones hasheadas. Menores: F-59, F-70. |
| 13 | Cabeceras de seguridad | OK | CSP con nonce, HSTS, etc. Menores: F-58, F-65. |
| 14 | Reset de contraseña | FAIL | F-23 (bloqueado por Resend). |
| 15 | Fuerza bruta | FAIL | F-04. |
| 16 | GETs seguros | OK (parcial) | No se verificó el page-size máximo en todas las listas (F-79). |
| 17 | POSTs seguros | OK | No se devuelven secretos. La URL de invitación se muestra una sola vez, por diseño. |
| 18 | Dependencias | FAIL | F-02. |
| 19 | Secretos en el repo | OK | Solo placeholders. Residuales: F-67, F-68. |
| 20 | DNS | N/A | Dominio de Fly, sin dominio propio. |

## 3. Requiere acción del dueño

Ninguno de estos pasos lo puede hacer un agente sin la aprobación del dueño. Algunos cuestan dinero o borran datos.

1. **GitHub (F-11, F-12, F-27):**
   - Crear un ruleset en `main`: PR obligatorio, checks requeridos (`quality`, `codeql`), sin force-push ni borrado, historial lineal.
   - Activar secret scanning, push protection, alertas de Dependabot, security updates y private vulnerability reporting.
   - En Actions, exigir acciones fijadas por SHA completo y restringir las acciones permitidas.
   - Añadir revisores requeridos al environment `Production` y mover `FLY_API_TOKEN` a un secreto de ese environment, como token de deploy limitado a la app (`fly tokens create deploy -a propflow-app`).
   - Después de activar secret scanning, revisar las alertas sobre el historial.
2. **Almacén global de pnpm dañado (baseline):** `C:\Users\Ilan\AppData\Local\pnpm\store\v3` tiene 74 ficheros vacíos. Hay que limpiarlo (`pnpm store prune` o borrar el directorio; borra caché local). Hasta entonces, las instalaciones de los builders deben usar `--store-dir` en el scratchpad.
3. **Dominio verificado en Resend:** desbloquea F-23 (reset de contraseña), F-25 (verificación de email, respuesta genérica al registrarse) y los emails de renovación. Además faltan `RESEND_FROM_EMAIL` y `RESEND_API_KEY` en los secretos de Fly.
4. **Secretos de Meta / WhatsApp:** definir `META_APP_SECRET` (y el resto de variables Meta) cuando WhatsApp salga en vivo. **No** definir `WHATSAPP_WEBHOOK_SECRET` en Fly (F-31, PT-7).
5. **`flyctl auth login`** en esta máquina. Hace falta para:
   - ejecutar el diagnóstico de solo lectura `scripts/diag/profile-identity.sql` (lo crea W-04) contra prod y decidir si se necesita la migración condicional de F-06;
   - comparar `fly secrets list` (solo nombres) con el esquema de W-16 antes de desplegarlo;
   - verificar que el bucket Tigris es privado (F-30, SE-9);
   - definir `ADMIN_ALLOWLIST` y `PRIMARY_OWNER_EMAIL` antes de desplegar W-50;
   - definir `AUTH_URL` para poder quitar `trustHost` (F-65).
6. **Limpieza de filas Airtable copiadas a otras orgs (F-01):** cuando SA-1 se fusione, contar por org las filas con `airtable_external_id` que no pertenecen a la org dueña. **Borrarlas elimina datos**: requiere aprobación explícita y backup previo.
7. **Vínculos cruzados de `attemptAutoLink` (F-07):** el diagnóstico de W-04 lista los tenants cuyo `profile_id` apunta a un perfil de otra org. Desvincularlos (`UPDATE tenants SET profile_id = NULL ...`) modifica datos de producción, así que requiere aprobación. Tras W-04 y W-05 ya no son explotables.
8. **Tokens OAuth de Google en `accounts` (F-69):** anular `refresh_token`, `access_token` e `id_token` existentes de `provider = 'google'` es una mutación de datos y requiere aprobación.
9. **Supabase (F-68):** confirmar que el proyecto antiguo está borrado o pausado. Si existe, rotar el JWT secret y borrar sus datos.
10. **Borrar los dos logs versionados en la raíz (F-67):** `git rm` de ficheros versionados, requiere aprobación.
11. **Decisión de producto (F-16):** cadencia de recordatorios de renovación (hoy diaria durante 30 días; SR-4 sugiere hitos 30/15/7/1). W-21 mantiene la cadencia actual salvo que el dueño decida otra.
12. **Decisión de dependencias (F-02):** si `zod` (GHSA-mrhx-c7xc-m3w5, vía `@anthropic-ai/sdk`) no se resuelve sin migrar la app de zod 3 a 4, el dueño elige entre aprobar esa migración como ítem extra o una excepción temporal documentada del audit.

## 4. Juicios sobre severidad y posibles falsos positivos

- **SA-19 (baja) frente a AC-2 (alta):** se fusionan como alta (F-06). La FK de `tenants.profile_id`, `notification_inbox.profile_id`, `ai_chat_messages.profile_id`, `tenant_tasks.created_by` y `payments.approved_by` apunta a `profiles.id`, y `provisionOrgAndProfile` crea perfiles con id aleatorio. Para usuarios nuevos falla toda escritura con `ctx.userId`, no solo las lecturas. No es falso positivo.
- **AC-2, "FK writes raise 23503":** está confirmado en `0000_baseline.sql`. Sin embargo, producción es anterior al runner de migraciones (el baseline se marcó como aplicado sin ejecutarse), así que la FK real en prod debe comprobarse con el diagnóstico de W-04 antes de dar por buena la conclusión "no hace falta migrar datos".
- **SA-17, "mínimo 8 también en login":** no se adopta para el login. Rechazaría a usuarios legacy con contraseñas de 6-7 caracteres. El mínimo de 8 se aplica solo al registro (W-18).
- **PT-3:** se mantiene como media. No es explotable desde un navegador, pero el control depende de una cabecera del cliente.
- **SE-23 (fuga de longitud del secreto de cron):** informativo. Se corrige de paso al comparar digests en W-07.
- **PT-13, PT-14 (404 en `voice/recording`), AC-22:** comportamiento por diseño o solo documentación. No son vulnerabilidades.
- **DOC-a:** real, pero hoy no se explota (las lecturas usan `users.id` y, tras el fix, filtran por org). Se clasifica como media, no alta.
- **Ningún hallazgo crítico o alto se considera falso positivo.**
