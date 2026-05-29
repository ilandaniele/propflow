# Implementation Notes — PropFlow Core Operations MVP

## Architecture decisions

### Next.js 16 proxy convention
Next.js 16 renamed `middleware.ts` to `proxy.ts` and the export from `middleware` to `proxy`.
The file is at `src/proxy.ts` exporting a `proxy` function.

### Server Actions as the backend
All mutations use Next.js Server Actions. No separate Express/FastAPI backend.
API Route Handlers exist for: `/api/health` (health check) and `/api/incident-photo` (signed URL generation).

### Supabase client without Database generic
The hand-written `Database` type at `src/types/database.ts` is used for documentation and
autocomplete reference but is NOT passed as a generic to `createServerClient` / `createBrowserClient`.
Reason: strict type mismatch between the hand-written types and the supabase-js 2.x internal
Insert/Update type system caused `never[]` errors. Runtime safety is enforced via Zod schemas
at every Server Action boundary. This is a known pattern for hand-written Supabase types.

### Server vs Client component split
- Server: all page.tsx files under `/dashboard/*` and `/portal/*` — data fetching with server client
- Client: all form components (`CreateTenantForm`, `ApprovePaymentButton`, etc.), shells
  (`AdminSidebar`, `AdminTopbar`, `TenantNav`), auth pages

### Tailwind v4 @theme
Design tokens are defined in `src/app/globals.css` using the `@theme` block.
No separate `tailwind.config.js` is needed; v4 picks it up from CSS.

### Auth actions file path
The auth actions file lives at `src/app/actions/auth.ts` (note: directory uses forward slash
on Windows; the file is accessible). Windows path: `src\app\actions\auth.ts`.

## Security controls applied

### CSP (nonce-based)
Generated per-request in `src/proxy.ts`. The nonce is injected into response headers and
passed to the RSC layout via `x-nonce` header. Script tags must include the nonce.
CSP includes: `default-src 'self'`, `script-src 'self' 'nonce-{n}'`, `frame-ancestors 'none'`.

### Security headers
All applied in `src/proxy.ts` per-response:
- `Content-Security-Policy` (nonce-based)
- `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`
- `Cross-Origin-Opener-Policy: same-origin`
Additional static headers in `next.config.ts`.

### RLS — deny-by-default
Every domain table: `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY`.
No row is accessible without a matching policy.
Helper functions `current_org_id()` and `current_user_role()` use `SECURITY DEFINER + search_path`.

### Role-based routing
`src/proxy.ts` checks `user.app_metadata.role` (set by seed/admin provisioning):
- `/dashboard/*` — admin only; tenant redirected to `/portal`
- `/portal/*` — tenant only; admin redirected to `/dashboard`
Server Action guards (`requireAdmin`, `requireUser`) re-verify at the data layer.

### Payment approval
Only admin can set `status='approved'`. Enforced at:
1. RLS: no UPDATE policy for tenants on `payments` table
2. Server Action `approvePayment`: calls `requireAdmin()` — any error returns FORBIDDEN

### Incident status
Tenants have no UPDATE policy on `incidents`. Trying to update from client fails at DB.
`updateIncident` server action calls `requireAdmin()`.

### File upload security
- Max 5 MB enforced by Supabase Storage bucket config (`file_size_limit = 5242880`)
- MIME allowlist enforced by Supabase bucket (`allowed_mime_types`)
- Server-side Zod validation in `createIncident` action before upload
- Private bucket — only signed URLs (60 min TTL) via `/api/incident-photo`
- Storage path: `{org_id}/{incident_id}/{uuid}.{ext}` — org-scoped

### Auth rate limiting
In-memory limiter: 5 attempts / 10 seconds / IP.
For production scale, replace `src/lib/ratelimit.ts` with Upstash Redis-backed limiter.

## API surface

### Server Actions
- `signIn` / `signOut` / `requestPasswordReset` — auth
- `createProperty` / `updateProperty` / `createUnit` / `updateUnit` — admin
- `createTenant` / `updateTenant` / `assignTenantToUnit` — admin
- `createContract` / `updateContractStatus` — admin
- `createCharge` — admin
- `recordPayment` — admin or tenant (own contract, pending status)
- `approvePayment` — admin only
- `createIncident` — admin or tenant (with optional photo upload)
- `updateIncident` — admin only (status/assign)
- `addIncidentComment` — admin or tenant (for accessible incidents)

### Route Handlers
- `GET /api/health` — returns `{ status: 'ok', timestamp }`, no auth
- `GET /api/incident-photo?path={storagePath}` — returns signed URL; requires auth + org match

## Env vars (7 total)

