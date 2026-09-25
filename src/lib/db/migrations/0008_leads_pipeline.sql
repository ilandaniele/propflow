-- =============================================================================
-- Migration 0008: Agent Phase 6 — dual-pipeline leads kanban, advisor routing,
-- follow-up sequencing, cold-lead listing alerts, and the weekly QA export.
-- Apply with: psql $DATABASE_URL -f src/lib/db/migrations/0008_leads_pipeline.sql
-- Idempotent — safe to re-run.
-- =============================================================================

-- =============================================================================
-- crm_leads: the fixed enum CHECK on `stage` (0004, inline column default →
-- Postgres-generated name crm_leads_stage_check; confirmed against
-- `\d crm_leads` before writing this) is replaced by a format CHECK, so org
-- admins can add/rename/reorder stages without a migration. `status` is left
-- untouched (legacy, no longer rendered).
-- =============================================================================
ALTER TABLE "crm_leads" DROP CONSTRAINT IF EXISTS "crm_leads_stage_check";

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_leads_stage_format') THEN
    ALTER TABLE "crm_leads" ADD CONSTRAINT "crm_leads_stage_format"
      CHECK (stage ~ '^[a-z][a-z0-9_]{1,39}$');
  END IF;
END $$;

ALTER TABLE "crm_leads"
  ADD COLUMN IF NOT EXISTS "assigned_at" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "stage_changed_at" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "followup_state" TEXT NOT NULL DEFAULT 'idle'
    CHECK (followup_state IN ('idle', 'active', 'stopped', 'completed')),
  ADD COLUMN IF NOT EXISTS "followup_stop_reason" TEXT,
  ADD COLUMN IF NOT EXISTS "last_listing_alert_at" TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_crm_leads_org_pipeline_stage ON "crm_leads"("org_id", "pipeline", "stage");
CREATE INDEX IF NOT EXISTS idx_crm_leads_org_assigned ON "crm_leads"("org_id", "assigned_profile_id");

-- =============================================================================
-- lead_pipeline_stages: per-org, per-pipeline stage list. System stages (the
-- keys Phase 3/4 code writes — see src/lib/leads/types.ts SYSTEM_STAGES) are
-- seeded lazily by getPipelineStages() on first read, not by this migration,
-- so a fresh org with zero leads never gets rows it doesn't need.
-- =============================================================================
CREATE TABLE IF NOT EXISTS "lead_pipeline_stages" (
  "id"          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"      UUID NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "pipeline"    TEXT NOT NULL CHECK (pipeline IN ('demand', 'supply')),
  "key"         TEXT NOT NULL CHECK (key ~ '^[a-z][a-z0-9_]{1,39}$'),
  "label"       TEXT NOT NULL CHECK (char_length(label) BETWEEN 1 AND 60),
  "position"    INTEGER NOT NULL,
  "kind"        TEXT NOT NULL CHECK (kind IN ('open', 'won', 'lost')),
  "color"       TEXT CHECK (color IS NULL OR color ~ '^#[0-9a-fA-F]{6}$'),
  "is_system"   BOOLEAN NOT NULL DEFAULT false,
  "archived"    BOOLEAN NOT NULL DEFAULT false,
  "created_at"  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at"  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT lead_pipeline_stages_org_pipeline_key_uniq UNIQUE ("org_id", "pipeline", "key")
);

CREATE INDEX IF NOT EXISTS idx_lead_pipeline_stages_org_pipeline
  ON "lead_pipeline_stages"("org_id", "pipeline", "position");

-- =============================================================================
-- lead_routing_members: advisors participating in round-robin/weighted
-- assignment. `pipeline` scopes eligibility; 'both' means either pipeline.
-- =============================================================================
CREATE TABLE IF NOT EXISTS "lead_routing_members" (
  "id"                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"            UUID NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "profile_id"        UUID NOT NULL REFERENCES "profiles"("id") ON DELETE CASCADE,
  "pipeline"          TEXT NOT NULL DEFAULT 'both' CHECK (pipeline IN ('demand', 'supply', 'both')),
  "weight"            INTEGER NOT NULL DEFAULT 1 CHECK (weight BETWEEN 1 AND 100),
  "active"            BOOLEAN NOT NULL DEFAULT true,
  "max_open_leads"    INTEGER CHECK (max_open_leads IS NULL OR max_open_leads > 0),
  "assigned_count"    INTEGER NOT NULL DEFAULT 0,
  "last_assigned_at"  TIMESTAMPTZ,
  "created_at"        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at"        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT lead_routing_members_org_profile_uniq UNIQUE ("org_id", "profile_id")
);

