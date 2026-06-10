-- payments: currency, receipt, movement type, external import ID
ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'PEN',
  ADD COLUMN IF NOT EXISTS receipt_url TEXT,
  ADD COLUMN IF NOT EXISTS movement_type TEXT NOT NULL DEFAULT 'payment'
    CHECK (movement_type IN ('rent_charge','payment','partial_payment','deposit','sanction','discount','adjustment','refund','other')),
  ADD COLUMN IF NOT EXISTS external_payment_id TEXT,
  ADD COLUMN IF NOT EXISTS import_source TEXT DEFAULT 'manual'
    CHECK (import_source IN ('manual','csv_import','airtable','google_onboarding'));

CREATE UNIQUE INDEX IF NOT EXISTS payments_org_external_id_uidx
  ON payments (org_id, external_payment_id) WHERE external_payment_id IS NOT NULL;
