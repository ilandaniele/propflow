-- =============================================================================
-- Migration 0009: Agent Phase 7 — public catalogue pages + web chat widget.
-- Adds the opt-in public_pages_enabled switch, the one-web-channel-per-org
-- guard, a backfill for listings.public_slug (byte-identical to
-- src/lib/widget/slug.ts's buildListingSlug), and three new tables: web
-- session identity, WhatsApp-handoff codes (booking/continue), and a
-- DB-backed daily usage cap. Idempotent — safe to re-run.
-- Runs independently of 0007/0008 (Phase 5-6, a separate branch) — no shared
-- table or column names.
-- Apply with: psql $DATABASE_URL -f src/lib/db/migrations/0009_agent_web.sql
-- =============================================================================

ALTER TABLE "agent_configs"
  ADD COLUMN IF NOT EXISTS "public_pages_enabled" BOOLEAN NOT NULL DEFAULT false;

-- Only one 'web' row per org in org_channels — resolveWebChannel()/getOrgWebChannel()
-- both assume a single public key per org.
CREATE UNIQUE INDEX IF NOT EXISTS org_channels_one_web_per_org ON "org_channels"("org_id")
  WHERE channel = 'web';

-- =============================================================================
-- listings.public_slug backfill. Same algorithm as buildListingSlug() in
-- src/lib/widget/slug.ts: lowercase, translate the accented Latin letters
-- common in es/pt titles (not a general Unicode fold — kept in sync by hand
-- with the ACCENT_MAP in slug.ts), collapse everything that isn't [a-z0-9]
-- into '-', trim leading/trailing '-', cut to 60 chars (empty -> 'propiedad'),
-- then append '-' + the listing id's first 6 hex chars (dashes stripped) so
-- two listings with the same title never collide.
-- =============================================================================
UPDATE "listings" SET "public_slug" =
  COALESCE(NULLIF(
    LEFT(
      REGEXP_REPLACE(
        REGEXP_REPLACE(
          TRANSLATE(LOWER(COALESCE("title", '')), 'áàâãäåéèêëíìîïóòôõöúùûüñç', 'aaaaaaeeeeiiiiooooouuuunc'),
          '[^a-z0-9]+', '-', 'g'
        ),
        '^-+|-+$', '', 'g'
      ),
      60
    ),
  ''), 'propiedad')
  || '-' || LEFT(REPLACE("id"::text, '-', ''), 6)
WHERE "public_slug" IS NULL;

-- =============================================================================
-- agent_web_sessions: the widget's opaque session identity. The token itself
-- (wst_<43 base64url chars>) is never stored — only its sha256, so a DB leak
-- doesn't hand out live bearer tokens. ip_hash is sha256(ip|AUTH_SECRET), not
-- the raw IP (never log/store raw visitor IPs — blueprint §6).
-- =============================================================================
CREATE TABLE IF NOT EXISTS "agent_web_sessions" (
  "id"                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"              UUID NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "token_hash"          TEXT NOT NULL UNIQUE,
  "agent_session_id"    UUID REFERENCES "agent_sessions"("id") ON DELETE SET NULL,
  "ip_hash"             TEXT,
  "origin"              TEXT,
  "page_url"            TEXT CHECK ("page_url" IS NULL OR length("page_url") <= 500),
  "current_listing_id"  UUID REFERENCES "listings"("id") ON DELETE SET NULL,
  "phone_e164"          TEXT,
  "phone_captured_at"   TIMESTAMPTZ,
  "message_count"       INTEGER NOT NULL DEFAULT 0,
  "last_message_at"     TIMESTAMPTZ,
  "processing_until"    TIMESTAMPTZ,
  "expires_at"          TIMESTAMPTZ NOT NULL,
  "created_at"          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_web_sessions_org ON "agent_web_sessions"("org_id", "created_at" DESC);

-- =============================================================================
-- agent_web_handoff_codes: the WEB-XXXXXX codes that stand in for a booking
-- (or a "continue on WhatsApp" link) until the visitor's WhatsApp message
-- proves they own the phone. See decision 6 (blueprint §0) for why this is
-- not a pending property_visits row.
-- =============================================================================
CREATE TABLE IF NOT EXISTS "agent_web_handoff_codes" (
  "id"                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"               UUID NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "web_session_id"       UUID NOT NULL REFERENCES "agent_web_sessions"("id") ON DELETE CASCADE,
  "code"                 TEXT NOT NULL,
  "kind"                 TEXT NOT NULL CHECK ("kind" IN ('visit', 'continue')),
  "lead_id"              UUID REFERENCES "crm_leads"("id") ON DELETE SET NULL,
  "listing_id"           UUID REFERENCES "listings"("id") ON DELETE SET NULL,
  "profile_id"           UUID REFERENCES "profiles"("id") ON DELETE SET NULL,
  "starts_at"            TIMESTAMPTZ,
  "visit_minutes"        INTEGER,
  "status"                TEXT NOT NULL DEFAULT 'pending'
    CHECK ("status" IN ('pending', 'redeemed', 'failed', 'expired', 'superseded')),
  "redeemed_phone"       TEXT,
  "redeemed_session_id"  UUID REFERENCES "agent_sessions"("id") ON DELETE SET NULL,
  "visit_id"             UUID REFERENCES "property_visits"("id") ON DELETE SET NULL,
  "result"               TEXT,
  "expires_at"           TIMESTAMPTZ NOT NULL,
  "redeemed_at"          TIMESTAMPTZ,
  "created_at"           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_web_handoff_code UNIQUE ("org_id", "code"),
  CONSTRAINT chk_web_handoff_visit CHECK (
    "kind" <> 'visit' OR ("starts_at" IS NOT NULL AND "profile_id" IS NOT NULL AND "visit_minutes" IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_web_handoff_session ON "agent_web_handoff_codes"("web_session_id", "status");

-- =============================================================================
-- agent_web_usage_daily: DB-backed daily cap per org (sessions + messages),
-- so a Fly restart or multiple instances never reset the in-memory limiter's
-- counters (abuse control §0.10).
-- =============================================================================
CREATE TABLE IF NOT EXISTS "agent_web_usage_daily" (
  "org_id"    UUID NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "day"       DATE NOT NULL,
  "sessions"  INTEGER NOT NULL DEFAULT 0,
  "messages"  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY ("org_id", "day")
);

-- To set the WhatsApp display number used for wa.me links, use the admin
-- Widget settings page (item B, /dashboard/agent/widget) once it ships, or
-- for now, src/lib/widget/channel.ts's setWhatsAppDisplayPhone(orgId, phone):
--   UPDATE org_channels SET config = jsonb_set(config, '{displayPhoneE164}', '"+51987654321"')
--   WHERE channel = 'whatsapp' AND org_id = '<your-org-id>';
