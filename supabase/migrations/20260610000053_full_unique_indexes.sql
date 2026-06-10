-- Migration 000053: Convert partial unique indexes to full composite unique indexes.
--
-- Root cause: PostgREST (Supabase .upsert with onConflict) generates
--   ON CONFLICT (org_id, airtable_external_id) DO UPDATE
-- WITHOUT the index predicate. Postgres cannot use a PARTIAL unique index
-- (WHERE airtable_external_id IS NOT NULL) for that conflict inference, so every
-- sync upsert failed with:
--   "there is no unique or exclusion constraint matching the ON CONFLICT specification"
--
-- Full (non-partial) unique indexes are safe here: in Postgres, NULLs never
-- conflict with each other (NULLS DISTINCT is the default), so rows without an
-- airtable_external_id remain unconstrained — identical semantics to the old
-- partial index, but usable by ON CONFLICT.
--
-- Idempotent: DROP IF EXISTS + CREATE IF NOT EXISTS.

-- properties
DROP INDEX IF EXISTS properties_airtable_external_id_uniq;
CREATE UNIQUE INDEX IF NOT EXISTS properties_org_airtable_uniq
  ON public.properties (org_id, airtable_external_id);

-- tenants
DROP INDEX IF EXISTS tenants_airtable_external_id_uniq;
CREATE UNIQUE INDEX IF NOT EXISTS tenants_org_airtable_uniq
  ON public.tenants (org_id, airtable_external_id);

-- contracts
DROP INDEX IF EXISTS contracts_airtable_external_id_uniq;
CREATE UNIQUE INDEX IF NOT EXISTS contracts_org_airtable_uniq
  ON public.contracts (org_id, airtable_external_id);

-- payments
DROP INDEX IF EXISTS payments_airtable_external_id_uniq;
CREATE UNIQUE INDEX IF NOT EXISTS payments_org_airtable_uniq
  ON public.payments (org_id, airtable_external_id);

-- units
DROP INDEX IF EXISTS units_org_airtable_ext_id_uidx;
CREATE UNIQUE INDEX IF NOT EXISTS units_org_airtable_uniq
  ON public.units (org_id, airtable_external_id);

-- responsables
DROP INDEX IF EXISTS responsables_org_airtable_ext_id_uidx;
CREATE UNIQUE INDEX IF NOT EXISTS responsables_org_airtable_uniq
  ON public.responsables (org_id, airtable_external_id);

-- service_payments
DROP INDEX IF EXISTS service_payments_org_airtable_ext_id_uidx;
CREATE UNIQUE INDEX IF NOT EXISTS service_payments_org_airtable_uniq
  ON public.service_payments (org_id, airtable_external_id);
