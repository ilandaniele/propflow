-- Migration 000054: enable Airtable Mantenimiento → incidents sync.
--
-- 1. airtable_external_id + airtable_synced_at + full unique index
--    (same pattern as the other 7 synced tables — full index, not partial,
--    so PostgREST ON CONFLICT inference works; see migration 000053).
-- 2. created_by becomes nullable: rows synced from Airtable have no creator
--    profile. App-created incidents still set it.
-- 3. cost: Mantenimiento has "Costo (S/)".

ALTER TABLE public.incidents
  ADD COLUMN IF NOT EXISTS airtable_external_id TEXT,
  ADD COLUMN IF NOT EXISTS airtable_synced_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cost                 NUMERIC;

ALTER TABLE public.incidents
  ALTER COLUMN created_by DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS incidents_org_airtable_uniq
  ON public.incidents (org_id, airtable_external_id);
