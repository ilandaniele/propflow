# Implementation Notes — Supabase → Fly.io + Drizzle Migration

## Migration summary

| Layer | Before | After |
|---|---|---|
| Database | Supabase Postgres (managed) | Fly.io Postgres (`propflow-db`, `mia` region, `shared-cpu-1x`, 256 MB) |
| ORM / query layer | `@supabase/supabase-js` `.from()` API | Drizzle ORM (`drizzle-orm` + `postgres` driver) |
| Authentication | Supabase Auth (JWTs, RLS) | NextAuth.js v5 — Google OAuth + Credentials (bcryptjs), DrizzleAdapter, session strategy = database |
| File storage | Supabase Storage | **Kept** — Supabase Storage is explicitly out of scope for this migration |
| Row-level security | Supabase RLS policies | Dropped — multi-tenancy enforced at app layer (`WHERE org_id = session.orgId` in every Drizzle query) |

## Architecture decisions

- **DrizzleAdapter session strategy = database**: session rows live in the `sessions` table in Fly Postgres; no JWT secret rotation needed.
- **`db` module uses `NEXT_PHASE` guard**: During `next build` (phase-production-build) `DATABASE_URL` may be absent. The db module falls back to a placeholder URL so Drizzle can construct a real `PgDatabase` instance for `DrizzleAdapter`. No actual DB connection is made at build time.
- **Supabase Storage kept**: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are still required for file upload/download via `@supabase/storage-js`.
- **`forgotPassword` stubbed (returns HTTP 501)**: Password reset flow for email/password users is a follow-up PR.
- **`tests/rls/` deleted**: RLS tests are non-portable to plain Postgres; replaced by `tests/integration/cross-tenant.test.ts` which audits 12 entity types for org isolation.

## Tenant isolation contract

Every Drizzle query against org-scoped tables **must** include `eq(table.orgId, session.orgId)`. RLS is no longer active. Violation = data leak.

The cross-tenant integration audit (`tests/integration/cross-tenant.test.ts`) covers: properties, units, tenants, contracts, payments, incidents, expenses, reminders, tenant_tasks, sanctions, whatsapp_conversations, csv_imports.

## Post-merge human steps

