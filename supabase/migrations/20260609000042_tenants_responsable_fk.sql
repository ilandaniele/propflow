-- Add responsable_id FK to tenants (nullable — filled by backfill after responsables sync)
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS responsable_id UUID REFERENCES responsables(id) ON DELETE SET NULL;
