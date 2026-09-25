-- =============================================================================
-- Manual verification for migration 0009 (Agent Phase 7 — public pages + web
-- widget). Run against a dev/staging DB AFTER applying 0009 (twice, to check
-- idempotency):
--   psql $DATABASE_URL -f tests/sql/0009_check.sql
-- Everything happens inside BEGIN … ROLLBACK — nothing is left behind.
-- Same slug cases as tests/unit/widget/slug.test.ts (buildListingSlug) — the
-- backfill expression here must match that pure function byte-for-byte.
-- =============================================================================

BEGIN;

INSERT INTO organizations (id, name) VALUES ('00000000-0000-0000-0000-0000000000f1', 'Widget check org');
INSERT INTO organizations (id, name) VALUES ('00000000-0000-0000-0000-0000000000f9', 'Widget check org 2');

INSERT INTO properties (id, org_id, name)
VALUES ('88888888-8888-8888-8888-888888888888', '00000000-0000-0000-0000-0000000000f1', 'Edificio check');

-- =============================================================================
-- listings.public_slug backfill: accents, empty title, id suffix.
-- =============================================================================
INSERT INTO listings (id, org_id, property_id, operation, title, public_slug)
VALUES ('abcdef12-3456-7890-abcd-ef1234567890', '00000000-0000-0000-0000-0000000000f1', '88888888-8888-8888-8888-888888888888', 'rent', 'Ñandú São Paulo Café', NULL);

INSERT INTO listings (id, org_id, property_id, operation, title, public_slug)
VALUES ('11111111-2222-3333-4444-555555555555', '00000000-0000-0000-0000-0000000000f1', '88888888-8888-8888-8888-888888888888', 'rent', NULL, NULL);

INSERT INTO listings (id, org_id, property_id, operation, title, public_slug)
VALUES ('99999999-2222-3333-4444-555555555555', '00000000-0000-0000-0000-0000000000f1', '88888888-8888-8888-8888-888888888888', 'rent', 'Depa', NULL);

UPDATE listings SET public_slug =
  COALESCE(NULLIF(
    LEFT(
      REGEXP_REPLACE(
        REGEXP_REPLACE(
          TRANSLATE(LOWER(COALESCE(title, '')), 'áàâãäåéèêëíìîïóòôõöúùûüñç', 'aaaaaaeeeeiiiiooooouuuunc'),
          '[^a-z0-9]+', '-', 'g'
        ),
        '^-+|-+$', '', 'g'
      ),
      60
    ),
  ''), 'propiedad')
  || '-' || LEFT(REPLACE(id::text, '-', ''), 6)
WHERE public_slug IS NULL;

DO $$
DECLARE
  s TEXT;
BEGIN
  SELECT public_slug INTO s FROM listings WHERE id = 'abcdef12-3456-7890-abcd-ef1234567890';
  IF s <> 'nandu-sao-paulo-cafe-abcdef' THEN
    RAISE EXCEPTION 'accent backfill mismatch: got %', s;
  END IF;

  SELECT public_slug INTO s FROM listings WHERE id = '11111111-2222-3333-4444-555555555555';
  IF s <> 'propiedad-111111' THEN
    RAISE EXCEPTION 'empty-title backfill mismatch: got %', s;
  END IF;

  SELECT public_slug INTO s FROM listings WHERE id = '99999999-2222-3333-4444-555555555555';
  IF s <> 'depa-999999' THEN
    RAISE EXCEPTION 'id-suffix backfill mismatch: got %', s;
  END IF;

  RAISE NOTICE 'OK: public_slug backfill matches buildListingSlug()';
END $$;

-- =============================================================================
-- org_channels_one_web_per_org: a second 'web' row for the same org is rejected.
-- =============================================================================
INSERT INTO org_channels (org_id, channel, external_id) VALUES ('00000000-0000-0000-0000-0000000000f1', 'web', 'pk_aaaaaaaaaaaaaaaaaaaaaaaa');

SAVEPOINT sp_one_web;
DO $$
BEGIN
  BEGIN
    INSERT INTO org_channels (org_id, channel, external_id) VALUES ('00000000-0000-0000-0000-0000000000f1', 'web', 'pk_bbbbbbbbbbbbbbbbbbbbbbbb');
    RAISE EXCEPTION 'a second web channel row for the same org was accepted (expected a unique violation)';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'OK: second web channel row for the same org was rejected';
  END;
END $$;
ROLLBACK TO SAVEPOINT sp_one_web;

-- A second org's web row is unaffected by the partial index above.
INSERT INTO org_channels (org_id, channel, external_id) VALUES ('00000000-0000-0000-0000-0000000000f9', 'web', 'pk_cccccccccccccccccccccccc');

-- =============================================================================
-- agent_web_sessions / agent_web_handoff_codes / agent_web_usage_daily: basic
-- round-trip + the visit-kind CHECK constraint.
-- =============================================================================
INSERT INTO agent_web_sessions (id, org_id, token_hash, expires_at)
VALUES ('22222222-3333-4444-5555-666666666666', '00000000-0000-0000-0000-0000000000f1', 'deadbeef', NOW() + INTERVAL '30 days');

INSERT INTO agent_web_handoff_codes (org_id, web_session_id, code, kind, expires_at)
VALUES ('00000000-0000-0000-0000-0000000000f1', '22222222-3333-4444-5555-666666666666', 'WEB-AB2K9M', 'continue', NOW() + INTERVAL '30 minutes');

SAVEPOINT sp_visit_check;
DO $$
BEGIN
  BEGIN
    -- kind='visit' without starts_at/profile_id/visit_minutes must fail chk_web_handoff_visit.
    INSERT INTO agent_web_handoff_codes (org_id, web_session_id, code, kind, expires_at)
    VALUES ('00000000-0000-0000-0000-0000000000f1', '22222222-3333-4444-5555-666666666666', 'WEB-ZZ9988', 'visit', NOW() + INTERVAL '30 minutes');
    RAISE EXCEPTION 'an incomplete visit-kind handoff code was accepted (expected a check violation)';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'OK: chk_web_handoff_visit rejected an incomplete visit-kind row';
  END;
END $$;
ROLLBACK TO SAVEPOINT sp_visit_check;

INSERT INTO agent_web_usage_daily (org_id, day, sessions, messages)
VALUES ('00000000-0000-0000-0000-0000000000f1', CURRENT_DATE, 1, 1)
ON CONFLICT (org_id, day) DO UPDATE SET sessions = agent_web_usage_daily.sessions + 1;

ROLLBACK;
