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
