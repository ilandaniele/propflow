-- Add external_tenant_id for CSV import deduplication
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS external_tenant_id TEXT,
  ADD COLUMN IF NOT EXISTS document_number    TEXT,
  ADD COLUMN IF NOT EXISTS date_of_birth      DATE,
  ADD COLUMN IF NOT EXISTS move_in_date       DATE,
  ADD COLUMN IF NOT EXISTS import_source      TEXT DEFAULT 'manual';

CREATE UNIQUE INDEX IF NOT EXISTS tenants_org_external_id_uidx
  ON tenants (org_id, external_tenant_id) WHERE external_tenant_id IS NOT NULL;
