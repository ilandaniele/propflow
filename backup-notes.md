# Backup Notes — propflow staging (Supabase Free)

## Supabase free-tier backup limitations

Supabase free tier does NOT include Point-in-Time Recovery (PITR) or scheduled
automated backups to an external store. The only included backup is a daily
snapshot retained for a short period within Supabase infrastructure — but it is
not downloadable on the free tier and is not guaranteed for disaster recovery.

Summary of free-tier backup constraints:
- No PITR (requires Supabase Pro $25/mo)
- No downloadable backup files from the Supabase dashboard
- Backup history retention: minimal (hours/1 day for internal snapshots)
- Database size cap: 500 MB (pause if exceeded)

For the MVP staging environment (no production data, no real users), this is
acceptable. Before any real-user / production promotion, upgrade to Supabase Pro
($25/mo) which includes 7-day PITR and downloadable backups.

## Manual pg_dump for staging

Run this from a machine with psql / pg_dump installed, using the DIRECT connection
URL (not the pooled URL — pg_dump does not work via PgBouncer).

```bash
# Set the direct DB URL (from Supabase Dashboard → Settings → Database → Connection String → URI)
# Example format: postgres://postgres.[ref]:[password]@db.[ref].supabase.co:5432/postgres
export SUPABASE_DB_DIRECT_URL="postgres://postgres.yourref:yourpassword@db.yourref.supabase.co:5432/postgres"

# Run pg_dump and compress
pg_dump "$SUPABASE_DB_DIRECT_URL" \
  --no-acl \
  --no-owner \
  | gzip > "propflow-staging-backup-$(date +%Y%m%d-%H%M%S).sql.gz"

# Verify the file exists and has non-zero size
ls -lh propflow-staging-backup-*.sql.gz
```

Store the resulting `.sql.gz` file locally or upload it to a secure location
(e.g. Cloudflare R2 free 10 GB tier, or a private S3 bucket).

## Restore from pg_dump

```bash
# Decompress and restore to a fresh Supabase project (or local Postgres)
gunzip -c propflow-staging-backup-<timestamp>.sql.gz \
  | psql "$SUPABASE_DB_DIRECT_URL"
```

Note: restoring into an existing project with data will produce conflicts on
unique constraints / primary keys. For a clean restore, use a fresh empty project
or truncate all tables first.

## Recommended cadence for staging

- Run a manual pg_dump before any migration that drops columns or tables.
- Run a manual pg_dump before the first real user data is entered (pre-production).
- Store backups for at least 30 days.

## When to upgrade to Pro for backups

Upgrade Supabase to Pro ($25/mo) before:
- Any real tenant (customer) data is stored
- Going live with an actual organization account
- Any financial data (payments, charges) entering the system with real amounts

Pro gives you 7-day PITR, downloadable backups via the dashboard, and removes
the 1-week inactivity auto-pause (critical for always-on staging or production).
