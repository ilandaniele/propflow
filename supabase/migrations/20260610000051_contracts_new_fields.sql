-- Migration 000051: Add new fields for the Historial (Contratos) Airtable sync
-- (new base schema — "Untitled Base" apphwPe2oIkGRSTkb).
--
-- The contracts table was created with non-nullable FK columns (tenant_id, unit_id),
-- but the Airtable sync may upsert rows before links are resolved.
-- We add the airtable_synced_at column here; the airtable_external_id unique index
-- was already created in migration 000038.
--
-- Also extends service_payments.service_type CHECK to include 'otro'
-- (the new single-table schema has a Tipo de servicio select that may contain
-- values beyond the original 4 tokens).
--
-- Idempotent via ADD COLUMN IF NOT EXISTS and IF NOT EXISTS checks.

-- ─── contracts: add airtable_synced_at if not already present ─────────────
ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS airtable_synced_at TIMESTAMPTZ;

-- ─── payments: add receipt_url if not already present ─────────────────────
-- Stores the URL from Movimientos.Comprobante[0]
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS receipt_url TEXT;

-- ─── service_payments: extend service_type CHECK to include 'otro' ─────────
-- The original CHECK was ('agua','internet','gas','luz').
-- The new single "Pago de servicios" table may have other service types.
DO $$
BEGIN
  -- Drop the old constraint only if it exists and doesn't already include 'otro'
  IF EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'service_payments_service_type_check'
      AND constraint_catalog = current_database()
  ) THEN
    ALTER TABLE public.service_payments
      DROP CONSTRAINT IF EXISTS service_payments_service_type_check;
  END IF;
END $$;

ALTER TABLE public.service_payments
  ADD CONSTRAINT service_payments_service_type_check
    CHECK (service_type IN ('agua', 'internet', 'gas', 'luz', 'otro'));
