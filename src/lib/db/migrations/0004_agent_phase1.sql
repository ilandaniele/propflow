-- =============================================================================
-- Migration 0004: Agent Phase 1 — brain, inventory, playground
-- Extends crm_leads for qualification; adds agent_configs, agent_sessions,
-- agent_messages, listings, listing_images.
-- Apply with: psql $DATABASE_URL -f src/lib/db/migrations/0004_agent_phase1.sql
-- =============================================================================

-- =============================================================================
-- crm_leads: qualification fields the agent fills in during conversation.
-- The existing `status` column (new|contacted|qualified|lost) is untouched —
-- dashboard/leads still reads it. `stage` is the agent's richer pipeline.
-- =============================================================================
ALTER TABLE "crm_leads"
  ADD COLUMN IF NOT EXISTS "operation_type"       TEXT CHECK (operation_type IS NULL OR operation_type IN ('rent','buy','owner_sell','owner_rent')),
  ADD COLUMN IF NOT EXISTS "pipeline"              TEXT NOT NULL DEFAULT 'demand' CHECK (pipeline IN ('demand','supply')),
  ADD COLUMN IF NOT EXISTS "budget_min"            NUMERIC(12,2) CHECK (budget_min IS NULL OR budget_min >= 0),
  ADD COLUMN IF NOT EXISTS "budget_max"            NUMERIC(12,2) CHECK (budget_max IS NULL OR budget_max >= 0),
  ADD COLUMN IF NOT EXISTS "currency"              TEXT NOT NULL DEFAULT 'PEN',
  ADD COLUMN IF NOT EXISTS "zones"                 JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS "bedrooms_min"          INTEGER CHECK (bedrooms_min IS NULL OR bedrooms_min >= 0),
  ADD COLUMN IF NOT EXISTS "move_in_date"          DATE,
  ADD COLUMN IF NOT EXISTS "timeline"               TEXT CHECK (timeline IS NULL OR timeline IN ('immediate','1_3_months','3_6_months','flexible')),
  ADD COLUMN IF NOT EXISTS "pets"                  BOOLEAN,
  ADD COLUMN IF NOT EXISTS "score"                 INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "intent_tag"            TEXT CHECK (intent_tag IS NULL OR intent_tag IN ('high_intent','under_analysis','qualified','cold')),
  ADD COLUMN IF NOT EXISTS "assigned_profile_id"   UUID REFERENCES "profiles"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "stage"                 TEXT NOT NULL DEFAULT 'new' CHECK (stage IN ('new','contacted','qualified','visit_scheduled','visited','negotiating','won','lost')),
  ADD COLUMN IF NOT EXISTS "next_followup_at"      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "do_not_contact"        BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "source_channel"        TEXT CHECK (source_channel IS NULL OR source_channel IN ('whatsapp','web','voice','manual')),
  ADD COLUMN IF NOT EXISTS "source_ref"            TEXT;

CREATE INDEX IF NOT EXISTS idx_crm_leads_org_stage ON "crm_leads"("org_id", "stage");
CREATE INDEX IF NOT EXISTS idx_crm_leads_org_followup ON "crm_leads"("org_id", "next_followup_at");

