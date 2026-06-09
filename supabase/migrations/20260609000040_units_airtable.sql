-- Add airtable sync columns to units (idempotent)
ALTER TABLE units
  ADD COLUMN IF NOT EXISTS airtable_external_id TEXT,
  ADD COLUMN IF NOT EXISTS airtable_synced_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS area_m2              NUMERIC;

-- Partial unique index: one unit per (org, airtable record)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'units'
      AND indexname = 'units_org_airtable_ext_id_uidx'
  ) THEN
    CREATE UNIQUE INDEX units_org_airtable_ext_id_uidx
      ON units (org_id, airtable_external_id)
      WHERE airtable_external_id IS NOT NULL;
  END IF;
END $$;