-- =============================================================================
-- lead_assignments: audit trail of every (re)assignment.
-- =============================================================================
CREATE TABLE IF NOT EXISTS "lead_assignments" (
  "id"                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"                 UUID NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "lead_id"                UUID NOT NULL REFERENCES "crm_leads"("id") ON DELETE CASCADE,
  "profile_id"             UUID REFERENCES "profiles"("id") ON DELETE SET NULL,
  "previous_profile_id"    UUID REFERENCES "profiles"("id") ON DELETE SET NULL,
  "method"                 TEXT CHECK (method IN ('round_robin', 'weighted', 'manual', 'visit', 'reassign')),
  "assigned_by_profile_id" UUID REFERENCES "profiles"("id") ON DELETE SET NULL,
  "created_at"             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lead_assignments_org_created ON "lead_assignments"("org_id", "created_at");
CREATE INDEX IF NOT EXISTS idx_lead_assignments_lead ON "lead_assignments"("lead_id");

-- =============================================================================
-- lead_followups: a scheduled follow-up sequence, re-anchored on every new
-- agent reply (scheduleFollowupSequence supersedes prior 'scheduled' rows).
-- =============================================================================
CREATE TABLE IF NOT EXISTS "lead_followups" (
  "id"                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"              UUID NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "lead_id"             UUID NOT NULL REFERENCES "crm_leads"("id") ON DELETE CASCADE,
  "session_id"          UUID REFERENCES "agent_sessions"("id") ON DELETE SET NULL,
  "sequence_anchor_at"  TIMESTAMPTZ NOT NULL,
  "step"                INTEGER NOT NULL CHECK (step BETWEEN 1 AND 10),
  "kind"                TEXT NOT NULL CHECK (kind IN ('text', 'template')),
  "template_name"       TEXT,
  "scheduled_for"       TIMESTAMPTZ NOT NULL,
  "status"              TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'sending', 'sent', 'skipped', 'cancelled', 'failed')),
  "stop_reason"         TEXT,
  "sent_at"             TIMESTAMPTZ,
  "created_at"          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at"          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT lead_followups_lead_anchor_step_uniq UNIQUE ("lead_id", "sequence_anchor_at", "step")
);

CREATE INDEX IF NOT EXISTS idx_lead_followups_org_status_scheduled
  ON "lead_followups"("org_id", "status", "scheduled_for");
CREATE INDEX IF NOT EXISTS idx_lead_followups_lead_status ON "lead_followups"("lead_id", "status");

-- =============================================================================
-- lead_listing_alerts: claim table for cold-lead new-listing notifications —
-- ON CONFLICT DO NOTHING on (lead_id, listing_id) is the send-once guarantee.
-- =============================================================================
CREATE TABLE IF NOT EXISTS "lead_listing_alerts" (
  "id"          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"      UUID NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "lead_id"     UUID NOT NULL REFERENCES "crm_leads"("id") ON DELETE CASCADE,
  "listing_id"  UUID NOT NULL REFERENCES "listings"("id") ON DELETE CASCADE,
  "status"      TEXT CHECK (status IN ('sent', 'skipped', 'failed')),
  "reason"      TEXT,
  "created_at"  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT lead_listing_alerts_lead_listing_uniq UNIQUE ("lead_id", "listing_id")
);

-- =============================================================================
-- qa_exports: one row per (org, ISO week), holding the generated CSV so the
-- download route never has to recompute it.
-- =============================================================================
CREATE TABLE IF NOT EXISTS "qa_exports" (
  "id"                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"                   UUID NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "week_start"               DATE NOT NULL,
  "period_start"             TIMESTAMPTZ,
  "period_end"               TIMESTAMPTZ,
  "row_count"                INTEGER,
  "handoff_count"            INTEGER,
  "complaint_count"          INTEGER,
  "takeover_count"           INTEGER,
  "csv"                      TEXT NOT NULL,
  "emailed_at"                TIMESTAMPTZ,
  "email_recipient_count"     INTEGER NOT NULL DEFAULT 0,
  "created_at"                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT qa_exports_org_week_uniq UNIQUE ("org_id", "week_start")
);

CREATE INDEX IF NOT EXISTS idx_agent_events_org_kind_ts ON "agent_events"("org_id", "kind", "created_at");

-- =============================================================================
-- listings.published_at: maintained by trigger so no listing-writing code
-- needs to change. Only flips on a false→true transition (or an insert that
-- is already published), and never resets once set.
-- =============================================================================
ALTER TABLE "listings" ADD COLUMN IF NOT EXISTS "published_at" TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION listings_set_published_at() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.published AND (TG_OP = 'INSERT' OR OLD.published IS DISTINCT FROM true) THEN
    NEW.published_at := NOW();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_listings_published_at ON "listings";
CREATE TRIGGER trg_listings_published_at
  BEFORE INSERT OR UPDATE OF "published" ON "listings"
  FOR EACH ROW EXECUTE FUNCTION listings_set_published_at();

UPDATE "listings" SET "published_at" = "created_at" WHERE "published" AND "published_at" IS NULL;
