-- =============================================================================
-- Migration 0003: Agent Phase 0 foundations
-- org_channels (route an inbound channel identifier to an org) and
-- agent_jobs (durable queue for the real-estate agent's async work).
-- Apply with: psql $DATABASE_URL -f src/lib/db/migrations/0003_agent_phase0.sql
-- =============================================================================

-- =============================================================================
-- org_channels: maps a WhatsApp phone_number_id / widget public key / voice
-- number to the organization that owns it. Replaces the webhook's previous
-- `SELECT organizations LIMIT 1` org resolution for real Meta traffic.
-- =============================================================================
CREATE TABLE IF NOT EXISTS "org_channels" (
  "id"          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"      UUID NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "channel"     TEXT NOT NULL,               -- 'whatsapp' | 'web' | 'voice'
  "external_id" TEXT NOT NULL,               -- phone_number_id | widget public key | voice number
  "config"      JSONB NOT NULL DEFAULT '{}',
  "created_at"  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at"  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_org_channels_channel_external UNIQUE (channel, external_id)
);

CREATE INDEX IF NOT EXISTS idx_org_channels_org ON "org_channels"("org_id");

-- To route your first WhatsApp number once you have a Meta phone_number_id:
--   INSERT INTO org_channels (org_id, channel, external_id)
--   VALUES ('<your-org-id>', 'whatsapp', '<phone_number_id>');

-- =============================================================================
-- agent_jobs: durable queue for reminders, follow-ups, calendar sync and
-- outbound calls. Claimed with FOR UPDATE SKIP LOCKED (see src/lib/agent/jobs.ts).
-- =============================================================================
CREATE TABLE IF NOT EXISTS "agent_jobs" (
  "id"            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"        UUID NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "kind"          TEXT NOT NULL,
  "run_at"        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "payload"       JSONB NOT NULL DEFAULT '{}',
  "status"        TEXT NOT NULL DEFAULT 'pending',  -- 'pending'|'processing'|'done'|'failed'
  "attempts"      INTEGER NOT NULL DEFAULT 0,
  "last_error"    TEXT,
  "locked_until"  TIMESTAMPTZ,
  "created_at"    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at"    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_jobs_due ON "agent_jobs"("status", "run_at");
CREATE INDEX IF NOT EXISTS idx_agent_jobs_org ON "agent_jobs"("org_id");
