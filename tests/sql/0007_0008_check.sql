-- =============================================================================
-- Manual verification for migrations 0007 (calendar) and 0008 (leads
-- pipeline). Run against a dev/staging DB AFTER applying both migrations:
--   psql $DATABASE_URL -f tests/sql/0007_0008_check.sql
-- Everything happens inside BEGIN … ROLLBACK — nothing is left behind.
-- =============================================================================

BEGIN;

INSERT INTO organizations (id, name) VALUES ('00000000-0000-0000-0000-0000000000e1', '0007/0008 check org');

INSERT INTO profiles (id, org_id, role, full_name)
VALUES ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000e1', 'admin', 'Test Advisor');

INSERT INTO properties (id, org_id, name)
VALUES ('00000000-0000-0000-0000-0000000000e9', '00000000-0000-0000-0000-0000000000e1', 'Test Property');

-- ---------------------------------------------------------------------------
-- 1. crm_leads.stage format CHECK: 'Bad Stage' (uppercase + space) must fail.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  BEGIN
    INSERT INTO crm_leads (id, org_id, full_name, stage)
    VALUES ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-0000000000e1', 'Bad Stage Lead', 'Bad Stage');
    RAISE EXCEPTION 'FAIL: stage=''Bad Stage'' was accepted, expected 23514';
  EXCEPTION
    WHEN check_violation THEN
      RAISE NOTICE 'PASS (EXPECTED 23514): stage=''Bad Stage'' correctly rejected';
  END;
END $$;

-- ---------------------------------------------------------------------------
-- 2. A custom stage key that fits the format must pass.
-- ---------------------------------------------------------------------------
INSERT INTO crm_leads (id, org_id, full_name, stage)
VALUES ('00000000-0000-0000-0000-0000000000e4', '00000000-0000-0000-0000-0000000000e1', 'Custom Stage Lead', 'tasacion_2');

DO $$ BEGIN RAISE NOTICE 'PASS: custom stage ''tasacion_2'' was accepted'; END $$;

-- ---------------------------------------------------------------------------
-- 3. listings.published_at trigger: false→true sets it; it never resets.
-- ---------------------------------------------------------------------------
INSERT INTO listings (id, org_id, property_id, operation, published)
VALUES ('00000000-0000-0000-0000-0000000000e5', '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e9', 'rent', false);

DO $$
DECLARE v_published_at TIMESTAMPTZ;
BEGIN
  SELECT published_at INTO v_published_at FROM listings WHERE id = '00000000-0000-0000-0000-0000000000e5';
  IF v_published_at IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: published_at was set before publishing';
  END IF;
END $$;

UPDATE listings SET published = true WHERE id = '00000000-0000-0000-0000-0000000000e5';

DO $$
DECLARE v_published_at TIMESTAMPTZ;
BEGIN
  SELECT published_at INTO v_published_at FROM listings WHERE id = '00000000-0000-0000-0000-0000000000e5';
  IF v_published_at IS NULL THEN
    RAISE EXCEPTION 'FAIL: published_at was not set after publishing';
  END IF;
  RAISE NOTICE 'PASS: published_at set on false->true transition';
END $$;

-- ---------------------------------------------------------------------------
-- 4. property_visits_google_event_uniq: duplicate (google_connection_id,
--    google_event_id) must fail with 23505.
-- ---------------------------------------------------------------------------
INSERT INTO calendar_connections (id, org_id, profile_id, google_email, refresh_token_enc)
VALUES ('00000000-0000-0000-0000-0000000000e6', '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e2', 'advisor@example.com', 'enc:placeholder');

INSERT INTO property_visits (
  id, org_id, lead_id, profile_id, starts_at, ends_at, blocked_until,
  status, created_by, source_channel, google_connection_id, google_event_id
) VALUES (
  '00000000-0000-0000-0000-0000000000e7', '00000000-0000-0000-0000-0000000000e1',
  '00000000-0000-0000-0000-0000000000e4', '00000000-0000-0000-0000-0000000000e2',
  '2026-11-02T10:00:00Z', '2026-11-02T10:45:00Z', '2026-11-02T11:00:00Z',
  'scheduled', 'human', 'manual', '00000000-0000-0000-0000-0000000000e6', 'pfv-dup'
);

DO $$
BEGIN
  BEGIN
    INSERT INTO property_visits (
      id, org_id, lead_id, profile_id, starts_at, ends_at, blocked_until,
      status, created_by, source_channel, google_connection_id, google_event_id
    ) VALUES (
      '00000000-0000-0000-0000-0000000000e8', '00000000-0000-0000-0000-0000000000e1',
      '00000000-0000-0000-0000-0000000000e4', '00000000-0000-0000-0000-0000000000e2',
      '2026-11-03T10:00:00Z', '2026-11-03T10:45:00Z', '2026-11-03T11:00:00Z',
      'scheduled', 'human', 'manual', '00000000-0000-0000-0000-0000000000e6', 'pfv-dup'
    );
    RAISE EXCEPTION 'FAIL: duplicate (google_connection_id, google_event_id) was accepted, expected 23505';
  EXCEPTION
    WHEN unique_violation THEN
      RAISE NOTICE 'PASS (EXPECTED 23505): duplicate Google event id correctly rejected';
  END;
END $$;

ROLLBACK;
