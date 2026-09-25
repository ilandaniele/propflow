-- =============================================================================
-- Migration 0005: Agent Phase 2 — live WhatsApp agent, human handoff, shadow
-- mode. Adds per-message claim/debounce columns to whatsapp_messages, shadow
-- mode + turn cap to agent_configs, turn/window/language/attribution
-- bookkeeping to agent_sessions, lead attribution metadata, and two new
-- tables: agent_suggestions (shadow mode review queue) and agent_events
-- (inbox timeline).
-- Apply with: psql $DATABASE_URL -f src/lib/db/migrations/0005_agent_phase2.sql
-- =============================================================================

-- =============================================================================
-- whatsapp_messages: per-message agent claim (this is the turn's debounce —
-- a single turn atomically claims every 'pending' message for a conversation),
-- sender attribution for the inbox timeline, and — verified against the live
-- DB first (`\d whatsapp_messages`) — replacing the DEFERRABLE unique
-- constraint with a plain unique index, since Postgres does not accept
-- deferrable constraints as ON CONFLICT arbiters (a duplicate webhook would
-- otherwise throw and Meta would retry forever).
-- =============================================================================
ALTER TABLE "whatsapp_messages"
  ADD COLUMN IF NOT EXISTS "agent_status" TEXT CHECK (agent_status IS NULL OR agent_status IN ('pending','processing','processed','skipped')),
  ADD COLUMN IF NOT EXISTS "sender_kind" TEXT CHECK (sender_kind IS NULL OR sender_kind IN ('contact','agent','human','system')),
  ADD COLUMN IF NOT EXISTS "sent_by_profile_id" UUID REFERENCES "profiles"("id") ON DELETE SET NULL,
  -- item 4 (added after initial ship): set by claimPendingInbound() the moment
  -- a message flips 'pending' → 'processing'. Without this there's no way to
  -- tell a legitimately-in-progress turn apart from one whose process crashed
  -- mid-turn, so a stuck 'processing' row could never be resurrected.
  ADD COLUMN IF NOT EXISTS "agent_claimed_at" TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_wa_msg_agent_pending ON "whatsapp_messages"("conversation_id", "created_at")
  WHERE agent_status IN ('pending','processing');

ALTER TABLE "whatsapp_messages" DROP CONSTRAINT IF EXISTS whatsapp_messages_provider_id_per_org; -- deferrable → plain
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_messages_provider_id_per_org ON "whatsapp_messages"("org_id", "provider_message_id");

-- =============================================================================
-- agent_messages: OVERRIDE (see handoffs/phase2-blueprint.md, item A —
-- "Override" note). Tracks whether an assistant turn's text was actually
-- sent, so shadow-mode drafts that were never sent (or were discarded) never
-- leak into the cached LLM history. NULL/'sent' rows are used; 'shadow_pending'
-- and 'shadow_discarded' are filtered out by getSessionHistory(). When a human
-- edits a suggestion before sending, the edited text becomes the row's
-- content and its status flips to 'sent' — the sent text is what counts.
-- =============================================================================
ALTER TABLE "agent_messages"
  ADD COLUMN IF NOT EXISTS "send_status" TEXT CHECK (send_status IS NULL OR send_status IN ('sent','shadow_pending','shadow_discarded'));

-- =============================================================================
-- agent_configs: shadow mode (the turn runs for real — tools write, history
-- persists — but the reply is held for human review instead of being sent)
-- and a hard cap on agent turns per session before auto-handoff.
-- =============================================================================
ALTER TABLE "agent_configs"
  ADD COLUMN IF NOT EXISTS "shadow_mode" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "max_agent_turns" INTEGER DEFAULT 30 CHECK (max_agent_turns IS NULL OR max_agent_turns > 0);

