# supabase/migrations — Convention & Workflow

## Directory purpose

All database schema changes, RLS policies, helper SQL functions, indexes, and views
live here as numbered SQL migration files. The Supabase CLI applies them in
lexicographic order.

## File naming convention

```
<timestamp>_<description>.sql
```

Example:
```
20260528000001_init_schema.sql
20260528000002_rls_policies.sql
20260528000003_helper_functions.sql
20260528000004_indexes.sql
20260528000005_views_tenant_statement.sql
20260528000006_seed_demo_orgs.sql   <-- staging/dev seed ONLY, not prod
```

Generate the timestamp prefix with:
```bash
npx supabase migration new <description>
# or manually: date -u +%Y%m%d%H%M%S
```

## What belongs in migrations (senior-dev authors these)

1. `CREATE TABLE` + `ALTER TABLE ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY`
   for every domain table listed in spec.md:
   organizations, profiles, properties, units, tenants, contracts,
   charges, payments, incidents, incident_comments

2. RLS policies for each table (SELECT / INSERT / UPDATE / DELETE per role).
   Helper functions:
   - `current_org_id()` — returns `profiles.org_id` where `id = auth.uid()`
   - `current_role()` — returns `profiles.role` where `id = auth.uid()`
   Both must read from the JWT / `auth.uid()` — never from a client-supplied parameter.

3. Indexes per spec.md (org_id, composite indexes for common queries).

4. The `tenant_statement` view (balance = approved_payments - charges per tenant, RLS-scoped).

5. Supabase Storage bucket creation + bucket RLS policies (incidents private bucket,
   path pattern: `{org_id}/{incident_id}/{uuid}`).

6. Seed migration (only applied to staging/dev via `--local` or manually to staging project):
   - 2 demo orgs (Org A, Org B) with distinct admin users + tenant users
   - Sufficient data to exercise isolation acceptance scenarios
   - Run via `SUPABASE_DB_URL=<staging-direct-url> npx supabase db push` or the seed script

## One-time CLI setup (human step — do once per developer)

```bash
# Install Supabase CLI (if not already installed)
npm install supabase --save-dev
# or: npm install -g supabase

# Link the CLI to the staging Supabase project
npx supabase login
# (Opens browser for OAuth — you need Supabase account)

npx supabase link --project-ref <your-staging-project-ref>
# Project ref found in: Supabase Dashboard → Project Settings → General → Reference ID
# The CLI will prompt for the DB password (set in Supabase Dashboard → Database → Database password)
```

## Applying migrations to staging

### Option A — Supabase CLI (recommended)

```bash
# Push all pending migrations to the linked staging project
npx supabase db push
# This applies every migration in supabase/migrations/ that has not yet been applied.
# It uses the linked project (set by `supabase link` above).

# Verify applied migrations
npx supabase migration list
```

### Option B — Direct psql (fallback)

```bash
# Apply a specific migration manually
psql "$SUPABASE_DB_URL" -f supabase/migrations/20260528000001_init_schema.sql
```

Note: use the DIRECT connection URL (not the pooled/pooler URL) for migrations.
The pooled URL is for application query traffic only.

## Running the seed (staging only)

```bash
# Never run the seed against production automatically.
# The seed creates demo orgs (A + B) + admin + tenant users for testing isolation.
node scripts/seed.ts
# or: npx tsx scripts/seed.ts
# Requires SUPABASE_DB_URL + SUPABASE_SERVICE_ROLE_KEY set in your environment.
```

The seed script uses the service-role key (bypasses RLS) to insert the demo data.
After seeding, log in as the demo admin to reach /dashboard and as the demo tenant
to reach /portal.

## RLS test notes

The RLS integration test layer (Vitest) spins up two separately-scoped Supabase
clients — one authenticated as an Org A admin, one as an Org B admin — and asserts:
- Cross-org queries return 0 rows
- Cross-org writes are rejected by WITH CHECK policies
- Tenant T1 cannot read T2's payments (same org)

These tests run against a local Supabase instance (`npx supabase start`) or against
the staging project when `E2E_ENABLED=true` in GitHub Actions.

## Local development

```bash
# Start local Supabase stack (Postgres + Auth + Storage + Realtime)
npx supabase start

# Apply migrations to local
npx supabase db push --local

# Stop local stack
npx supabase stop
```

Local Supabase runs on http://localhost:54321 (API) and http://localhost:54323 (Studio).
Set NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 in .env.local for local dev.
