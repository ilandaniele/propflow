-- =============================================================================
-- Migration 0010: Agent Phase 8 — voice AI (Vapi).
-- Adds voice_config to agent_configs, the one-voice-channel-per-org guard,
-- agent_calls (durable outbound/inbound call rows), voice_do_not_call (DNC
-- list), and generalises agent_web_handoff_codes to also carry voice
-- ('VOZ-XXXXXX') codes that redeem only from a specific target_phone.
-- Idempotent — safe to re-run. Runs independently of 0007/0008 (Phase 5-6).
-- Apply with: psql $DATABASE_URL -f src/lib/db/migrations/0010_agent_voice.sql
-- =============================================================================

ALTER TABLE "agent_configs"
  ADD COLUMN IF NOT EXISTS "voice_config" JSONB NOT NULL DEFAULT '{}';

-- Only one 'voice' row per org in org_channels — one Vapi account serves all
-- orgs, so a second row per org would let one org's number bleed into another's.
CREATE UNIQUE INDEX IF NOT EXISTS org_channels_one_voice_per_org ON "org_channels"("org_id")
  WHERE channel = 'voice';

-- =============================================================================
-- agent_calls: one row per inbound or outbound voice call, tracked from
-- 'queued' through to 'ended'/'failed'/'skipped'/'blocked'. Outbound calls are
-- durable — a Fly restart never loses a queued call, it's just re-drained.
-- =============================================================================
CREATE TABLE IF NOT EXISTS "agent_calls" (
  "id"                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"            UUID NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "session_id"        UUID REFERENCES "agent_sessions"("id") ON DELETE SET NULL,
  "lead_id"           UUID REFERENCES "crm_leads"("id") ON DELETE SET NULL,
  "visit_id"          UUID REFERENCES "property_visits"("id") ON DELETE SET NULL,
  "direction"         TEXT NOT NULL CHECK ("direction" IN ('inbound', 'outbound')),
  "purpose"           TEXT NOT NULL CHECK ("purpose" IN ('inbound', 'speed_to_lead', 'visit_confirmation', 'reactivation')),
  "status"            TEXT NOT NULL DEFAULT 'queued'
    CHECK ("status" IN ('queued', 'dialing', 'in_progress', 'ended', 'failed', 'skipped', 'blocked')),
  "block_reason"      TEXT,
  "dedupe_key"        TEXT,
  "vapi_call_id"      TEXT UNIQUE,
  "phone_number_id"   TEXT,
  "customer_phone"    TEXT,
  "started_at"        TIMESTAMPTZ,
  "ended_at"          TIMESTAMPTZ,
  "duration_seconds"  INTEGER CHECK ("duration_seconds" IS NULL OR "duration_seconds" >= 0),
  "ended_reason"      TEXT,
  "outcome"           TEXT CHECK ("outcome" IS NULL OR "outcome" IN ('answered', 'no_answer', 'busy', 'voicemail', 'failed', 'abandoned')),
  "transcript"        TEXT,
  "recording_url"     TEXT,
  "summary"           TEXT,
  "cost_usd"          NUMERIC(10, 4),
  "cost_breakdown"    JSONB,
  "created_at"        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at"        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS agent_calls_dedupe ON "agent_calls"("org_id", "dedupe_key") WHERE "dedupe_key" IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_agent_calls_org_created ON "agent_calls"("org_id", "created_at");
CREATE INDEX IF NOT EXISTS idx_agent_calls_org_status ON "agent_calls"("org_id", "status");
CREATE INDEX IF NOT EXISTS idx_agent_calls_lead ON "agent_calls"("lead_id");

-- =============================================================================
-- voice_do_not_call: org-scoped DNC list. 'caller_request' rows can never be
-- removed by staff through the settings UI (see removeDoNotCall -> 'protected').
-- =============================================================================
CREATE TABLE IF NOT EXISTS "voice_do_not_call" (
  "org_id"             UUID NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "phone_e164"         TEXT NOT NULL CHECK ("phone_e164" ~ '^\+[1-9][0-9]{6,14}$'),
  "reason"             TEXT CHECK ("reason" IS NULL OR length("reason") <= 200),
  "source"             TEXT NOT NULL CHECK ("source" IN ('staff', 'caller_request')),
  "added_by_profile_id" UUID REFERENCES "profiles"("id") ON DELETE SET NULL,
  "created_at"         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY ("org_id", "phone_e164")
);

-- =============================================================================
-- agent_web_handoff_codes: generalised (Phase 7 -> Phase 8) to also carry
-- voice codes ('VOZ-XXXXXX'). A voice code has no web_session_id (voice turns
-- never run through the web widget) but must carry a call_id and the
-- target_phone it's allowed to redeem from — this is what neutralises a
-- spoofed caller ID: the code only ever redeems for the WhatsApp number it
-- was sent to.
-- =============================================================================
ALTER TABLE "agent_web_handoff_codes" ALTER COLUMN "web_session_id" DROP NOT NULL;

ALTER TABLE "agent_web_handoff_codes"
  ADD COLUMN IF NOT EXISTS "source" TEXT NOT NULL DEFAULT 'web' CHECK ("source" IN ('web', 'voice')),
  ADD COLUMN IF NOT EXISTS "call_id" UUID REFERENCES "agent_calls"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "target_phone" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_handoff_source') THEN
    ALTER TABLE "agent_web_handoff_codes"
      ADD CONSTRAINT chk_handoff_source CHECK (
        ("source" = 'web' AND "web_session_id" IS NOT NULL)
        OR ("source" = 'voice' AND "call_id" IS NOT NULL AND "target_phone" IS NOT NULL)
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_handoff_voice_phone ON "agent_web_handoff_codes"("org_id", "target_phone", "status") WHERE "source" = 'voice';
