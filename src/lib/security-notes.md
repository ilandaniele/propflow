# Security Notes — propflow (post-Supabase removal)

## Status: W9 complete (2026-06-22)

---

## Implemented guards (this PR)

- **CSP**: nonce-based strict CSP in `src/proxy.ts`. `connect-src` and `img-src` include Tigris
  endpoint (`process.env.TIGRIS_ENDPOINT ?? https://fly.storage.tigris.dev`). No `*.supabase.co`
  domains remain. No `unsafe-eval`. Script src uses `nonce-{nonce} strict-dynamic`.
- **debug route**: `GET /api/debug/airtable-meta` requires admin session via `requireAdmin()` guard.
  Returns 401 for unauthenticated/non-admin callers.
- **/api/dev absent**: directory does not exist in this codebase.
- **WhatsApp webhook rate limiting**: `webhookRateLimit` (60 req/min/IP) enforced in
  `src/app/api/whatsapp/webhook/route.ts` before any DB work.
- **Cron endpoints**: protected by `CRON_SECRET` bearer (constant-time compare) — no additional
  rate limit needed; they are only called by Fly scheduled machines.
- **NEXT_PUBLIC_ exposure audit**: only `NEXT_PUBLIC_SITE_URL` (safe) and
  `NEXT_PUBLIC_META_APP_ID` (safe — Meta public app ID) are exposed to the browser. All Tigris,
  Airtable, database, and auth secrets are server-only.

---

## Remaining TODOs (human steps required)

### CRITICAL — do immediately after deploy

1. **Rotate exposed Supabase anon key**: The Supabase anon key was committed in `fly.toml` git
   history. Go to https://supabase.com → project settings → API → "Roll anon key". Old key will
   be invalidated. (Supabase project itself is being decommissioned, but the key should be rotated
   now to prevent any abuse window.)

2. **Unset stale secrets from Fly**: After deploy, run:
   ```
   flyctl secrets unset NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY RESET_ADMIN_TOKEN
   ```

3. **Set Tigris bucket CORS policy**: Allow `https://propflow-app.fly.dev` as the only origin for
   PUT/GET on the bucket. Use `flyctl storage cors` or the Tigris dashboard. Without this,
   browser-direct S3 presigned URL uploads may be blocked or overly permissive.

### Medium priority

4. **Rate limit AI endpoints** (`/api/ai/chat`, `/api/ai/executive-brief`, `/api/receipts/ocr`):
   These call Anthropic and incur per-token costs. Currently they require an admin session
   (requireAdmin guard) which limits abuse to authenticated admins. If the org grows to multiple
   admin accounts, consider adding per-user token-budget enforcement or Upstash rate limits.
   Estimated effort: 2h.

5. **Airtable PAT rotation**: `AIRTABLE_PAT` grants write access to the Airtable base. It is
   never exposed to the browser, but if the Fly secrets are compromised, it could be used to
   corrupt sync data. Rotate it periodically in Airtable account settings → developer tokens.

6. **Delete `/api/debug/airtable-meta` after diagnosis is complete**: This endpoint is marked
   "Temporary diagnostic endpoint" in its source. Once the Airtable sync is confirmed working,
   delete `src/app/api/debug/airtable-meta/route.ts` entirely.

### Low priority / informational

7. **CSP `style-src unsafe-inline`**: Kept because Tailwind + styled-jsx require it. This is
   standard for Tailwind-based apps. No script injection risk from style-only unsafe-inline.

8. **`img-src https:`**: The `img-src` directive allows all HTTPS image sources. This is
   intentional for tenant-uploaded receipt images that may be served from Tigris presigned URLs
   with dynamic hostnames. Tightening to `img-src 'self' data: *.fly.storage.tigris.dev` would
   be more restrictive — consider doing this once the Tigris bucket hostname is confirmed stable.

9. **Org-level IDOR**: All Drizzle queries on org-scoped tables include `eq(table.orgId, ctx.orgId)`.
   This is enforced at the application layer (not DB-level RLS, since Supabase was removed).
   A defense-in-depth option is to add a Postgres row-level policy on the Fly Postgres instance,
   but this is optional for a single-tenant deployment.
