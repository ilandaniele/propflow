-- Migration 000018: payment_receipts table
-- Stores WhatsApp-sourced (and future manual) payment receipts with OCR results.
-- Source 'whatsapp' = inbound attachment; source 'manual' = admin dashboard upload (future).
-- RLS is applied in migration 000023.

CREATE TABLE IF NOT EXISTS public.payment_receipts (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  tenant_id           uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  source              text NOT NULL DEFAULT 'whatsapp'
                          CHECK (source IN ('whatsapp', 'manual')),
  whatsapp_message_id uuid NULL REFERENCES public.whatsapp_messages(id) ON DELETE SET NULL,
  image_path          text NOT NULL,        -- Supabase storage path in 'receipts' bucket
  image_sha256        text NOT NULL,        -- hex SHA-256 for duplicate detection
  extracted_amount    numeric(12, 2),
  extracted_date      date,
  extracted_vendor    text,
  confidence          numeric(4, 3),        -- 0.000–1.000 from OCR
  matched_charge_id   uuid NULL REFERENCES public.charges(id) ON DELETE SET NULL,
  matched_payment_id  uuid NULL REFERENCES public.payments(id) ON DELETE SET NULL,
  status              text NOT NULL DEFAULT 'pending_review'
                          CHECK (status IN (
                            'pending_review',
                            'auto_approved',
                            'admin_approved',
                            'rejected',
                            'duplicate_rejected'
                          )),
  rejection_reason    text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  -- One receipt per (org, image_sha256) — prevents duplicate processing
  CONSTRAINT payment_receipts_sha256_per_org UNIQUE (org_id, image_sha256)
);

CREATE INDEX IF NOT EXISTS idx_pr_org_status ON public.payment_receipts (org_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pr_tenant ON public.payment_receipts (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pr_sha256 ON public.payment_receipts (image_sha256); -- duplicate lookup
