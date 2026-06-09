CREATE TABLE IF NOT EXISTS service_payments (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  property_id          UUID REFERENCES properties(id) ON DELETE SET NULL,
  airtable_external_id TEXT,           -- synthetic: record.id + '::' + service_type
  airtable_synced_at   TIMESTAMPTZ,
  service_type         TEXT NOT NULL,  -- 'agua' | 'internet' | 'gas' | 'luz'
  supply_number        TEXT,           -- N° suministro / código pago / N° cliente
  tope                 NUMERIC,        -- luz only: spending cap
  monthly_data         JSONB,          -- { "2026-01": { amount, eecc, receipt_url } }
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);

-- Unique: one row per (org, property, service_type) keyed by synthetic airtable id
CREATE UNIQUE INDEX IF NOT EXISTS service_payments_org_airtable_ext_id_uidx
  ON service_payments (org_id, airtable_external_id)
  WHERE airtable_external_id IS NOT NULL;

ALTER TABLE service_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members can read their service_payments"
  ON service_payments FOR SELECT
  USING (org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "service role can manage service_payments"
  ON service_payments FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
