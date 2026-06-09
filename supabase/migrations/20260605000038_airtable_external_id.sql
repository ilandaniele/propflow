-- Migration 038: Add airtable_external_id + airtable_synced_at + partial UNIQUE index
-- to the four main entity tables.
--
-- All columns are nullable so existing rows are not affected.
-- Partial UNIQUE ensures only non-null external_ids are deduplicated per org.
--
-- Idempotent via IF NOT EXISTS / DO blocks.

-- ─── properties ──────────────────────────────────────────────────────────────
ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS airtable_external_id TEXT,
  ADD COLUMN IF NOT EXISTS airtable_synced_at   TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename  = 'properties'
      AND indexname  = 'properties_airtable_external_id_uniq'
  ) THEN
    CREATE UNIQUE INDEX properties_airtable_external_id_uniq
      ON public.properties (org_id, airtable_external_id)
      WHERE airtable_external_id IS NOT NULL;
  END IF;
END$$;

-- ─── tenants ─────────────────────────────────────────────────────────────────
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS airtable_external_id TEXT,
  ADD COLUMN IF NOT EXISTS airtable_synced_at   TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename  = 'tenants'
      AND indexname  = 'tenants_airtable_external_id_uniq'
  ) THEN
    CREATE UNIQUE INDEX tenants_airtable_external_id_uniq
      ON public.tenants (org_id, airtable_external_id)
      WHERE airtable_external_id IS NOT NULL;
  END IF;
END$$;

-- ─── contracts ───────────────────────────────────────────────────────────────
ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS airtable_external_id TEXT,
  ADD COLUMN IF NOT EXISTS airtable_synced_at   TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename  = 'contracts'
      AND indexname  = 'contracts_airtable_external_id_uniq'
  ) THEN
    CREATE UNIQUE INDEX contracts_airtable_external_id_uniq
      ON public.contracts (org_id, airtable_external_id)
      WHERE airtable_external_id IS NOT NULL;
  END IF;
END$$;

-- ─── payments ────────────────────────────────────────────────────────────────
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS airtable_external_id TEXT,
  ADD COLUMN IF NOT EXISTS airtable_synced_at   TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename  = 'payments'
      AND indexname  = 'payments_airtable_external_id_uniq'
  ) THEN
    CREATE UNIQUE INDEX payments_airtable_external_id_uniq
      ON public.payments (org_id, airtable_external_id)
      WHERE airtable_external_id IS NOT NULL;
  END IF;
END$$;
