CREATE TABLE IF NOT EXISTS import_logs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  import_type      TEXT NOT NULL CHECK (import_type IN ('tenant','payment','room_performance','financial')),
  file_name        TEXT,
  imported_by      UUID REFERENCES profiles(id) ON DELETE SET NULL,
  role             TEXT,
  status           TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','completed','failed','partial')),
  rows_received    INTEGER DEFAULT 0,
  rows_created     INTEGER DEFAULT 0,
  rows_updated     INTEGER DEFAULT 0,
  rows_skipped     INTEGER DEFAULT 0,
  rows_failed      INTEGER DEFAULT 0,
  validation_warnings JSONB DEFAULT '[]'::jsonb,
  error_details    JSONB DEFAULT '[]'::jsonb,
  airtable_sync_result JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at     TIMESTAMPTZ
);

ALTER TABLE import_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members can read own import logs"
  ON import_logs FOR SELECT
  USING (org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "service_role full access import_logs"
  ON import_logs FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- payments: link to import log
ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS import_id UUID REFERENCES import_logs(id) ON DELETE SET NULL;