| Variable | Public/Private |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | PUBLIC |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | PUBLIC (RLS-gated) |
| `NEXT_PUBLIC_SITE_URL` | PUBLIC |
| `SUPABASE_SERVICE_ROLE_KEY` | SERVER-ONLY — never NEXT_PUBLIC_ |
| `SUPABASE_DB_URL` | SERVER-ONLY (migrations/seed) |
| `SENTRY_DSN` | SERVER-ONLY (optional) |
| `CSP_REPORT_URI` | SERVER-ONLY (optional) |

## Database migrations

4 SQL migrations under `supabase/migrations/`:
1. `20260528000001_init_schema.sql` — tables, indexes, FKs, constraints, updated_at triggers
2. `20260528000002_rls_helpers.sql` — `current_org_id()`, `current_user_role()`, ENABLE/FORCE RLS
3. `20260528000003_rls_policies.sql` — all per-table RLS policies
4. `20260528000004_storage_view.sql` — incident-photos bucket, storage RLS, `tenant_statement` view, profile auto-create trigger

## How to run locally

```bash
# 1. Clone and install
git clone <repo-url> && cd propflow
npm install

# 2. Start local Supabase
npx supabase start  # requires Docker

# 3. Apply migrations
npx supabase db push --local

# 4. Copy env example
cp .env.example .env.local
# Edit .env.local with local Supabase URL and keys

# 5. Run seed (creates demo orgs + users)
SUPABASE_SERVICE_ROLE_KEY=<local-service-role> NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 npx tsx scripts/seed.ts

# 6. Start dev server
npm run dev
```

## Known limitations / deviations from spec

1. **`next lint` removed in Next.js 16** — the `lint` script uses `eslint src` directly.
   The CI workflow references `npm run lint` which works. If `next lint` returns in a future
   minor, the script can be reverted.

2. **Realtime (IC10)** — Supabase Realtime integration for incident comments is NOT wired
   in this MVP. The spec says "progressive enhancement — app works without it." Comments
   work via server-render + manual refresh. Adding realtime subscriptions is a follow-up.

3. **In-memory rate limiter** — `src/lib/ratelimit.ts` uses an in-memory Map. This resets
   on server restart and does not share state across multiple serverless instances (Vercel).
   For production, swap with Upstash Redis. The rate-limit shape is already compatible.

4. **Supabase Database generic not passed** — see Architecture decisions above. Zod schemas
   at action boundaries provide the runtime safety layer.

5. **`tenant_statement` view** — the view is created in migration 004. It is RLS-safe because
   it reads from RLS-protected tables using the calling user's session (SECURITY INVOKER default).
   Admins see all tenant statements in their org; tenants see only their own.

6. **Profile auto-create trigger** — the `handle_new_user()` trigger creates a profile row
   automatically when `auth.users` is inserted, IF `app_metadata.org_id` and `app_metadata.role`
   are set. This is done by the seed script (`admin.createUser` with `app_metadata`). Without
   those fields, no profile is created and the user cannot authenticate past the proxy guard.

7. **Settings page** — referenced in the admin sidebar nav but not implemented. Clicking
   "Settings" in the sidebar navigates to `/dashboard` (placeholder). Noted as future.

## Security fixes — review blockers (2026-05-28)

### B1 — Helper function collision (incidents.ts)
**Root cause:** a local `function err(code, message)` at line 112 shadowed the imported `err()`
from `@/lib/errors`, and the calls at lines 48/51 used the local shadow (missing the `details`
field, diverging from the `ActionResult` contract).

**Fix:** removed the local `err()` entirely. The two call sites now use
`Errors.VALIDATION_ERROR({ formErrors: [...], fieldErrors: {} })` which is the standard pattern
used everywhere else. The import `{ Errors, ok }` from `@/lib/errors` was already present.

**File changed:** `src/app/actions/incidents.ts` (removed lines 111–114, updated lines 48/51).

---

### B2 — Storage upload RLS: incident UUID not validated against DB
**Root cause:** `incident_photos_upload` policy only checked path segment 1 (org_id). Segment 2
(incident UUID) was never validated, allowing phantom storage objects under arbitrary UUIDs.

**Additional root cause uncovered:** the original `createIncident` action generated a local
`randomUUID()` for the storage path BEFORE inserting the incident row — so the incident_id in
the path never matched any real DB row. The new RLS check would have blocked all uploads if this
wasn't fixed too.

**Fix (two-part):**

1. **New migration `20260528000005_fix_storage_incident_ownership.sql`:** DROPs and recreates
   `incident_photos_upload` adding:
   ```sql
   AND EXISTS (
     SELECT 1 FROM public.incidents i
     WHERE i.id::TEXT = (storage.foldername(name))[2]
       AND i.org_id = public.current_org_id()
   )
   ```