1. **Provision Fly Postgres**: `flyctl postgres create --name propflow-db --region mia --vm-size shared-cpu-1x --initial-cluster-size 1`; capture the `DATABASE_URL`.
2. **Run baseline migration**: `npx drizzle-kit migrate` against the Fly Postgres instance.
3. **Set Vercel environment variables**: `DATABASE_URL`, `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `NEXTAUTH_URL` (plus keep existing Supabase Storage vars).
4. **Update Google OAuth redirect URI**: add `${SITE_URL}/api/auth/callback/google` in Google Cloud Console.
5. **(Separate PR) Password migration**: extract bcrypt hashes from Supabase Postgres and copy to `public.users.password_hash` in Fly Postgres.

## What is kept from Supabase

Storage only: `src/lib/supabase/storage/` — all file upload/download/signed URL generation uses the Supabase Storage JS client. The Supabase Postgres database is no longer used after migration.

## Known follow-up items

- Password reset / forgot-password flow (stubbed → 501). Needs email provider + token table + reset route.
- Data migration from Supabase Postgres → Fly Postgres (pg_dump / pg_restore for 46 domain tables).
- The `analyst/`, `finance/leak-detector`, `portal-preview/queries`, `dashboard/health`, and `whatsapp/db` lib modules still use a `SupabaseClient` parameter for DB queries. These should be migrated to Drizzle in a follow-up PR (AC12 backlog item).

## New dependencies (this PR)

- `drizzle-orm` — Drizzle ORM core
- `postgres` — postgres.js driver
- `drizzle-kit` (devDep) — migration CLI
- `next-auth@beta` — NextAuth.js v5
- `@auth/drizzle-adapter` — NextAuth DrizzleAdapter
- `bcryptjs` + `@types/bcryptjs` — password hashing for Credentials provider

---

# Implementation Notes — W1: Foundation (image/photo support)

## Architecture decisions

- **Migration filename**: `20260604000035_unit_images.sql` — matches repo convention of `YYYYMMDD000NNN_description.sql`
- **uploaded_by → profiles(id)**: spec said `REFERENCES auth.users(id)` but the codebase uniformly references `profiles.id` as the FK for user attribution (see incidents.created_by, incident_comments.author_id). Changed to `REFERENCES public.profiles(id)` to match existing pattern.
- **Storage admin client for uploads/deletes**: `uploadImage()` and `deleteImage()` use `createAdminClient()` (service-role) so storage writes succeed regardless of RLS. The calling Server Action (not yet in W1) enforces auth. This matches the existing pattern used in `uploadReceipt()` and WhatsApp task-proof handler.
- **Storage user client for signed URLs**: `getSignedUrl()` uses `createClient()` (user-scoped) so the signed URL generation is subject to the bucket's RLS SELECT policy. This is defense-in-depth on top of the application-level IDOR check.
- **validateImageFile is synchronous**: The function takes a pre-read `Buffer`. The caller (Server Action) reads the file into a buffer before calling this — consistent with how `createIncident()` handles photo uploads.
- **`buildStoragePath` is synchronous**: Uses Node `crypto.randomUUID()` which is sync. The path is always `{orgId}/{resourceId}/{uuid}.{ext}` — original filename is excluded (ASVS V12.2.1).

## Server vs Client component split

This W1 only touches lib/schemas/errors/types/migration — no React components yet.

## New files

| File | Purpose |
|------|---------|
| `supabase/migrations/20260604000035_unit_images.sql` | Table + indexes + RLS + storage buckets + storage policies |
| `src/lib/storage/mime-sniff.ts` | Pure-JS magic-byte detection (JPEG/PNG/WebP) |
| `src/lib/storage/index.ts` | Storage abstraction: upload/signedUrl/delete/validate/buildPath |
| `src/lib/schemas/image.ts` | Zod schemas for upload, caption, reorder, row shape, normalized output |
| `tests/unit/storage/mime-sniff.test.ts` | 20 tests covering all 3 MIME types + spoofed MIME + edge cases |
| `tests/unit/storage/index.test.ts` | 28 tests covering validateImageFile happy + invalid + oversized + spoofed + buildStoragePath |
| `tests/unit/schemas/image.test.ts` | 29 tests covering all 6 schemas |

## Modified files

| File | Change |
|------|--------|
| `src/types/database.ts` | Added `unit_images` table to Database interface; added `UnitImage*` top-level exports; fixed type drift on `tenants` (photo_url, whatsapp_phone, whatsapp_opt_in, reliability_scores) and `units` (toilet_type) |
| `src/lib/errors.ts` | Added 5 image error codes: IMAGE_INVALID_MIME/TOO_LARGE/NOT_FOUND/QUOTA_EXCEEDED/COVER_CONFLICT |
| `next.config.ts` | Extended images.remotePatterns: *.supabase.co/storage/v1/object/sign/**, *.supabase.co/storage/v1/object/public/**, dl.airtable.com, v5.airtableusercontent.com |
| `vitest.config.ts` | Added src/lib/storage/** to coverage include paths |

## Assumptions

- The `uploaded_by` column FK points to `profiles.id` not `auth.users.id` — consistent with rest of codebase
- tenant RLS on unit_images uses `tenants.unit_id IS NOT NULL` guard to avoid matching tenants without a unit assignment
- Storage tenant SELECT policy uses foldername()[2] = unit_id segment (path is `{orgId}/{unitId}/{uuid}.ext`)

## Known limitations / tradeoffs

- `getSignedUrl()` in the storage abstraction uses `createClient()` which requires `await cookies()` — this means it must be called from a Server Component, Server Action, or Route Handler (never from client components). This is correct by design.
- The admin client (`createAdminClient()`) for upload bypasses RLS — the application-layer auth guard in the calling Server Action is the primary protection. Defense-in-depth is provided by the strict storage path template (orgId/unitId/uuid.ext) which prevents cross-org path writes.

## Out of scope (noticed but not changed)

- `src/types/index.ts` re-exports Profile type — not modified (only database.ts touched)
- Existing storage policies on incident-photos, receipts, contracts, task-proofs — not touched

## Service payments sync (PR #21)
- parseMonthlyData skips Airtable "copy" columns (view duplicates) to prevent monthly_data corruption
- Synthetic airtable_external_id = `${record.id}::${serviceType}` — one row per (property, service type)
- monthly_data JSONB: { "YYYY-MM": { amount, eecc, receipt_url } }