-- =============================================================================
-- agent_configs: one row per org. Seeded with defaults by the app on first
-- read (see src/lib/agent/config.ts) rather than here, so column defaults
-- below only cover the DB-level fallback.
-- =============================================================================
CREATE TABLE IF NOT EXISTS "agent_configs" (
  "id"                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"                 UUID NOT NULL UNIQUE REFERENCES "organizations"("id") ON DELETE CASCADE,
  "persona"                TEXT NOT NULL DEFAULT 'Asistente inmobiliario',
  "tone"                   TEXT NOT NULL DEFAULT 'profesional' CHECK (tone IN ('profesional','cercano','formal')),
  "rules"                  TEXT,
  "prohibited"             TEXT,
  "faq"                    JSONB NOT NULL DEFAULT '[]',
  "business_hours"         JSONB NOT NULL DEFAULT '{}',
  "timezone"               TEXT NOT NULL DEFAULT 'America/Lima',
  "qualification_fields"   JSONB NOT NULL DEFAULT '["operation_type","zones","budget_max","bedrooms_min","timeline"]',
  "followup_policy"        JSONB NOT NULL DEFAULT '{}',
  "routing_mode"           TEXT NOT NULL DEFAULT 'round_robin' CHECK (routing_mode IN ('round_robin','weighted','manual')),
  "daily_token_budget"     INTEGER NOT NULL DEFAULT 50000 CHECK (daily_token_budget > 0),
  "widget_allowed_origins" JSONB NOT NULL DEFAULT '[]',
  "channels_enabled"       JSONB NOT NULL DEFAULT '{"whatsapp":false,"web":false,"voice":false}',
  "created_at"             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at"             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- agent_sessions: one conversational thread per (org, channel, external_id).
-- Links to whatsapp_conversations so the WhatsApp inbox and the agent share
-- one history instead of drifting apart.
-- =============================================================================
CREATE TABLE IF NOT EXISTS "agent_sessions" (
  "id"                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"                    UUID NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "channel"                   TEXT NOT NULL CHECK (channel IN ('whatsapp','web','voice')),
  "external_id"               TEXT NOT NULL,
  "lead_id"                   UUID REFERENCES "crm_leads"("id") ON DELETE SET NULL,
  "whatsapp_conversation_id"  UUID REFERENCES "whatsapp_conversations"("id") ON DELETE SET NULL,
  "mode"                      TEXT NOT NULL DEFAULT 'ai' CHECK (mode IN ('ai','human','paused')),
  "summary"                   TEXT,
  "window_expires_at"         TIMESTAMPTZ,
  "processing_locked_until"   TIMESTAMPTZ,
  "created_at"                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at"                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_agent_sessions_channel_external UNIQUE (org_id, channel, external_id)
);

CREATE INDEX IF NOT EXISTS idx_agent_sessions_org ON "agent_sessions"("org_id");
CREATE INDEX IF NOT EXISTS idx_agent_sessions_lead ON "agent_sessions"("lead_id");

-- =============================================================================
-- agent_messages: full Anthropic content-block history per session, append-
-- only. Separate from whatsapp_messages (the inbox's source of truth) so LLM
-- context (tool_use/tool_result blocks) never has to round-trip through it.
-- =============================================================================
CREATE TABLE IF NOT EXISTS "agent_messages" (
  "id"             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"         UUID NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "session_id"     UUID NOT NULL REFERENCES "agent_sessions"("id") ON DELETE CASCADE,
  "role"           TEXT NOT NULL CHECK (role IN ('user','assistant')),
  "content"        JSONB NOT NULL,
  "input_tokens"   INTEGER,
  "output_tokens"  INTEGER,
  "cost_usd"       NUMERIC(10,4),
  "created_at"     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_messages_session ON "agent_messages"("session_id", "created_at");

-- =============================================================================
-- listings: unified rent + sale inventory. Owns price and marketing copy —
-- the unit-derivation job (src/lib/agent/listings.ts) only inserts missing
-- rows and updates availability, never price or text (Airtable sync owns
-- units.status and can be up to 24h stale; see status_override).
-- =============================================================================
CREATE TABLE IF NOT EXISTS "listings" (
  "id"               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"           UUID NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "unit_id"          UUID REFERENCES "units"("id") ON DELETE SET NULL,
  "property_id"      UUID REFERENCES "properties"("id") ON DELETE SET NULL,
  "operation"        TEXT NOT NULL CHECK (operation IN ('rent','sale')),
  "price"            NUMERIC(14,2) CHECK (price IS NULL OR price >= 0),
  "currency"         TEXT NOT NULL DEFAULT 'PEN',
  "status"           TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available','reserved','closed')),
  "status_override"  BOOLEAN NOT NULL DEFAULT false,
  "title"            TEXT,
  "description"      TEXT,
  "zone"             TEXT,
  "bedrooms"         INTEGER CHECK (bedrooms IS NULL OR bedrooms >= 0),
  "bathrooms"        INTEGER CHECK (bathrooms IS NULL OR bathrooms >= 0),
  "area_m2"          NUMERIC CHECK (area_m2 IS NULL OR area_m2 >= 0),
  "parking"          BOOLEAN NOT NULL DEFAULT false,
  "maintenance_fee"  NUMERIC(12,2) CHECK (maintenance_fee IS NULL OR maintenance_fee >= 0),
  "pets_allowed"     BOOLEAN,
  "public_slug"      TEXT,
  "published"        BOOLEAN NOT NULL DEFAULT false,
  "ref_code"         TEXT,
  "created_at"       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at"       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_listings_has_target CHECK (unit_id IS NOT NULL OR property_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_listings_org ON "listings"("org_id");
CREATE INDEX IF NOT EXISTS idx_listings_org_published ON "listings"("org_id", "published", "status");
CREATE UNIQUE INDEX IF NOT EXISTS listings_org_unit_uniq ON "listings"("org_id", "unit_id") WHERE unit_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS listings_org_slug_uniq ON "listings"("org_id", "public_slug") WHERE public_slug IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS listings_org_ref_code_uniq ON "listings"("org_id", "ref_code") WHERE ref_code IS NOT NULL;

-- =============================================================================
-- listing_images: for listings without a unit (standalone sale listings).
-- Unit-backed listings reuse unit_images instead.
-- =============================================================================
CREATE TABLE IF NOT EXISTS "listing_images" (
  "id"           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"       UUID NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "listing_id"   UUID NOT NULL REFERENCES "listings"("id") ON DELETE CASCADE,
  "storage_path" TEXT NOT NULL,
  "filename"     TEXT NOT NULL,
  "mime_type"    TEXT NOT NULL,
  "size_bytes"   INTEGER NOT NULL,
  "width"        INTEGER,
  "height"       INTEGER,
  "caption"      TEXT,
  "sort_order"   INTEGER NOT NULL DEFAULT 0,
  "is_cover"     BOOLEAN NOT NULL DEFAULT false,
  "uploaded_by"  UUID REFERENCES "profiles"("id"),
  "created_at"   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_listing_images_listing ON "listing_images"("listing_id", "sort_order");
CREATE INDEX IF NOT EXISTS idx_listing_images_org ON "listing_images"("org_id");
CREATE UNIQUE INDEX IF NOT EXISTS listing_images_cover_idx ON "listing_images"("listing_id") WHERE is_cover = true;
