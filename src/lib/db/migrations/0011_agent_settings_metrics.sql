-- =============================================================================
-- Migration 0011: Agent Phase 9 — full settings and metrics.
-- Adds the two remaining agent_configs limits (max_active_visits_per_phone,
-- max_listing_photos), agent_session_listings (the "did this session already
-- see this listing" guard for send_listing_card / send_listing_photos), and
-- the aggregation indexes the metrics dashboard's per-channel queries need.
-- Idempotent — safe to re-run.
-- Apply with: psql $DATABASE_URL -f src/lib/db/migrations/0011_agent_settings_metrics.sql
-- =============================================================================

ALTER TABLE "agent_configs"
  ADD COLUMN IF NOT EXISTS "max_active_visits_per_phone" INTEGER NOT NULL DEFAULT 2
    CHECK ("max_active_visits_per_phone" BETWEEN 1 AND 10),
  ADD COLUMN IF NOT EXISTS "max_listing_photos" INTEGER NOT NULL DEFAULT 5
    CHECK ("max_listing_photos" BETWEEN 1 AND 10);

-- =============================================================================
-- agent_session_listings: every listing id a session has actually seen
-- (returned by search_listings, or the page/attribution listing) — the only
-- ids send_listing_card / send_listing_photos are allowed to act on.
-- =============================================================================
CREATE TABLE IF NOT EXISTS "agent_session_listings" (
  "session_id"  UUID NOT NULL REFERENCES "agent_sessions"("id") ON DELETE CASCADE,
  "org_id"      UUID NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "listing_id"  UUID NOT NULL REFERENCES "listings"("id") ON DELETE CASCADE,
  "source"      TEXT NOT NULL CHECK ("source" IN ('search', 'attribution', 'page')),
  "created_at"  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY ("session_id", "listing_id")
);

-- =============================================================================
-- Aggregation indexes for the metrics dashboard (item E) — every query there
-- groups by org + channel/time range over ALL rows, never a LIMIT-ed page.
-- =============================================================================
CREATE INDEX IF NOT EXISTS idx_agent_sessions_org_channel_created ON "agent_sessions"("org_id", "channel", "created_at");
CREATE INDEX IF NOT EXISTS idx_agent_messages_org_created ON "agent_messages"("org_id", "created_at");
CREATE INDEX IF NOT EXISTS idx_crm_leads_org_created ON "crm_leads"("org_id", "created_at");
CREATE INDEX IF NOT EXISTS idx_wa_msg_conv_dir_created ON "whatsapp_messages"("conversation_id", "direction", "created_at");
