-- =============================================================================
-- Migration 0007: Agent Phase 5 — Google Calendar integration. One OAuth
-- connection per advisor (profile), tokens encrypted at rest, plus the
-- Google-side sync bookkeeping columns on property_visits (google_event_id
-- itself already exists from 0006).
-- Apply with: psql $DATABASE_URL -f src/lib/db/migrations/0007_calendar.sql
-- Idempotent — safe to re-run.
-- =============================================================================

-- =============================================================================
-- calendar_connections: one row per (org, advisor profile). refresh_token_enc
-- and access_token_enc are AES-GCM ciphertext from src/lib/crypto/encrypt.ts —
-- never plaintext, never logged. sync_token/sync_page_token live here (not on
-- property_visits) because there is exactly one Google calendar per
-- connection.
-- =============================================================================
CREATE TABLE IF NOT EXISTS "calendar_connections" (
  "id"                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"                    UUID NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "profile_id"                UUID NOT NULL REFERENCES "profiles"("id") ON DELETE CASCADE,
  "provider"                  TEXT NOT NULL DEFAULT 'google' CHECK (provider IN ('google')),
  "google_email"               TEXT NOT NULL,
  "calendar_id"                TEXT NOT NULL DEFAULT 'primary',
  "scopes"                     TEXT[] NOT NULL DEFAULT '{}',
  "refresh_token_enc"          TEXT NOT NULL,
  "access_token_enc"           TEXT,
  "access_token_expires_at"    TIMESTAMPTZ,
  "status"                     TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked', 'error')),
  "last_error"                 TEXT,
  "freebusy_enabled"           BOOLEAN NOT NULL DEFAULT true,
  "write_events"               BOOLEAN NOT NULL DEFAULT true,
  "sync_token"                 TEXT,
  "sync_page_token"            TEXT,
  "last_synced_at"             TIMESTAMPTZ,
  "last_full_sync_at"          TIMESTAMPTZ,
  "created_at"                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at"                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS calendar_connections_org_profile_uidx
  ON "calendar_connections"("org_id", "profile_id");
CREATE INDEX IF NOT EXISTS idx_calendar_connections_org_status
  ON "calendar_connections"("org_id", "status");

-- =============================================================================
-- property_visits: Google sync bookkeeping. 'none' = never synced or the
-- advisor has no connection; 'pending' = a push job is queued; 'synced' =
-- last push succeeded; 'error' = last push failed (see google_sync_error);
-- 'detached' = the Google event was deleted out-of-band; 'drift' = the Google
-- event was moved out-of-band and staff must resolve it.
-- =============================================================================
ALTER TABLE "property_visits"
  ADD COLUMN IF NOT EXISTS "google_connection_id" UUID REFERENCES "calendar_connections"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "google_sync_status" TEXT NOT NULL DEFAULT 'none'
    CHECK (google_sync_status IN ('none', 'pending', 'synced', 'error', 'detached', 'drift')),
  ADD COLUMN IF NOT EXISTS "google_event_etag" TEXT,
  ADD COLUMN IF NOT EXISTS "google_synced_at" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "google_sync_error" TEXT,
  ADD COLUMN IF NOT EXISTS "google_drift_starts_at" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "google_drift_ends_at" TIMESTAMPTZ;

-- google_event_id already exists (0006). One event per connection, and NULL
-- (never synced / detached) rows are excluded so they never collide.
CREATE UNIQUE INDEX IF NOT EXISTS property_visits_google_event_uniq
  ON "property_visits"("google_connection_id", "google_event_id")
  WHERE "google_event_id" IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_property_visits_google_pending
  ON "property_visits"("profile_id", "updated_at")
  WHERE "google_sync_status" IN ('pending', 'error');