2. **Restructured `createIncident` action:** insert the incident row first (photo_path = null),
   get the DB-generated UUID back via `.select('id').single()`, then upload using the real incident
   UUID in the path, then update the row with photo_path. This ensures the DB row exists before
   the storage upload, satisfying the new RLS ownership check.

**Files changed:** `supabase/migrations/20260528000005_fix_storage_incident_ownership.sql` (new),
`src/app/actions/incidents.ts` (restructured photo upload flow).

---

### B3 — RLS isolation tests had zero CI coverage
**Root cause:** `tests/rls/isolation.test.ts` wraps all tests in `describe.skipIf(skipIfNoSupabase)`.
`TEST_SUPABASE_URL` was not available in CI, so all RLS tests silently skipped. The CI workflow
ran `npm run test:unit` only — no `test:rls` step existed.

**Fix:** added a `rls` job to `.github/workflows/ci.yml` that:
1. Installs the Supabase CLI via `supabase/setup-cli@v1`
2. Runs `supabase start` — this spins up a local Supabase stack (Docker-based) and applies all
   migrations in `supabase/migrations/` in filename order (001–006)
3. Exports `TEST_SUPABASE_URL` and `TEST_SUPABASE_ANON_KEY` from `supabase status`
4. Runs `npm run seed` to create the demo orgs and users (org-a, org-b admins + tenants)
5. Runs `npm run test:rls -- --reporter=verbose`

With `TEST_SUPABASE_URL` set to the local Supabase URL, the `skipIfNoSupabase` guard is `false`
and ALL isolation scenarios run: Scenarios 6 (cross-org isolation), 8 (tenant-vs-tenant payment
isolation), 9 (WITH CHECK rejection), tenant-cannot-approve, tenant-cannot-solve-incident.

The `rls` job is a top-level peer of `quality` (not nested under it) — it runs in parallel
and is REQUIRED (no `if:` condition gates it on secrets).

**File changed:** `.github/workflows/ci.yml` (new `rls` job added).

---

### B4 — Tenant could attribute incident to another tenant (tenant_id injection)
**Root cause:** `createIncident` set `let tenantId = parsed.data.tenant_id || null` and only
overrode it if `ctx.role === 'tenant' && !tenantId`. If a malicious tenant submitted
`tenant_id=<other_tenant_uuid>`, `tenantId` was truthy and the DB lookup was skipped.

**Fix (two-part):**

1. **Action logic** (`src/app/actions/incidents.ts`): replaced the conditional block with an
   unconditional branch — for `role === 'tenant'`, always execute the DB lookup and ignore
   `parsed.data.tenant_id` entirely. For admin callers, use the client-supplied value as before.

2. **RLS defense-in-depth** (`supabase/migrations/20260528000006_tighten_incident_tenant_rls.sql`):
   new migration DROPs and recreates `incidents_tenant_insert` policy adding:
   ```sql
   AND (
     tenant_id IS NULL
     OR tenant_id IN (
       SELECT id FROM public.tenants
       WHERE profile_id = auth.uid() AND org_id = public.current_org_id()
     )
   )
   ```
   Even if the action were bypassed, the DB would reject an insert with a foreign tenant_id.

3. **Unit test** (`tests/unit/action-security.test.ts`): proves that the derivation logic
   always returns the DB-sourced tenant_id for tenant callers, regardless of client input.

**Files changed:** `src/app/actions/incidents.ts`, `supabase/migrations/20260528000006_tighten_incident_tenant_rls.sql` (new), `tests/unit/action-security.test.ts` (new).

---

### B5 — createCharge inserted client-supplied tenant_id without contract validation
**Root cause:** `createCharge` fetched the contract to verify it belongs to the org, but then
used `parsed.data.tenant_id` (client-supplied) for the charge insert instead of `contract.tenant_id`.
This allowed an admin to create charges attributed to the wrong tenant within the same org.

**Fix:** after fetching the contract, derive tenant_id server-side:
```typescript
// B5: Always derive tenant_id from the fetched contract server-side.
tenant_id: contract.tenant_id,  // was: parsed.data.tenant_id
```

**Unit test** (`tests/unit/action-security.test.ts`): proves the derivation logic always returns
`contract.tenant_id` regardless of what the client submitted.

**File changed:** `src/app/actions/payments.ts` (line 140), `tests/unit/action-security.test.ts`.

---

## Out of scope (noticed but not built)

- Admin Settings page (UI placeholder only)
- Supabase Realtime incident comment subscriptions
- Sentry integration (DSN is read via env but SDK not installed)
- Command-palette (Cmd-K shell wired but empty — noted as future)
- AI/OCR/RTABLES/automation/cleaning/announcements/community modules (all deferred per spec)
- Contract PDF generation and e-signatures (fields reserved in schema)
- Self-serve org signup / Stripe billing (seeded-admin model per IC4)