-- =============================================================================
-- agent_sessions: turn count and 24h window bookkeeping, detected language,
-- first-touch attribution, and the reason a session was handed to a human.
-- =============================================================================
ALTER TABLE "agent_sessions"
  ADD COLUMN IF NOT EXISTS "agent_turn_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "language" TEXT CHECK (language IS NULL OR language IN ('es','en','pt')),
  ADD COLUMN IF NOT EXISTS "attribution" JSONB,
  ADD COLUMN IF NOT EXISTS "handoff_reason" TEXT CHECK (handoff_reason IS NULL OR handoff_reason IN ('tool','budget','turn_cap','manual')),
  ADD COLUMN IF NOT EXISTS "last_inbound_at" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "last_agent_turn_at" TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_agent_sessions_org_inbound ON "agent_sessions"("org_id", "last_inbound_at" DESC);

-- =============================================================================
-- crm_leads: full attribution payload (ctwa referral or wa.me ref code)
-- alongside the existing source_ref summary string.
-- =============================================================================
ALTER TABLE "crm_leads" ADD COLUMN IF NOT EXISTS "source_meta" JSONB NOT NULL DEFAULT '{}';

-- =============================================================================
-- agent_suggestions: shadow mode's review queue. A human approves a pending
-- suggestion (optionally edited) or discards it; a new turn's suggestion
-- supersedes any prior pending one for the same session.
-- =============================================================================
CREATE TABLE IF NOT EXISTS "agent_suggestions" (
  "id"                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"                   UUID NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "session_id"               UUID NOT NULL REFERENCES "agent_sessions"("id") ON DELETE CASCADE,
  "whatsapp_conversation_id" UUID REFERENCES "whatsapp_conversations"("id") ON DELETE SET NULL,
  "agent_message_id"         UUID REFERENCES "agent_messages"("id") ON DELETE SET NULL, -- OVERRIDE: the assistant turn this suggestion drafted; flips to sent/shadow_discarded on decision
  "body"                     TEXT NOT NULL,
  -- 'sending' (item 3, added after initial ship): claimed by approveSuggestion
  -- before the send call, so a crash mid-send never leaves the row stuck
  -- looking permanently 'sent' for a message that was never delivered.
  "status"                   TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sending','sent','discarded','superseded')),
  "decided_by"               UUID REFERENCES "profiles"("id") ON DELETE SET NULL,
  "decided_at"               TIMESTAMPTZ,
  "sent_message_id"          UUID REFERENCES "whatsapp_messages"("id") ON DELETE SET NULL,
  "created_at"               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Widen the CHECK for a DB where this migration already ran before 'sending'
-- was added (CREATE TABLE IF NOT EXISTS above is a no-op there).
ALTER TABLE "agent_suggestions" DROP CONSTRAINT IF EXISTS "agent_suggestions_status_check";
ALTER TABLE "agent_suggestions" ADD CONSTRAINT "agent_suggestions_status_check"
  CHECK (status IN ('pending','sending','sent','discarded','superseded'));

CREATE INDEX IF NOT EXISTS idx_agent_suggestions_session ON "agent_suggestions"("session_id", "created_at" DESC);
CREATE UNIQUE INDEX IF NOT EXISTS agent_suggestions_one_pending ON "agent_suggestions"("session_id") WHERE status = 'pending';

-- =============================================================================
-- agent_events: inbox timeline (handoffs, mode changes, suggestions,
-- attribution, window-closed, turn errors). `kind` stays free TEXT with no
-- CHECK so later phases (e.g. Phase 3's visit_* kinds) don't need a migration.
-- =============================================================================
CREATE TABLE IF NOT EXISTS "agent_events" (
  "id"               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"           UUID NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "session_id"       UUID NOT NULL REFERENCES "agent_sessions"("id") ON DELETE CASCADE,
  "kind"             TEXT NOT NULL,
  "data"             JSONB NOT NULL DEFAULT '{}',
  "actor_profile_id" UUID REFERENCES "profiles"("id") ON DELETE SET NULL,
  "created_at"       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_events_session ON "agent_events"("session_id", "created_at");
