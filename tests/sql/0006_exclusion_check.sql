-- =============================================================================
-- Manual verification for the property_visits_no_overlap EXCLUDE constraint
-- (migration 0006). Run against a dev/staging DB AFTER applying 0006:
--   psql $DATABASE_URL -f tests/sql/0006_exclusion_check.sql
-- Everything happens inside BEGIN … ROLLBACK — nothing is left behind.
-- Expected output: the first INSERT fails with 23P01 ("EXPECTED 23P01" notice),
-- the second and third INSERTs succeed silently (no error).
-- =============================================================================

BEGIN;

-- Fixture data, scoped to this transaction only.
INSERT INTO organizations (id, name) VALUES ('00000000-0000-0000-0000-0000000000f1', 'Exclusion check org');

INSERT INTO profiles (id, org_id, role, full_name)
VALUES ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000f1', 'admin', 'Test Advisor');

INSERT INTO crm_leads (id, org_id, full_name)
VALUES ('00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-0000000000f1', 'Test Lead');

-- Visit #1: 2026-11-02 10:00-10:45, buffer 15min -> blocked_until 11:00.
INSERT INTO property_visits (
  id, org_id, lead_id, profile_id, starts_at, ends_at, blocked_until,
  status, created_by, source_channel
) VALUES (
  '00000000-0000-0000-0000-0000000000f4', '00000000-0000-0000-0000-0000000000f1',
  '00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-0000000000f2',
  '2026-11-02T10:00:00Z', '2026-11-02T10:45:00Z', '2026-11-02T11:00:00Z',
  'scheduled', 'human', 'manual'
);

-- Step 1: an overlapping visit for the SAME advisor must be rejected with 23P01.
DO $$
BEGIN
  BEGIN
    INSERT INTO property_visits (
      id, org_id, lead_id, profile_id, starts_at, ends_at, blocked_until,
      status, created_by, source_channel
    ) VALUES (
      '00000000-0000-0000-0000-0000000000f5', '00000000-0000-0000-0000-0000000000f1',
      '00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-0000000000f2',
      '2026-11-02T10:30:00Z', '2026-11-02T11:15:00Z', '2026-11-02T11:30:00Z',
      'scheduled', 'human', 'manual'
    );
    RAISE EXCEPTION 'FAIL: overlapping visit was accepted, expected 23P01';
  EXCEPTION
    WHEN exclusion_violation THEN
      RAISE NOTICE 'PASS (EXPECTED 23P01): overlapping visit correctly rejected';
  END;
END $$;

-- Step 2: a visit starting exactly at blocked_until (11:00) must be accepted —
-- the range is half-open [starts_at, blocked_until), so 11:00 is free.
INSERT INTO property_visits (
  id, org_id, lead_id, profile_id, starts_at, ends_at, blocked_until,
  status, created_by, source_channel
) VALUES (
  '00000000-0000-0000-0000-0000000000f6', '00000000-0000-0000-0000-0000000000f1',
  '00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-0000000000f2',
  '2026-11-02T11:00:00Z', '2026-11-02T11:45:00Z', '2026-11-02T12:00:00Z',
  'scheduled', 'human', 'manual'
);

DO $$ BEGIN RAISE NOTICE 'PASS: slot starting exactly at blocked_until was accepted'; END $$;

-- Step 3: cancel visit #1, then the originally-overlapping range must now succeed
-- (cancelled/rescheduled/completed/no_show rows are outside the WHERE clause).
UPDATE property_visits SET status = 'cancelled' WHERE id = '00000000-0000-0000-0000-0000000000f4';

INSERT INTO property_visits (
  id, org_id, lead_id, profile_id, starts_at, ends_at, blocked_until,
  status, created_by, source_channel
) VALUES (
  '00000000-0000-0000-0000-0000000000f7', '00000000-0000-0000-0000-0000000000f1',
  '00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-0000000000f2',
  '2026-11-02T12:00:00Z', '2026-11-02T12:45:00Z', '2026-11-02T13:00:00Z',
  'scheduled', 'human', 'manual'
);

DO $$ BEGIN RAISE NOTICE 'PASS: re-insert after cancelling the conflicting visit was accepted'; END $$;

ROLLBACK;
