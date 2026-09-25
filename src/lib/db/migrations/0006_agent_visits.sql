-- =============================================================================
-- Migration 0006: Agent Phase 3-4 — internal agenda, visit booking, reminders
-- and post-visit follow-up. Runs in parallel with 0005 (Phase 2); both apply
-- cleanly to the same baseline. Idempotent — safe to re-run.
-- Apply by hand: psql $DATABASE_URL -f src/lib/db/migrations/0006_agent_visits.sql
-- NEVER `drizzle-kit push` (see the EXCLUDE constraint note below).
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- =============================================================================
-- agent_advisor_settings: one row per advisor (profiles.role='admin'). Visit
-- length, buffer, minimum notice, horizon and slot granularity live here
-- (advisor-level), not on agent_availability (which only holds weekly
-- windows) — see blueprint §0.2.
-- =============================================================================
CREATE TABLE IF NOT EXISTS "agent_advisor_settings" (
  "id"                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"             UUID NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "profile_id"         UUID NOT NULL REFERENCES "profiles"("id") ON DELETE CASCADE,
  "accepts_visits"     BOOLEAN NOT NULL DEFAULT true,
  "visit_minutes"      INTEGER NOT NULL DEFAULT 45 CHECK (visit_minutes BETWEEN 10 AND 240),
  "buffer_minutes"     INTEGER NOT NULL DEFAULT 15 CHECK (buffer_minutes BETWEEN 0 AND 120),
  "min_notice_minutes" INTEGER NOT NULL DEFAULT 120 CHECK (min_notice_minutes >= 0),
  "days_ahead"         INTEGER NOT NULL DEFAULT 14 CHECK (days_ahead BETWEEN 1 AND 60),
  "slot_step_minutes"  INTEGER NOT NULL DEFAULT 30 CHECK (slot_step_minutes IN (15, 30, 60)),
  "created_at"         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at"         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS agent_advisor_settings_org_profile_uidx
  ON "agent_advisor_settings"("org_id", "profile_id");

-- =============================================================================
-- agent_availability: weekly recurring windows only (weekday 0=Sunday, same
-- as JS Date#getDay). start/end are minutes-of-day in the advisor's local
-- (org) timezone.
-- =============================================================================
CREATE TABLE IF NOT EXISTS "agent_availability" (
  "id"           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"       UUID NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "profile_id"   UUID NOT NULL REFERENCES "profiles"("id") ON DELETE CASCADE,
  "weekday"      SMALLINT NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  "start_minute" INTEGER NOT NULL CHECK (start_minute BETWEEN 0 AND 1439),
  "end_minute"   INTEGER NOT NULL CHECK (end_minute BETWEEN 1 AND 1440),
  "created_at"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT agent_availability_end_after_start CHECK (end_minute > start_minute)
);

CREATE INDEX IF NOT EXISTS idx_agent_availability_org_profile
  ON "agent_availability"("org_id", "profile_id");

-- =============================================================================
-- agent_availability_exceptions: one-off blocks ('block' removes availability)
-- or extras ('extra' adds availability outside the weekly windows).
-- =============================================================================
CREATE TABLE IF NOT EXISTS "agent_availability_exceptions" (
  "id"                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"                 UUID NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "profile_id"             UUID NOT NULL REFERENCES "profiles"("id") ON DELETE CASCADE,
  "starts_at"              TIMESTAMPTZ NOT NULL,
  "ends_at"                TIMESTAMPTZ NOT NULL,
  "kind"                   TEXT NOT NULL CHECK (kind IN ('block', 'extra')),
  "reason"                 TEXT,
  "created_by_profile_id"  UUID REFERENCES "profiles"("id") ON DELETE SET NULL,
  "created_at"             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT agent_availability_exceptions_ends_after_starts CHECK (ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS idx_agent_availability_exceptions_org_profile_starts
  ON "agent_availability_exceptions"("org_id", "profile_id", "starts_at");

-- =============================================================================
-- property_visits: the single source of truth for visit bookings. blocked_until
-- is a real column (app-written) rather than a generated one because
-- `timestamptz ± interval` is STABLE, not IMMUTABLE, so Postgres refuses it in
-- a generated column / index expression. The buffer only applies after the
-- visit: [starts_at, blocked_until) with blocked_until = ends_at + buffer.
-- =============================================================================
CREATE TABLE IF NOT EXISTS "property_visits" (
  "id"                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"                 UUID NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "lead_id"                UUID NOT NULL REFERENCES "crm_leads"("id") ON DELETE CASCADE,
  "listing_id"             UUID REFERENCES "listings"("id") ON DELETE SET NULL,
  "profile_id"             UUID NOT NULL REFERENCES "profiles"("id") ON DELETE RESTRICT,
  "session_id"             UUID REFERENCES "agent_sessions"("id") ON DELETE SET NULL,
  "contact_phone"          TEXT,
  "starts_at"              TIMESTAMPTZ NOT NULL,
  "ends_at"                TIMESTAMPTZ NOT NULL,
  "blocked_until"          TIMESTAMPTZ NOT NULL,
  "status"                 TEXT NOT NULL DEFAULT 'scheduled'
                              CHECK (status IN ('scheduled', 'confirmed', 'completed', 'no_show', 'cancelled', 'rescheduled')),
  "created_by"             TEXT NOT NULL CHECK (created_by IN ('agent', 'human')),
  "created_by_profile_id"  UUID REFERENCES "profiles"("id") ON DELETE SET NULL,
  "source_channel"         TEXT NOT NULL CHECK (source_channel IN ('whatsapp', 'web', 'voice', 'manual')),
  "rescheduled_from_id"    UUID REFERENCES "property_visits"("id") ON DELETE SET NULL,
  "google_event_id"        TEXT,
  "notes"                  TEXT,
  "cancel_reason"          TEXT,
  "feedback"               TEXT CHECK (feedback IS NULL OR feedback IN ('interested', 'not_interested', 'wants_more')),
  "outcome_source"         TEXT CHECK (outcome_source IS NULL OR outcome_source IN ('staff', 'lead')),
  "confirmed_at"           TIMESTAMPTZ,
  "cancelled_at"           TIMESTAMPTZ,
  "completed_at"           TIMESTAMPTZ,
  "reminder_24h_sent_at"   TIMESTAMPTZ,
  "reminder_2h_sent_at"    TIMESTAMPTZ,
  "advisor_reminded_at"    TIMESTAMPTZ,
  "post_check_sent_at"     TIMESTAMPTZ,
  "feedback_requested_at"  TIMESTAMPTZ,
  "reoffer_sent_at"        TIMESTAMPTZ,
  "created_at"             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at"             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT property_visits_ends_after_starts CHECK (ends_at > starts_at),
  CONSTRAINT property_visits_blocked_after_ends CHECK (blocked_until >= ends_at)
);

CREATE INDEX IF NOT EXISTS idx_property_visits_org_starts ON "property_visits"("org_id", "starts_at");
CREATE INDEX IF NOT EXISTS idx_property_visits_org_profile_starts ON "property_visits"("org_id", "profile_id", "starts_at");
CREATE INDEX IF NOT EXISTS idx_property_visits_lead ON "property_visits"("lead_id");
CREATE INDEX IF NOT EXISTS idx_property_visits_org_phone_status ON "property_visits"("org_id", "contact_phone", "status");
CREATE INDEX IF NOT EXISTS idx_property_visits_org_created ON "property_visits"("org_id", "created_at");

-- No two active (scheduled/confirmed) visits for the same advisor may overlap
-- once the post-visit buffer is included — this is the DB-level backstop for
-- the same predicate service.ts checks in the app before inserting.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'property_visits_no_overlap') THEN
    ALTER TABLE "property_visits" ADD CONSTRAINT property_visits_no_overlap
      EXCLUDE USING gist (
        "profile_id" WITH =,
        tstzrange("starts_at", "blocked_until", '[)') WITH &&
      )
      WHERE (status IN ('scheduled', 'confirmed'));
  END IF;
END $$;
