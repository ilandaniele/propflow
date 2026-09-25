-- =============================================================================
-- Constraint smoke tests for migrations 0010 (agent_voice) and 0011
-- (agent_settings_metrics). Run inside BEGIN...ROLLBACK so nothing persists.
-- Apply with: psql $DATABASE_URL -f tests/sql/0010_0011_check.sql
-- Expects migrations 0000-0011 already applied to $DATABASE_URL.
-- =============================================================================

BEGIN;

-- A minimal org + web session + call row to hang the checks off of.
INSERT INTO organizations (id, name) VALUES ('00000000-0000-0000-0000-0000000000a1', 'SQL Check Org');

INSERT INTO agent_web_sessions (id, org_id, token_hash, expires_at)
VALUES ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', 'tok-check-1', NOW() + interval '1 day');

INSERT INTO agent_calls (id, org_id, direction, purpose, status)
VALUES ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1', 'outbound', 'reactivation', 'queued');

-- 1) a voice code with no target_phone -> 23514 (chk_handoff_source)
DO $$
BEGIN
  BEGIN
    INSERT INTO agent_web_handoff_codes (org_id, code, kind, source, call_id, target_phone, expires_at)
    VALUES ('00000000-0000-0000-0000-0000000000a1', 'VOZ-AAAAAA', 'visit', 'voice', '00000000-0000-0000-0000-0000000000c1', NULL, NOW() + interval '1 hour');
    RAISE EXCEPTION 'expected 23514, insert succeeded';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'OK: voice code with no target_phone rejected with %', SQLSTATE;
  END;
END $$;

-- 2) a web code with no web_session_id -> 23514 (chk_handoff_source)
DO $$
BEGIN
  BEGIN
    INSERT INTO agent_web_handoff_codes (org_id, code, kind, source, web_session_id, expires_at)
    VALUES ('00000000-0000-0000-0000-0000000000a1', 'WEB-BBBBBB', 'continue', 'web', NULL, NOW() + interval '30 minutes');
    RAISE EXCEPTION 'expected 23514, insert succeeded';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'OK: web code with no web_session_id rejected with %', SQLSTATE;
  END;
END $$;

-- 3) a duplicate (org, dedupe_key) -> 23505 (agent_calls_dedupe)
INSERT INTO agent_calls (org_id, direction, purpose, status, dedupe_key)
VALUES ('00000000-0000-0000-0000-0000000000a1', 'outbound', 'speed_to_lead', 'queued', 'dedupe-check-1');

DO $$
BEGIN
  BEGIN
    INSERT INTO agent_calls (org_id, direction, purpose, status, dedupe_key)
    VALUES ('00000000-0000-0000-0000-0000000000a1', 'outbound', 'speed_to_lead', 'queued', 'dedupe-check-1');
    RAISE EXCEPTION 'expected 23505, insert succeeded';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'OK: duplicate (org_id, dedupe_key) rejected with %', SQLSTATE;
  END;
END $$;

-- 4) a bad DNC phone -> 23514 (voice_do_not_call's phone_e164 CHECK)
DO $$
BEGIN
  BEGIN
    INSERT INTO voice_do_not_call (org_id, phone_e164, source)
    VALUES ('00000000-0000-0000-0000-0000000000a1', 'not-a-phone', 'staff');
    RAISE EXCEPTION 'expected 23514, insert succeeded';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'OK: bad DNC phone rejected with %', SQLSTATE;
  END;
END $$;

-- Sanity: a VALID voice code and a valid DNC row both succeed. kind='continue'
-- (not 'visit') so chk_web_handoff_visit (0009, unrelated to this migration)
-- doesn't also require starts_at/profile_id/visit_minutes here.
INSERT INTO agent_web_handoff_codes (org_id, code, kind, source, call_id, target_phone, expires_at)
VALUES ('00000000-0000-0000-0000-0000000000a1', 'VOZ-CCCCCC', 'continue', 'voice', '00000000-0000-0000-0000-0000000000c1', '+51987654321', NOW() + interval '2 hours');

INSERT INTO voice_do_not_call (org_id, phone_e164, source)
VALUES ('00000000-0000-0000-0000-0000000000a1', '+51987654321', 'staff');

-- Phase 9: the two new agent_configs limits carry their defaults/bounds.
INSERT INTO agent_configs (org_id) VALUES ('00000000-0000-0000-0000-0000000000a1')
  ON CONFLICT (org_id) DO NOTHING;

DO $$
BEGIN
  BEGIN
    UPDATE agent_configs SET max_active_visits_per_phone = 99 WHERE org_id = '00000000-0000-0000-0000-0000000000a1';
    RAISE EXCEPTION 'expected 23514, update succeeded';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'OK: max_active_visits_per_phone out of range rejected with %', SQLSTATE;
  END;
END $$;

ROLLBACK;
