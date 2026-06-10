-- Migration 000052: Fix schema mismatches that caused every entity to report 0 records.
--
-- Root causes addressed:
--
-- 1. properties: normalizeProperty.ts writes tope_luz + tope_agua but those columns
--    were never created.  Every properties upsert failed → idMap empty → all downstream
--    entities (units, tenants, contracts, payments, service_payments) cascaded to 0.
--
-- 2. contracts: end_date is DATE NOT NULL in init_schema, but active Airtable contracts
--    may legitimately have no end date (open-ended / indefinite contracts).
--    Solution: drop NOT NULL on end_date and relax the date-order CHECK so it is only
--    enforced when end_date is present.  tenant_id / unit_id NOT NULL constraints are
--    handled in sync-entities.ts by skipping rows that can't satisfy them (same pattern
--    as payments).
--
-- All changes are idempotent (IF NOT EXISTS / DO-block guards).

-- ── 1. properties: add missing tope_luz / tope_agua columns ──────────────────

ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS tope_luz  NUMERIC,
  ADD COLUMN IF NOT EXISTS tope_agua NUMERIC;

-- ── 2. contracts: relax end_date NOT NULL + fix date-order CHECK ─────────────

-- Drop NOT NULL constraint on end_date (open-ended contracts have no end date).
ALTER TABLE public.contracts
  ALTER COLUMN end_date DROP NOT NULL;

-- Drop + recreate the date-order CHECK so it only fires when end_date IS NOT NULL.
-- The constraint was named contracts_date_order in the init schema.
ALTER TABLE public.contracts
  DROP CONSTRAINT IF EXISTS contracts_date_order;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'contracts_date_order_nullable'
      AND conrelid = 'public.contracts'::regclass
  ) THEN
    ALTER TABLE public.contracts
      ADD CONSTRAINT contracts_date_order_nullable
        CHECK (end_date IS NULL OR end_date > start_date);
  END IF;
END $$;
