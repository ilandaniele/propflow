CREATE TABLE IF NOT EXISTS responsables (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  airtable_external_id  TEXT,
  airtable_synced_at    TIMESTAMPTZ,
  full_name             TEXT,
  dni                   TEXT,
  phone                 TEXT,
  email                 TEXT,
  employment            TEXT,
  company               TEXT,
  job_title             TEXT,
  industry              TEXT,
  status                TEXT,
  photo_url             TEXT,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

-- Partial unique index
CREATE UNIQUE INDEX IF NOT EXISTS responsables_org_airtable_ext_id_uidx
  ON responsables (org_id, airtable_external_id)
  WHERE airtable_external_id IS NOT NULL;

-- RLS
ALTER TABLE responsables ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members can read their responsables"
  ON responsables FOR SELECT
  USING (
    org_id IN (
      SELECT org_id FROM profiles WHERE id = auth.uid()
    )
  );

CREATE POLICY "service role can manage responsables"
  ON responsables FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
