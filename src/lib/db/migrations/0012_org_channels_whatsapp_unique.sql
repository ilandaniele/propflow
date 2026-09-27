-- =============================================================================
-- Migration 0012: one-whatsapp-channel-per-org guard.
-- Mirrors org_channels_one_web_per_org (0009) / org_channels_one_voice_per_org
-- (0010) — saveWhatsAppChannel() (src/app/actions/agent-setup.ts) assumes
-- exactly one 'whatsapp' row per org, but nothing in the DB enforced that
-- until now. Prod has zero 'whatsapp' rows today, so a plain unique index is
-- safe to add without a dedup pass.
-- Idempotent — safe to re-run.
-- Apply with: psql $DATABASE_URL -f src/lib/db/migrations/0012_org_channels_whatsapp_unique.sql
-- =============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS org_channels_one_whatsapp_per_org ON "org_channels"("org_id")
  WHERE channel = 'whatsapp';
