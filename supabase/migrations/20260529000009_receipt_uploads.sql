-- Migration 000009: receipt_uploads + indexes
-- Phase 2 — Module 1: OCR inbox

CREATE TABLE public.receipt_uploads (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  payment_id       uuid NULL REFERENCES public.payments(id) ON DELETE SET NULL,
  uploaded_by      uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  file_path        text NOT NULL,
  -- PII-adjacent: may show receipt names/amounts
  ocr_status       text NOT NULL DEFAULT 'pending'
                   CHECK (ocr_status IN ('pending','processing','extracted','failed','matched')),
  extracted_amount numeric(12,2) NULL,
  extracted_date   date NULL,
  extracted_vendor text NULL,
  confidence       numeric(4,3) NULL CHECK (confidence >= 0 AND confidence <= 1),
  ocr_error        text NULL,
  created_at       timestamptz DEFAULT now() NOT NULL,
  updated_at       timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX idx_receipt_uploads_org        ON public.receipt_uploads(org_id);
CREATE INDEX idx_receipt_uploads_org_status ON public.receipt_uploads(org_id, ocr_status);
CREATE INDEX idx_receipt_uploads_payment    ON public.receipt_uploads(payment_id);
CREATE INDEX idx_receipt_uploads_uploader   ON public.receipt_uploads(uploaded_by);

CREATE TRIGGER trg_receipt_uploads_updated
  BEFORE UPDATE ON public.receipt_uploads
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
